"use client";

import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { useKey } from "@/components/kit/KeyProvider";
import { ThemeToggle } from "@/components/kit/ThemeToggle";
import type { GeneratedCase } from "@/app/api/generate/route";
import type { ApiMeta } from "@/lib/api";
import { namesOf, type CaseRef, type PublicCase } from "@/lib/case/public";
import type { Accusation as AccusationInput, Reveal } from "@/lib/case/score";
import { callApi, streamApi } from "@/lib/client";
import type { GenerateEvent } from "@/lib/generate/run";
import { MAX_THEME_CHARS, SAMPLE_DEMO_ID, SAMPLE_THEME } from "@/lib/generate/sample";
import {
  contradictionsIn,
  foundEvidence,
  initialState,
  knownMotives,
  liveHistory,
  reduce,
  theoriesLeft,
  type GameAction,
  type GameState,
} from "@/lib/game/state";
import { parseSaved, readSaved, save } from "@/lib/game/storage";
import type { TurnData } from "@/lib/interrogation/turn";
import { Accusation } from "./Accusation";
import { Board } from "./Board";
import { CaseFiles, type GenerationView } from "./CaseFiles";
import { ExhibitDialog } from "./ExhibitDialog";
import { Interrogation, type AskRequest } from "./Interrogation";
import { Notebook } from "./Notebook";
import { Portrait } from "./Portrait";
import { Timeline } from "./Timeline";

interface LoadedCase {
  pub: PublicCase;
  ref: CaseRef;
  generated: boolean;
}

interface Session {
  cases: LoadedCase[];
  activeId: string;
  games: Record<string, GameState>;
}

type SessionAction =
  | { type: "game"; caseId: string; action: GameAction }
  | { type: "add"; entry: LoadedCase }
  | { type: "open"; caseId: string };

function sessionReducer(session: Session, action: SessionAction): Session {
  switch (action.type) {
    case "game": {
      const entry = session.cases.find((c) => c.pub.id === action.caseId);
      const game = session.games[action.caseId];
      if (!entry || !game) return session;
      return {
        ...session,
        games: { ...session.games, [action.caseId]: reduce(entry.pub, game, action.action) },
      };
    }
    case "add": {
      const id = action.entry.pub.id;
      const known = session.cases.some((c) => c.pub.id === id);
      return {
        ...session,
        // Re-running a generation refreshes the sealed reference but keeps any progress.
        cases: known
          ? session.cases.map((c) => (c.pub.id === id ? action.entry : c))
          : [...session.cases, action.entry],
        games: known ? session.games : { ...session.games, [id]: initialState(action.entry.pub) },
      };
    }
    case "open":
      return session.cases.some((c) => c.pub.id === action.caseId)
        ? { ...session, activeId: action.caseId }
        : session;
  }
}

const TABS = [
  { id: "question", label: "Question" },
  { id: "board", label: "Board" },
  { id: "timeline", label: "Timeline" },
  { id: "accuse", label: "Accuse" },
  { id: "cases", label: "Case files" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const IDLE: GenerationView = {
  status: "idle",
  drafting: null,
  chars: 0,
  attempts: [],
  error: null,
  meta: null,
  caseId: null,
};

const subscribeToNothing = () => () => {};

/**
 * Restores saved progress without a hydration mismatch: the server and the
 * first client render both start a fresh game, then the saved one (if any) is
 * mounted in its place.
 */
export function Game({ initialCase }: { initialCase: PublicCase }) {
  const raw = useSyncExternalStore(
    subscribeToNothing,
    () => readSaved(initialCase.id),
    () => null,
  );
  const saved = useMemo(() => parseSaved(initialCase, raw), [initialCase, raw]);
  return <Table key={saved ? "restored" : "fresh"} initialCase={initialCase} saved={saved} />;
}

function Table({ initialCase, saved }: { initialCase: PublicCase; saved: GameState | null }) {
  const { apiKey, isLive, openKeyModal } = useKey();
  const [session, dispatch] = useReducer(sessionReducer, initialCase, (pub): Session => ({
    cases: [{ pub, ref: { id: pub.id }, generated: false }],
    activeId: pub.id,
    games: { [pub.id]: saved ?? initialState(pub) },
  }));
  // Only the built-in case is saved: a generated case's sealed reference may not outlive the server.
  const builtIn = session.games[initialCase.id];
  useEffect(() => {
    save(builtIn);
  }, [builtIn]);
  const [tab, setTab] = useState<TabId>("question");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<ApiMeta | null>(null);
  const [typing, setTyping] = useState<{ caseId: string; n: number } | null>(null);
  const [exhibitId, setExhibitId] = useState<string | null>(null);
  const [accusing, setAccusing] = useState(false);
  const [accuseError, setAccuseError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<GenerationView>(IDLE);

  const entry = session.cases.find((c) => c.pub.id === session.activeId) ?? session.cases[0];
  const { pub, ref } = entry;
  const state = session.games[pub.id];
  const play = (action: GameAction) => dispatch({ type: "game", caseId: pub.id, action });

  const names = useMemo(() => namesOf(pub), [pub]);
  const found = useMemo(() => foundEvidence(pub, state), [pub, state]);
  const contradictions = useMemo(() => contradictionsIn(pub, state), [pub, state]);
  const theories = useMemo(() => theoriesLeft(pub, state), [pub, state]);
  const motives = useMemo(() => knownMotives(pub, state), [pub, state]);
  const conflictCount = new Set(contradictions.map((c) => `${c.rule}:${c.subject}`)).size;

  async function ask(request: AskRequest) {
    if (busy) return;
    const suspect = state.suspect;
    const caseId = pub.id;
    setBusy(true);
    setError(null);
    const body = {
      // A demoId is only a fixture key; a live question is always answered live.
      ...(!isLive && request.demoId ? { demoId: request.demoId } : {}),
      case: ref,
      suspectId: suspect,
      question: request.text,
      evidenceIds: request.presents,
      history: isLive ? liveHistory(state, suspect) : [],
    };
    const response = await callApi<TurnData>("/api/interrogate", body, apiKey);
    setBusy(false);
    setLastMeta(response.meta ?? null);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    // The new turn takes the next index; type its answer out once.
    setTyping({ caseId, n: state.turns.length });
    dispatch({
      type: "game",
      caseId,
      action: {
        type: "answered",
        suspect,
        question: request.text,
        presents: request.presents,
        data: response.data,
        meta: response.meta,
      },
    });
  }

  /** Changing view ends any typing animation, so coming back shows the finished transcript. */
  function show(next: TabId) {
    setTyping(null);
    setTab(next);
  }

  async function accuse(accusation: AccusationInput) {
    setAccusing(true);
    setAccuseError(null);
    const caseId = pub.id;
    // No key is sent: scoring is deterministic and this route never calls a model.
    const response = await callApi<Reveal>(
      "/api/accuse",
      { case: ref, accusation, found: state.found, claims: state.claims },
      null,
    );
    setAccusing(false);
    if (!response.ok) {
      setAccuseError(response.error.message);
      return;
    }
    dispatch({
      type: "game",
      caseId,
      action: { type: "revealed", accusation, reveal: response.data },
    });
    window.scrollTo({ top: 0 });
  }

  async function generate(theme: string) {
    setGeneration({ ...IDLE, status: "running", drafting: 1 });
    const body = { ...(isLive ? {} : { demoId: SAMPLE_DEMO_ID }), theme };
    const response = await streamApi<GeneratedCase, GenerateEvent>("/api/generate", body, apiKey, {
      onEvent: (event) =>
        setGeneration((view) => {
          if (event.type === "drafting") return { ...view, drafting: event.attempt, chars: 0 };
          if (event.type === "progress") return { ...view, chars: event.chars };
          return {
            ...view,
            attempts: [...view.attempts.filter((a) => a.n !== event.attempt.n), event.attempt],
          };
        }),
    });
    if (!response.ok) {
      setGeneration((view) => ({
        ...view,
        status: "error",
        drafting: null,
        error: response.error.message,
        meta: response.meta ?? null,
      }));
      return;
    }
    const { publicCase, ref: sealed, attempts } = response.data;
    dispatch({ type: "add", entry: { pub: publicCase, ref: sealed, generated: true } });
    setGeneration({
      status: "done",
      drafting: null,
      chars: 0,
      attempts,
      error: null,
      meta: response.meta,
      caseId: publicCase.id,
    });
  }

  function openCase(caseId: string) {
    dispatch({ type: "open", caseId });
    setError(null);
    setAccuseError(null);
    setLastMeta(null);
    show("question");
  }

  const exhibit = exhibitId
    ? (pub.evidence.find((e) => e.id === exhibitId && state.found.includes(e.id)) ?? null)
    : null;
  const solved = state.reveal !== null;

  return (
    <>
      <header className="on-band border-b border-band-border bg-band text-band-fg">
        <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-3 px-4 pb-4 pt-5 lg:px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.28em] text-brass">
                Last Course
              </p>
              <h1 className="font-display text-3xl leading-tight sm:text-4xl">{pub.title}</h1>
              <p className="text-sm text-band-muted">
                {pub.restaurant} · {pub.date} · The victim: {pub.victim.name},{" "}
                {lowerFirst(pub.victim.role)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <dl className="flex items-stretch divide-x divide-band-border rounded-md border border-band-border text-center">
                <Stat label="Exhibits" value={`${state.found.length}/${pub.evidence.length}`} />
                <Stat label="Conflicts" value={String(conflictCount)} alert={conflictCount > 0} />
                <Stat
                  label="Theories left"
                  value={`${theories.survivors.length}/${theories.total}`}
                />
              </dl>
              <ThemeToggle className="border-band-border! text-band-fg! hover:bg-white/10!" />
            </div>
          </div>
          {/* Always open where there is room; a disclosure on small screens so the game stays near the top. */}
          <div className="hidden gap-x-8 text-sm leading-relaxed text-band-muted md:grid md:grid-cols-3">
            {pub.briefing.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <details className="text-sm text-band-muted md:hidden">
            <summary className="cursor-pointer leading-relaxed">
              {pub.tagline}{" "}
              <span className="whitespace-nowrap font-medium text-brass underline underline-offset-2">
                Read the briefing
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-2 leading-relaxed">
              {pub.briefing.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </details>
        </div>
        <nav
          aria-label="Views"
          className="mx-auto w-full max-w-[90rem] overflow-x-auto px-4 lg:px-6"
        >
          <ul className="flex gap-1">
            {TABS.map((t) => {
              const current = tab === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-current={current ? "page" : undefined}
                    onClick={() => show(t.id)}
                    className={`whitespace-nowrap rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium ${
                      current
                        ? "border-band-border bg-bg text-fg"
                        : "border-transparent text-band-muted hover:text-band-fg"
                    }`}
                  >
                    {t.id === "accuse" && solved ? "The reveal" : t.label}
                    {t.id === "board" && (
                      <span className="ml-1.5 font-mono text-xs opacity-70">
                        {state.found.length}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 lg:px-6">
        {tab === "question" && (
          <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_22rem]">
            <nav aria-label="Suspects" className="min-w-0">
              <h2 className="label mb-2">In the chair</h2>
              <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
                {pub.suspects.map((s) => {
                  const active = s.id === state.suspect;
                  const asked = state.turns.filter((t) => t.suspect === s.id).length;
                  return (
                    <li key={s.id} className="shrink-0">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          play({ type: "select", suspect: s.id });
                          setError(null);
                          setTyping(null);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left ${
                          active
                            ? "border-accent bg-accent-soft"
                            : "border-border bg-surface hover:border-accent"
                        }`}
                      >
                        <Portrait monogram={s.monogram} size={40} active={active} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{s.name}</span>
                          <span className="block truncate text-xs text-muted">{s.role}</span>
                        </span>
                        {asked > 0 && (
                          <span
                            className="shrink-0 rounded bg-raised px-1.5 font-mono text-xs text-muted"
                            title={`${asked} asked`}
                          >
                            {asked}
                            <span className="sr-only"> questions asked</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => show("accuse")}
                className="mt-3 hidden w-full rounded-md border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft lg:block"
              >
                {solved ? "See the reveal" : "Make an accusation"}
              </button>
            </nav>

            <Interrogation
              pub={pub}
              state={state}
              isLive={isLive}
              busy={busy}
              error={error}
              lastMeta={lastMeta}
              typingTurn={typing?.caseId === pub.id ? typing.n : null}
              contradictions={contradictions}
              onAsk={ask}
              onOpenExhibit={setExhibitId}
              onOpenNotebook={() =>
                document
                  .getElementById("notebook")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              onAddKey={openKeyModal}
            />

            <Notebook
              pub={pub}
              state={state}
              names={names}
              found={found}
              contradictions={contradictions}
              onOpenExhibit={setExhibitId}
            />
          </div>
        )}

        {tab === "board" && (
          <Board
            pub={pub}
            state={state}
            found={found}
            contradictions={contradictions}
            onMove={(id, to) => play({ type: "move", id, to })}
            onTidy={() => play({ type: "tidy" })}
            onOpenExhibit={setExhibitId}
            onQuestion={(suspect) => {
              play({ type: "select", suspect });
              show("question");
            }}
          />
        )}

        {tab === "timeline" && (
          <Timeline
            pub={pub}
            state={state}
            names={names}
            found={found}
            contradictions={contradictions}
          />
        )}

        {tab === "accuse" && (
          <Accusation
            pub={pub}
            state={state}
            theories={theories}
            knownMotives={motives}
            busy={accusing}
            error={accuseError}
            onAccuse={accuse}
            onRestart={() => {
              play({ type: "reset" });
              show("question");
              setLastMeta(null);
            }}
          />
        )}

        {tab === "cases" && (
          <CaseFiles
            cases={session.cases.map((c) => ({
              pub: c.pub,
              generated: c.generated,
              asked: session.games[c.pub.id]?.turns.length ?? 0,
            }))}
            activeId={pub.id}
            isLive={isLive}
            generation={generation}
            sampleTheme={SAMPLE_THEME}
            maxTheme={MAX_THEME_CHARS}
            onOpen={openCase}
            onRestart={(caseId) => dispatch({ type: "game", caseId, action: { type: "reset" } })}
            onGenerate={generate}
            onAddKey={openKeyModal}
          />
        )}
      </main>

      <ExhibitDialog exhibit={exhibit} names={names} onClose={() => setExhibitId(null)} />
    </>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function Stat({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex flex-col-reverse px-3 py-1.5">
      <dt className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-band-muted">
        {label}
      </dt>
      <dd className={`font-mono text-sm ${alert ? "text-brass" : "text-band-fg"}`}>{value}</dd>
    </div>
  );
}
