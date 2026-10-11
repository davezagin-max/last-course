"use client";

import type { CSSProperties } from "react";
import type { Contradiction } from "@/lib/case/contradictions";
import type { Names, PublicCase } from "@/lib/case/public";
import { formatClock, formatSpan, type Span } from "@/lib/case/time";
import { PLACE_AT, PLACE_SHORT, type Evidence } from "@/lib/case/types";
import type { GameState } from "@/lib/game/state";
import { buildTimeline, type Lane, type TimelineBar } from "@/lib/game/timeline";
import { Portrait } from "./Portrait";

interface Props {
  pub: PublicCase;
  state: GameState;
  names: Names;
  found: Evidence[];
  contradictions: Contradiction[];
}

const LANE_H = 22;
const LANES: { id: Lane; label: string }[] = [
  { id: "says", label: "Says" },
  { id: "others", label: "Others say" },
  { id: "proven", label: "Proven" },
];

const LANE_STYLE: Record<Lane, string> = {
  says: "border border-fg/55 bg-raised text-fg",
  others: "border border-dashed border-fg/55 bg-raised text-fg",
  proven: "border border-accent bg-accent text-accent-fg",
};
const CONFLICT_STYLE: Record<Lane, string> = {
  says: "border-2 border-danger bg-danger-soft text-fg",
  others: "border-2 border-dashed border-danger bg-danger-soft text-fg",
  proven: LANE_STYLE.proven,
};

export function Timeline({ pub, state, names, found, contradictions }: Props) {
  const data = buildTimeline(pub, names, state.claims, found, contradictions);
  const { from, to } = pub.window;
  const pct = (minute: number) => ((Math.min(Math.max(minute, from), to) - from) / (to - from)) * 100;
  const place = (span: Span): CSSProperties => ({ left: `${pct(span.from)}%`, width: `${Math.max(pct(span.to) - pct(span.from), 0.6)}%` });
  const ticks: number[] = [];
  for (let m = Math.ceil(from / 10) * 10; m <= to; m += 10) ticks.push(m);
  const empty = data.rows.every((r) => r.bars.length === 0) && data.empties.length === 0 && data.bands.length === 0;

  return (
    <section aria-label="Timeline" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Timeline</h2>
          <p className="text-sm text-muted">
            Where each person says they were, where others put them, and what the exhibits prove. Testimony caught in a conflict turns red.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {LANES.map((lane) => (
            <span key={lane.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`inline-block h-3 w-6 rounded-sm ${LANE_STYLE[lane.id]}`} />
              {lane.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-3 w-6 rounded-sm ${CONFLICT_STYLE.says}`} />
            In conflict
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface" tabIndex={0} role="group" aria-label="Timeline chart. Scrolls sideways on small screens.">
        <div className="grid min-w-[52rem] grid-cols-[7.5rem_minmax(0,1fr)_1.25rem]">
          {/* Clock */}
          <div className="border-b border-border" />
          <div className="relative h-8 border-b border-border">
            {ticks.map((m) => (
              <span key={m} className="absolute top-2 -translate-x-1/2 font-mono text-[0.6875rem] text-muted" style={{ left: `${pct(m)}%` }}>
                {formatClock(m)}
              </span>
            ))}
          </div>
          <div className="border-b border-border" />

          {/* What the evidence establishes about the evening as a whole. */}
          {(data.bands.length > 0 || data.markers.length > 0) && (
            <>
              <div className="label border-b border-border px-3 py-2.5">Established</div>
              <Track ticks={ticks} pct={pct} data={data} place={place} className="border-b border-border py-1.5">
                <ul className="relative flex flex-col gap-1">
                  {data.bands.map((band) => (
                    <li key={band.key} className="relative h-5">
                      <span aria-hidden className="absolute inset-y-0 rounded-sm border border-accent bg-accent-soft" style={place(band.span)} />
                      {/* The label starts at the window but is allowed to run past it. */}
                      <span className="absolute inset-y-0 flex items-center whitespace-nowrap pl-1.5 text-[0.6875rem] font-medium" style={{ left: `${pct(band.span.from)}%` }}>
                        {band.label}, <span className="ml-1 font-mono">{formatSpan(band.span)}</span>
                      </span>
                    </li>
                  ))}
                  {data.markers.map((marker) => {
                    const flip = pct(marker.at) > 60;
                    return (
                      <li key={`${marker.at}-${marker.label}`} className="relative h-4">
                        <span
                          className={`absolute whitespace-nowrap text-[0.6875rem] text-muted ${flip ? "-translate-x-full pr-1.5" : "pl-1.5"}`}
                          style={{ left: `${pct(marker.at)}%` }}
                        >
                          <span className="font-mono text-fg">{formatClock(marker.at)}</span> {marker.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Track>
              <div className="border-b border-border" />
            </>
          )}

          {data.rows.map((row) => (
            <div key={row.suspect.id} className="col-span-3 grid grid-cols-subgrid border-b border-border last:border-b-0">
              <div className="flex items-center gap-2 px-3">
                <Portrait monogram={row.suspect.monogram} size={30} />
                <span className="truncate text-sm font-medium">{row.suspect.short}</span>
              </div>
              <Track ticks={ticks} pct={pct} data={data} place={place} className="py-1.5">
                {LANES.map((lane) => (
                  <ul
                    key={lane.id}
                    aria-label={`${row.suspect.short}: ${lane.label.toLowerCase()}`}
                    className="relative"
                    style={{ height: row.depth[lane.id] * LANE_H }}
                  >
                    {row.bars
                      .filter((b) => b.lane === lane.id)
                      .map((bar) => (
                        <Bar key={bar.key} bar={bar} who={row.suspect.short} style={place(bar.span)} left={pct(bar.span.from)} />
                      ))}
                  </ul>
                ))}
              </Track>
              <div />
            </div>
          ))}

          {data.empties.length > 0 && (
            <div className="col-span-3 grid grid-cols-subgrid border-t border-border">
              <div className="flex items-center px-3 text-sm font-medium">Empty rooms</div>
              <Track ticks={ticks} pct={pct} data={data} place={place} className="py-1.5">
                <ul className="relative" style={{ height: LANE_H }}>
                  {data.empties.map((e) => (
                    <li
                      key={e.key}
                      className="absolute top-0.5 flex items-center overflow-hidden whitespace-nowrap rounded-sm border border-border text-[0.6875rem] text-muted"
                      style={{
                        ...place(e.span),
                        height: LANE_H - 4,
                        backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--border) 5px 6px)",
                      }}
                      title={`Nobody ${PLACE_AT[e.place]}, ${formatSpan(e.span)} (${e.source})`}
                    >
                      <span aria-hidden className="bg-surface px-1.5">
                        {PLACE_SHORT[e.place]}
                      </span>
                      <span className="sr-only">
                        Nobody {PLACE_AT[e.place]}, {formatSpan(e.span)}, per {e.source}
                      </span>
                    </li>
                  ))}
                </ul>
              </Track>
              <div />
            </div>
          )}
        </div>
      </div>
      {empty && (
        <p className="text-sm text-muted">
          Nothing to plot yet. Ask people where they were; the times they give, and the times the exhibits prove, will line up here.
        </p>
      )}
    </section>
  );
}

/** One row's plotting area, with the shared grid lines, event markers, and opportunity windows behind it. */
function Track({
  ticks,
  pct,
  data,
  place,
  className = "",
  children,
}: {
  ticks: number[];
  pct: (minute: number) => number;
  data: ReturnType<typeof buildTimeline>;
  place: (span: Span) => CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {ticks.map((m) => (
          <span key={m} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${pct(m)}%` }} />
        ))}
        {data.bands.map((band) => (
          <span key={band.key} className="absolute inset-y-0 bg-accent-soft" style={place(band.span)} />
        ))}
        {data.markers.map((marker) => (
          <span key={`${marker.at}-${marker.label}`} className="absolute inset-y-0 w-px bg-accent/70" style={{ left: `${pct(marker.at)}%` }} />
        ))}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function Bar({ bar, who, style, left }: { bar: TimelineBar; who: string; style: CSSProperties; left: number }) {
  const what =
    bar.lane === "says"
      ? `${who} says: ${PLACE_AT[bar.place]}`
      : bar.lane === "others"
        ? `${bar.source} says ${who} was ${PLACE_AT[bar.place]}`
        : `${bar.source} proves ${who} was ${PLACE_AT[bar.place]}`;
  const description = `${what}, ${formatSpan(bar.span)}${bar.conflict ? ". In conflict." : ""}`;
  const tone = bar.conflict ? CONFLICT_STYLE[bar.lane] : LANE_STYLE[bar.lane];
  const top = bar.row * LANE_H + 2;
  if (bar.point) {
    // A single moment: a small diamond, with the room named beside it.
    return (
      <li className="absolute flex items-center gap-1" style={{ left: `${left}%`, top, height: LANE_H - 4 }} title={description}>
        <span aria-hidden className={`-ml-[5px] block size-2.5 shrink-0 rotate-45 rounded-[1px] ${tone}`} />
        <span aria-hidden className="whitespace-nowrap text-[0.6875rem] font-medium">
          {PLACE_SHORT[bar.place]}
        </span>
        <span className="sr-only">{description}</span>
      </li>
    );
  }
  return (
    <li
      className={`absolute flex items-center overflow-hidden whitespace-nowrap rounded-sm px-1.5 text-[0.6875rem] font-medium ${tone}`}
      style={{ ...style, top, height: LANE_H - 4 }}
      title={description}
    >
      <span aria-hidden>{PLACE_SHORT[bar.place]}</span>
      <span className="sr-only">{description}</span>
    </li>
  );
}
