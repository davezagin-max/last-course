import { z } from "zod";
import { localRoute, RouteError } from "@/lib/api";
import { CaseRefSchema, resolveCase } from "@/lib/case/registry";
import { scoreAccusation } from "@/lib/case/score";
import { CLAIM_KINDS, PLACES } from "@/lib/case/types";

/**
 * The final accusation. Deterministic: no model, no key, no fixtures. This is
 * the only route that returns the solution, and only once the player has
 * committed to a culprit and a method.
 */
const Claim = z.object({
  id: z.string().max(80),
  speaker: z.string().max(40),
  subject: z.string().max(40),
  kind: z.enum(CLAIM_KINDS),
  place: z.enum(PLACES).nullable(),
  from: z.number().int().min(0).max(1440).nullable(),
  to: z.number().int().min(0).max(1440).nullable(),
  object: z.string().max(64).nullable(),
  negated: z.boolean(),
  quote: z.string().max(400),
});

const Body = z.object({
  case: CaseRefSchema,
  accusation: z.object({
    culprit: z.string().min(1).max(40),
    method: z.string().min(1).max(64),
    motive: z.string().max(64).nullable(),
  }),
  found: z.array(z.string().max(64)).max(64),
  claims: z.array(Claim).max(400),
});

export const POST = localRoute({
  schema: Body,
  maxBytes: 512 * 1024,
  handler: (body) => {
    const kase = resolveCase(body.case);
    const { culprit, method } = body.accusation;
    if (!kase.suspects.some((s) => s.id === culprit) || !kase.methods.some((m) => m.id === method)) {
      throw new RouteError(400, "invalid", "Name one of the suspects and one of the methods.");
    }
    return scoreAccusation(kase, body.accusation, { found: body.found, claims: body.claims });
  },
});
