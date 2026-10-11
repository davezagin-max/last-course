/**
 * One interrogation turn, end to end. This is the live path behind
 * `POST /api/interrogate`; it takes the client as an argument so tests can run
 * the whole pipeline against a fake one.
 *
 *   1. Verify the sealed history; rebuild the conversation from the case file.
 *   2. Opus plays the suspect (low effort: it is dialogue), with the case
 *      prompt cached.
 *   3. The output guard checks the answer. A blocked answer is replaced with
 *      an in-character deflection and never enters the history.
 *   4. Haiku extracts claims and leads as structured output; code re-validates
 *      every one of them.
 *   5. The turn is sealed so it can be trusted when it comes back.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { RouteError, type LiveResult } from "@/lib/api";
import type { CaseFile } from "@/lib/case/types";
import { callClaude, untrusted } from "@/lib/claude";
import { MODELS, addUsage } from "@/lib/config";
import {
  MAX_EVIDENCE_PER_TURN,
  MAX_QUESTION_CHARS,
  MAX_TURNS,
  buildMessages,
  sealTurn,
  shownEvidence,
  verifyHistory,
  type Ask,
  type TurnRecord,
} from "./conversation";
import {
  extractionSchema,
  extractionSystem,
  normalizeExtraction,
  type ExtractionWire,
  type RecordedClaim,
} from "./extract";
import { checkAnswer, deflection, type GuardReason } from "./guard";
import { guardContext } from "./guard-context";
import { buildSystemPrompt } from "./prompt";

export interface TurnData {
  answer: string;
  /** The assistant's content blocks exactly as returned. Empty when the answer was blocked. */
  assistantContent: unknown[];
  /** Null when the answer was blocked: a blocked exchange is never part of the history. */
  seal: string | null;
  claims: RecordedClaim[];
  leads: string[];
  /** The output guard replaced the model's answer. */
  blocked: boolean;
  blockedFor: GuardReason[];
  /** Earlier turns could not be verified, so the suspect answered with no memory of them. */
  historyReset: boolean;
  /** The notebook call failed or was refused; the answer stands without claims. */
  extractionFailed: boolean;
}

export interface TurnInput {
  client: Anthropic;
  kase: CaseFile;
  suspectId: string;
  history: TurnRecord[];
  ask: Ask;
  /** Overrides the seal key. Tests only. */
  secret?: string;
}

export async function runTurn(input: TurnInput): Promise<LiveResult<TurnData>> {
  const { client, kase, suspectId, secret } = input;
  const suspect = kase.suspects.find((s) => s.id === suspectId);
  if (!suspect) throw new RouteError(400, "invalid", "There is no such suspect in this case.");

  const question = input.ask.question.trim();
  if (!question || question.length > MAX_QUESTION_CHARS) {
    throw new RouteError(
      400,
      "invalid",
      `A question must be between 1 and ${MAX_QUESTION_CHARS} characters.`,
    );
  }
  const known = new Set(kase.evidence.map((e) => e.id));
  const evidenceIds = [...new Set(input.ask.evidenceIds)];
  if (evidenceIds.length > MAX_EVIDENCE_PER_TURN || evidenceIds.some((id) => !known.has(id))) {
    throw new RouteError(400, "invalid", "That evidence is not part of this case.");
  }
  if (input.history.length >= MAX_TURNS) {
    throw new RouteError(
      409,
      "invalid",
      `${suspect.short} has answered ${MAX_TURNS} questions and will not take any more. Question someone else, or make your accusation.`,
    );
  }

  // A history that does not verify is discarded, never trusted and never an error:
  // the suspect simply answers afresh, and the client is told.
  const verified = verifyHistory(kase.id, suspectId, input.history, secret);
  const history = verified ? input.history : [];
  if (history.some((turn) => turn.evidenceIds.some((id) => !known.has(id)))) {
    throw new RouteError(400, "invalid", "That evidence is not part of this case.");
  }
  const ask: Ask = { question, evidenceIds };

  const answer = await callClaude({
    client,
    model: MODELS.opus,
    effort: "low",
    system: buildSystemPrompt(kase, suspectId),
    cacheSystem: true,
    messages: buildMessages(kase, suspectId, history, ask),
    maxTokens: 3000,
  });
  let usage = answer.usage;
  let costUsd = answer.costUsd;
  const cost = () => ({ model: answer.model, usage, costUsd });

  if (answer.refusal) return { refusal: answer.refusal, ...cost() };
  if (!answer.ok)
    throw new RouteError(502, "server", `${suspect.short}'s answer was cut off. Ask again.`);

  const guard = checkAnswer(answer.text, guardContext(kase, suspectId));
  if (!guard.ok) {
    return {
      data: {
        answer: deflection(suspect.deflections, history.length),
        assistantContent: [],
        seal: null,
        claims: [],
        leads: [],
        blocked: true,
        blockedFor: guard.reasons,
        historyReset: !verified,
        extractionFailed: false,
      },
      ...cost(),
    };
  }

  const last = answer.messages[answer.messages.length - 1];
  const assistantContent = Array.isArray(last?.content) ? (last.content as unknown[]) : [];
  const shown = [...new Set([...shownEvidence(history), ...evidenceIds])];

  let claims: RecordedClaim[] = [];
  let leads: string[] = [];
  let extractionFailed = false;
  let models = answer.model;
  try {
    const extraction = await callClaude<ExtractionWire>({
      client,
      model: MODELS.haiku,
      effort: "low",
      system: extractionSystem(kase, suspectId),
      cacheSystem: true,
      messages: [
        {
          role: "user",
          content: `${untrusted("question", question)}\n\n${untrusted("answer", answer.text)}`,
        },
      ],
      schema: extractionSchema(kase, suspectId),
      maxTokens: 3000,
    });
    usage = addUsage(usage, extraction.usage);
    costUsd += extraction.costUsd;
    models = `${answer.model} + ${extraction.model}`;
    if (extraction.ok && extraction.parsed) {
      ({ claims, leads } = normalizeExtraction(
        kase,
        suspectId,
        answer.text,
        extraction.parsed,
        shown,
      ));
    } else {
      extractionFailed = true;
    }
  } catch {
    // The answer is already paid for and already good. Losing the notes is better than losing the turn.
    extractionFailed = true;
  }

  const seal = sealTurn(
    {
      caseId: kase.id,
      suspectId,
      index: history.length,
      previous: history.length ? history[history.length - 1].seal : null,
      question,
      evidenceIds,
      assistantContent,
    },
    secret,
  );

  return {
    data: {
      answer: answer.text,
      assistantContent,
      seal,
      claims,
      leads,
      blocked: false,
      blockedFor: [],
      historyReset: !verified,
      extractionFailed,
    },
    model: models,
    usage,
    costUsd,
  };
}
