/**
 * The accusation and the reveal. Runs on the server only: this is the one
 * place the solution leaves the case file, and only after the player commits.
 *
 * Scoring is arithmetic on ids, so the reveal can say exactly what the player
 * got right. The explanation of why each innocent suspect is cleared is taken
 * from the solver's own eliminations, not written by hand.
 */
import { claimVerdict, matchesPattern, type Verdict } from "./claims";
import { detectContradictions } from "./contradictions";
import { eliminationText } from "./explain";
import { namesOf } from "./public";
import { solveCase } from "./validate";
import type { CaseFile, Claim } from "./types";

export interface Accusation {
  culprit: string;
  method: string;
  /** Null when the player could not name a motive. */
  motive: string | null;
}

export interface Casework {
  /** Evidence ids the player found. */
  found: string[];
  /** The player's notebook. */
  claims: Claim[];
}

export const POINTS = { culprit: 50, method: 20, motive: 20, casework: 10 } as const;

export interface RevealLine {
  id: "culprit" | "method" | "motive" | "casework";
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface Reveal {
  score: number;
  rank: string;
  rankNote: string;
  correct: { culprit: boolean; method: boolean; motive: boolean };
  breakdown: RevealLine[];
  solution: {
    culprit: { id: string; name: string };
    method: { id: string; label: string };
    motive: { id: string; label: string };
    narrative: string[];
    confession: string;
  };
  /** Why the evidence clears each innocent suspect. */
  cleared: { suspect: string; name: string; reason: string; evidence: { id: string; title: string }[] }[];
  /** Every lie in the case, and whether the player's notebook caught it. */
  lies: { suspect: string; name: string; topic: string; says: string; truth: string; caught: boolean }[];
  /** Verdict on each notebook claim, by claim id. */
  claims: Record<string, Verdict>;
  missed: { id: string; title: string }[];
  theories: number;
}

const RANKS: { min: number; rank: string; note: string }[] = [
  { min: 95, rank: "Chef de cuisine", note: "Who, how, and why, with the paperwork to prove it. You ran this case like a pass on a Saturday." },
  { min: 70, rank: "Sous chef", note: "You had the right person. The file still has a gap or two a defence lawyer would enjoy." },
  { min: 40, rank: "Commis", note: "Part of this plate was right. Not the part that matters most." },
  { min: 0, rank: "Stagiaire", note: "The wrong person is in handcuffs and the right one is drying glasses." },
];

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function scoreAccusation(kase: CaseFile, accusation: Accusation, casework: Casework): Reveal {
  const sol = kase.solution;
  const names = namesOf(kase);
  const culprit = kase.suspects.find((s) => s.id === sol.culprit);
  const method = kase.methods.find((m) => m.id === sol.method);
  const motive = kase.motives.find((m) => m.id === sol.motive);
  if (!culprit || !method || !motive) throw new Error("Case file has no valid solution.");

  const correct = {
    culprit: accusation.culprit === sol.culprit,
    method: accusation.method === sol.method,
    motive: accusation.motive === sol.motive,
  };

  // Only evidence and claims that belong to this case count.
  const found = kase.evidence.filter((e) => casework.found.includes(e.id));
  const speakers = new Set(kase.suspects.map((s) => s.id));
  const claims = casework.claims.filter((c) => speakers.has(c.speaker));

  const contradictions = detectContradictions(claims, found, kase.window);
  const flagged = new Set(
    contradictions.flatMap((c) => [c.a, c.b]).flatMap((s) => (s.type === "claim" ? [s.id] : [])),
  );
  const lies = kase.suspects.flatMap((s) =>
    s.lies.map((lie) => ({
      suspect: s.id,
      name: s.short,
      topic: lie.topic,
      says: lie.says,
      truth: lie.truth,
      caught: claims.some(
        (c) =>
          c.speaker === s.id &&
          flagged.has(c.id) &&
          lie.asserts.some((pattern) => matchesPattern(c, pattern, kase.window)),
      ),
    })),
  );
  const caught = lies.filter((l) => l.caught).length;
  const casePoints = Math.round(
    (POINTS.casework / 2) * (found.length / kase.evidence.length) +
      (POINTS.casework / 2) * (lies.length ? caught / lies.length : 1),
  );

  const accusedName = names.person(accusation.culprit);
  const breakdown: RevealLine[] = [
    {
      id: "culprit",
      label: "Who",
      points: correct.culprit ? POINTS.culprit : 0,
      max: POINTS.culprit,
      note: correct.culprit
        ? `${culprit.name} did it. You named the right person.`
        : `You accused ${accusedName}. It was ${culprit.name}.`,
    },
    {
      id: "method",
      label: "How",
      points: correct.method ? POINTS.method : 0,
      max: POINTS.method,
      note: correct.method ? `Right: ${lowerFirst(method.label)}.` : `It was ${lowerFirst(method.label)}.`,
    },
    {
      id: "motive",
      label: "Why",
      points: correct.motive ? POINTS.motive : 0,
      max: POINTS.motive,
      note: correct.motive
        ? `Right: ${lowerFirst(motive.label)}.`
        : accusation.motive === null
          ? `You named no motive. It was ${lowerFirst(motive.label)}.`
          : `The real reason: ${lowerFirst(motive.label)}.`,
    },
    {
      id: "casework",
      label: "Casework",
      points: casePoints,
      max: POINTS.casework,
      note: `You found ${found.length} of ${count(kase.evidence.length, "exhibit")} and caught ${caught} of ${count(lies.length, "lie")} in a contradiction.`,
    },
  ];
  const score = breakdown.reduce((total, line) => total + line.points, 0);
  const rank = RANKS.find((r) => score >= r.min) ?? RANKS[RANKS.length - 1];

  const solved = solveCase(kase);
  const titles = new Map(kase.evidence.map((e) => [e.id, e.title]));
  const cleared = kase.suspects
    .filter((s) => s.id !== sol.culprit)
    .map((s) => {
      const mine = solved.eliminated.filter((e) => e.theory.culprit === s.id);
      // Prefer the reason that clears them of the real method: that is the alibi.
      const best =
        mine.find((e) => e.theory.method === sol.method && e.rule !== "motive") ??
        mine.find((e) => e.theory.method === sol.method) ??
        mine[0];
      return {
        suspect: s.id,
        name: s.name,
        reason: best ? eliminationText(names, best, kase.methods) : "Nothing in the evidence rules them out.",
        evidence: (best?.evidence ?? []).map((id) => ({ id, title: titles.get(id) ?? id })),
      };
    });

  return {
    score,
    rank: rank.rank,
    rankNote: rank.note,
    correct,
    breakdown,
    solution: {
      culprit: { id: culprit.id, name: culprit.name },
      method: { id: method.id, label: method.label },
      motive: { id: motive.id, label: motive.label },
      narrative: [...sol.narrative],
      confession: sol.confession,
    },
    cleared,
    lies,
    claims: Object.fromEntries(claims.map((c) => [c.id, claimVerdict(kase, c)])),
    missed: kase.evidence.filter((e) => !casework.found.includes(e.id)).map((e) => ({ id: e.id, title: e.title })),
    theories: solved.total,
  };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
