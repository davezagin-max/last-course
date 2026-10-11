/**
 * Turns the engine's structured results into sentences. Deterministic: every
 * word on the notebook, the board, and the reveal that states a fact comes
 * from here, built from ids and minutes, never from a model.
 */
import { claimSpan } from "./claims";
import type { Contradiction, Source } from "./contradictions";
import type { Names } from "./public";
import type { Elimination } from "./solver";
import { formatClock, formatSpan, formatSpans, type Span } from "./time";
import { PLACE_AT, type Claim, type Fact, type Method } from "./types";

function when(claim: Claim, evening: Span): string {
  if (claim.from === null) return claim.negated ? " at any point" : "";
  const span = claimSpan(claim, evening);
  return span ? `, ${formatSpan(span.span)}` : "";
}

/** A claim paraphrased in the speaker's own first person. */
export function claimText(names: Names, claim: Claim, evening: Span): string {
  const self = claim.subject === claim.speaker;
  const who = self ? "I" : names.person(claim.subject);
  switch (claim.kind) {
    case "location":
      return `${who} was${claim.negated ? " not" : ""} ${claim.place ? PLACE_AT[claim.place] : "there"}${when(claim, evening)}`;
    case "sighting":
      return `I ${claim.negated ? "did not see" : "saw"} ${names.person(claim.subject)} ${
        claim.place ? PLACE_AT[claim.place] : "there"
      }${when(claim, evening)}`;
    case "timing":
      return `${capitalize(names.event(claim.object ?? ""))}: ${claim.from === null ? "?" : formatClock(claim.from)}`;
    case "possession":
      return `${who} ${claim.negated ? "never had" : "had"} ${names.item(claim.object ?? "")}${
        claim.from === null ? "" : when(claim, evening)
      }`;
    case "relationship":
      return `${who} ${claim.negated ? "did not know" : "knew"} ${names.person(claim.object ?? "")}`;
  }
}

export function factText(names: Names, fact: Fact): string {
  const span = "from" in fact && "to" in fact ? formatSpan({ from: fact.from, to: fact.to }) : "";
  switch (fact.type) {
    case "presence":
      return `${names.person(fact.person)} was ${PLACE_AT[fact.place]}, ${span}`;
    case "absent":
      return `${names.person(fact.person)} was not ${PLACE_AT[fact.place]}, ${span}`;
    case "empty":
      return `Nobody was ${PLACE_AT[fact.place]}, ${span}`;
    case "poison":
      return `The poison was ${names.item(fact.item)}`;
    case "vehicle":
      return `The poison was in ${names.item(fact.item)}`;
    case "window":
      return fact.step === "acquire"
        ? `${capitalize(names.item(fact.item))} could only have been taken ${PLACE_AT[fact.place]}, ${span}`
        : `${capitalize(names.item(fact.item))} could only have been tampered with ${PLACE_AT[fact.place]}, ${span}`;
    case "motive":
      return fact.holds ? "Supports a motive" : "Rules out a motive";
    case "possession":
      return `${names.person(fact.person)} ${fact.holds ? "had" : "did not have"} ${names.item(fact.item)}, ${span}`;
    case "relationship":
      return `${names.person(fact.a)} and ${names.person(fact.b)} ${fact.holds ? "knew each other" : "had never met"}`;
    case "timing":
      return `${capitalize(names.event(fact.event))}: ${formatClock(fact.at)}`;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface ContradictionText {
  title: string;
  /** Who said or what shows each side, and what it amounts to. */
  sides: { label: string; text: string; source: Source }[];
}

const RULE_TITLE: Record<Contradiction["rule"], (subject: string) => string> = {
  two_places: (s) => `${s} in two places at once`,
  denied: (s) => `Where was ${s}?`,
  empty: (s) => `${s} in a room that was empty`,
  possession: (s) => `Who had ${s}?`,
  relationship: () => "Did they know each other?",
  timing: (s) => `Two times for ${s}`,
};

export function contradictionText(
  names: Names,
  contradiction: Contradiction,
  claims: Map<string, Claim>,
  evidence: Map<string, { id: string; title: string; facts: Fact[] }>,
  evening: Span,
): ContradictionText {
  const subject =
    contradiction.rule === "possession"
      ? names.item(contradiction.subject)
      : contradiction.rule === "timing"
        ? names.event(contradiction.subject)
        : names.person(contradiction.subject);

  const side = (source: Source, other: Source) => {
    if (source.type === "claim") {
      const claim = claims.get(source.id);
      return {
        label: names.person(source.speaker),
        text: claim ? `“${claimText(names, claim, evening)}”` : "",
        source,
      };
    }
    const exhibit = evidence.get(source.id);
    const fact = exhibit?.facts.find((f) => conflictsWith(f, contradiction, other, claims));
    return {
      label: exhibit?.title ?? source.id,
      text: fact ? factText(names, fact) : "",
      source,
    };
  };

  return {
    title: RULE_TITLE[contradiction.rule](subject),
    sides: [side(contradiction.a, contradiction.b), side(contradiction.b, contradiction.a)],
  };
}

/** Picks the fact of an exhibit that a given contradiction is about. */
function conflictsWith(
  fact: Fact,
  contradiction: Contradiction,
  other: Source,
  claims: Map<string, Claim>,
): boolean {
  const claim = other.type === "claim" ? claims.get(other.id) : undefined;
  switch (contradiction.rule) {
    case "two_places":
      return fact.type === "presence" && fact.person === contradiction.subject && fact.place !== claim?.place;
    case "denied":
      return (fact.type === "presence" || fact.type === "absent") && fact.person === contradiction.subject && fact.place === claim?.place;
    case "empty":
      return fact.type === "empty" && fact.place === claim?.place;
    case "possession":
      return fact.type === "possession" && fact.item === contradiction.subject;
    case "relationship":
      return fact.type === "relationship" && [fact.a, fact.b].sort().join("|") === contradiction.subject;
    case "timing":
      return fact.type === "timing" && fact.event === contradiction.subject;
  }
}

/** Why the evidence rules a theory out, as one or two sentences. */
export function eliminationText(names: Names, elimination: Elimination, methods: Method[]): string {
  const who = names.person(elimination.theory.culprit);
  const method = methods.find((m) => m.id === elimination.theory.method);
  const detail = elimination.detail;
  switch (detail.rule) {
    case "poison":
      return `The poison was ${names.item(detail.item)}, not ${names.item(method?.poison ?? "")}.`;
    case "vehicle":
      return `The poison was in ${names.item(detail.item)}, not ${names.item(method?.vehicle ?? "")}.`;
    case "motive":
      return `The evidence rules this motive out.`;
    case "acquire":
    case "administer": {
      const act =
        detail.rule === "acquire"
          ? `${names.item(method?.poison ?? "")} could only have been taken`
          : `${names.item(method?.vehicle ?? "")} could only have been tampered with`;
      const elsewhere = detail.blockers
        .map((b) =>
          b.fact.type === "presence"
            ? `${PLACE_AT[b.fact.place]} ${formatSpan({ from: b.fact.from, to: b.fact.to })}`
            : `away from there ${formatSpan({ from: b.fact.from, to: b.fact.to })}`,
        )
        .join(" and ");
      const opening = `${capitalize(act)} ${PLACE_AT[detail.place]}, ${formatSpans(detail.open)}.`;
      if (detail.open.length === 0) return `${capitalize(act)} ${PLACE_AT[detail.place]}, and the evidence leaves no time at all for that.`;
      return `${opening} ${who} was ${elsewhere}.`;
    }
    case "sequence":
      return `${who} could only have reached the poison ${formatSpans(detail.acquire)}, which is too late: the dish could only have been tampered with ${formatSpans(detail.administer)}.`;
  }
}
