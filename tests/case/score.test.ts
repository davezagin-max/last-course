import { describe, expect, it } from "vitest";
import { withIds } from "@/lib/case/claims";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { POINTS, scoreAccusation } from "@/lib/case/score";
import { parseClock } from "@/lib/case/time";
import type { Claim } from "@/lib/case/types";

const t = (clock: string) => parseClock(clock)!;
const RIGHT = { culprit: "gus", method: "root_on_turbot", motive: "gus_revenge" };
const all = kase.evidence.map((e) => e.id);

const gusLie: Claim[] = withIds("gus", 0, [
  {
    speaker: "gus",
    subject: "gus",
    kind: "location",
    place: "dish_pit",
    from: t("20:00"),
    to: t("21:34"),
    object: null,
    negated: false,
    quote: "I did not leave the dish pit",
  },
]);

describe("scoring an accusation", () => {
  it("adds up to 100 and awards each part on its own", () => {
    expect(POINTS.culprit + POINTS.method + POINTS.motive + POINTS.casework).toBe(100);
    const points = (
      accusation: typeof RIGHT | { culprit: string; method: string; motive: string | null },
    ) =>
      Object.fromEntries(
        scoreAccusation(kase, accusation, { found: [], claims: [] }).breakdown.map((l) => [
          l.id,
          l.points,
        ]),
      );
    expect(points(RIGHT)).toEqual({ culprit: 50, method: 20, motive: 20, casework: 0 });
    expect(points({ ...RIGHT, motive: "gus_loyalty" })).toMatchObject({
      culprit: 50,
      method: 20,
      motive: 0,
    });
    expect(points({ ...RIGHT, motive: null })).toMatchObject({ motive: 0 });
    expect(
      points({ culprit: "odile", method: "root_on_turbot", motive: "odile_debt" }),
    ).toMatchObject({ culprit: 0, method: 20, motive: 0 });
  });

  it("scores casework from exhibits found and lies caught in a contradiction", () => {
    const none = scoreAccusation(kase, RIGHT, { found: [], claims: [] });
    expect(none.breakdown[3]).toMatchObject({
      points: 0,
      note: "You found 0 of 15 exhibits and caught 0 of 9 lies in a contradiction.",
    });

    // The lie is on record but nothing contradicts it yet: not caught.
    const unproven = scoreAccusation(kase, RIGHT, { found: ["tox_report"], claims: gusLie });
    expect(
      unproven.lies.find((l) => l.suspect === "gus" && l.topic.includes("dish pit"))?.caught,
    ).toBe(false);

    // With the fob log found, the same note sits in a contradiction: caught.
    const proven = scoreAccusation(kase, RIGHT, { found: all, claims: gusLie });
    expect(proven.lies.filter((l) => l.caught).map((l) => l.topic)).toEqual([
      "whether he left the dish pit",
    ]);
    expect(proven.breakdown[3].points).toBe(Math.round(5 + 5 * (1 / 9)));
    expect(proven.missed).toEqual([]);
  });

  it("labels every notebook claim true or false against the ground truth", () => {
    const reveal = scoreAccusation(kase, RIGHT, { found: all, claims: gusLie });
    expect(reveal.claims).toEqual({ [gusLie[0].id]: "false" });
  });

  it("explains each innocent suspect's clearance with the solver's own elimination", () => {
    const reveal = scoreAccusation(kase, RIGHT, { found: [], claims: [] });
    expect(reveal.cleared.map((c) => c.suspect)).toEqual(["odile", "tomas", "priya", "marit"]);
    const odile = reveal.cleared[0];
    expect(odile.reason).toBe(
      "Monkshood root could only have been taken in the alley, 20:44–20:49. Odile was in the office 20:41–20:53.",
    );
    expect(odile.evidence.map((e) => e.id).sort()).toEqual([
      "door_log",
      "pass_photos",
      "phone_log",
      "planter",
    ]);
    expect(reveal.theories).toBe(28);
  });

  it("ranks by score and ignores claims and exhibits that are not part of the case", () => {
    // Right on all three counts but with an empty file: 90. With every exhibit found: 95.
    expect(scoreAccusation(kase, RIGHT, { found: [], claims: [] })).toMatchObject({
      score: 90,
      rank: "Sous chef",
    });
    expect(scoreAccusation(kase, RIGHT, { found: all, claims: [] })).toMatchObject({
      score: 95,
      rank: "Chef de cuisine",
    });
    expect(
      scoreAccusation(
        kase,
        { culprit: "priya", method: "bait_in_butter", motive: null },
        { found: [], claims: [] },
      ).rank,
    ).toBe("Stagiaire");
    const junk = scoreAccusation(kase, RIGHT, {
      found: ["forged", "tox_report"],
      claims: [{ ...gusLie[0], speaker: "the_butler" }],
    });
    expect(junk.breakdown[3].note).toMatch(/^You found 1 of 15 exhibits/);
    expect(junk.claims).toEqual({});
  });

  it("carries the narrative and the confession, which live nowhere else the browser can read", () => {
    const reveal = scoreAccusation(kase, RIGHT, { found: [], claims: [] });
    expect(reveal.solution.narrative).toEqual(kase.solution.narrative);
    expect(reveal.solution.confession).toBe(kase.solution.confession);
    expect(reveal.solution.method.label).toBe(
      "Monkshood root, grated over the turbot in place of horseradish",
    );
  });
});
