import { describe, expect, it } from "vitest";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { toPublicCase } from "@/lib/case/public";
import { initialState, reduce } from "@/lib/game/state";
import { parseSaved } from "@/lib/game/storage";

const pub = toPublicCase(kase);

describe("saved progress", () => {
  const played = reduce(pub, initialState(pub), {
    type: "move",
    id: "s:gus",
    to: { x: 10, y: 20 },
  });

  it("restores a state it wrote", () => {
    expect(parseSaved(pub, JSON.stringify(played))).toEqual(played);
  });

  it("starts fresh when there is nothing to restore", () => {
    expect(parseSaved(pub, null)).toBeNull();
    expect(parseSaved(pub, JSON.stringify(initialState(pub)))).toBeNull();
  });

  it("ignores junk, another case's state, and a suspect that no longer exists", () => {
    expect(parseSaved(pub, "{not json")).toBeNull();
    expect(parseSaved(pub, JSON.stringify({ ...played, caseId: "other" }))).toBeNull();
    expect(parseSaved(pub, JSON.stringify({ ...played, suspect: "the_butler" }))).toBeNull();
    expect(parseSaved(pub, JSON.stringify({ ...played, found: "all of it" }))).toBeNull();
    expect(parseSaved(pub, JSON.stringify(null))).toBeNull();
  });
});
