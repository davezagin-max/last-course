import { describe, expect, it } from "vitest";
import { contradictedClaims, detectContradictions } from "@/lib/case/contradictions";
import { contradictionText } from "@/lib/case/explain";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { namesOf } from "@/lib/case/public";
import { parseClock } from "@/lib/case/time";
import type { Claim, ClaimKind, Fact, PlaceId } from "@/lib/case/types";

const t = (clock: string) => parseClock(clock)!;
const evening = kase.window;

let n = 0;
function claim(
  speaker: string,
  kind: ClaimKind,
  fields: Partial<Pick<Claim, "subject" | "place" | "object" | "negated">> & { from?: string; to?: string } = {},
): Claim {
  return {
    id: `c${++n}`,
    speaker,
    subject: fields.subject ?? speaker,
    kind,
    place: (fields.place as PlaceId | undefined) ?? null,
    from: fields.from ? t(fields.from) : null,
    to: fields.to ? t(fields.to) : null,
    object: fields.object ?? null,
    negated: fields.negated ?? false,
    quote: "",
  };
}
const exhibit = (id: string, ...facts: Fact[]) => ({ id, facts });

describe("contradiction detector rules", () => {
  it("two_places: a claim against proven presence somewhere else", () => {
    const said = claim("odile", "location", { place: "pass", from: "20:00", to: "21:34" });
    const log = exhibit("phone_log", { type: "presence", person: "odile", place: "office", from: t("20:41"), to: t("20:53") });
    const [c, ...rest] = detectContradictions([said], [log], evening);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ rule: "two_places", basis: "evidence", subject: "odile" });
    expect(c.a).toEqual({ type: "claim", id: said.id, speaker: "odile" });
    expect(c.b).toEqual({ type: "evidence", id: "phone_log" });
  });

  it("two_places: one witness's sighting against another person's own story", () => {
    const story = claim("tomas", "location", { place: "pass", from: "20:00", to: "21:16" });
    const sighting = claim("marit", "sighting", { subject: "tomas", place: "alley", from: "20:58", to: "21:03" });
    const [c] = detectContradictions([story, sighting], [], evening);
    expect(c).toMatchObject({ rule: "two_places", basis: "testimony", subject: "tomas" });
    expect(c.span).toEqual({ from: t("20:59"), to: t("21:02") });
  });

  it("two_places: a momentary sighting inside a long alibi still conflicts", () => {
    const story = claim("gus", "location", { place: "dish_pit", from: "20:00", to: "21:34" });
    const seen = claim("priya", "sighting", { subject: "gus", place: "pass", from: "20:50" });
    expect(detectContradictions([story, seen], [], evening)).toHaveLength(1);
  });

  it("allows for vague edges: adjacent and one-minute-overlap spans do not conflict", () => {
    const leftAt = claim("odile", "location", { place: "pass", from: "20:00", to: "20:42" });
    const log = exhibit("phone_log", { type: "presence", person: "odile", place: "office", from: t("20:41"), to: t("20:53") });
    expect(detectContradictions([leftAt], [log], evening)).toEqual([]);
    const sameRoom = claim("odile", "location", { place: "office", from: "20:40", to: "20:55" });
    expect(detectContradictions([sameRoom], [log], evening)).toEqual([]);
  });

  it("denied: one source puts someone in a room and another says they were not there", () => {
    const story = claim("odile", "location", { place: "pass", from: "20:00", to: "21:34" });
    const gone = claim("tomas", "location", { subject: "odile", place: "pass", from: "20:40", to: "20:50", negated: true });
    const [c] = detectContradictions([story, gone], [], evening);
    expect(c).toMatchObject({ rule: "denied", basis: "testimony", subject: "odile" });
  });

  it("denied: 'I never went there' with no time covers the whole evening", () => {
    const never = claim("gus", "location", { place: "alley", negated: true });
    const fob = exhibit("bin_cage", { type: "presence", person: "gus", place: "alley", from: t("20:45"), to: t("20:48") });
    expect(detectContradictions([never], [fob], evening)[0]).toMatchObject({ rule: "denied", basis: "evidence" });
  });

  it("empty: a claim puts someone in a room the evidence shows was empty", () => {
    const smoke = claim("marit", "location", { place: "alley", from: "20:30", to: "20:40" });
    const door = exhibit("door_log", { type: "empty", place: "alley", from: t("20:25"), to: t("20:44") });
    expect(detectContradictions([smoke], [door], evening)[0]).toMatchObject({ rule: "empty", subject: "marit" });
    const fine = claim("gus", "location", { place: "alley", from: "20:44", to: "20:49" });
    expect(detectContradictions([fine], [door], evening)).toEqual([]);
  });

  it("possession: had it against never had it", () => {
    const sent = claim("tomas", "possession", { subject: "gus", object: "copper_dish" });
    const never = claim("gus", "possession", { object: "copper_dish", negated: true });
    expect(detectContradictions([sent, never], [], evening)[0]).toMatchObject({ rule: "possession", subject: "copper_dish" });
  });

  it("relationship: 'never met him' against proof, in either order of names", () => {
    const stranger = claim("priya", "relationship", { object: "victim", negated: true });
    const notebook = exhibit("notebook", { type: "relationship", a: "victim", b: "priya", holds: true });
    expect(detectContradictions([stranger], [notebook], evening)[0]).toMatchObject({ rule: "relationship", basis: "evidence" });
  });

  it("timing: two times for one event, beyond a three-minute tolerance", () => {
    const early = claim("gus", "timing", { object: "dish_returned", from: "20:40" });
    const late = claim("tomas", "timing", { object: "dish_returned", from: "20:50" });
    const video = exhibit("guest_video", { type: "timing", event: "dish_returned", at: t("20:51") });
    const found = detectContradictions([early, late], [video], evening);
    // Tomas's "about ten to nine" is within tolerance of 20:51; Gus's is not.
    expect(found.map((c) => [c.basis, c.rule])).toEqual([
      ["evidence", "timing"],
      ["testimony", "timing"],
    ]);
    expect(found.every((c) => [c.a, c.b].some((s) => s.type === "claim" && s.id === early.id))).toBe(true);
  });

  it("self: the same person, two incompatible statements", () => {
    const before = claim("marit", "location", { place: "cold_station", from: "20:00", to: "21:34" });
    const after = claim("marit", "location", { place: "dry_store", from: "20:38", to: "20:57" });
    expect(detectContradictions([before, after], [], evening)[0]).toMatchObject({ basis: "self", rule: "two_places" });
  });

  it("never reports evidence against evidence, or claims that agree", () => {
    const a = exhibit("a", { type: "presence", person: "odile", place: "office", from: t("20:41"), to: t("20:53") });
    const b = exhibit("b", { type: "presence", person: "odile", place: "pass", from: t("20:41"), to: t("20:53") });
    expect(detectContradictions([], [a, b], evening)).toEqual([]);
    const one = claim("priya", "location", { place: "pastry", from: "20:00", to: "21:20" });
    const two = claim("tomas", "sighting", { subject: "priya", place: "pastry", from: "20:45" });
    expect(detectContradictions([one, two], [], evening)).toEqual([]);
  });

  it("ignores claims that cannot be checked", () => {
    const vague = claim("odile", "location", { place: "office" });
    const noPlace = claim("odile", "location", { from: "20:41" });
    const log = exhibit("phone_log", { type: "presence", person: "odile", place: "pass", from: t("20:00"), to: t("21:00") });
    expect(detectContradictions([vague, noPlace], [log], evening)).toEqual([]);
  });

  it("is deterministic and lists evidence-backed conflicts first", () => {
    const claims = [
      claim("tomas", "location", { place: "pass", from: "20:00", to: "21:16" }),
      claim("marit", "sighting", { subject: "tomas", place: "alley", from: "20:58", to: "21:03" }),
      claim("odile", "location", { place: "pass", from: "20:00", to: "21:34" }),
    ];
    const evidence = [exhibit("phone_log", { type: "presence", person: "odile", place: "office", from: t("20:41"), to: t("20:53") })];
    const first = detectContradictions(claims, evidence, evening);
    expect(first.map((c) => c.basis)).toEqual(["evidence", "testimony"]);
    expect(detectContradictions([...claims].reverse(), evidence, evening).map((c) => c.id)).toEqual(first.map((c) => c.id));
    expect([...contradictedClaims(first).keys()].sort()).toEqual(claims.map((c) => c.id).sort());
  });
});

describe("contradiction wording", () => {
  it("names both sides from ids, with no model involved", () => {
    const said = claim("odile", "location", { place: "pass", from: "20:00", to: "21:34" });
    const log = kase.evidence.find((e) => e.id === "phone_log")!;
    const [c] = detectContradictions([said], [log], evening);
    const text = contradictionText(namesOf(kase), c, new Map([[said.id, said]]), new Map([[log.id, log]]), evening);
    expect(text.title).toBe("Odile in two places at once");
    expect(text.sides.map((s) => [s.label, s.text])).toEqual([
      ["Odile", "“I was at the pass, 20:00–21:34”"],
      ["Office phone log", "Odile was in the office, 20:41–20:53"],
    ]);
  });
});
