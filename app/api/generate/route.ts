import { z } from "zod";
import fixtures from "@/fixtures/generate.json";
import { streamRoute } from "@/lib/api";
import { toPublicCase, type CaseRef, type PublicCase } from "@/lib/case/public";
import { sealCase } from "@/lib/case/registry";
import type { FixtureStore } from "@/lib/demo";
import {
  MAX_THEME_CHARS,
  generateCase,
  type Attempt,
  type GenerateData,
  type GenerateEvent,
} from "@/lib/generate/run";

/**
 * Generates a new case and streams each draft's verdict as it happens.
 *
 * The full case file (solution included) is what gets recorded in the fixture,
 * but it never leaves the server: `present` swaps it for the public projection
 * plus a sealed blob, for live runs and demo replays alike.
 */
const Body = z.object({
  demoId: z.string().max(64).optional(),
  theme: z.string().max(MAX_THEME_CHARS),
});

export interface GeneratedCase {
  publicCase: PublicCase;
  ref: CaseRef;
  attempts: Attempt[];
}

export const maxDuration = 300;

export const POST = streamRoute({
  store: "generate",
  fixtures: fixtures as unknown as FixtureStore<GenerateData, GenerateEvent>,
  schema: Body,
  rateLimit: { limit: 6, windowMs: 60_000 },
  replaySpeed: 3,
  live: ({ body, client, emit }) => generateCase({ client, theme: body.theme, emit }),
  present: (data): GeneratedCase => ({
    publicCase: toPublicCase(data.kase),
    ref: { sealed: sealCase(data.kase) },
    attempts: data.attempts,
  }),
});
