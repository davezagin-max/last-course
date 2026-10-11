import { describe, expect, it } from "vitest";
import {
  earliest,
  formatClock,
  formatSpan,
  intersect,
  latest,
  normalize,
  parseClock,
  subtract,
} from "@/lib/case/time";

const s = (from: string, to: string) => ({ from: parseClock(from)!, to: parseClock(to)! });

describe("clock parsing and formatting", () => {
  it("round-trips 24-hour times and rejects anything else", () => {
    expect(parseClock("20:41")).toBe(1241);
    expect(parseClock("9:05")).toBe(545);
    expect(formatClock(1241)).toBe("20:41");
    expect(formatClock(545)).toBe("09:05");
    for (const bad of ["24:00", "20:60", "8pm", "", "20.41", "twenty to nine"]) {
      expect(parseClock(bad), bad).toBeNull();
    }
  });

  it("prints a one-minute span as a single time", () => {
    expect(formatSpan(s("20:58", "20:59"))).toBe("20:58");
    expect(formatSpan(s("20:44", "20:49"))).toBe("20:44–20:49");
  });
});

describe("interval arithmetic on half-open spans", () => {
  it("merges overlapping and touching spans and drops empty ones", () => {
    expect(
      normalize([
        s("20:10", "20:20"),
        s("20:00", "20:10"),
        s("20:15", "20:30"),
        s("21:00", "21:00"),
      ]),
    ).toEqual([s("20:00", "20:30")]);
  });

  it("treats adjacent spans as not overlapping", () => {
    expect(intersect([s("20:00", "20:41")], [s("20:41", "20:53")])).toEqual([]);
  });

  it("intersects lists of spans", () => {
    expect(intersect([s("20:31", "21:11")], [s("20:44", "20:49"), s("20:58", "21:03")])).toEqual([
      s("20:44", "20:49"),
      s("20:58", "21:03"),
    ]);
  });

  it("subtracts cuts from the middle, the edges, and the whole", () => {
    const base = [s("20:31", "21:11")];
    expect(subtract(base, [s("20:25", "20:44"), s("20:49", "20:58"), s("21:03", "21:30")])).toEqual(
      [s("20:44", "20:49"), s("20:58", "21:03")],
    );
    expect(subtract(base, [s("20:00", "22:00")])).toEqual([]);
    expect(subtract(base, [])).toEqual(base);
  });

  it("finds the first and last minute inside a set of spans", () => {
    const open = [s("20:44", "20:49"), s("20:58", "21:03")];
    expect(earliest(open)).toBe(parseClock("20:44"));
    // The last minute inside a half-open span ending 21:03 is 21:02.
    expect(latest(open)).toBe(parseClock("21:02"));
    expect(earliest([])).toBeNull();
    expect(latest([])).toBeNull();
  });
});
