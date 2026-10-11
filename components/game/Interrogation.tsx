"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CostMeter } from "@/components/kit/CostMeter";
import type { ApiMeta } from "@/lib/api";
import type { Contradiction } from "@/lib/case/contradictions";
import type { PublicCase } from "@/lib/case/public";
import { questionsFor, shownTo, turnsFor, type GameState, type PlayedTurn } from "@/lib/game/state";
import { MAX_EVIDENCE_PER_TURN, MAX_QUESTION_CHARS, MAX_TURNS } from "@/lib/interrogation/limits";
import { Portrait } from "./Portrait";
import { Typed } from "./Typed";

export interface AskRequest {
  text: string;
  presents: string[];
  /** Set for a suggested question: the key of its recorded answer. */
  demoId: string | null;
}

interface Props {
  pub: PublicCase;
  state: GameState;
  isLive: boolean;
  busy: boolean;
  error: string | null;
  lastMeta: ApiMeta | null;
  contradictions: Contradiction[];
  onAsk: (request: AskRequest) => void;
  onOpenExhibit: (id: string) => void;
  onOpenNotebook: () => void;
  onAddKey: () => void;
}

export function Interrogation(props: Props) {
  const { pub, state, isLive, busy, error, onAsk } = props;
  const suspect = pub.suspects.find((s) => s.id === state.suspect) ?? pub.suspects[0];
  const turns = turnsFor(state, suspect.id);
  const questions = questionsFor(pub, state, suspect.id);
  const open = questions.filter((q) => q.available);
  const locked = questions.length - open.length;
  const liveTurns = turns.filter((t) => t.record).length;
  const outOfTurns = isLive && liveTurns >= MAX_TURNS;
  const titles = new Map(pub.evidence.map((e) => [e.id, e.title]));

  const log = useRef<HTMLDivElement>(null);
  const latest = state.turns.length;
  useEffect(() => {
    // Keep the newest exchange in view by scrolling the transcript itself, never the page.
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [latest, busy, suspect.id]);

  return (
    <section aria-label={`Interrogation of ${suspect.name}`} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Portrait monogram={suspect.monogram} size={48} />
        <div className="min-w-0">
          <h2 className="font-display text-xl leading-tight">{suspect.name}</h2>
          <p className="line-clamp-2 text-sm text-muted sm:line-clamp-1">
            {suspect.role}. {suspect.blurb}
          </p>
        </div>
      </header>

      <div
        ref={log}
        className="flex max-h-[26rem] min-h-28 flex-col gap-4 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-label="Transcript"
        tabIndex={0}
      >
        <Bubble who={suspect.short}>{suspect.opening}</Bubble>
        {turns.map((turn) => (
          <Exchange key={turn.n} turn={turn} suspect={suspect.short} fresh={turn.n === latest - 1} {...props} titles={titles} />
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="font-medium text-fg">{suspect.short}</span> is choosing their words
            <span className="dots" aria-hidden>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
        {questions.length > 0 ? (
          <>
            <h3 className="label">{isLive ? "Suggested questions" : "Ask a question"}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {open.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    disabled={busy || outOfTurns}
                    onClick={() => onAsk({ text: q.text, presents: q.presents, demoId: q.id })}
                    className={`group flex h-full w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      q.asked
                        ? "border-border text-muted hover:border-accent"
                        : q.presents.length
                          ? "border-accent bg-accent-soft hover:bg-raised"
                          : "border-border bg-raised hover:border-accent"
                    }`}
                  >
                    {q.presents.length > 0 && (
                      <span className="label text-accent!">Show: {q.presents.map((id) => titles.get(id) ?? id).join(", ")}</span>
                    )}
                    <span>{q.text}</span>
                    {q.asked && <span className="text-xs text-muted">Asked</span>}
                  </button>
                </li>
              ))}
            </ul>
            {locked > 0 && (
              <p className="text-xs text-muted">
                {locked} more {locked === 1 ? "question opens" : "questions open"} up as you find evidence to put in front of {suspect.short}.
              </p>
            )}
          </>
        ) : (
          !isLive && (
            <p className="rounded-md border border-border bg-raised px-3 py-3 text-sm text-muted">
              This case has no recorded answers, so it cannot be played in demo mode. Add your key and {suspect.short} will answer anything you ask, live.
            </p>
          )
        )}

        {isLive ? (
          outOfTurns ? (
            <p className="text-sm text-muted">
              {suspect.short} has answered {MAX_TURNS} questions and will not take any more. Question someone else, or make your accusation.
            </p>
          ) : (
            <FreeForm {...props} suspect={suspect.short} shown={shownTo(state, suspect.id)} titles={titles} />
          )
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
            <span>Demo mode plays the questions above. To ask anything you like, in your own words:</span>
            <button type="button" onClick={props.onAddKey} className="rounded-md border border-accent px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft">
              Add your key
            </button>
          </div>
        )}
        <CostMeter meta={props.lastMeta} />
      </div>
    </section>
  );
}

function Bubble({ who, children }: { who: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[46rem]">
      <p className="label mb-1">{who}</p>
      <div className="rounded-md rounded-tl-none border border-border bg-raised px-3.5 py-2.5 text-[0.95rem] leading-relaxed">{children}</div>
    </div>
  );
}

function Exchange({
  turn,
  suspect,
  fresh,
  pub,
  contradictions,
  titles,
  onOpenExhibit,
  onOpenNotebook,
}: Props & { turn: PlayedTurn; suspect: string; fresh: boolean; titles: Map<string, string> }) {
  const mine = new Set(turn.claimIds);
  const conflicts = contradictions.filter((c) => [c.a, c.b].some((s) => s.type === "claim" && mine.has(s.id))).length;
  const notes = turn.claimIds.length;
  return (
    <div className={`flex flex-col gap-3 ${fresh ? "rise" : ""}`}>
      <div className="ml-auto max-w-[40rem]">
        <p className="label mb-1 text-right">You</p>
        <div className="rounded-md rounded-tr-none bg-accent px-3.5 py-2.5 text-[0.95rem] leading-relaxed text-accent-fg">
          {turn.presents.length > 0 && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider opacity-80">
              Exhibit shown: {turn.presents.map((id) => titles.get(id) ?? id).join(", ")}
            </p>
          )}
          {turn.question}
        </div>
      </div>
      <Bubble who={suspect}>
        <Typed text={turn.answer} animate={fresh} />
      </Bubble>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-xs text-muted">
        {turn.blocked ? (
          <span className="text-danger">
            The output guard caught an out-of-character answer and replaced it. That exchange was dropped from {suspect}&apos;s memory.
          </span>
        ) : (
          <>
            <button type="button" onClick={onOpenNotebook} className="underline-offset-2 hover:text-fg hover:underline">
              {notes === 0 ? "Nothing checkable in that answer" : `${notes} ${notes === 1 ? "note" : "notes"} in the notebook`}
            </button>
            {conflicts > 0 && (
              <button type="button" onClick={onOpenNotebook} className="font-semibold text-danger underline-offset-2 hover:underline">
                {conflicts} {conflicts === 1 ? "conflict" : "conflicts"}
              </button>
            )}
          </>
        )}
        {turn.unlocked.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpenExhibit(id)}
            className="rounded border border-accent bg-accent-soft px-1.5 py-0.5 font-medium text-accent hover:bg-raised"
          >
            New exhibit: {pub.evidence.find((e) => e.id === id)?.title ?? id}
          </button>
        ))}
        {turn.note === "history_reset" && <span>The server could not verify the earlier conversation, so {suspect} answered without it.</span>}
        {turn.note === "extraction_failed" && <span>The notebook call failed for this answer; nothing was filed.</span>}
      </div>
    </div>
  );
}

function FreeForm({
  pub,
  state,
  busy,
  onAsk,
  suspect,
  shown,
  titles,
}: Props & { suspect: string; shown: string[]; titles: Map<string, string> }) {
  const [text, setText] = useState("");
  const [presents, setPresents] = useState<string[]>([]);
  const inputId = useId();
  const unseen = state.found.filter((id) => !shown.includes(id));
  // Evidence the suspect has since been shown drops out of the selection.
  const selected = presents.filter((id) => unseen.includes(id));

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = text.trim();
    if (!question || busy) return;
    onAsk({ text: question, presents: selected, demoId: null });
    setText("");
    setPresents([]);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={inputId} className="label">
        Or ask {suspect} anything
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          autoComplete="off"
          placeholder={`Your question for ${suspect}`}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50">
          Ask
        </button>
      </div>
      {unseen.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Exhibits to put in front of {suspect} with this question</legend>
          <span aria-hidden className="text-xs text-muted">
            Show with it:
          </span>
          {unseen.map((id) => {
            const on = selected.includes(id);
            const full = !on && selected.length >= MAX_EVIDENCE_PER_TURN;
            return (
              <label
                key={id}
                className={`cursor-pointer rounded border px-2 py-1 text-xs has-focus-visible:outline-2 has-focus-visible:outline-accent ${
                  on ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:border-accent"
                } ${full ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={full}
                  onChange={() => setPresents(on ? selected.filter((x) => x !== id) : [...selected, id])}
                />
                {titles.get(id) ?? pub.evidence.find((e) => e.id === id)?.title ?? id}
              </label>
            );
          })}
        </fieldset>
      )}
    </form>
  );
}
