/**
 * "Generate a new case": Opus drafts, the validator judges, and a rejected
 * draft goes back with the validator's own errors, up to two times.
 *
 * The conversation is append-only. Each retry sends back the model's previous
 * turn exactly as it was returned (thinking blocks included) plus one new user
 * message, so the model repairs its own draft instead of starting over.
 */
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { RouteError, type LiveResult } from "@/lib/api";
import type { CaseFile } from "@/lib/case/types";
import { validateCase, type CheckResult, type ValidationReport } from "@/lib/case/validate";
import { callClaude, untrusted, type Msg } from "@/lib/claude";
import { MODELS, ZERO_USAGE, addUsage, formatUsd } from "@/lib/config";
import { stableStringify } from "@/lib/demo";
import { GENERATE_REQUEST, GENERATE_SYSTEM, repairRequest } from "./prompt";
import { MAX_THEME_CHARS } from "./sample";
import { CaseWireSchema, fromWire, type CaseWire } from "./wire";

export const MAX_ATTEMPTS = 3;
export { MAX_THEME_CHARS };

export interface Attempt {
  n: number;
  ok: boolean;
  errors: string[];
  /** Null when the draft was too malformed to run the checks at all. */
  checks: CheckResult[] | null;
  stats: ValidationReport["stats"] | null;
}

export type GenerateEvent =
  | { type: "drafting"; attempt: number }
  /** How much of the current draft has been written so far. */
  | { type: "progress"; attempt: number; chars: number }
  | { type: "validated"; attempt: Attempt };

/** Report progress about this often, in characters of draft. */
const PROGRESS_STEP = 2500;

/** What the route stores in a fixture. The browser only ever gets `present`ed data. */
export interface GenerateData {
  kase: CaseFile;
  /** Every draft the model returned, in order. The last one is the accepted case. */
  drafts: CaseWire[];
  attempts: Attempt[];
}

/** A stable id for a generated case: the same draft always gets the same id. */
export function caseIdFor(wire: CaseWire): string {
  // Key order must not matter: a draft read from disk and one parsed off the wire are the same draft.
  return `gen-${createHash("sha256").update(stableStringify(wire)).digest("hex").slice(0, 10)}`;
}

/** Runs one draft through conversion and the validator. Pure: used by the route and by the fixture tests. */
export function judge(wire: CaseWire, n: number): { attempt: Attempt; kase: CaseFile | null } {
  const converted = fromWire(wire, caseIdFor(wire));
  if (!converted.kase) {
    return { attempt: { n, ok: false, errors: converted.errors, checks: null, stats: null }, kase: null };
  }
  const report = validateCase(converted.kase);
  return {
    attempt: { n, ok: report.ok, errors: report.errors.map((e) => e.message), checks: report.checks, stats: report.stats },
    kase: report.ok ? converted.kase : null,
  };
}

export async function generateCase(input: {
  client: Anthropic;
  theme: string;
  emit: (event: GenerateEvent) => void;
}): Promise<LiveResult<GenerateData>> {
  const theme = input.theme.trim().slice(0, MAX_THEME_CHARS);
  let messages: Msg[] = [
    { role: "user", content: theme ? `${untrusted("theme", theme)}\n\n${GENERATE_REQUEST}` : GENERATE_REQUEST },
  ];
  let usage = ZERO_USAGE;
  let costUsd = 0;
  let model: string = MODELS.opus;
  const drafts: CaseWire[] = [];
  const attempts: Attempt[] = [];

  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    input.emit({ type: "drafting", attempt: n });
    let written = 0;
    let reported = 0;
    const result = await callClaude<CaseWire>({
      client: input.client,
      model: MODELS.opus,
      // The one place in the app that needs real reasoning: a consistent timeline and a unique solution.
      effort: "high",
      system: GENERATE_SYSTEM,
      cacheSystem: true,
      messages,
      schema: CaseWireSchema,
      // Streamed: a whole case is too long for one non-streaming response, and
      // the stream lets the page show the draft growing instead of a blank wait.
      onText: (delta) => {
        written += delta.length;
        if (written - reported >= PROGRESS_STEP) {
          reported = written;
          input.emit({ type: "progress", attempt: n, chars: written });
        }
      },
      maxTokens: 48_000,
    });
    usage = addUsage(usage, result.usage);
    costUsd += result.costUsd;
    model = result.model;
    if (result.refusal) return { refusal: result.refusal, model, usage, costUsd };

    let attempt: Attempt;
    if (result.parsed) {
      drafts.push(result.parsed);
      const judged = judge(result.parsed, n);
      attempt = judged.attempt;
      attempts.push(attempt);
      input.emit({ type: "validated", attempt });
      if (judged.kase) return { data: { kase: judged.kase, drafts, attempts }, model, usage, costUsd };
    } else {
      attempt = {
        n,
        ok: false,
        errors: ["The reply was cut off or was not a complete case file in the required format."],
        checks: null,
        stats: null,
      };
      attempts.push(attempt);
      input.emit({ type: "validated", attempt });
      // A truncated reply cannot be continued from: there is no finished turn to append to.
      if (result.stopReason !== "end_turn") break;
    }
    messages = [...result.messages, { role: "user", content: repairRequest(attempt.errors) }];
  }

  throw new RouteError(
    422,
    "invalid",
    `Claude drafted ${attempts.length} ${attempts.length === 1 ? "case" : "cases"} and the validator rejected ${attempts.length === 1 ? "it" : "each one"}, so nothing was loaded (this run cost ${formatUsd(costUsd)}). Try again, or change the theme.`,
  );
}
