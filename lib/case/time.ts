/**
 * Time and interval arithmetic for the case engine.
 *
 * Every time in a case is a whole number of minutes after midnight on one
 * evening, and every span is half-open: [from, to). That makes "left the pass
 * at 20:41" and "reached the office at 20:41" adjacent rather than overlapping,
 * and lets the solver do set arithmetic on plain sorted lists.
 */

export type Minute = number;

export interface Span {
  from: Minute;
  to: Minute;
}

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "20:41" -> 1241. Returns null for anything that is not a 24-hour clock time. */
export function parseClock(text: string): Minute | null {
  const match = CLOCK.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 1241 -> "20:41". */
export function formatClock(minute: Minute): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "20:41–20:53", or a single time for a one-minute span. */
export function formatSpan(span: Span): string {
  if (span.to - span.from <= 1) return formatClock(span.from);
  return `${formatClock(span.from)}–${formatClock(span.to)}`;
}

export function formatSpans(spans: Span[]): string {
  return spans.length ? spans.map(formatSpan).join(", ") : "never";
}

/** Sorts, drops empty spans, and merges spans that touch or overlap. */
export function normalize(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else out.push({ ...span });
  }
  return out;
}

export function intersect(a: Span[], b: Span[]): Span[] {
  const left = normalize(a);
  const right = normalize(b);
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const from = Math.max(left[i].from, right[j].from);
    const to = Math.min(left[i].to, right[j].to);
    if (to > from) out.push({ from, to });
    if (left[i].to < right[j].to) i += 1;
    else j += 1;
  }
  return out;
}

/** Everything in `base` that is not covered by `cuts`. */
export function subtract(base: Span[], cuts: Span[]): Span[] {
  const removed = normalize(cuts);
  const out: Span[] = [];
  for (const span of normalize(base)) {
    let cursor = span.from;
    for (const cut of removed) {
      if (cut.to <= cursor) continue;
      if (cut.from >= span.to) break;
      if (cut.from > cursor) out.push({ from: cursor, to: cut.from });
      cursor = Math.max(cursor, cut.to);
    }
    if (cursor < span.to) out.push({ from: cursor, to: span.to });
  }
  return out;
}

export function overlapMinutes(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

export function earliest(spans: Span[]): Minute | null {
  const list = normalize(spans);
  return list.length ? list[0].from : null;
}

/** The last minute that is inside the set (spans are half-open, so `to - 1`). */
export function latest(spans: Span[]): Minute | null {
  const list = normalize(spans);
  return list.length ? list[list.length - 1].to - 1 : null;
}
