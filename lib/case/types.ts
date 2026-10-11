/**
 * The case file: the single source of truth for a mystery.
 *
 * Everything the game can be asked about is typed data here. Times are minutes
 * on one evening, places are an enum of rooms, people and objects are ids. The
 * model never decides a fact: it only speaks for a character who was handed a
 * slice of this file.
 *
 * Two shapes matter:
 * - `CaseFile` is the full ground truth and only ever exists on the server.
 * - `PublicCase` (see ./public.ts) is what the browser gets: no solution, no
 *   true movements, no private character sheets.
 */
import type { Minute } from "./time";

export const PLACES = [
  "pass",
  "hot_line",
  "cold_station",
  "pastry",
  "walk_in",
  "dry_store",
  "dish_pit",
  "office",
  "alley",
  "dining_room",
] as const;

export type PlaceId = (typeof PLACES)[number];

export const PLACE_NAMES: Record<PlaceId, string> = {
  pass: "the pass",
  hot_line: "the hot line",
  cold_station: "the cold station",
  pastry: "the pastry station",
  walk_in: "the walk-in",
  dry_store: "the dry store",
  dish_pit: "the dish pit",
  office: "the office",
  alley: "the alley",
  dining_room: "the dining room",
};

/** The same rooms with the preposition a sentence needs: "at the pass", "in the alley". */
export const PLACE_AT: Record<PlaceId, string> = {
  pass: "at the pass",
  hot_line: "on the hot line",
  cold_station: "at the cold station",
  pastry: "at the pastry station",
  walk_in: "in the walk-in",
  dry_store: "in the dry store",
  dish_pit: "at the dish pit",
  office: "in the office",
  alley: "in the alley",
  dining_room: "in the dining room",
};

/** Short labels for tight spaces such as timeline bars. */
export const PLACE_SHORT: Record<PlaceId, string> = {
  pass: "Pass",
  hot_line: "Hot line",
  cold_station: "Cold station",
  pastry: "Pastry",
  walk_in: "Walk-in",
  dry_store: "Dry store",
  dish_pit: "Dish pit",
  office: "Office",
  alley: "Alley",
  dining_room: "Dining room",
};

export function isPlace(value: unknown): value is PlaceId {
  return typeof value === "string" && (PLACES as readonly string[]).includes(value);
}

/** The victim is always this id, so claims and facts can refer to them. */
export const VICTIM_ID = "victim";

export interface Victim {
  id: typeof VICTIM_ID;
  name: string;
  role: string;
  blurb: string;
}

export const CLAIM_KINDS = ["location", "sighting", "timing", "possession", "relationship"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/**
 * A checkable statement. This one shape is used for what a suspect is on
 * record as saying (a notebook claim) and for what a lie asserts (a pattern).
 *
 * - location: `subject` was (or was not) at `place` during [from, to).
 * - sighting: the speaker saw (or did not see) `subject` at `place`.
 * - timing: the event `object` happened at `from`.
 * - possession: `subject` had (or never had) the item `object`.
 * - relationship: `subject` knew (or did not know) the person `object`.
 */
export interface ClaimPattern {
  kind: ClaimKind;
  subject: string;
  place: PlaceId | null;
  from: Minute | null;
  to: Minute | null;
  object: string | null;
  negated: boolean;
}

export interface Claim extends ClaimPattern {
  id: string;
  speaker: string;
  /** The words the claim was taken from; must appear verbatim in the answer. */
  quote: string;
}

/** Where a suspect says they were. `lie` names the lie this segment belongs to. */
export interface AlibiSegment {
  place: PlaceId;
  from: Minute;
  to: Minute;
  lie: string | null;
}

export interface Sighting {
  subject: string;
  place: PlaceId;
  from: Minute;
  to: Minute;
  note: string;
}

export interface Lie {
  id: string;
  topic: string;
  /** What the suspect says. */
  says: string;
  /** What actually happened. */
  truth: string;
  /** Why they lie about it. */
  why: string;
  /** The false statements, in checkable form. Each must be false under the truth. */
  asserts: ClaimPattern[];
  /** Evidence that, once shown to them, makes the lie untenable. */
  breaksWith: string[];
  /** What they concede once the lie is broken. */
  admits: string;
}

export interface Suspect {
  // Public.
  id: string;
  name: string;
  /** First name, used in the UI and in generated sentences. */
  short: string;
  role: string;
  monogram: string;
  blurb: string;
  /** Their first words to the detective. Shown before any question is asked. */
  opening: string;
  // Private: only this suspect's own prompt ever contains these.
  voice: string;
  secret: string;
  knows: string[];
  sightings: Sighting[];
  alibi: AlibiSegment[];
  lies: Lie[];
  /** In-character lines used when the output guard blocks an answer. */
  deflections: string[];
}

export interface Item {
  id: string;
  name: string;
  kind: "poison" | "vehicle" | "object";
}

/** Something that happened at a known minute, e.g. a course leaving the pass. */
export interface CaseEvent {
  id: string;
  label: string;
  at: Minute;
}

export interface Movement {
  person: string;
  place: PlaceId;
  from: Minute;
  to: Minute;
}

export interface Relationship {
  a: string;
  b: string;
  note: string;
}

export interface Possession {
  person: string;
  item: string;
  from: Minute;
  to: Minute;
}

export interface Method {
  id: string;
  label: string;
  poison: string;
  vehicle: string;
}

export interface Motive {
  id: string;
  suspect: string;
  label: string;
  /**
   * Evidence or lead ids that put this motive on the table for the player.
   * Empty means it is an obvious hypothesis from the start.
   */
  revealedBy: string[];
}

/**
 * What a piece of evidence proves. These are the only inputs the solver and
 * the contradiction detector accept, so "the evidence" has an exact meaning.
 */
export type Fact =
  | { type: "presence"; person: string; place: PlaceId; from: Minute; to: Minute }
  | { type: "absent"; person: string; place: PlaceId; from: Minute; to: Minute }
  /** Nobody was in `place` during the span (a door log, a locked room). */
  | { type: "empty"; place: PlaceId; from: Minute; to: Minute }
  /** Forensics: the poison was this item. */
  | { type: "poison"; item: string }
  /** Forensics: the poison was delivered in this item. */
  | { type: "vehicle"; item: string }
  /**
   * Opportunity: the poison `item` could only have been obtained (acquire), or
   * the vehicle `item` could only have been dosed (administer), at `place`
   * during the span.
   */
  | { type: "window"; step: "acquire" | "administer"; item: string; place: PlaceId; from: Minute; to: Minute }
  | { type: "motive"; motive: string; holds: boolean }
  | { type: "possession"; person: string; item: string; from: Minute; to: Minute; holds: boolean }
  | { type: "relationship"; a: string; b: string; holds: boolean }
  | { type: "timing"; event: string; at: Minute };

export type Unlock =
  /** On the table when the case opens. */
  | { type: "start" }
  /** Found once any one of these leads has been revealed in questioning. */
  | { type: "lead"; any: string[] }
  /** Follows automatically once all of these are found (a lab result, a pulled log). */
  | { type: "evidence"; all: string[] };

export interface Evidence {
  id: string;
  title: string;
  /** One line for the card. */
  summary: string;
  /** The full exhibit text. Shown to the player and, when presented, to a suspect. */
  detail: string;
  foundAt: PlaceId | null;
  facts: Fact[];
  unlock: Unlock;
}

/** Something a suspect can tell the detective that opens up new evidence or a motive. */
export interface Lead {
  id: string;
  suspect: string;
  /** What they say, in substance. */
  reveal: string;
  /** Evidence that must be shown to this suspect before they will say it. */
  requires: string[];
}

export interface Solution {
  culprit: string;
  method: string;
  motive: string;
  /** Where and when the culprit got the poison, and where and when it went into the vehicle. */
  acquire: { place: PlaceId; at: Minute };
  administer: { place: PlaceId; at: Minute };
  /** The reveal, step by step. */
  narrative: string[];
  confession: string;
}

/** A suggested question. In demo mode its id is the fixture key of the recorded answer. */
export interface DemoQuestion {
  id: string;
  suspect: string;
  text: string;
  /** Evidence put in front of the suspect with this question. Must be found first. */
  presents: string[];
}

export interface CaseFile {
  id: string;
  title: string;
  restaurant: string;
  tagline: string;
  date: string;
  /** Public briefing paragraphs. */
  briefing: string[];
  /** The stretch of the evening the case covers. Every movement lies inside it. */
  window: { from: Minute; to: Minute };
  victim: Victim;
  suspects: Suspect[];
  items: Item[];
  events: CaseEvent[];
  truth: {
    movements: Movement[];
    relationships: Relationship[];
    possessions: Possession[];
  };
  methods: Method[];
  motives: Motive[];
  evidence: Evidence[];
  leads: Lead[];
  solution: Solution;
  questions: DemoQuestion[];
}

/** One complete answer to "who, how, and why". */
export interface Theory {
  culprit: string;
  method: string;
  motive: string;
}

export function sameTheory(a: Theory, b: Theory): boolean {
  return a.culprit === b.culprit && a.method === b.method && a.motive === b.motive;
}
