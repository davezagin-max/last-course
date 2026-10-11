/**
 * Where routes get a case from. SERVER ONLY.
 *
 * A request names its case one of two ways: the id of a built-in case that
 * lives in this codebase, or a sealed blob for a generated case that the
 * browser was given earlier. Either way the route ends up with a full
 * `CaseFile` that the client never had the chance to read or edit.
 */
import { z } from "zod";
import { RouteError } from "@/lib/api";
import { decrypt, encrypt } from "@/lib/seal";
import { THE_FOURTH_COURSE } from "./handcrafted";
import type { CaseRef } from "./public";
import type { CaseFile } from "./types";
import { validateCase } from "./validate";

const BUILT_IN: Record<string, CaseFile> = {
  [THE_FOURTH_COURSE.id]: THE_FOURTH_COURSE,
};

export const DEFAULT_CASE_ID = THE_FOURTH_COURSE.id;

/** Request-body schema for a case reference. A sealed case is a few tens of kilobytes. */
export const CaseRefSchema: z.ZodType<CaseRef> = z.union([
  z.object({ id: z.string().min(1).max(64) }).strict(),
  z.object({ sealed: z.string().min(1).max(300_000) }).strict(),
]);

const SEAL_VERSION = 1;

interface SealedCase {
  v: number;
  kase: CaseFile;
}

export function sealCase(kase: CaseFile, secret?: string): string {
  return encrypt({ v: SEAL_VERSION, kase } satisfies SealedCase, secret);
}

export function builtInCase(id: string): CaseFile | null {
  return Object.prototype.hasOwnProperty.call(BUILT_IN, id) ? BUILT_IN[id] : null;
}

export function resolveCase(ref: CaseRef, secret?: string): CaseFile {
  if ("id" in ref) {
    const kase = builtInCase(ref.id);
    if (!kase) throw new RouteError(404, "invalid", "There is no such case.");
    return kase;
  }
  const opened = decrypt<SealedCase>(ref.sealed, secret);
  // The seal proves we wrote it; the validator proves it is still a case this build can run.
  if (!opened || opened.v !== SEAL_VERSION || !validateCase(opened.kase).ok) {
    throw new RouteError(410, "invalid", "This generated case can no longer be opened (the server that sealed it has restarted). Generate a new one.");
  }
  return opened.kase;
}
