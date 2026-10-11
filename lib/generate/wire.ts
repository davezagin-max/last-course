/**
 * The wire format for a generated case, and its conversion to a `CaseFile`.
 *
 * Structured output needs a schema with every property required, no recursion,
 * and no numeric or length limits. So the wire format is deliberately flat:
 * parallel lists (suspects, movements, alibis, lies, evidence, leads) that
 * refer to each other by id, clock times as "HH:MM" strings, and "none" or ""
 * where a field does not apply. No field is nullable.
 *
 * `fromWire` rebuilds the nested, typed case file and enforces everything the
 * schema could not say: sizes, id formats, readable times. The result then
 * goes to the same validator as the handcrafted case.
 */
import { z } from "zod";
import { parseClock } from "@/lib/case/time";
import {
  CLAIM_KINDS,
  PLACES,
  VICTIM_ID,
  isPlace,
  type AlibiSegment,
  type CaseFile,
  type ClaimPattern,
  type Evidence,
  type Fact,
  type Lie,
  type PlaceId,
  type Sighting,
} from "@/lib/case/types";

const NONE = "none";
// Fresh instances on every use: a shared one would be hoisted into $defs/$ref,
// and the flattest possible schema is the safest one to send.
const place = () => z.enum(PLACES);
const placeOrNone = () => z.enum([...PLACES, NONE]);

export const FACT_TYPES = [
  "presence",
  "absent",
  "empty",
  "poison",
  "vehicle",
  "window",
  "motive",
  "possession",
  "relationship",
  "timing",
] as const;

const FactWire = z.object({
  type: z.enum(FACT_TYPES),
  person: z.string(),
  other: z.string(),
  place: placeOrNone(),
  from: z.string(),
  to: z.string(),
  item: z.string(),
  event: z.string(),
  motive: z.string(),
  step: z.enum(["acquire", "administer", NONE]),
  holds: z.boolean(),
});

const AssertionWire = z.object({
  kind: z.enum(CLAIM_KINDS),
  subject: z.string(),
  place: placeOrNone(),
  from: z.string(),
  to: z.string(),
  object: z.string(),
  negated: z.boolean(),
});

export const CaseWireSchema = z.object({
  title: z.string(),
  restaurant: z.string(),
  tagline: z.string(),
  date: z.string(),
  briefing: z.array(z.string()),
  windowFrom: z.string(),
  windowTo: z.string(),
  victim: z.object({ name: z.string(), role: z.string(), blurb: z.string() }),
  suspects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      short: z.string(),
      role: z.string(),
      monogram: z.string(),
      blurb: z.string(),
      opening: z.string(),
      voice: z.string(),
      secret: z.string(),
      knows: z.array(z.string()),
      deflections: z.array(z.string()),
    }),
  ),
  movements: z.array(
    z.object({ person: z.string(), place: place(), from: z.string(), to: z.string() }),
  ),
  relationships: z.array(z.object({ a: z.string(), b: z.string(), note: z.string() })),
  possessions: z.array(
    z.object({ person: z.string(), item: z.string(), from: z.string(), to: z.string() }),
  ),
  sightings: z.array(
    z.object({
      observer: z.string(),
      subject: z.string(),
      place: place(),
      from: z.string(),
      to: z.string(),
      note: z.string(),
    }),
  ),
  alibis: z.array(
    z.object({
      suspect: z.string(),
      place: place(),
      from: z.string(),
      to: z.string(),
      lie: z.string(),
    }),
  ),
  lies: z.array(
    z.object({
      id: z.string(),
      suspect: z.string(),
      topic: z.string(),
      says: z.string(),
      truth: z.string(),
      why: z.string(),
      admits: z.string(),
      breaksWith: z.array(z.string()),
      asserts: z.array(AssertionWire),
    }),
  ),
  items: z.array(
    z.object({ id: z.string(), name: z.string(), kind: z.enum(["poison", "vehicle", "object"]) }),
  ),
  events: z.array(z.object({ id: z.string(), label: z.string(), at: z.string() })),
  methods: z.array(
    z.object({ id: z.string(), label: z.string(), poison: z.string(), vehicle: z.string() }),
  ),
  motives: z.array(
    z.object({
      id: z.string(),
      suspect: z.string(),
      label: z.string(),
      revealedBy: z.array(z.string()),
    }),
  ),
  evidence: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      detail: z.string(),
      foundAt: placeOrNone(),
      startsFound: z.boolean(),
      unlockLeads: z.array(z.string()),
      unlockEvidence: z.array(z.string()),
      facts: z.array(FactWire),
    }),
  ),
  leads: z.array(
    z.object({
      id: z.string(),
      suspect: z.string(),
      reveal: z.string(),
      requires: z.array(z.string()),
    }),
  ),
  solution: z.object({
    culprit: z.string(),
    method: z.string(),
    motive: z.string(),
    acquirePlace: place(),
    acquireAt: z.string(),
    administerPlace: place(),
    administerAt: z.string(),
    narrative: z.array(z.string()),
    confession: z.string(),
  }),
});

export type CaseWire = z.infer<typeof CaseWireSchema>;

/** Size limits the schema cannot carry. Generous for a good case, tight enough to bound cost. */
export const LIMITS = {
  text: 700,
  short: 120,
  list: 14,
  evidence: { min: 7, max: 16 },
  movements: 60,
};

export interface Converted {
  kase: CaseFile | null;
  errors: string[];
}

/** Builds a `CaseFile` from wire data. Any error means the draft is unusable as written. */
export function fromWire(wire: CaseWire, id: string): Converted {
  const errors: string[] = [];
  const bad = (message: string) => void errors.push(message);

  const clock = (text: string, what: string): number => {
    const minute = parseClock(text);
    if (minute === null) bad(`${what}: "${text}" is not a 24-hour HH:MM time`);
    return minute ?? 0;
  };
  const optionalClock = (text: string, what: string): number | null =>
    text.trim() ? clock(text, what) : null;
  const optionalPlace = (value: string): PlaceId | null => (isPlace(value) ? value : null);
  const text = (value: string, what: string, max = LIMITS.text): string => {
    const trimmed = value.trim();
    if (!trimmed) bad(`${what} is empty`);
    if (trimmed.length > max) bad(`${what} is longer than ${max} characters`);
    return trimmed;
  };
  const list = <T>(items: T[], what: string, max = LIMITS.list): T[] => {
    if (items.length > max) bad(`${what} has ${items.length} entries; the limit is ${max}`);
    return items.slice(0, max);
  };

  if (wire.evidence.length < LIMITS.evidence.min || wire.evidence.length > LIMITS.evidence.max) {
    bad(
      `a case needs between ${LIMITS.evidence.min} and ${LIMITS.evidence.max} exhibits; this one has ${wire.evidence.length}`,
    );
  }

  const toFact = (f: CaseWire["evidence"][number]["facts"][number], what: string): Fact | null => {
    const from = () => clock(f.from, what);
    const to = () => clock(f.to, what);
    const room = (): PlaceId => {
      if (!isPlace(f.place)) bad(`${what}: a ${f.type} fact needs a place`);
      return isPlace(f.place) ? f.place : "pass";
    };
    switch (f.type) {
      case "presence":
      case "absent":
        return { type: f.type, person: f.person, place: room(), from: from(), to: to() };
      case "empty":
        return { type: "empty", place: room(), from: from(), to: to() };
      case "poison":
      case "vehicle":
        return { type: f.type, item: f.item };
      case "window":
        if (f.step === NONE) {
          bad(`${what}: a window fact needs step "acquire" or "administer"`);
          return null;
        }
        return {
          type: "window",
          step: f.step,
          item: f.item,
          place: room(),
          from: from(),
          to: to(),
        };
      case "motive":
        return { type: "motive", motive: f.motive, holds: f.holds };
      case "possession":
        return {
          type: "possession",
          person: f.person,
          item: f.item,
          from: from(),
          to: to(),
          holds: f.holds,
        };
      case "relationship":
        return { type: "relationship", a: f.person, b: f.other, holds: f.holds };
      case "timing":
        return { type: "timing", event: f.event, at: clock(f.from, what) };
    }
  };

  const toAssertion = (
    a: CaseWire["lies"][number]["asserts"][number],
    what: string,
  ): ClaimPattern => ({
    kind: a.kind,
    subject: a.subject,
    place: optionalPlace(a.place),
    from: optionalClock(a.from, what),
    to: optionalClock(a.to, what),
    object: a.object.trim() && a.object !== NONE ? a.object : null,
    negated: a.negated,
  });

  const suspects = list(wire.suspects, "suspects", 8).map((s) => {
    const mine = (x: { suspect: string }) => x.suspect === s.id;
    const lies: Lie[] = wire.lies.filter(mine).map((l) => ({
      id: l.id,
      topic: text(l.topic, `lie ${l.id}'s topic`, LIMITS.short),
      says: text(l.says, `lie ${l.id}'s "says"`),
      truth: text(l.truth, `lie ${l.id}'s truth`),
      why: text(l.why, `lie ${l.id}'s reason`),
      admits: text(l.admits, `lie ${l.id}'s admission`),
      breaksWith: list(l.breaksWith, `lie ${l.id}'s breaksWith`),
      asserts: list(l.asserts, `lie ${l.id}'s assertions`, 4).map((a) =>
        toAssertion(a, `lie ${l.id}`),
      ),
    }));
    const alibi: AlibiSegment[] = wire.alibis.filter(mine).map((a) => ({
      place: a.place,
      from: clock(a.from, `${s.id}'s alibi`),
      to: clock(a.to, `${s.id}'s alibi`),
      lie: a.lie.trim() && a.lie !== NONE ? a.lie : null,
    }));
    const sightings: Sighting[] = wire.sightings
      .filter((x) => x.observer === s.id)
      .map((x) => ({
        subject: x.subject,
        place: x.place,
        from: clock(x.from, `${s.id}'s sighting`),
        to: clock(x.to, `${s.id}'s sighting`),
        note: text(x.note, `${s.id}'s sighting note`, LIMITS.short * 2),
      }));
    if (alibi.length === 0) bad(`suspect ${s.id} has no alibi; say where they claim to have been`);
    if (lies.length === 0) bad(`suspect ${s.id} has no lie; every suspect hides something`);
    return {
      id: s.id,
      name: text(s.name, `suspect ${s.id}'s name`, LIMITS.short),
      short: text(s.short, `suspect ${s.id}'s short name`, 24),
      role: text(s.role, `suspect ${s.id}'s role`, LIMITS.short),
      monogram: text(s.monogram, `suspect ${s.id}'s monogram`, 2).toUpperCase(),
      blurb: text(s.blurb, `suspect ${s.id}'s blurb`, LIMITS.short * 2),
      opening: text(s.opening, `suspect ${s.id}'s opening line`, LIMITS.short * 2),
      voice: text(s.voice, `suspect ${s.id}'s voice`),
      secret: text(s.secret, `suspect ${s.id}'s secret`),
      knows: list(s.knows, `suspect ${s.id}'s knowledge`).map((k, i) =>
        text(k, `suspect ${s.id}'s knowledge ${i + 1}`),
      ),
      sightings,
      alibi,
      lies,
      deflections: list(s.deflections, `suspect ${s.id}'s deflections`, 4).map((d, i) =>
        text(d, `suspect ${s.id}'s deflection ${i + 1}`, LIMITS.short * 2),
      ),
    };
  });

  const known = new Set(wire.suspects.map((s) => s.id));
  for (const [what, owners] of [
    ["lie", wire.lies.map((l) => l.suspect)],
    ["alibi", wire.alibis.map((a) => a.suspect)],
    ["sighting", wire.sightings.map((s) => s.observer)],
  ] as const) {
    for (const owner of owners)
      if (!known.has(owner)) bad(`a ${what} belongs to unknown suspect "${owner}"`);
  }

  const evidence: Evidence[] = list(wire.evidence, "evidence", LIMITS.evidence.max).map((e) => {
    const facts = list(e.facts, `evidence ${e.id}'s facts`, 6).flatMap((f) => {
      const fact = toFact(f, `evidence ${e.id}`);
      return fact ? [fact] : [];
    });
    let unlock: Evidence["unlock"];
    if (e.startsFound) unlock = { type: "start" };
    else if (e.unlockLeads.length > 0) unlock = { type: "lead", any: e.unlockLeads };
    else if (e.unlockEvidence.length > 0) unlock = { type: "evidence", all: e.unlockEvidence };
    else {
      bad(
        `evidence ${e.id} has no way to be found: set startsFound, unlockLeads, or unlockEvidence`,
      );
      unlock = { type: "start" };
    }
    return {
      id: e.id,
      title: text(e.title, `evidence ${e.id}'s title`, LIMITS.short),
      summary: text(e.summary, `evidence ${e.id}'s summary`, LIMITS.short * 2),
      detail: text(e.detail, `evidence ${e.id}'s detail`),
      foundAt: optionalPlace(e.foundAt),
      facts,
      unlock,
    };
  });

  const kase: CaseFile = {
    id,
    title: text(wire.title, "the title", LIMITS.short),
    restaurant: text(wire.restaurant, "the restaurant", LIMITS.short),
    tagline: text(wire.tagline, "the tagline", LIMITS.short * 2),
    date: text(wire.date, "the date", LIMITS.short),
    briefing: list(wire.briefing, "the briefing", 4).map((p, i) =>
      text(p, `briefing paragraph ${i + 1}`),
    ),
    window: { from: clock(wire.windowFrom, "windowFrom"), to: clock(wire.windowTo, "windowTo") },
    victim: {
      id: VICTIM_ID,
      name: text(wire.victim.name, "the victim's name", LIMITS.short),
      role: text(wire.victim.role, "the victim's role", LIMITS.short),
      blurb: text(wire.victim.blurb, "the victim's blurb", LIMITS.short * 2),
    },
    suspects,
    items: list(wire.items, "items").map((i) => ({
      id: i.id,
      name: text(i.name, `item ${i.id}'s name`, LIMITS.short),
      kind: i.kind,
    })),
    events: list(wire.events, "events").map((e) => ({
      id: e.id,
      label: text(e.label, `event ${e.id}'s label`, LIMITS.short),
      at: clock(e.at, `event ${e.id}`),
    })),
    truth: {
      movements: list(wire.movements, "movements", LIMITS.movements).map((m) => ({
        person: m.person,
        place: m.place,
        from: clock(m.from, `${m.person}'s movement`),
        to: clock(m.to, `${m.person}'s movement`),
      })),
      relationships: list(wire.relationships, "relationships").map((r) => ({
        a: r.a,
        b: r.b,
        note: text(r.note, "a relationship note"),
      })),
      possessions: list(wire.possessions, "possessions").map((p) => ({
        person: p.person,
        item: p.item,
        from: clock(p.from, `${p.person}'s possession`),
        to: clock(p.to, `${p.person}'s possession`),
      })),
    },
    methods: list(wire.methods, "methods", 6).map((m) => ({
      ...m,
      label: text(m.label, `method ${m.id}'s label`, LIMITS.short * 2),
    })),
    motives: list(wire.motives, "motives").map((m) => ({
      ...m,
      label: text(m.label, `motive ${m.id}'s label`, LIMITS.short * 2),
    })),
    evidence,
    leads: list(wire.leads, "leads", 24).map((l) => ({
      ...l,
      reveal: text(l.reveal, `lead ${l.id}'s reveal`),
    })),
    solution: {
      culprit: wire.solution.culprit,
      method: wire.solution.method,
      motive: wire.solution.motive,
      acquire: {
        place: wire.solution.acquirePlace,
        at: clock(wire.solution.acquireAt, "the solution's acquireAt"),
      },
      administer: {
        place: wire.solution.administerPlace,
        at: clock(wire.solution.administerAt, "the solution's administerAt"),
      },
      narrative: list(wire.solution.narrative, "the solution's narrative", 10).map((n, i) =>
        text(n, `narrative step ${i + 1}`),
      ),
      confession: text(wire.solution.confession, "the confession"),
    },
    // A generated case is played live; there are no recorded answers to suggest.
    questions: [],
  };

  return { kase: errors.length ? null : kase, errors };
}
