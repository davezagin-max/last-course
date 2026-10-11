/**
 * The contradiction detector. Pure code: no model decides what conflicts.
 *
 * Claims (what suspects said) and evidence facts (what is proven) are both
 * reduced to a handful of assertion shapes. Then every pair is checked against
 * six rules:
 *
 *   two_places    the same person, two different rooms, overlapping time
 *   denied        one source puts them in a room, another says they were not there
 *   empty         a claim puts someone in a room the evidence shows was empty
 *   possession    had it / never had it
 *   relationship  knew them / never met them
 *   timing        two different times for the same event
 *
 * A pair of two evidence facts is never reported: the validator already
 * guarantees evidence is consistent with the truth, and so with itself.
 */
import {
  TIMING_TOLERANCE,
  claimSpan,
  spansConflict,
  type ClaimSpan,
} from "./claims";
import type { Span } from "./time";
import type { Claim, Fact, PlaceId } from "./types";

export type Source =
  | { type: "claim"; id: string; speaker: string }
  | { type: "evidence"; id: string };

export type ContradictionRule =
  | "two_places"
  | "denied"
  | "empty"
  | "possession"
  | "relationship"
  | "timing";

export interface Contradiction {
  id: string;
  rule: ContradictionRule;
  /**
   * evidence: a claim against a proven fact, so the claim is false.
   * testimony: two people disagree, so at least one is wrong.
   * self: one person, two incompatible statements: they changed their story.
   */
  basis: "evidence" | "testimony" | "self";
  /** When one side is evidence it is always `b`. */
  a: Source;
  b: Source;
  /** The person, item, or event the conflict is about. */
  subject: string;
  /** The stretch of time in dispute, when the rule has one. */
  span: Span | null;
}

type Assertion =
  | { kind: "at"; person: string; place: PlaceId; when: ClaimSpan; positive: boolean; source: Source }
  | { kind: "empty"; place: PlaceId; when: ClaimSpan; source: Source }
  | { kind: "has"; person: string; item: string; when: ClaimSpan | null; positive: boolean; source: Source }
  | { kind: "knows"; pair: string; positive: boolean; source: Source }
  | { kind: "when"; event: string; at: number; source: Source };

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

function fromClaim(claim: Claim, evening: Span): Assertion[] {
  const source: Source = { type: "claim", id: claim.id, speaker: claim.speaker };
  switch (claim.kind) {
    case "location":
    case "sighting": {
      const when = claimSpan(claim, evening);
      if (!claim.place || !when) return [];
      return [{ kind: "at", person: claim.subject, place: claim.place, when, positive: !claim.negated, source }];
    }
    case "timing":
      if (!claim.object || claim.from === null) return [];
      return [{ kind: "when", event: claim.object, at: claim.from, source }];
    case "possession":
      if (!claim.object) return [];
      return [
        {
          kind: "has",
          person: claim.subject,
          item: claim.object,
          when: claimSpan(claim, evening),
          positive: !claim.negated,
          source,
        },
      ];
    case "relationship":
      if (!claim.object) return [];
      return [{ kind: "knows", pair: pairKey(claim.subject, claim.object), positive: !claim.negated, source }];
  }
}

function fromFact(evidence: string, fact: Fact): Assertion[] {
  const source: Source = { type: "evidence", id: evidence };
  const stretch = (from: number, to: number): ClaimSpan => ({ span: { from, to }, point: false });
  switch (fact.type) {
    case "presence":
      return [{ kind: "at", person: fact.person, place: fact.place, when: stretch(fact.from, fact.to), positive: true, source }];
    case "absent":
      return [{ kind: "at", person: fact.person, place: fact.place, when: stretch(fact.from, fact.to), positive: false, source }];
    case "empty":
      return [{ kind: "empty", place: fact.place, when: stretch(fact.from, fact.to), source }];
    case "possession":
      return [{ kind: "has", person: fact.person, item: fact.item, when: stretch(fact.from, fact.to), positive: fact.holds, source }];
    case "relationship":
      return [{ kind: "knows", pair: pairKey(fact.a, fact.b), positive: fact.holds, source }];
    case "timing":
      return [{ kind: "when", event: fact.event, at: fact.at, source }];
    default:
      // Forensic, window, and motive facts feed the solver, not the notebook.
      return [];
  }
}

interface Hit {
  rule: ContradictionRule;
  subject: string;
  span: Span | null;
}

function compare(x: Assertion, y: Assertion): Hit | null {
  if (x.kind === "at" && y.kind === "at") {
    if (x.person !== y.person) return null;
    const span = spansConflict(x.when, y.when);
    if (!span) return null;
    if (x.positive && y.positive && x.place !== y.place) return { rule: "two_places", subject: x.person, span };
    if (x.positive !== y.positive && x.place === y.place) return { rule: "denied", subject: x.person, span };
    return null;
  }
  if ((x.kind === "at" && y.kind === "empty") || (x.kind === "empty" && y.kind === "at")) {
    const at = x.kind === "at" ? x : (y as Extract<Assertion, { kind: "at" }>);
    const empty = x.kind === "empty" ? x : (y as Extract<Assertion, { kind: "empty" }>);
    if (!at.positive || at.place !== empty.place) return null;
    const span = spansConflict(at.when, empty.when);
    return span ? { rule: "empty", subject: at.person, span } : null;
  }
  if (x.kind === "has" && y.kind === "has") {
    if (x.person !== y.person || x.item !== y.item || x.positive === y.positive) return null;
    // No time on either side means "at any point", which always overlaps.
    const span = x.when && y.when ? spansConflict(x.when, y.when) : null;
    if (x.when && y.when && !span) return null;
    return { rule: "possession", subject: x.item, span };
  }
  if (x.kind === "knows" && y.kind === "knows") {
    if (x.pair !== y.pair || x.positive === y.positive) return null;
    return { rule: "relationship", subject: x.pair, span: null };
  }
  if (x.kind === "when" && y.kind === "when") {
    if (x.event !== y.event || Math.abs(x.at - y.at) <= TIMING_TOLERANCE) return null;
    return { rule: "timing", subject: x.event, span: { from: Math.min(x.at, y.at), to: Math.max(x.at, y.at) } };
  }
  return null;
}

const sourceKey = (s: Source) => `${s.type}:${s.id}`;

function basisOf(a: Source, b: Source): Contradiction["basis"] {
  if (a.type === "evidence" || b.type === "evidence") return "evidence";
  return a.speaker === b.speaker ? "self" : "testimony";
}

const BASIS_ORDER: Record<Contradiction["basis"], number> = { evidence: 0, self: 1, testimony: 2 };

/**
 * Finds every conflict among the claims, and between the claims and the facts
 * of the evidence found so far. Deterministic: same input, same list, same order.
 */
export function detectContradictions(
  claims: Claim[],
  evidence: { id: string; facts: Fact[] }[],
  evening: Span,
): Contradiction[] {
  const assertions: Assertion[] = [
    ...claims.flatMap((claim) => fromClaim(claim, evening)),
    ...evidence.flatMap((e) => e.facts.flatMap((fact) => fromFact(e.id, fact))),
  ];

  const found = new Map<string, Contradiction>();
  for (let i = 0; i < assertions.length; i++) {
    for (let j = i + 1; j < assertions.length; j++) {
      const x = assertions[i];
      const y = assertions[j];
      if (x.source.type === "evidence" && y.source.type === "evidence") continue;
      if (sourceKey(x.source) === sourceKey(y.source)) continue;
      const hit = compare(x, y);
      if (!hit) continue;
      // Claim first, evidence second; otherwise keep the order they were made in.
      const [a, b] = x.source.type === "evidence" ? [y.source, x.source] : [x.source, y.source];
      const id = `${hit.rule}:${[sourceKey(a), sourceKey(b)].sort().join("~")}`;
      if (!found.has(id)) {
        found.set(id, { id, rule: hit.rule, basis: basisOf(a, b), a, b, subject: hit.subject, span: hit.span });
      }
    }
  }
  return [...found.values()].sort(
    (p, q) => BASIS_ORDER[p.basis] - BASIS_ORDER[q.basis] || p.id.localeCompare(q.id),
  );
}

/** The ids of every claim that appears in at least one contradiction. */
export function contradictedClaims(contradictions: Contradiction[]): Map<string, Contradiction[]> {
  const byClaim = new Map<string, Contradiction[]>();
  for (const c of contradictions) {
    for (const source of [c.a, c.b]) {
      if (source.type !== "claim") continue;
      byClaim.set(source.id, [...(byClaim.get(source.id) ?? []), c]);
    }
  }
  return byClaim;
}
