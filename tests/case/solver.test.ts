import { describe, expect, it } from "vitest";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { enumerateTheories, solve, sourcedFacts, type Candidates, type SourcedFact } from "@/lib/case/solver";
import { parseClock } from "@/lib/case/time";
import type { Fact } from "@/lib/case/types";

const t = (clock: string) => parseClock(clock)!;

/** A two-suspect toy case: one poison, one dish, taken from the alley, used at the pass. */
const toy: Candidates = {
  suspects: ["ana", "ben"],
  methods: [
    { id: "root", label: "", poison: "root", vehicle: "fish" },
    { id: "pills", label: "", poison: "pills", vehicle: "soup" },
  ],
  motives: [
    { id: "ana_money", suspect: "ana" },
    { id: "ana_love", suspect: "ana" },
    { id: "ben_money", suspect: "ben" },
  ],
  window: { from: t("20:00"), to: t("22:00") },
};

const ev = (id: string, ...facts: Fact[]): SourcedFact[] => facts.map((fact) => ({ evidence: id, fact }));

describe("solver", () => {
  it("enumerates every suspect's motives against every method", () => {
    expect(enumerateTheories(toy)).toHaveLength(3 * 2);
    expect(solve(toy, []).survivors).toHaveLength(6);
  });

  it("eliminates by forensics: the wrong poison and the wrong dish", () => {
    const result = solve(toy, ev("lab", { type: "poison", item: "root" }));
    expect(result.survivors.map((s) => s.method)).toEqual(["root", "root", "root"]);
    expect(result.eliminated.every((e) => e.rule === "poison" && e.evidence[0] === "lab")).toBe(true);

    const dish = solve(toy, ev("plate", { type: "vehicle", item: "soup" }));
    expect(dish.survivors.every((s) => s.method === "pills")).toBe(true);
  });

  it("eliminates a refuted motive but keeps the suspect's other motive", () => {
    const result = solve(toy, ev("letter", { type: "motive", motive: "ana_money", holds: false }));
    expect(result.survivors.filter((s) => s.culprit === "ana").map((s) => s.motive)).toEqual(["ana_love", "ana_love"]);
    // Evidence that supports a motive never eliminates anything.
    expect(solve(toy, ev("letter", { type: "motive", motive: "ana_money", holds: true })).survivors).toHaveLength(6);
  });

  it("eliminates a suspect who was provably elsewhere for the whole acquire window", () => {
    const facts = [
      ...ev("planter", { type: "window", step: "acquire", item: "root", place: "alley", from: t("20:30"), to: t("20:40") }),
      ...ev("cctv", { type: "presence", person: "ana", place: "office", from: t("20:25"), to: t("20:45") }),
    ];
    const result = solve(toy, facts);
    const out = result.eliminated.find((e) => e.theory.culprit === "ana" && e.theory.method === "root");
    expect(out?.rule).toBe("acquire");
    expect(out?.evidence.sort()).toEqual(["cctv", "planter"]);
    // Ana is still possible for the other method, and Ben for both.
    expect(result.survivors.some((s) => s.culprit === "ana" && s.method === "pills")).toBe(true);
    expect(result.survivors.filter((s) => s.culprit === "ben")).toHaveLength(2);
  });

  it("keeps a suspect whose alibi leaves even one minute of the window open", () => {
    const facts = [
      ...ev("planter", { type: "window", step: "acquire", item: "root", place: "alley", from: t("20:30"), to: t("20:40") }),
      ...ev("cctv", { type: "presence", person: "ana", place: "office", from: t("20:25"), to: t("20:39") }),
    ];
    expect(solve(toy, facts).survivors.some((s) => s.culprit === "ana" && s.method === "root")).toBe(true);
  });

  it("does not count presence in the same room as an alibi, and honours 'absent' facts", () => {
    const window = ev("planter", { type: "window", step: "acquire", item: "root", place: "alley", from: t("20:30"), to: t("20:40") });
    const inRoom = solve(toy, [...window, ...ev("fob", { type: "presence", person: "ana", place: "alley", from: t("20:30"), to: t("20:40") })]);
    expect(inRoom.survivors.some((s) => s.culprit === "ana" && s.method === "root")).toBe(true);
    const absent = solve(toy, [...window, ...ev("gate", { type: "absent", person: "ana", place: "alley", from: t("20:00"), to: t("21:00") })]);
    expect(absent.survivors.some((s) => s.culprit === "ana" && s.method === "root")).toBe(false);
  });

  it("cuts 'empty room' minutes out of a window for everyone", () => {
    const facts = [
      ...ev("planter", { type: "window", step: "acquire", item: "root", place: "alley", from: t("20:30"), to: t("21:00") }),
      ...ev("door", { type: "empty", place: "alley", from: t("20:30"), to: t("20:50") }),
    ];
    const result = solve(toy, facts);
    expect(result.opportunities.root.acquire.open).toEqual([{ from: t("20:50"), to: t("21:00") }]);
    expect(result.opportunities.root.acquire.evidence.sort()).toEqual(["door", "planter"]);
  });

  it("requires the poison to be taken before it is used", () => {
    const facts = [
      // The alley was reachable twice...
      ...ev("planter", { type: "window", step: "acquire", item: "root", place: "alley", from: t("20:30"), to: t("21:10") }),
      ...ev("door", { type: "empty", place: "alley", from: t("20:30"), to: t("20:44") }, { type: "empty", place: "alley", from: t("20:49"), to: t("20:58") }, { type: "empty", place: "alley", from: t("21:03"), to: t("21:10") }),
      // ...but the dish was already dosed by 20:56.
      ...ev("photo", { type: "window", step: "administer", item: "fish", place: "pass", from: t("20:38"), to: t("20:56") }),
    ];
    const result = solve(toy, facts);
    expect(result.opportunities.root.acquire.open).toEqual([{ from: t("20:44"), to: t("20:49") }]);
    // And the dish cannot have been dosed before the first minute the poison could be taken.
    expect(result.opportunities.root.administer.open).toEqual([{ from: t("20:45"), to: t("20:56") }]);
    expect(result.opportunities.root.acquire.evidence).toContain("photo");
  });

  it("eliminates by sequence when a suspect's only chances come in the wrong order", () => {
    const facts = [
      ...ev("planter", { type: "window", step: "acquire", item: "root", place: "alley", from: t("20:30"), to: t("20:50") }),
      ...ev("photo", { type: "window", step: "administer", item: "fish", place: "pass", from: t("20:30"), to: t("20:50") }),
      // Ana could only reach the alley late, and the pass early.
      ...ev("a", { type: "presence", person: "ana", place: "pass", from: t("20:30"), to: t("20:45") }),
      ...ev("b", { type: "presence", person: "ana", place: "alley", from: t("20:45"), to: t("20:50") }),
    ];
    const out = solve(toy, facts).eliminated.find((e) => e.theory.culprit === "ana" && e.theory.method === "root");
    expect(out?.rule).toBe("sequence");
  });

  it("eliminates every theory for a method whose windows name two different rooms", () => {
    const facts = [
      ...ev("x", { type: "window", step: "acquire", item: "root", place: "alley", from: t("20:30"), to: t("20:50") }),
      ...ev("y", { type: "window", step: "acquire", item: "root", place: "office", from: t("20:30"), to: t("20:50") }),
    ];
    expect(solve(toy, facts).survivors.every((s) => s.method === "pills")).toBe(true);
  });

  it("is monotonic: adding evidence never brings a theory back", () => {
    const all = sourcedFacts(kase.evidence);
    const candidates: Candidates = {
      suspects: kase.suspects.map((s) => s.id),
      methods: kase.methods,
      motives: kase.motives,
      window: kase.window,
    };
    let previous = solve(candidates, []).survivors.length;
    expect(previous).toBe(28);
    for (let i = 1; i <= kase.evidence.length; i++) {
      const facts = sourcedFacts(kase.evidence.slice(0, i));
      const now = solve(candidates, facts).survivors.length;
      expect(now, kase.evidence[i - 1].id).toBeLessThanOrEqual(previous);
      previous = now;
    }
    expect(solve(candidates, all).survivors).toHaveLength(1);
  });
});

describe("the deductions in The Fourth Course", () => {
  const candidates: Candidates = {
    suspects: kase.suspects.map((s) => s.id),
    methods: kase.methods,
    motives: kase.motives,
    window: kase.window,
  };
  const without = (...ids: string[]) => solve(candidates, sourcedFacts(kase.evidence.filter((e) => !ids.includes(e.id))));
  const culprits = (ids: string[]) => [...new Set(without(...ids).survivors.map((s) => s.culprit))].sort();

  it("narrows the opportunity to one five-minute trip to the alley", () => {
    const { acquire, administer } = without().opportunities.root_on_turbot;
    expect(acquire.open).toEqual([{ from: t("20:44"), to: t("20:49") }]);
    expect(acquire.place).toBe("alley");
    expect(administer.open).toEqual([{ from: t("20:45"), to: t("20:56") }]);
    expect(administer.place).toBe("pass");
  });

  it("clears each innocent with their own alibi exhibit, and only that exhibit", () => {
    expect(culprits([])).toEqual(["gus"]);
    expect(culprits(["phone_log"])).toEqual(["gus", "odile"]);
    expect(culprits(["bump_log"])).toEqual(["gus", "tomas"]);
    expect(culprits(["guest_video"])).toEqual(["gus", "priya"]);
    expect(culprits(["keypad_log"])).toEqual(["gus", "marit"]);
  });

  it("explains every innocent's elimination by the acquire window and their alibi", () => {
    const result = without();
    const alibi: Record<string, string> = { odile: "phone_log", tomas: "bump_log", priya: "guest_video", marit: "keypad_log" };
    for (const [suspect, exhibit] of Object.entries(alibi)) {
      const out = result.eliminated.find((e) => e.theory.culprit === suspect && e.theory.method === "root_on_turbot" && e.rule !== "motive");
      expect(out?.rule, suspect).toBe("acquire");
      expect(out?.evidence, suspect).toContain(exhibit);
      expect(out?.evidence, suspect).toEqual(expect.arrayContaining(["planter", "door_log", "pass_photos"]));
    }
  });

  it("needs the pass photographs to discount the second trip to the alley", () => {
    // Without them, anyone free at 20:58–21:03 could still have taken the root.
    expect(culprits(["pass_photos"])).toEqual(["gus", "marit", "odile", "priya", "tomas"]);
  });

  it("needs both forensic exhibits to settle the method", () => {
    const methods = (ids: string[]) => [...new Set(without(...ids).survivors.map((s) => s.method))].sort();
    expect(methods([])).toEqual(["root_on_turbot"]);
    expect(methods(["plate_residue"])).toEqual(["root_in_consomme", "root_on_turbot"]);
    expect(methods(["tox_report"])).toEqual(["root_on_turbot", "tablets_in_sauce"]);
  });

  it("needs the lineup sheet to settle the motive", () => {
    expect(without("lineup_sheet").survivors.map((s) => s.motive).sort()).toEqual(["gus_loyalty", "gus_revenge"]);
  });
});
