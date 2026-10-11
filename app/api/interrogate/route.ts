import { z } from "zod";
import fixtures from "@/fixtures/interrogate.json";
import { jsonRoute } from "@/lib/api";
import { CaseRefSchema, resolveCase } from "@/lib/case/registry";
import type { FixtureStore } from "@/lib/demo";
import {
  MAX_EVIDENCE_PER_TURN,
  MAX_QUESTION_CHARS,
  MAX_TURNS,
} from "@/lib/interrogation/conversation";
import { runTurn, type TurnData } from "@/lib/interrogation/turn";

/**
 * One interrogation turn. With a key: Opus answers as the suspect, the output
 * guard checks it, Haiku files the claims. Without one: the recorded answer
 * for the suggested question (`demoId`) is replayed.
 *
 * The body carries the player's transcript for this suspect. Assistant content
 * passes through untouched (it holds thinking blocks) and every turn is sealed,
 * so nothing in it is trusted until the seal chain verifies.
 */
const EvidenceIds = z.array(z.string().min(1).max(64)).max(MAX_EVIDENCE_PER_TURN);

const Turn = z.object({
  question: z.string().min(1).max(MAX_QUESTION_CHARS),
  evidenceIds: EvidenceIds,
  assistantContent: z
    .array(z.looseObject({ type: z.string().max(40) }))
    .min(1)
    .max(16),
  seal: z.string().regex(/^[0-9a-f]{64}$/),
});

const Body = z.object({
  demoId: z.string().max(64).optional(),
  case: CaseRefSchema,
  suspectId: z.string().min(1).max(40),
  question: z.string().min(1).max(MAX_QUESTION_CHARS),
  evidenceIds: EvidenceIds,
  history: z.array(Turn).max(MAX_TURNS),
});
export type InterrogateBody = z.infer<typeof Body>;

export const maxDuration = 60;

export const POST = jsonRoute({
  store: "interrogate",
  fixtures: fixtures as FixtureStore<TurnData>,
  schema: Body,
  // Twenty turns of content blocks plus, for a generated case, the sealed case itself.
  maxBytes: 768 * 1024,
  // Generous: a demo replay costs nothing, and a live turn is paid for by the visitor's own key.
  rateLimit: { limit: 90, windowMs: 60_000 },
  live: ({ body, client }) =>
    runTurn({
      client,
      kase: resolveCase(body.case),
      suspectId: body.suspectId,
      history: body.history,
      ask: { question: body.question, evidenceIds: body.evidenceIds },
    }),
});
