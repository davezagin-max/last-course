import { describe, expect, it } from "vitest";
import { RouteError } from "@/lib/api";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { toPublicCase } from "@/lib/case/public";
import { CaseRefSchema, resolveCase, sealCase } from "@/lib/case/registry";

const SECRET = "a-test-secret-of-sufficient-length";

describe("case registry", () => {
  it("resolves the built-in case by id and refuses unknown ids", () => {
    expect(resolveCase({ id: "the-fourth-course" })).toBe(kase);
    expect(() => resolveCase({ id: "__proto__" })).toThrow(RouteError);
    expect(() => resolveCase({ id: "nope" })).toThrow("There is no such case.");
  });

  it("round-trips a sealed case, and the blob shows nothing", () => {
    const sealed = sealCase(kase, SECRET);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain('"culprit"');
    expect(resolveCase({ sealed }, SECRET)).toEqual(kase);
  });

  it("refuses a sealed case from another key, an altered one, or one that is no longer a valid case", () => {
    const sealed = sealCase(kase, SECRET);
    expect(() => resolveCase({ sealed }, "a-different-secret-entirely")).toThrow(/can no longer be opened/);
    expect(() => resolveCase({ sealed: `${sealed.slice(0, -3)}abc` }, SECRET)).toThrow(RouteError);
    const broken = structuredClone(kase);
    broken.suspects.pop();
    expect(() => resolveCase({ sealed: sealCase(broken, SECRET) }, SECRET)).toThrow(/can no longer be opened/);
  });

  it("accepts exactly the two reference shapes", () => {
    expect(CaseRefSchema.safeParse({ id: "the-fourth-course" }).success).toBe(true);
    expect(CaseRefSchema.safeParse({ sealed: "abc" }).success).toBe(true);
    expect(CaseRefSchema.safeParse({ id: "x", kase: {} }).success).toBe(false);
    expect(CaseRefSchema.safeParse({}).success).toBe(false);
  });
});

describe("public projection", () => {
  const shipped = JSON.stringify(toPublicCase(kase));

  it("ships no solution, no true movements, and no private character sheets", () => {
    for (const key of ['"solution"', '"truth"', '"movements"', '"secret"', '"voice"', '"knows"', '"lies"', '"alibi"', '"sightings"', '"reveal"', '"confession"']) {
      expect(shipped, key).not.toContain(key);
    }
    expect(shipped).not.toContain(kase.solution.confession);
    for (const s of kase.suspects) expect(shipped).not.toContain(s.secret);
    for (const lead of kase.leads) expect(shipped).not.toContain(lead.reveal);
  });

  it("ships what the game needs: exhibits and what they prove, unlock rules, candidates, questions", () => {
    const pub = toPublicCase(kase);
    expect(pub.evidence).toEqual(kase.evidence);
    expect(pub.leads).toEqual(kase.leads.map(({ id, suspect, requires }) => ({ id, suspect, requires })));
    expect(pub.methods).toEqual(kase.methods);
    expect(pub.questions).toEqual(kase.questions);
    expect(pub.events).toEqual(kase.events.map(({ id, label }) => ({ id, label })));
    // A copy, not a view: mutating it cannot touch the case file.
    pub.evidence[0].facts.length = 0;
    expect(kase.evidence[0].facts.length).toBeGreaterThan(0);
  });
});
