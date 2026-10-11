import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * The page writes its state in an effect on mount, and React runs a child's
 * effects before the parent has read what was saved. So the very first thing
 * that happens after a reload is `save(fresh game)`. That must not cost the
 * player the progress they came back for.
 */
describe("saving and reloading in a browser", () => {
  const STORAGE_KEY = "last-course:v1:the-fourth-course";

  function fakeBrowser(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    return store;
  }

  const afterOneQuestion = reduce(pub, initialState(pub), {
    type: "move",
    id: "s:odile",
    to: { x: 120, y: 80 },
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("still restores earlier progress when a fresh game is saved before anything is read", async () => {
    const store = fakeBrowser({ [STORAGE_KEY]: JSON.stringify(afterOneQuestion) });
    vi.resetModules();
    const storage = await import("@/lib/game/storage");

    // What the mount effect does on the first render after a reload.
    storage.save(initialState(pub));
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "null")).toEqual(initialState(pub));

    const restored = storage.parseSaved(pub, storage.readSaved(pub.id));
    expect(restored).toEqual(afterOneQuestion);

    // The restored game is then saved in its turn, so storage ends up right as well.
    storage.save(restored!);
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "null")).toEqual(afterOneQuestion);
  });

  it("writes progress that a later page load can read back", async () => {
    const store = fakeBrowser();
    vi.resetModules();
    const first = await import("@/lib/game/storage");
    expect(first.readSaved(pub.id)).toBeNull();
    first.save(afterOneQuestion);

    vi.resetModules();
    const second = await import("@/lib/game/storage");
    expect(second.parseSaved(pub, second.readSaved(pub.id))).toEqual(afterOneQuestion);
    expect(store.size).toBe(1);
  });

  it("carries on without storage when the browser blocks it", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    vi.resetModules();
    const storage = await import("@/lib/game/storage");
    expect(storage.readSaved(pub.id)).toBeNull();
    expect(() => storage.save(afterOneQuestion)).not.toThrow();
  });
});
