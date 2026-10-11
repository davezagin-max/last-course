/**
 * Claims: what a suspect is on record as saying, in a form code can check.
 *
 * Three jobs live here, all pure:
 * - `claimSpan`: the time a claim covers.
 * - `claimVerdict`: is the claim true under the ground truth? (server only,
 *   used for the reveal and to prove the demo script never invents a lie).
 * - `matchesPattern`: is this claim an instance of a lie the case file declares?
 */
import { overlapMinutes, type Minute, type Span } from "./time";
import type { CaseFile, Claim, ClaimPattern, Movement } from "./types";

/** People are vague about minutes. A span gives this much at each end before it conflicts. */
export const SLACK = 1;
/** A sighting "at about ten to nine" is honoured if the person was there within this many minutes. */
export const POINT_TOLERANCE = 2;
/** Two times for the same event disagree only if they differ by more than this. */
export const TIMING_TOLERANCE = 3;

export interface ClaimSpan {
  span: Span;
  /** True for a single moment ("at 20:58") rather than a stretch of time. */
  point: boolean;
}

/**
 * The span a location, sighting, or possession claim covers. A denial with no
 * time ("I never went into the alley") covers the whole evening. A positive
 * claim with no time cannot be checked and has no span.
 */
export function claimSpan(claim: ClaimPattern, evening: Span): ClaimSpan | null {
  if (claim.from === null) {
    return claim.negated ? { span: { ...evening }, point: false } : null;
  }
  if (claim.to === null || claim.to <= claim.from) {
    return { span: { from: claim.from, to: claim.from + 1 }, point: true };
  }
  return { span: { from: claim.from, to: claim.to }, point: false };
}

/** A span with its fuzzy edges trimmed. Points and very short spans are left alone. */
export function core({ span, point }: ClaimSpan): Span {
  if (point || span.to - span.from <= 2 * SLACK) return span;
  return { from: span.from + SLACK, to: span.to - SLACK };
}

/** Do two stretches of time genuinely overlap, allowing for vague edges? */
export function spansConflict(a: ClaimSpan, b: ClaimSpan): Span | null {
  const left = core(a);
  const right = core(b);
  if (overlapMinutes(left, right) < 1) return null;
  return { from: Math.max(left.from, right.from), to: Math.min(left.to, right.to) };
}

export type Verdict = "true" | "false" | "unknown";

function movementsOf(kase: CaseFile, person: string): Movement[] {
  return kase.truth.movements.filter((m) => m.person === person);
}

function placeAt(movements: Movement[], minute: Minute): string | null {
  return movements.find((m) => m.from <= minute && minute < m.to)?.place ?? null;
}

/** Was the person in the place for every minute of the span? */
export function wasAtThroughout(kase: CaseFile, person: string, place: string, span: Span): boolean {
  const movements = movementsOf(kase, person);
  for (let minute = span.from; minute < span.to; minute++) {
    if (placeAt(movements, minute) !== place) return false;
  }
  return span.to > span.from;
}

/** Was the person in the place for any minute of the span? */
export function wasEverAt(kase: CaseFile, person: string, place: string, span: Span): boolean {
  const movements = movementsOf(kase, person);
  for (let minute = span.from; minute < span.to; minute++) {
    if (placeAt(movements, minute) === place) return true;
  }
  return false;
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/** Checks a claim against the ground truth. "unknown" means the truth does not cover it. */
export function claimVerdict(kase: CaseFile, claim: ClaimPattern): Verdict {
  const evening = kase.window;
  const as = (holds: boolean): Verdict => (holds !== claim.negated ? "true" : "false");

  switch (claim.kind) {
    case "location":
    case "sighting": {
      if (!claim.place) return "unknown";
      if (movementsOf(kase, claim.subject).length === 0) return "unknown";
      const when = claimSpan(claim, evening);
      if (!when) return "unknown";
      if (when.point) {
        if (claim.negated) return as(wasEverAt(kase, claim.subject, claim.place, when.span));
        const near = { from: when.span.from - POINT_TOLERANCE, to: when.span.to + POINT_TOLERANCE };
        return as(wasEverAt(kase, claim.subject, claim.place, near));
      }
      const span = core(when);
      // "I was there from eight to nine" needs every minute; "I was never there" needs none.
      return claim.negated
        ? as(wasEverAt(kase, claim.subject, claim.place, span))
        : as(wasAtThroughout(kase, claim.subject, claim.place, span));
    }
    case "timing": {
      const event = kase.events.find((e) => e.id === claim.object);
      if (!event || claim.from === null) return "unknown";
      return Math.abs(event.at - claim.from) <= TIMING_TOLERANCE ? "true" : "false";
    }
    case "possession": {
      if (!claim.object) return "unknown";
      const when = claimSpan(claim, evening);
      const held = kase.truth.possessions.some(
        (p) =>
          p.person === claim.subject &&
          p.item === claim.object &&
          (!when || overlapMinutes({ from: p.from, to: p.to }, core(when)) >= 1),
      );
      return as(held);
    }
    case "relationship": {
      if (!claim.object) return "unknown";
      const key = pairKey(claim.subject, claim.object);
      return as(kase.truth.relationships.some((r) => pairKey(r.a, r.b) === key));
    }
  }
}

/** Is `claim` an instance of the (false) statement `pattern`? */
export function matchesPattern(claim: ClaimPattern, pattern: ClaimPattern, evening: Span): boolean {
  const sameShape = (kind: ClaimPattern["kind"]) =>
    kind === "location" || kind === "sighting" ? "at" : kind;
  if (sameShape(claim.kind) !== sameShape(pattern.kind)) return false;
  if (claim.subject !== pattern.subject || claim.negated !== pattern.negated) return false;
  if (claim.kind === "relationship") {
    return claim.object === pattern.object;
  }
  if (claim.kind === "timing") {
    if (claim.object !== pattern.object) return false;
    if (claim.from === null || pattern.from === null) return false;
    return Math.abs(claim.from - pattern.from) <= TIMING_TOLERANCE;
  }
  if (claim.kind === "possession") {
    return claim.object === pattern.object;
  }
  if (claim.place !== pattern.place) return false;
  const a = claimSpan(claim, evening);
  const b = claimSpan(pattern, evening);
  if (!a || !b) return false;
  return overlapMinutes(a.span, b.span) >= 1;
}

/** Stable id for a claim: which suspect, which answer, which claim in that answer. */
export function claimId(speaker: string, turn: number, index: number): string {
  return `${speaker}:${turn}:${index}`;
}

export function withIds(speaker: string, turn: number, claims: Omit<Claim, "id">[]): Claim[] {
  return claims.map((claim, index) => ({ ...claim, id: claimId(speaker, turn, index) }));
}
