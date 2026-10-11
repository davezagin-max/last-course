import { describe, expect, it } from "vitest";
import interrogateStore from "@/fixtures/interrogate.json";
import presets from "@/fixtures/presets.json";
import { claimVerdict, matchesPattern, withIds } from "@/lib/case/claims";
import { detectContradictions } from "@/lib/case/contradictions";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { toPublicCase } from "@/lib/case/public";
import { acceptLeads } from "@/lib/case/reach";
import type { FixtureStore } from "@/lib/demo";
import { ZERO_USAGE } from "@/lib/config";
import { contradictionsIn, initialState, knownMotives, questionsFor, reduce, theoriesLeft, type GameState } from "@/lib/game/state";
import { claimProblems } from "@/lib/interrogation/extract";
import { checkAnswer } from "@/lib/interrogation/guard";
import { guardContext } from "@/lib/interrogation/guard-context";
import type { TurnData } from "@/lib/interrogation/turn";

const store = interrogateStore as FixtureStore<TurnData>;
const pub = toPublicCase(kase);
const question = (id: string) => kase.questions.find((q) => q.id === id)!;

/** Plays a suggested question the way the browser does: fold the recorded answer into the game state. */
function play(state: GameState, id: string): GameState {
  const q = question(id);
  return reduce(pub, state, { type: "answered", suspect: q.suspect, question: q.text, presents: q.presents, data: store[id].data, meta: null });
}

describe("interrogation fixtures: every recorded answer goes through the real pipeline", () => {
  it("has exactly one fixture per suggested question", () => {
    expect(Object.keys(store).sort()).toEqual(kase.questions.map((q) => q.id).sort());
  });

  it("marks hand-written samples honestly", () => {
    for (const [id, fixture] of Object.entries(store)) {
      if (!fixture.placeholder) continue;
      expect(fixture.recordedAt, id).toBeNull();
      expect(fixture.usage, id).toEqual(ZERO_USAGE);
      expect(fixture.costUsd, id).toBe(0);
    }
  });

  describe.each(kase.questions.map((q) => [q.id, q] as const))("%s", (id, q) => {
    const { data } = store[id];

    it("passes the output guard, in voice and within the length rule", () => {
      expect(checkAnswer(data.answer, guardContext(kase, q.suspect))).toEqual({ ok: true, reasons: [] });
      expect(data.answer.split(/\s+/).length).toBeLessThanOrEqual(110);
      expect(data.blocked).toBe(false);
      expect(data.assistantContent.length).toBeGreaterThan(0);
    });

    it("has only claims the extractor's validator accepts, each quoted verbatim from the answer", () => {
      expect(claimProblems(kase, q.suspect, data.answer, data.claims)).toEqual([]);
    });

    it("names only leads this suspect may give at this point", () => {
      expect(acceptLeads(kase.leads, q.suspect, data.leads, q.presents)).toEqual(data.leads);
    });

    it("tells no lie the case file does not declare", () => {
      const speaker = kase.suspects.find((s) => s.id === q.suspect)!;
      for (const claim of data.claims) {
        const verdict = claimVerdict(kase, claim);
        expect(verdict, claim.quote).not.toBe("unknown");
        if (verdict === "false") {
          const declared = speaker.lies.some((lie) => lie.asserts.some((p) => matchesPattern(claim, p, kase.window)));
          expect(declared, `undeclared lie: "${claim.quote}"`).toBe(true);
        }
      }
    });
  });

  it("has every declared lie actually told, and later broken by an exhibit, somewhere in the script", () => {
    for (const s of kase.suspects) {
      const mine = kase.questions.filter((q) => q.suspect === s.id);
      for (const lie of s.lies) {
        const told = mine.some((q) => store[q.id].data.claims.some((c) => lie.asserts.some((p) => matchesPattern(c, p, kase.window))));
        expect(told, `${lie.id} is never told`).toBe(true);
        const confronted = mine.some((q) => q.presents.some((e) => lie.breaksWith.includes(e)));
        expect(confronted, `${lie.id} is never confronted`).toBe(true);
      }
    }
  });

  it("has every lead given by at least one recorded answer", () => {
    const given = new Set(Object.values(store).flatMap((f) => f.data.leads));
    expect([...given].sort()).toEqual(kase.leads.map((l) => l.id).sort());
  });
});

describe("presets.json", () => {
  const interrogate = presets.filter((p) => p.route === "/api/interrogate");

  it("lists every suggested question exactly as the case file has it, so `pnpm record` replays them all", () => {
    expect(interrogate.map((p) => p.body.demoId).sort()).toEqual(kase.questions.map((q) => q.id).sort());
    for (const p of interrogate) {
      const q = question(p.body.demoId);
      expect(p.body).toEqual({ demoId: q.id, case: { id: kase.id }, suspectId: q.suspect, question: q.text, evidenceIds: q.presents, history: [] });
    }
  });
});

describe("playing the demo script", () => {
  it("lights up a contradiction on the very first click", () => {
    const first = questionsFor(pub, initialState(pub), pub.suspects[0].id)[0];
    const state = play(initialState(pub), first.id);
    const found = contradictionsIn(pub, state);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "relationship", basis: "evidence", b: { type: "evidence", id: "notebook" } });
  });

  it("reaches every exhibit and every motive using only suggested questions", () => {
    let state = initialState(pub);
    // Keep asking whatever is currently askable until nothing new is left.
    for (let progress = true; progress; ) {
      progress = false;
      for (const s of pub.suspects) {
        for (const q of questionsFor(pub, state, s.id)) {
          if (q.available && !q.asked) {
            state = play(state, q.id);
            progress = true;
          }
        }
      }
    }
    expect(state.turns).toHaveLength(kase.questions.length);
    expect([...state.found].sort()).toEqual(kase.evidence.map((e) => e.id).sort());
    expect([...knownMotives(pub, state)].sort()).toEqual(kase.motives.map((m) => m.id).sort());
    // With everything found, the public solver has it down to the one true theory.
    expect(theoriesLeft(pub, state).survivors).toEqual([{ culprit: "gus", method: "root_on_turbot", motive: "gus_revenge" }]);
  });

  it("produces well over three detectable contradictions, of every basis and most rules", () => {
    const claims = kase.questions.flatMap((q, i) => withIds(q.suspect, i, store[q.id].data.claims));
    const found = detectContradictions(claims, kase.evidence, kase.window);
    expect(found.length).toBeGreaterThanOrEqual(12);
    expect(new Set(found.map((c) => c.basis))).toEqual(new Set(["evidence", "self", "testimony"]));
    expect(new Set(found.map((c) => c.rule))).toEqual(new Set(["two_places", "denied", "relationship", "timing"]));

    // The specific catches the case is built around.
    const caught = (speaker: string, evidence: string) =>
      found.some((c) => c.a.type === "claim" && c.a.speaker === speaker && c.b.type === "evidence" && c.b.id === evidence);
    expect(caught("odile", "phone_log")).toBe(true);
    expect(caught("odile", "notebook")).toBe(true);
    expect(caught("priya", "notebook")).toBe(true);
    expect(caught("marit", "keypad_log")).toBe(true);
    expect(caught("gus", "bin_cage")).toBe(true);
    expect(caught("gus", "guest_video")).toBe(true);
    expect(caught("gus", "locker_clipping")).toBe(true);
    // Tomas is caught by testimony, not by an exhibit: the bump log only shows a gap.
    expect(found.some((c) => c.basis === "testimony" && c.subject === "tomas" && c.rule === "two_places")).toBe(true);
  });

  it("flags every lie in the case and no truthful claim against evidence", () => {
    const claims = kase.questions.flatMap((q, i) => withIds(q.suspect, i, store[q.id].data.claims));
    const found = detectContradictions(claims, kase.evidence, kase.window);
    const byId = new Map(claims.map((c) => [c.id, c]));
    // Evidence is true, so a claim that contradicts evidence must be false.
    for (const c of found.filter((x) => x.basis === "evidence")) {
      const claim = byId.get((c.a as { id: string }).id)!;
      expect(claimVerdict(kase, claim), claim.quote).toBe("false");
    }
    // And every false claim in the script is caught by something.
    const flagged = new Set(found.flatMap((c) => [c.a, c.b]).flatMap((s) => (s.type === "claim" ? [s.id] : [])));
    for (const claim of claims) {
      if (claimVerdict(kase, claim) === "false") expect(flagged.has(claim.id), claim.quote).toBe(true);
    }
  });
});
