import { describe, expect, it } from "vitest";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { reachability } from "@/lib/case/reach";
import { solveCase, validateCase } from "@/lib/case/validate";

describe("The Fourth Course (handcrafted case)", () => {
  const report = validateCase(kase);

  it("passes every validator check", () => {
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => [c.id, c.ok])).toEqual([
      ["structure", true],
      ["timeline", true],
      ["evidence", true],
      ["alibis", true],
      ["solution", true],
      ["reachability", true],
    ]);
  });

  it("has exactly one theory left out of 28 once all evidence is in", () => {
    const result = solveCase(kase);
    expect(result.total).toBe(28);
    expect(result.survivors).toEqual([
      { culprit: "gus", method: "root_on_turbot", motive: "gus_revenge" },
    ]);
  });

  it("has five suspects with six to eight suggested questions each", () => {
    expect(kase.suspects).toHaveLength(5);
    for (const s of kase.suspects) {
      const count = kase.questions.filter((q) => q.suspect === s.id).length;
      expect(count, s.id).toBeGreaterThanOrEqual(6);
      expect(count, s.id).toBeLessThanOrEqual(8);
    }
  });

  it("gives every suspect a secret and at least one lie that evidence can break", () => {
    for (const s of kase.suspects) {
      expect(s.secret.length, s.id).toBeGreaterThan(40);
      expect(
        s.lies.some((l) => l.breaksWith.length > 0),
        s.id,
      ).toBe(true);
    }
  });

  it("can reach every exhibit and lead from the three starting exhibits", () => {
    const reach = reachability(kase);
    expect(kase.evidence.filter((e) => e.unlock.type === "start").map((e) => e.id)).toEqual([
      "tox_report",
      "ticket_t7",
      "notebook",
    ]);
    expect(reach.evidence).toHaveLength(kase.evidence.length);
    expect(reach.leads).toHaveLength(kase.leads.length);
  });
});
