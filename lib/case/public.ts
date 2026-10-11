/**
 * The public projection of a case: everything the browser needs to run the
 * game, and nothing that gives the answer away.
 *
 * Kept: who the suspects are, the exhibits and what each proves, how clues
 * unlock, the candidate methods and motives, the suggested questions.
 * Dropped: the solution, the true movements, relationships and possessions,
 * and every private field of every suspect (voice, secret, knowledge, alibi,
 * lies). The accusation is scored on the server (`/api/accuse`), so the
 * solution never reaches the client until the player commits to an answer.
 */
import type { Span } from "./time";
import type {
  CaseFile,
  DemoQuestion,
  Evidence,
  Item,
  Lead,
  Method,
  Motive,
  PlaceId,
  Victim,
} from "./types";
import { PLACES } from "./types";

export interface PublicSuspect {
  id: string;
  name: string;
  short: string;
  role: string;
  monogram: string;
  blurb: string;
  opening: string;
}

export interface PublicCase {
  id: string;
  title: string;
  restaurant: string;
  tagline: string;
  date: string;
  briefing: string[];
  window: Span;
  victim: Victim;
  suspects: PublicSuspect[];
  places: PlaceId[];
  items: Item[];
  /** Event ids and labels only. Their times are established by evidence. */
  events: { id: string; label: string }[];
  methods: Method[];
  motives: Motive[];
  evidence: Evidence[];
  /** Unlock rules only; what the suspect says stays on the server. */
  leads: Pick<Lead, "id" | "suspect" | "requires">[];
  questions: DemoQuestion[];
}

/**
 * How the browser names a case to the server: a built-in case by id, or a
 * generated case by the sealed blob the server handed out for it.
 */
export type CaseRef = { id: string } | { sealed: string };

export function toPublicCase(kase: CaseFile): PublicCase {
  return {
    id: kase.id,
    title: kase.title,
    restaurant: kase.restaurant,
    tagline: kase.tagline,
    date: kase.date,
    briefing: [...kase.briefing],
    window: { ...kase.window },
    victim: { ...kase.victim },
    suspects: kase.suspects.map((s) => ({
      id: s.id,
      name: s.name,
      short: s.short,
      role: s.role,
      monogram: s.monogram,
      blurb: s.blurb,
      opening: s.opening,
    })),
    places: [...PLACES],
    items: kase.items.map((item) => ({ ...item })),
    events: kase.events.map((e) => ({ id: e.id, label: e.label })),
    methods: kase.methods.map((m) => ({ ...m })),
    motives: kase.motives.map((m) => ({ ...m, revealedBy: [...m.revealedBy] })),
    evidence: kase.evidence.map((e) => structuredClone(e)),
    leads: kase.leads.map((l) => ({ id: l.id, suspect: l.suspect, requires: [...l.requires] })),
    questions: kase.questions.map((q) => ({ ...q, presents: [...q.presents] })),
  };
}

/** Looks up display names for ids. Works on either the full or the public case. */
export interface Names {
  person(id: string): string;
  item(id: string): string;
  event(id: string): string;
  evidence(id: string): string;
}

type Nameable = Pick<PublicCase, "victim" | "items" | "events"> & {
  suspects: { id: string; short: string }[];
  evidence: { id: string; title: string }[];
};

export function namesOf(kase: Nameable): Names {
  const people = new Map(kase.suspects.map((s) => [s.id, s.short]));
  people.set(kase.victim.id, kase.victim.name);
  const items = new Map(kase.items.map((i) => [i.id, i.name]));
  const events = new Map(kase.events.map((e) => [e.id, e.label]));
  const evidence = new Map(kase.evidence.map((e) => [e.id, e.title]));
  return {
    person: (id) => people.get(id) ?? id,
    item: (id) => items.get(id) ?? id,
    event: (id) => events.get(id) ?? id,
    evidence: (id) => evidence.get(id) ?? id,
  };
}
