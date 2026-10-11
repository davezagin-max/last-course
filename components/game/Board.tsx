"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Contradiction } from "@/lib/case/contradictions";
import type { PublicCase } from "@/lib/case/public";
import type { Evidence } from "@/lib/case/types";
import {
  BOARD,
  boardLinks,
  clampToBoard,
  defaultPosition,
  evidenceCard,
  stringBetween,
  suspectCard,
  type BoardLink,
} from "@/lib/game/board";
import type { GameState, Point } from "@/lib/game/state";
import { Portrait } from "./Portrait";

interface Props {
  pub: PublicCase;
  state: GameState;
  found: Evidence[];
  contradictions: Contradiction[];
  onMove: (id: string, to: Point) => void;
  onTidy: () => void;
  onOpenExhibit: (id: string) => void;
  onQuestion: (suspect: string) => void;
}

interface Card {
  id: string;
  kind: "suspect" | "evidence";
  title: string;
  detail: string;
  /** A second line for suspects: how much they have said and how much of it is in dispute. */
  note?: string;
  monogram?: string;
  open: () => void;
}

const STEP = 16;
const LINK_STYLE: Record<BoardLink["kind"], { stroke: string; dash?: string; width: number }> = {
  concerns: { stroke: "var(--string)", width: 1.5 },
  follows: { stroke: "var(--muted)", dash: "2 5", width: 1.5 },
  conflict: { stroke: "var(--danger)", width: 2.25 },
};

export function Board({
  pub,
  state,
  found,
  contradictions,
  onMove,
  onTidy,
  onOpenExhibit,
  onQuestion,
}: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; at: Point } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const grab = useRef<{
    id: string;
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const cards: Card[] = [
    ...pub.suspects.map((s): Card => {
      const said = state.claims.filter((c) => c.speaker === s.id).length;
      const caught = new Set(
        contradictions
          .filter((c) => [c.a, c.b].some((x) => x.type === "claim" && x.speaker === s.id))
          .map((c) => `${c.rule}:${c.subject}`),
      ).size;
      return {
        id: suspectCard(s.id),
        kind: "suspect",
        title: s.name,
        detail: s.role,
        note: `${said} ${said === 1 ? "note" : "notes"}${caught ? ` · ${caught} disputed` : ""}`,
        monogram: s.monogram,
        open: () => onQuestion(s.id),
      };
    }),
    ...found.map((e): Card => ({
      id: evidenceCard(e.id),
      kind: "evidence",
      title: e.title,
      detail: e.summary,
      open: () => onOpenExhibit(e.id),
    })),
  ];
  const positionOf = (id: string): Point =>
    drag?.id === id ? drag.at : (state.positions[id] ?? defaultPosition(pub, state.found, id));
  const links = boardLinks(pub, found, contradictions);
  const moved = Object.keys(state.positions).length > 0;

  function pointerDown(event: PointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0) return;
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const at = positionOf(id);
    grab.current = {
      id,
      dx: event.clientX - rect.left - at.x,
      dy: event.clientY - rect.top - at.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const g = grab.current;
    const rect = surface.current?.getBoundingClientRect();
    if (!g || !rect) return;
    // A few pixels of wobble is still a click, not a drag.
    if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 5) return;
    g.moved = true;
    setDrag({
      id: g.id,
      at: clampToBoard({ x: event.clientX - rect.left - g.dx, y: event.clientY - rect.top - g.dy }),
    });
  }

  function pointerUp(card: Card) {
    const g = grab.current;
    grab.current = null;
    if (!g) return;
    if (g.moved && drag) onMove(drag.id, drag.at);
    else card.open();
    setDrag(null);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>, card: Card) {
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const d = delta[event.key];
    if (d) {
      event.preventDefault();
      const size = event.shiftKey ? STEP * 4 : STEP;
      const at = positionOf(card.id);
      const to = clampToBoard({ x: at.x + d.x * size, y: at.y + d.y * size });
      onMove(card.id, to);
      setStatus(`${card.title} moved to ${Math.round(to.x)}, ${Math.round(to.y)}.`);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.open();
    }
  }

  return (
    <section aria-label="Evidence board" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Evidence board</h2>
          <p className="text-sm text-muted">
            Drag the cards, or focus one and use the arrow keys (Shift for bigger steps). Enter
            opens it. Strings are drawn from what each exhibit proves.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
          <Legend kind="concerns" label="Concerns" />
          <Legend kind="conflict" label="Contradicts" />
          <Legend kind="follows" label="Led to" />
          <button
            type="button"
            onClick={onTidy}
            disabled={!moved}
            className="rounded-md border border-border px-2.5 py-1.5 text-fg hover:bg-raised disabled:opacity-40"
          >
            Tidy board
          </button>
        </div>
      </div>

      <div
        className="overflow-auto rounded-lg border border-border bg-surface"
        style={{ maxHeight: "min(70vh, 700px)" }}
      >
        <div
          ref={surface}
          className="relative"
          style={{
            width: BOARD.width,
            height: BOARD.height,
            backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1.2px)",
            backgroundSize: "22px 22px",
          }}
        >
          {cards.map((card) => {
            const at = positionOf(card.id);
            const dragging = drag?.id === card.id;
            return (
              <div
                key={card.id}
                role="button"
                tabIndex={0}
                aria-roledescription="movable card"
                aria-label={`${card.kind === "suspect" ? "Suspect" : "Exhibit"}: ${card.title}. ${card.detail}${card.note ? `. ${card.note}` : ""}`}
                onPointerDown={(event) => pointerDown(event, card.id)}
                onPointerMove={pointerMove}
                onPointerUp={() => pointerUp(card)}
                onPointerCancel={() => {
                  grab.current = null;
                  setDrag(null);
                }}
                onKeyDown={(event) => keyDown(event, card)}
                onFocus={() => setActive(card.id)}
                onBlur={() => setActive(null)}
                onMouseEnter={() => setActive(card.id)}
                onMouseLeave={() => setActive(null)}
                className={`absolute flex touch-none select-none flex-col rounded-md border bg-raised px-3 py-2.5 shadow-sm ${
                  card.kind === "suspect" ? "border-accent" : "border-border"
                } ${dragging ? "z-20 cursor-grabbing shadow-xl" : "z-10 cursor-grab"}`}
                style={{ left: at.x, top: at.y, width: BOARD.card.w, height: BOARD.card.h }}
              >
                {card.kind === "suspect" ? (
                  <>
                    <span className="flex items-center gap-2">
                      <Portrait monogram={card.monogram ?? ""} size={34} />
                      <span className="min-w-0">
                        <span className="block truncate font-display text-[0.95rem] leading-tight">
                          {card.title}
                        </span>
                        <span className="block truncate text-[0.6875rem] text-muted">
                          {card.detail}
                        </span>
                      </span>
                    </span>
                    <span className="mt-auto truncate border-t border-border pt-1 font-mono text-[0.625rem] text-muted">
                      {card.note}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="line-clamp-2 text-[0.8125rem] font-semibold leading-tight">
                      {card.title}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[0.6875rem] leading-snug text-muted">
                      {card.detail}
                    </span>
                  </>
                )}
              </div>
            );
          })}

          <svg
            aria-hidden
            width={BOARD.width}
            height={BOARD.height}
            className="pointer-events-none absolute inset-0 z-30"
          >
            {links.map((link) => {
              const style = LINK_STYLE[link.kind];
              const lit = active === null || link.from === active || link.to === active;
              const { path, ends } = stringBetween(positionOf(link.from), positionOf(link.to));
              return (
                <g key={`${link.from}~${link.to}`} opacity={lit ? 0.92 : 0.14}>
                  <path
                    d={path}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={style.width}
                    strokeDasharray={style.dash}
                    strokeLinecap="round"
                  />
                  {ends.map((end, i) => (
                    <circle
                      key={i}
                      cx={end.x}
                      cy={end.y}
                      r="3.25"
                      fill={style.stroke}
                      stroke="var(--raised)"
                      strokeWidth="1"
                    />
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <p className="sr-only" role="status">
        {status}
      </p>
    </section>
  );
}

function Legend({ kind, label }: { kind: BoardLink["kind"]; label: string }) {
  const style = LINK_STYLE[kind];
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg aria-hidden width="26" height="8">
        <line
          x1="1"
          y1="4"
          x2="25"
          y2="4"
          stroke={style.stroke}
          strokeWidth={style.width}
          strokeDasharray={style.dash}
          strokeLinecap="round"
        />
      </svg>
      {label}
    </span>
  );
}
