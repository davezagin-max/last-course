/**
 * The player's side of the game: a pure reducer and its selectors.
 *
 * All progress lives in the browser. The server is stateless: each request
 * carries what it needs (the transcript for one suspect, or the notebook for
 * the accusation), and each response is folded in here. Nothing in this file
 * knows the solution; it only ever sees the public case.
 */
import type { ApiMeta } from "@/lib/api";
import { withIds } from "@/lib/case/claims";
import { detectContradictions, type Contradiction } from "@/lib/case/contradictions";
import type { PublicCase } from "@/lib/case/public";
import { acceptLeads, motiveRevealed, startingEvidence, unlockEvidence } from "@/lib/case/reach";
import type { Accusation, Reveal } from "@/lib/case/score";
import { solve, sourcedFacts, type SolveResult } from "@/lib/case/solver";
import type { Claim, Evidence } from "@/lib/case/types";
import type { TurnRecord } from "@/lib/interrogation/conversation";
import type { TurnData } from "@/lib/interrogation/turn";

export interface PlayedTurn {
  /** Position in the whole game, used as a React key and to order the transcript. */
  n: number;
  suspect: string;
  question: string;
  /** Evidence put in front of the suspect with this question. */
  presents: string[];
  answer: string;
  /** The output guard replaced the model's answer. */
  blocked: boolean;
  /**
   * What the server needs to replay this turn. Only live, unblocked turns have
   * one: demo answers and blocked exchanges are never part of a model's history.
   */
  record: TurnRecord | null;
  claimIds: string[];
  /** Evidence this answer unlocked. */
  unlocked: string[];
  note: "history_reset" | "extraction_failed" | null;
  meta: ApiMeta | null;
}

export interface Point {
  x: number;
  y: number;
}

export interface GameState {
  caseId: string;
  /** The suspect in the chair. */
  suspect: string;
  turns: PlayedTurn[];
  claims: Claim[];
  leads: string[];
  /** Evidence ids in the order they were found. */
  found: string[];
  /** Where the player has dragged cards on the board. Missing ids use the default layout. */
  positions: Record<string, Point>;
  accusation: Accusation | null;
  reveal: Reveal | null;
}

export function initialState(pub: PublicCase): GameState {
  return {
    caseId: pub.id,
    suspect: pub.suspects[0]?.id ?? "",
    turns: [],
    claims: [],
    leads: [],
    found: startingEvidence(pub.evidence),
    positions: {},
    accusation: null,
    reveal: null,
  };
}

export type GameAction =
  | { type: "select"; suspect: string }
  | {
      type: "answered";
      suspect: string;
      question: string;
      presents: string[];
      data: TurnData;
      meta: ApiMeta | null;
    }
  | { type: "move"; id: string; to: Point }
  | { type: "tidy" }
  | { type: "revealed"; accusation: Accusation; reveal: Reveal }
  | { type: "reset" }
  | { type: "restore"; state: GameState };

/** Evidence a suspect has been shown, in order. A blocked exchange does not count. */
export function shownTo(state: GameState, suspect: string): string[] {
  return [
    ...new Set(
      state.turns.filter((t) => t.suspect === suspect && !t.blocked).flatMap((t) => t.presents),
    ),
  ];
}

export function turnsFor(state: GameState, suspect: string): PlayedTurn[] {
  return state.turns.filter((t) => t.suspect === suspect);
}

/** The sealed turns to send back to the server so it can rebuild this suspect's conversation. */
export function liveHistory(state: GameState, suspect: string): TurnRecord[] {
  return turnsFor(state, suspect).flatMap((t) => (t.record ? [t.record] : []));
}

export function reduce(pub: PublicCase, state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "select":
      return pub.suspects.some((s) => s.id === action.suspect)
        ? { ...state, suspect: action.suspect }
        : state;

    case "answered": {
      const { suspect, data } = action;
      const mine = turnsFor(state, suspect);
      const presents = data.blocked ? [] : action.presents;
      const shown = [...shownTo(state, suspect), ...presents];

      // The server already vetted live leads; demo replays are vetted here by the same rule.
      const leads = acceptLeads(pub.leads, suspect, data.leads, shown);
      const allLeads = [...new Set([...state.leads, ...leads])];
      const nowFound = unlockEvidence(pub.evidence, allLeads, state.found);
      const unlocked = nowFound.filter((id) => !state.found.includes(id));

      const claims = withIds(suspect, mine.length, data.claims);
      const record: TurnRecord | null =
        !data.blocked && data.seal && action.meta?.mode === "live"
          ? {
              question: action.question,
              evidenceIds: action.presents,
              assistantContent: data.assistantContent,
              seal: data.seal,
            }
          : null;

      // If the server could not verify the earlier turns it answered without them;
      // stop sending them so the next turn chains from this one.
      const earlier = data.historyReset
        ? state.turns.map((t) => (t.suspect === suspect ? { ...t, record: null } : t))
        : state.turns;

      const turn: PlayedTurn = {
        n: state.turns.length,
        suspect,
        question: action.question,
        presents,
        answer: data.answer,
        blocked: data.blocked,
        record,
        claimIds: claims.map((c) => c.id),
        unlocked,
        note: data.historyReset
          ? "history_reset"
          : data.extractionFailed
            ? "extraction_failed"
            : null,
        meta: action.meta,
      };
      return {
        ...state,
        turns: [...earlier, turn],
        claims: [...state.claims, ...claims],
        leads: allLeads,
        // Keep discovery order: newly unlocked evidence goes on the end.
        found: [...state.found, ...unlocked],
      };
    }

    case "move":
      return { ...state, positions: { ...state.positions, [action.id]: action.to } };

    case "tidy":
      return { ...state, positions: {} };

    case "revealed":
      return { ...state, accusation: action.accusation, reveal: action.reveal };

    case "reset":
      return initialState(pub);

    case "restore":
      return action.state.caseId === pub.id ? action.state : state;
  }
}

export function foundEvidence(pub: PublicCase, state: GameState): Evidence[] {
  const byId = new Map(pub.evidence.map((e) => [e.id, e]));
  return state.found.flatMap((id) => {
    const exhibit = byId.get(id);
    return exhibit ? [exhibit] : [];
  });
}

export function contradictionsIn(pub: PublicCase, state: GameState): Contradiction[] {
  return detectContradictions(state.claims, foundEvidence(pub, state), pub.window);
}

/** How many theories the evidence found so far still allows. */
export function theoriesLeft(pub: PublicCase, state: GameState): SolveResult {
  return solve(
    {
      suspects: pub.suspects.map((s) => s.id),
      methods: pub.methods,
      motives: pub.motives,
      window: pub.window,
    },
    sourcedFacts(foundEvidence(pub, state)),
  );
}

/** Motives the player has uncovered and may name in an accusation. */
export function knownMotives(pub: PublicCase, state: GameState): Set<string> {
  return new Set(
    pub.motives.filter((m) => motiveRevealed(m, state.found, state.leads)).map((m) => m.id),
  );
}

/** Suggested questions for a suspect, with what the player can and has done with each. */
export function questionsFor(pub: PublicCase, state: GameState, suspect: string) {
  const asked = new Set(turnsFor(state, suspect).map((t) => t.question));
  const found = new Set(state.found);
  return pub.questions
    .filter((q) => q.suspect === suspect)
    .map((q) => ({
      ...q,
      asked: asked.has(q.text),
      available: q.presents.every((id) => found.has(id)),
    }));
}
