/**
 * The evidence board's geometry and its strings. Pure: the component only
 * draws what this returns.
 */
import type { Contradiction } from "@/lib/case/contradictions";
import type { PublicCase } from "@/lib/case/public";
import { VICTIM_ID, type Evidence } from "@/lib/case/types";
import type { Point } from "./state";

export const BOARD = {
  width: 1184,
  height: 712,
  card: { w: 176, h: 92 },
  columns: 5,
  gapX: 212,
  gapY: 126,
  margin: 26,
  /** Suspects sit a little below the top edge so strings between them can arc above the cards. */
  suspectTop: 58,
  evidenceTop: 208,
  /** Every other row of exhibits is shifted, so strings rarely run straight through a card. */
  stagger: 106,
};

export const suspectCard = (id: string) => `s:${id}`;
export const evidenceCard = (id: string) => `e:${id}`;

/** Where a card sits until the player drags it: suspects along the top, exhibits in rows in the order found. */
export function defaultPosition(pub: PublicCase, found: string[], cardId: string): Point {
  const [kind, id] = [cardId.slice(0, 1), cardId.slice(2)];
  if (kind === "s") {
    const i = Math.max(0, pub.suspects.findIndex((s) => s.id === id));
    return { x: BOARD.margin + i * BOARD.gapX, y: BOARD.suspectTop };
  }
  const i = Math.max(0, found.indexOf(id));
  const row = Math.floor(i / BOARD.columns);
  return {
    x: BOARD.margin + (row % 2 === 0 ? BOARD.stagger : 0) + (i % BOARD.columns) * BOARD.gapX,
    y: BOARD.evidenceTop + row * BOARD.gapY,
  };
}

export function clampToBoard(point: Point): Point {
  return {
    x: Math.min(Math.max(point.x, 0), BOARD.width - BOARD.card.w),
    y: Math.min(Math.max(point.y, 0), BOARD.height - BOARD.card.h),
  };
}

export interface BoardLink {
  from: string;
  to: string;
  /**
   * concerns: the exhibit proves something about this person.
   * follows: one exhibit led to another.
   * conflict: a contradiction between the two cards.
   */
  kind: "concerns" | "follows" | "conflict";
}

/** The suspects an exhibit says something about. */
export function concerns(pub: PublicCase, exhibit: Evidence): string[] {
  const suspects = new Set(pub.suspects.map((s) => s.id));
  const people = new Set<string>();
  for (const fact of exhibit.facts) {
    if (fact.type === "presence" || fact.type === "absent" || fact.type === "possession") people.add(fact.person);
    if (fact.type === "relationship") [fact.a, fact.b].forEach((p) => people.add(p));
    if (fact.type === "motive") {
      const owner = pub.motives.find((m) => m.id === fact.motive)?.suspect;
      if (owner) people.add(owner);
    }
  }
  people.delete(VICTIM_ID);
  return [...people].filter((p) => suspects.has(p));
}

export function boardLinks(pub: PublicCase, found: Evidence[], contradictions: Contradiction[]): BoardLink[] {
  const links = new Map<string, BoardLink>();
  const add = (from: string, to: string, kind: BoardLink["kind"]) => {
    const key = [from, to].sort().join("~");
    const existing = links.get(key);
    // A conflict outranks any quieter link between the same two cards.
    if (!existing || kind === "conflict") links.set(key, { from, to, kind });
  };
  const have = new Set(found.map((e) => e.id));

  for (const exhibit of found) {
    for (const person of concerns(pub, exhibit)) add(evidenceCard(exhibit.id), suspectCard(person), "concerns");
    if (exhibit.unlock.type === "evidence") {
      for (const source of exhibit.unlock.all) {
        if (have.has(source)) add(evidenceCard(source), evidenceCard(exhibit.id), "follows");
      }
    }
  }
  for (const c of contradictions) {
    if (c.a.type !== "claim") continue;
    if (c.b.type === "evidence") {
      if (have.has(c.b.id)) add(suspectCard(c.a.speaker), evidenceCard(c.b.id), "conflict");
    } else if (c.b.speaker !== c.a.speaker) {
      add(suspectCard(c.a.speaker), suspectCard(c.b.speaker), "conflict");
    }
  }
  return [...links.values()];
}

/**
 * The path of a string between two cards, and where it is pinned to each.
 * Cards in the same row are joined across their tops with an arc above them;
 * otherwise the string leaves the bottom of the upper card and hangs, with a
 * little slack, to the top of the lower one. Either way it never has to cross
 * the text of the two cards it joins.
 */
export function stringBetween(a: Point, b: Point): { path: string; ends: [Point, Point] } {
  const { w, h } = BOARD.card;
  const top = (p: Point): Point => ({ x: p.x + w / 2, y: p.y });
  const bottom = (p: Point): Point => ({ x: p.x + w / 2, y: p.y + h });
  if (Math.abs(a.y - b.y) < h) {
    const [from, to] = [top(a), top(b)];
    const lift = 16 + Math.abs(to.x - from.x) * 0.045;
    const peak = Math.min(from.y, to.y) - lift;
    return { path: `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${peak} ${to.x} ${to.y}`, ends: [from, to] };
  }
  const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
  const [from, to] = [bottom(upper), top(lower)];
  const slack = Math.min(34, 6 + Math.hypot(to.x - from.x, to.y - from.y) * 0.06);
  return {
    path: `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 + slack} ${to.x} ${to.y}`,
    ends: [from, to],
  };
}
