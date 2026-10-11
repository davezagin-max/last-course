"use client";

import { useState } from "react";
import type { PublicCase } from "@/lib/case/public";
import type { Accusation as AccusationInput, Reveal } from "@/lib/case/score";
import type { SolveResult } from "@/lib/case/solver";
import type { GameState } from "@/lib/game/state";
import { Portrait } from "./Portrait";

interface Props {
  pub: PublicCase;
  state: GameState;
  theories: SolveResult;
  knownMotives: Set<string>;
  busy: boolean;
  error: string | null;
  onAccuse: (accusation: AccusationInput) => void;
  onRestart: () => void;
}

export function Accusation(props: Props) {
  if (props.state.reveal) return <RevealView {...props} reveal={props.state.reveal} />;
  return <AccusationForm {...props} />;
}

function AccusationForm({ pub, state, theories, knownMotives, busy, error, onAccuse }: Props) {
  const [culprit, setCulprit] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [motive, setMotive] = useState<string | null>(null);

  const motives = pub.motives.filter((m) => m.suspect === culprit);
  const chosenMotive = motives.some((m) => m.id === motive) ? motive : null;
  const hidden = motives.filter((m) => !knownMotives.has(m.id)).length;
  const ready = culprit !== null && method !== null;
  const standing = new Set(theories.survivors.map((t) => t.culprit));

  return (
    <section aria-label="Accusation" className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h2 className="font-display text-2xl">Make your accusation</h2>
        <p className="text-muted">
          Name who did it, how, and why. You get one accusation, and it is scored against the case file: 50 for the culprit, 20 for the method, 20 for the motive, 10 for casework.
        </p>
      </header>

      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <p className="label">What your evidence allows</p>
        <p className="mt-1">
          <span className="font-display text-2xl">{theories.survivors.length}</span>{" "}
          <span className="text-muted">
            of {theories.total} possible theories still fit the {state.found.length} of {pub.evidence.length} exhibits you have found.
          </span>
        </p>
        <p className="mt-1 text-sm text-muted">
          A theory is one suspect, one method, one motive. Each exhibit can rule theories out: an alibi for the right minutes, a lab result, a motive that falls apart.
          {theories.survivors.length === 1 && " You are down to one."}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">Who</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pub.suspects.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 has-focus-visible:outline-2 has-focus-visible:outline-accent ${
                culprit === s.id ? "border-accent bg-accent-soft" : "border-border bg-raised hover:border-accent"
              }`}
            >
              <input
                type="radio"
                name="culprit"
                className="sr-only"
                checked={culprit === s.id}
                onChange={() => {
                  setCulprit(s.id);
                  setMotive(null);
                }}
              />
              <Portrait monogram={s.monogram} size={40} active={culprit === s.id} />
              <span className="min-w-0">
                <span className="block font-medium">{s.name}</span>
                <span className="block text-xs text-muted">
                  {s.role}
                  {!standing.has(s.id) && " · ruled out by your evidence"}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">How</legend>
        {pub.methods.map((m) => (
          <Choice key={m.id} name="method" checked={method === m.id} onChange={() => setMethod(m.id)}>
            {m.label}
          </Choice>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">Why</legend>
        {culprit === null ? (
          <p className="text-sm text-muted">Choose a suspect to see the motives you have uncovered for them.</p>
        ) : (
          <>
            {motives
              .filter((m) => knownMotives.has(m.id))
              .map((m) => (
                <Choice key={m.id} name="motive" checked={chosenMotive === m.id} onChange={() => setMotive(m.id)}>
                  {m.label}
                </Choice>
              ))}
            <Choice name="motive" checked={chosenMotive === null} onChange={() => setMotive(null)}>
              I cannot say why
            </Choice>
            {hidden > 0 && (
              <p className="text-sm text-muted">
                {hidden} possible {hidden === 1 ? "motive" : "motives"} for this suspect {hidden === 1 ? "is" : "are"} still undiscovered. Motives come to light through evidence and questioning.
              </p>
            )}
          </>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => culprit && method && onAccuse({ culprit, method, motive: chosenMotive })}
          className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-fg disabled:opacity-50"
        >
          {busy ? "Checking the case file…" : "Accuse"}
        </button>
        {!ready && <span className="text-sm text-muted">Choose a suspect and a method first.</span>}
      </div>
    </section>
  );
}

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-accent ${
        checked ? "border-accent bg-accent-soft" : "border-border bg-raised hover:border-accent"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5 size-4 accent-(--accent)" />
      <span>{children}</span>
    </label>
  );
}

function RevealView({ pub, state, reveal, onRestart }: Props & { reveal: Reveal }) {
  const culprit = pub.suspects.find((s) => s.id === reveal.solution.culprit.id);
  const verdicts = Object.values(reveal.claims);
  const told = verdicts.filter((v) => v === "false").length;

  return (
    <section aria-label="The reveal" className="mx-auto flex w-full max-w-3xl flex-col gap-7">
      <header className="flex flex-wrap items-center gap-5 rounded-lg border border-accent bg-surface p-5">
        <div className="flex size-24 shrink-0 flex-col items-center justify-center rounded-full border-2 border-accent">
          <span className="font-display text-4xl leading-none">{reveal.score}</span>
          <span className="text-[0.6875rem] text-muted">out of 100</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="label">{reveal.correct.culprit ? "Case closed" : "Case not closed"}</p>
          <h2 className="font-display text-3xl leading-tight">{reveal.rank}</h2>
          <p className="text-muted">{reveal.rankNote}</p>
        </div>
      </header>

      <div>
        <h3 className="label mb-2">Your accusation, line by line</h3>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {reveal.breakdown.map((line) => {
            const full = line.points === line.max;
            return (
              <li key={line.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`w-16 shrink-0 font-mono text-sm ${full ? "text-success" : line.points > 0 ? "text-fg" : "text-danger"}`}>
                  {line.points}/{line.max}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{line.label}.</span> <span className="text-muted">{line.note}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          {culprit && <Portrait monogram={culprit.monogram} size={52} active />}
          <div>
            <p className="label">What happened</p>
            <h3 className="font-display text-2xl leading-tight">{reveal.solution.culprit.name}</h3>
          </div>
        </div>
        <ol className="mt-4 flex flex-col gap-2.5 border-l border-accent pl-4">
          {reveal.solution.narrative.map((step) => (
            <li key={step} className="leading-relaxed">
              {step}
            </li>
          ))}
        </ol>
        <blockquote className="mt-5 border-t border-border pt-4 font-display text-lg leading-relaxed">
          “{reveal.solution.confession}”
          <footer className="mt-1 font-sans text-sm text-muted">{reveal.solution.culprit.name}, when the cuffs went on</footer>
        </blockquote>
      </div>

      <div>
        <h3 className="label mb-1">Why it could not have been anyone else</h3>
        <p className="mb-2 text-sm text-muted">These reasons are the solver&apos;s own: each is the evidence that eliminates that suspect.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {reveal.cleared.map((c) => (
            <li key={c.suspect} className="rounded-md border border-border bg-surface px-3 py-2.5">
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-muted">{c.reason}</p>
              {c.evidence.length > 0 && <p className="mt-1 text-xs text-muted">From: {c.evidence.map((e) => e.title).join(", ")}</p>}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="label mb-1">Everything they were hiding</h3>
        <p className="mb-2 text-sm text-muted">
          {told > 0
            ? `${told} of the ${verdicts.length} statements in your notebook were lies.`
            : "Nothing in your notebook was a lie, which mostly means you did not ask."}{" "}
          A lie counts as caught when one of your notes about it sits in a conflict.
        </p>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {reveal.lies.map((lie) => (
            <li key={`${lie.suspect}-${lie.topic}`} className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  {lie.name}, on {lie.topic}
                </p>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide ${
                    lie.caught ? "border-success text-success" : "border-border text-muted"
                  }`}
                >
                  {lie.caught ? "Caught" : "Missed"}
                </span>
              </div>
              <p className="text-sm italic text-muted">“{lie.says}”</p>
              <p className="text-sm">{lie.truth}</p>
            </li>
          ))}
        </ul>
      </div>

      {reveal.missed.length > 0 && (
        <p className="text-sm text-muted">
          <span className="font-medium text-fg">Exhibits you never found:</span> {reveal.missed.map((m) => m.title).join(", ")}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRestart} className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-fg">
          Play this case again
        </button>
        <span className="text-sm text-muted">
          You asked {state.turns.length} {state.turns.length === 1 ? "question" : "questions"}.
        </span>
      </div>
    </section>
  );
}
