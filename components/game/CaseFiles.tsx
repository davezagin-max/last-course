"use client";

import { useState } from "react";
import { CostMeter } from "@/components/kit/CostMeter";
import type { ApiMeta } from "@/lib/api";
import type { PublicCase } from "@/lib/case/public";
import type { CheckResult } from "@/lib/case/validate";
import type { Attempt } from "@/lib/generate/run";

export interface CaseEntry {
  pub: PublicCase;
  generated: boolean;
  /** Questions asked so far in this case. */
  asked: number;
}

export interface GenerationView {
  status: "idle" | "running" | "done" | "error";
  /** Which draft the model is working on, while running. */
  drafting: number | null;
  /** Characters of that draft written so far. */
  chars: number;
  attempts: Attempt[];
  error: string | null;
  meta: ApiMeta | null;
  /** The case this run produced, once it is loaded. */
  caseId: string | null;
}

interface Props {
  cases: CaseEntry[];
  activeId: string;
  isLive: boolean;
  generation: GenerationView;
  sampleTheme: string;
  maxTheme: number;
  onOpen: (id: string) => void;
  onRestart: (id: string) => void;
  onGenerate: (theme: string) => void;
  onAddKey: () => void;
}

export function CaseFiles({ cases, activeId, isLive, generation, sampleTheme, maxTheme, onOpen, onRestart, onGenerate, onAddKey }: Props) {
  const [theme, setTheme] = useState("");
  const running = generation.status === "running";

  return (
    <section aria-label="Case files" className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <div>
        <h2 className="font-display text-2xl">Case files</h2>
        <p className="text-muted">One case was written by hand. Any number more can be generated, and each one has to pass the same validator before you are allowed to play it.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {cases.map(({ pub, generated, asked }) => {
            const active = pub.id === activeId;
            return (
              <li key={pub.id} className={`flex flex-col gap-2 rounded-lg border bg-surface p-4 ${active ? "border-accent" : "border-border"}`}>
                <p className="label">{generated ? "Generated case" : "Handcrafted case"}</p>
                <h3 className="font-display text-xl leading-tight">{pub.title}</h3>
                <p className="text-sm text-muted">
                  {pub.restaurant}, {pub.date}. {pub.tagline}
                </p>
                <p className="text-xs text-muted">
                  {pub.suspects.length} suspects · {pub.evidence.length} exhibits ·{" "}
                  {pub.questions.length > 0 ? `${pub.questions.length} recorded answers, playable without a key` : "live questioning only"}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={active}
                    onClick={() => onOpen(pub.id)}
                    className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft disabled:border-border disabled:text-muted"
                  >
                    {active ? "Open now" : "Open this case"}
                  </button>
                  {asked > 0 && (
                    <button type="button" onClick={() => onRestart(pub.id)} className="rounded-md px-2 py-1.5 text-sm text-muted underline underline-offset-2 hover:text-fg">
                      Start over ({asked} asked)
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="font-display text-xl">Generate a new case</h3>
        <p className="mt-1 text-sm text-muted">
          Claude Opus 5.5, at high effort, drafts a whole case as structured data: five suspects, their true movements, their lies, the exhibits, and the solution. Then code takes over. A solver enumerates every
          combination of suspect, method, and motive and must be left with exactly one; every exhibit must be true and reachable. A draft that fails is sent back with the validator&apos;s own errors, up to two
          times.
        </p>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            onGenerate(isLive ? theme.trim() : sampleTheme);
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="label">Theme (optional)</span>
            <input
              value={isLive ? theme : sampleTheme}
              onChange={(event) => setTheme(event.target.value)}
              disabled={!isLive || running}
              maxLength={maxTheme}
              placeholder="A wedding tasting. A health inspector. New Year's Eve."
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm disabled:text-muted"
            />
          </label>
          <button type="submit" disabled={running} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50">
            {running ? "Working…" : isLive ? "Generate a case" : "Replay the sample run"}
          </button>
        </form>
        {!isLive && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            Demo mode replays one sample run with a fixed theme, then loads the case it produced.
            <button type="button" onClick={onAddKey} className="font-medium text-accent underline underline-offset-2">
              Add your key to generate your own
            </button>
          </p>
        )}

        {(generation.attempts.length > 0 || running) && (
          <ol aria-live="polite" className="mt-5 flex flex-col gap-3">
            {generation.attempts.map((attempt) => (
              <AttemptCard key={attempt.n} attempt={attempt} />
            ))}
            {running && generation.drafting !== null && generation.drafting > generation.attempts.length && (
              <li className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted">
                Draft {generation.drafting}: Claude is {generation.drafting === 1 ? "writing the case" : "repairing its draft"}
                <span className="dots" aria-hidden>
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
                {generation.chars > 0 && <span className="ml-auto font-mono text-xs">{generation.chars.toLocaleString("en-US")} characters</span>}
              </li>
            )}
          </ol>
        )}
        {generation.error && (
          <p role="alert" className="mt-4 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {generation.error}
          </p>
        )}
        {generation.status === "done" && generation.caseId && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => generation.caseId && onOpen(generation.caseId)} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
              Open the new case
            </button>
            <span className="text-sm text-muted">It is sealed: your browser holds an encrypted copy and never sees the solution.</span>
          </div>
        )}
        <CostMeter meta={generation.meta} className="mt-3" />
      </div>
    </section>
  );
}

function AttemptCard({ attempt }: { attempt: Attempt }) {
  return (
    <li className={`rise rounded-md border bg-raised ${attempt.ok ? "border-success" : "border-border"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <p className="font-medium">
          Draft {attempt.n}: <span className={attempt.ok ? "text-success" : "text-danger"}>{attempt.ok ? "accepted" : "rejected by the validator"}</span>
        </p>
        {attempt.stats && (
          <p className="font-mono text-xs text-muted">
            {attempt.stats.survivors} of {attempt.stats.theories} theories survive · {attempt.stats.reachableEvidence}/{attempt.stats.evidence} exhibits reachable
          </p>
        )}
      </div>
      {attempt.checks && (
        <ul className="grid gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 sm:grid-cols-2">
          {attempt.checks.map((check) => (
            <Check key={check.id} check={check} />
          ))}
        </ul>
      )}
      {attempt.errors.length > 0 && (
        <div className="border-t border-border px-4 py-2.5">
          <p className="label mb-1">Sent back to the model</p>
          <ul className="flex flex-col gap-1 text-sm">
            {attempt.errors.slice(0, 6).map((error) => (
              <li key={error} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-danger" />
                {error}
              </li>
            ))}
            {attempt.errors.length > 6 && <li className="text-muted">and {attempt.errors.length - 6} more.</li>}
          </ul>
        </div>
      )}
    </li>
  );
}

function Check({ check }: { check: CheckResult }) {
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <span className={`w-9 shrink-0 font-mono text-xs font-semibold uppercase ${check.ok ? "text-success" : "text-danger"}`}>{check.ok ? "pass" : "fail"}</span>
      <span className="min-w-0">
        {check.label} <span className="text-muted">· {check.detail}</span>
      </span>
    </li>
  );
}
