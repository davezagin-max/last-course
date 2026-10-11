/**
 * Keeps the player's progress on the built-in case across a page reload.
 * Browser only, and best effort: storage can be blocked or full, and the game
 * works the same without it.
 *
 * Only public data is stored: the same `GameState` the page already holds.
 * Sealed turn records are kept too; if the server no longer accepts them it
 * says so and the suspect simply answers afresh.
 */
import type { PublicCase } from "@/lib/case/public";
import type { GameState } from "./state";

const VERSION = 1;
const key = (caseId: string) => `last-course:v${VERSION}:${caseId}`;

/** What was in storage when the page loaded, read once so the value is stable for React. */
const loaded = new Map<string, string | null>();

export function readSaved(caseId: string): string | null {
  if (!loaded.has(caseId)) {
    let value: string | null = null;
    try {
      value = window.localStorage.getItem(key(caseId));
    } catch {
      // Storage is unavailable; start fresh.
    }
    loaded.set(caseId, value);
  }
  return loaded.get(caseId) ?? null;
}

/** Parses saved progress, or returns null if it is missing, malformed, or for another case. */
export function parseSaved(pub: PublicCase, raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as Partial<GameState>;
    const ok =
      state.caseId === pub.id &&
      typeof state.suspect === "string" &&
      pub.suspects.some((s) => s.id === state.suspect) &&
      Array.isArray(state.turns) &&
      Array.isArray(state.claims) &&
      Array.isArray(state.leads) &&
      Array.isArray(state.found) &&
      typeof state.positions === "object" &&
      state.positions !== null;
    if (!ok) return null;
    // Nothing worth restoring if the player never asked a question.
    if (state.turns?.length === 0 && Object.keys(state.positions ?? {}).length === 0) return null;
    return { accusation: null, reveal: null, ...state } as GameState;
  } catch {
    return null;
  }
}

export function save(state: GameState): void {
  try {
    window.localStorage.setItem(key(state.caseId), JSON.stringify(state));
  } catch {
    // Progress just will not survive a reload.
  }
}
