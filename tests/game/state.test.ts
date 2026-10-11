import { describe, expect, it } from "vitest";
import type { ApiMeta } from "@/lib/api";
import { detectContradictions } from "@/lib/case/contradictions";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { namesOf, toPublicCase } from "@/lib/case/public";
import { parseClock } from "@/lib/case/time";
import { ZERO_USAGE } from "@/lib/config";
import { BOARD, boardLinks, clampToBoard, concerns, defaultPosition, evidenceCard, stringBetween, suspectCard } from "@/lib/game/board";
import { foundEvidence, initialState, knownMotives, liveHistory, questionsFor, reduce, shownTo, type GameState } from "@/lib/game/state";
import { buildTimeline, packRows } from "@/lib/game/timeline";
import type { TurnData } from "@/lib/interrogation/turn";

const pub = toPublicCase(kase);
const t = (clock: string) => parseClock(clock)!;
const LIVE: ApiMeta = { mode: "live", placeholder: false, recordedAt: null, model: "claude-opus-5-5", usage: ZERO_USAGE, costUsd: 0.01 };
const DEMO: ApiMeta = { ...LIVE, mode: "demo", placeholder: true, costUsd: 0 };

const turn = (over: Partial<TurnData> = {}): TurnData => ({
  answer: "On my pass.",
  assistantContent: [{ type: "text", text: "On my pass." }],
  seal: "a".repeat(64),
  claims: [],
  leads: [],
  blocked: false,
  blockedFor: [],
  historyReset: false,
  extractionFailed: false,
  ...over,
});
const answer = (state: GameState, suspect: string, data: TurnData, meta: ApiMeta | null = LIVE, presents: string[] = [], question = "Q?") =>
  reduce(pub, state, { type: "answered", suspect, question, presents, data, meta });

describe("game state reducer", () => {
  it("opens with the first suspect in the chair and only the starting exhibits", () => {
    const state = initialState(pub);
    expect(state).toMatchObject({ caseId: "the-fourth-course", suspect: "odile", turns: [], claims: [], found: ["tox_report", "ticket_t7", "notebook"] });
    expect([...knownMotives(pub, state)].sort()).toEqual(["gus_loyalty", "odile_review", "priya_humiliation"]);
  });

  it("files claims with stable ids and unlocks evidence from leads, in discovery order", () => {
    const claim = { speaker: "tomas", subject: "tomas", kind: "location" as const, place: "pass" as const, from: t("20:00"), to: t("21:16"), object: null, negated: false, quote: "x" };
    const state = answer(initialState(pub), "tomas", turn({ claims: [claim], leads: ["tomas_bumps", "tomas_chef_left"] }));
    expect(state.claims.map((c) => c.id)).toEqual(["tomas:0:0"]);
    expect(state.found.slice(3)).toEqual(["phone_log", "bump_log"]);
    expect(state.turns[0]).toMatchObject({ n: 0, claimIds: ["tomas:0:0"], unlocked: ["phone_log", "bump_log"] });
    // Finding the planter releases the door log that depends on it.
    const next = answer(state, "marit", turn({ leads: ["marit_planter"] }));
    expect(next.found.slice(-2)).toEqual(["planter", "door_log"]);
  });

  it("ignores leads the suspect could not have given: someone else's, or held back until an exhibit is shown", () => {
    const start = initialState(pub);
    expect(answer(start, "marit", turn({ leads: ["tomas_bumps"] })).found).toEqual(start.found);
    expect(answer(start, "gus", turn({ leads: ["gus_bins"] })).found).toEqual(start.found);
    const shown = answer(start, "gus", turn({ leads: ["gus_bins"] }), LIVE, ["machine_log"]);
    expect(shown.found).toContain("bin_cage");
  });

  it("keeps a sealed record only for live, unblocked turns", () => {
    let state = answer(initialState(pub), "odile", turn(), DEMO);
    expect(state.turns[0].record).toBeNull();
    state = answer(state, "odile", turn({ seal: "b".repeat(64) }), LIVE, ["notebook"], "And this?");
    expect(liveHistory(state, "odile")).toEqual([
      { question: "And this?", evidenceIds: ["notebook"], assistantContent: [{ type: "text", text: "On my pass." }], seal: "b".repeat(64) },
    ]);
    expect(liveHistory(state, "tomas")).toEqual([]);
  });

  it("treats a blocked exchange as if it never happened: no record, no evidence shown, no claims", () => {
    const blocked = turn({ blocked: true, blockedFor: ["meta"], seal: null, assistantContent: [], answer: "Ask me about Saturday." });
    const state = answer(initialState(pub), "gus", blocked, LIVE, ["notebook"]);
    expect(state.turns[0]).toMatchObject({ blocked: true, record: null, presents: [] });
    expect(shownTo(state, "gus")).toEqual([]);
    expect(liveHistory(state, "gus")).toEqual([]);
  });

  it("drops earlier records for a suspect when the server reports it could not verify them", () => {
    let state = answer(initialState(pub), "odile", turn({ seal: "1".repeat(64) }));
    state = answer(state, "tomas", turn({ seal: "2".repeat(64) }));
    state = answer(state, "odile", turn({ seal: "3".repeat(64), historyReset: true }));
    expect(liveHistory(state, "odile").map((r) => r.seal)).toEqual(["3".repeat(64)]);
    expect(liveHistory(state, "tomas")).toHaveLength(1);
    expect(state.turns[2].note).toBe("history_reset");
  });

  it("offers a suspect's evidence questions only once the evidence is found, and marks asked ones", () => {
    const start = initialState(pub);
    const odile = questionsFor(pub, start, "odile");
    expect(odile.filter((q) => q.available)).toHaveLength(6);
    expect(odile.find((q) => q.id === "odile-show-phone-log")?.available).toBe(false);
    const priya = questionsFor(pub, start, "priya");
    expect(priya.find((q) => q.id === "priya-show-notebook")?.available).toBe(true);
    const asked = answer(start, "odile", turn(), DEMO, [], odile[0].text);
    expect(questionsFor(pub, asked, "odile")[0].asked).toBe(true);
  });

  it("selects, moves, tidies, resets, and refuses to restore another case's state", () => {
    let state = reduce(pub, initialState(pub), { type: "select", suspect: "gus" });
    expect(state.suspect).toBe("gus");
    expect(reduce(pub, state, { type: "select", suspect: "nobody" }).suspect).toBe("gus");
    state = reduce(pub, state, { type: "move", id: "s:gus", to: { x: 40, y: 60 } });
    expect(state.positions).toEqual({ "s:gus": { x: 40, y: 60 } });
    expect(reduce(pub, state, { type: "tidy" }).positions).toEqual({});
    expect(reduce(pub, state, { type: "reset" })).toEqual(initialState(pub));
    const foreign = { ...initialState(pub), caseId: "another" };
    expect(reduce(pub, state, { type: "restore", state: foreign })).toBe(state);
  });
});

describe("evidence board geometry", () => {
  const all = kase.evidence.map((e) => e.id);

  it("lays suspects along the top and exhibits in staggered rows, all inside the board", () => {
    expect(defaultPosition(pub, all, suspectCard("odile"))).toEqual({ x: BOARD.margin, y: BOARD.suspectTop });
    const first = defaultPosition(pub, all, evidenceCard(all[0]));
    const sixth = defaultPosition(pub, all, evidenceCard(all[5]));
    expect(sixth.y - first.y).toBe(BOARD.gapY);
    expect(first.x - sixth.x).toBe(BOARD.stagger);
    for (const id of [...pub.suspects.map((s) => suspectCard(s.id)), ...all.map(evidenceCard)]) {
      const p = defaultPosition(pub, all, id);
      expect(clampToBoard(p), id).toEqual(p);
    }
    const positions = all.map((id) => JSON.stringify(defaultPosition(pub, all, evidenceCard(id))));
    expect(new Set(positions).size).toBe(all.length);
  });

  it("keeps a dragged card on the board", () => {
    expect(clampToBoard({ x: -50, y: 9999 })).toEqual({ x: 0, y: BOARD.height - BOARD.card.h });
  });

  it("draws strings from what an exhibit proves, and lets a contradiction outrank a quieter link", () => {
    const exhibit = (id: string) => kase.evidence.find((e) => e.id === id)!;
    expect(concerns(pub, exhibit("phone_log"))).toEqual(["odile"]);
    expect(concerns(pub, exhibit("notebook")).sort()).toEqual(["odile", "priya"]);
    expect(concerns(pub, exhibit("lineup_sheet")).sort()).toEqual(["gus", "odile"]);
    expect(concerns(pub, exhibit("tox_report"))).toEqual([]);

    const found = [exhibit("phone_log"), exhibit("planter"), exhibit("door_log")];
    const quiet = boardLinks(pub, found, []);
    expect(quiet).toEqual([
      { from: "e:phone_log", to: "s:odile", kind: "concerns" },
      { from: "e:planter", to: "e:door_log", kind: "follows" },
    ]);
    const claim = { id: "odile:0:0", speaker: "odile", subject: "odile", kind: "location" as const, place: "pass" as const, from: t("20:00"), to: t("21:34"), object: null, negated: false, quote: "" };
    const loud = boardLinks(pub, found, detectContradictions([claim], found, pub.window));
    expect(loud.find((l) => l.from.includes("odile") || l.to.includes("odile"))).toEqual({ from: "s:odile", to: "e:phone_log", kind: "conflict" });
  });

  it("pins a string to the facing edges of two cards, or arcs it over two cards in the same row", () => {
    const { w, h } = BOARD.card;
    const below = stringBetween({ x: 0, y: 0 }, { x: 300, y: 300 });
    expect(below.ends).toEqual([{ x: w / 2, y: h }, { x: 300 + w / 2, y: 300 }]);
    // Order does not matter: the string still runs from the upper card's bottom edge.
    expect(stringBetween({ x: 300, y: 300 }, { x: 0, y: 0 }).ends).toEqual(below.ends);
    const beside = stringBetween({ x: 0, y: 100 }, { x: 400, y: 110 });
    expect(beside.ends).toEqual([{ x: w / 2, y: 100 }, { x: 400 + w / 2, y: 110 }]);
    const peak = Number(beside.path.split(" ")[5]);
    expect(peak).toBeLessThan(100);
  });
});

describe("timeline data", () => {
  it("stacks overlapping bars and leaves room for a moment's label", () => {
    const bar = (from: number, to: number, point = false) => ({ span: { from, to }, row: -1, point });
    const bars = [bar(0, 60), bar(10, 20), bar(30, 40), bar(15, 25)];
    expect(packRows(bars)).toBe(3);
    expect(bars.map((b) => b.row)).toEqual([0, 1, 1, 2]);
    const points = [bar(10, 11, true), bar(14, 30)];
    expect(packRows(points)).toBe(2);
    expect(packRows([])).toBe(1);
  });

  it("separates what a suspect says, what others say, and what is proven, and flags testimony in conflict", () => {
    let state = initialState(pub);
    const says = { speaker: "odile", subject: "odile", kind: "location" as const, place: "pass" as const, from: t("20:00"), to: t("21:34"), object: null, negated: false, quote: "" };
    const seen = { speaker: "tomas", subject: "odile", kind: "sighting" as const, place: "office" as const, from: t("20:45"), to: null, object: null, negated: false, quote: "" };
    const denial = { ...seen, place: "alley" as const, negated: true };
    state = answer(state, "odile", turn({ claims: [says] }));
    state = answer(state, "tomas", turn({ claims: [seen, denial], leads: ["tomas_chef_left"] }));
    const found = foundEvidence(pub, state);
    const data = buildTimeline(pub, namesOf(pub), state.claims, found, detectContradictions(state.claims, found, pub.window));

    const odile = data.rows.find((r) => r.suspect.id === "odile")!;
    expect(odile.bars.map((b) => [b.lane, b.place, b.point, b.conflict])).toEqual([
      ["says", "pass", false, true],
      ["others", "office", true, true],
      ["proven", "office", false, false],
    ]);
    // Denials are not plotted: there is nowhere to draw "not in the alley".
    expect(odile.bars.some((b) => b.place === "alley")).toBe(false);
    expect(data.markers.map((m) => m.at)).toEqual([t("20:57"), t("21:11"), t("21:16"), t("21:34")]);
    expect(data.bands).toEqual([]);
  });
});
