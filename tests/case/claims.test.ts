import { describe, expect, it } from "vitest";
import { claimSpan, claimVerdict, matchesPattern } from "@/lib/case/claims";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { parseClock } from "@/lib/case/time";
import type { ClaimKind, ClaimPattern, PlaceId } from "@/lib/case/types";

const t = (clock: string) => parseClock(clock)!;
const p = (kind: ClaimKind, subject: string, f: { place?: PlaceId; from?: string; to?: string; object?: string; negated?: boolean } = {}): ClaimPattern => ({
  kind,
  subject,
  place: f.place ?? null,
  from: f.from ? t(f.from) : null,
  to: f.to ? t(f.to) : null,
  object: f.object ?? null,
  negated: f.negated ?? false,
});

describe("claimSpan", () => {
  it("reads a stretch, a moment, a whole-evening denial, and an uncheckable claim", () => {
    expect(claimSpan(p("location", "odile", { place: "pass", from: "20:00", to: "20:41" }), kase.window)).toEqual({ span: { from: t("20:00"), to: t("20:41") }, point: false });
    expect(claimSpan(p("sighting", "gus", { place: "pass", from: "20:51" }), kase.window)).toEqual({ span: { from: t("20:51"), to: t("20:52") }, point: true });
    expect(claimSpan(p("location", "gus", { place: "alley", negated: true }), kase.window)).toEqual({ span: kase.window, point: false });
    expect(claimSpan(p("location", "gus", { place: "alley" }), kase.window)).toBeNull();
  });
});

describe("claimVerdict against the ground truth", () => {
  it("judges where people were", () => {
    expect(claimVerdict(kase, p("location", "odile", { place: "office", from: "20:41", to: "20:53" }))).toBe("true");
    expect(claimVerdict(kase, p("location", "odile", { place: "pass", from: "20:00", to: "21:34" }))).toBe("false");
    expect(claimVerdict(kase, p("location", "odile", { place: "pass", from: "20:41", to: "20:51", negated: true }))).toBe("true");
    expect(claimVerdict(kase, p("location", "gus", { place: "alley", negated: true }))).toBe("false");
    expect(claimVerdict(kase, p("location", "priya", { place: "alley", negated: true }))).toBe("true");
  });

  it("gives a momentary sighting two minutes of grace, but not ten", () => {
    expect(claimVerdict(kase, p("sighting", "gus", { place: "pass", from: "20:50" }))).toBe("true");
    expect(claimVerdict(kase, p("sighting", "gus", { place: "pass", from: "20:40" }))).toBe("false");
  });

  it("judges event times within three minutes", () => {
    expect(claimVerdict(kase, p("timing", "tomas", { object: "dish_returned", from: "20:50" }))).toBe("true");
    expect(claimVerdict(kase, p("timing", "gus", { object: "dish_returned", from: "20:40" }))).toBe("false");
  });

  it("judges possession and relationships", () => {
    expect(claimVerdict(kase, p("possession", "gus", { object: "copper_dish" }))).toBe("true");
    expect(claimVerdict(kase, p("possession", "gus", { object: "copper_dish", negated: true }))).toBe("false");
    expect(claimVerdict(kase, p("possession", "marit", { object: "copper_dish" }))).toBe("false");
    expect(claimVerdict(kase, p("relationship", "gus", { object: "victim", negated: true }))).toBe("false");
    expect(claimVerdict(kase, p("relationship", "marit", { object: "victim", negated: true }))).toBe("true");
  });

  it("answers 'unknown' when the truth does not cover the claim", () => {
    expect(claimVerdict(kase, p("location", "odile", { place: "office" }))).toBe("unknown");
    expect(claimVerdict(kase, p("timing", "odile", { object: "no_such_event", from: "20:00" }))).toBe("unknown");
    expect(claimVerdict(kase, p("location", "someone_else", { place: "office", from: "20:00", to: "20:10" }))).toBe("unknown");
  });
});

describe("matchesPattern", () => {
  const lie = kase.suspects.find((s) => s.id === "tomas")!.lies[0].asserts[0];

  it("matches a restatement of a declared lie, and a sighting phrased as a location", () => {
    expect(matchesPattern(p("location", "tomas", { place: "pass", from: "20:30", to: "21:10" }), lie, kase.window)).toBe(true);
    expect(matchesPattern(p("sighting", "tomas", { place: "pass", from: "20:55", to: "21:05" }), lie, kase.window)).toBe(true);
  });

  it("does not match a different person, room, polarity, or time", () => {
    expect(matchesPattern(p("location", "odile", { place: "pass", from: "20:30", to: "21:10" }), lie, kase.window)).toBe(false);
    expect(matchesPattern(p("location", "tomas", { place: "alley", from: "20:58", to: "21:03" }), lie, kase.window)).toBe(false);
    expect(matchesPattern(p("location", "tomas", { place: "pass", from: "20:30", to: "21:10", negated: true }), lie, kase.window)).toBe(false);
    expect(matchesPattern(p("location", "tomas", { place: "pass", from: "21:20", to: "21:30" }), lie, kase.window)).toBe(false);
  });
});
