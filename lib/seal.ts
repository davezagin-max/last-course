/**
 * Server-side seals. Node only: import from route handlers and tests.
 *
 * The server keeps no session. The browser holds the transcript and, for a
 * generated case, the case file itself, and sends them back on every turn.
 * Two seals keep that honest:
 *
 * - Turn seals: an HMAC over each recorded turn, chained to the one before.
 *   The server only rebuilds a conversation from turns whose chain verifies,
 *   so a client cannot invent or edit what a suspect "already said".
 * - Case seals: a generated case is AES-256-GCM encrypted before it leaves
 *   the server. The browser can hand it back but cannot read the solution or
 *   alter a character sheet (which would be a way to inject system text).
 *
 * The key comes from CASE_SEAL_SECRET. Without it a random key is made per
 * server process: fine for local use and a single instance, but seals then
 * die with the process, so a deployment on more than one instance must set it.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { stableStringify } from "./demo";

let processSecret: Buffer | null = null;

function key(secret?: string): Buffer {
  const configured = secret ?? process.env.CASE_SEAL_SECRET;
  if (configured && configured.length >= 16) return createHash("sha256").update(configured).digest();
  processSecret ??= randomBytes(32);
  return processSecret;
}

/** Hex HMAC-SHA256 of a JSON value, with keys sorted so equal values seal equally. */
export function sign(value: unknown, secret?: string): string {
  return createHmac("sha256", key(secret)).update(stableStringify(value)).digest("hex");
}

export function verify(value: unknown, seal: string, secret?: string): boolean {
  const expected = Buffer.from(sign(value, secret), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(seal, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Encrypts a JSON value. Output is base64url of iv (12) + tag (16) + ciphertext. */
export function encrypt(value: unknown, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns the value, or null if the blob was not produced with this key or was altered. */
export function decrypt<T>(blob: string, secret?: string): T | null {
  try {
    const raw = Buffer.from(blob, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
