/**
 * Lays testimony and proof side by side on one clock. Pure data for the
 * timeline view: who says they were where, who says otherwise, and what the
 * exhibits prove.
 */
import { claimSpan } from "@/lib/case/claims";
import { contradictedClaims, type Contradiction } from "@/lib/case/contradictions";
import type { Names, PublicCase, PublicSuspect } from "@/lib/case/public";
import type { Span } from "@/lib/case/time";
import { PLACE_SHORT, type Claim, type Evidence, type PlaceId } from "@/lib/case/types";

export type Lane = "says" | "others" | "proven";

export interface TimelineBar {
  key: string;
  lane: Lane;
  place: PlaceId;
  span: Span;
  /** A single moment rather than a stretch. */
  point: boolean;
  /** Who said it, or which exhibit proves it. */
  source: string;
  /** Testimony that sits in a contradiction. Proof is never marked: evidence is true. */
  conflict: boolean;
  /** Which sub-row of its lane the bar sits in, so overlapping bars stack instead of colliding. */
  row: number;
}

export interface TimelineRow {
  suspect: PublicSuspect;
  bars: TimelineBar[];
  /** How many sub-rows each lane needs. */
  depth: Record<Lane, number>;
}

/** Greedy interval packing: each bar takes the first sub-row where it does not overlap its neighbours. */
export function packRows<T extends { span: Span; row: number; point?: boolean }>(bars: T[], pad = 2): number {
  const ends: number[] = [];
  for (const bar of [...bars].sort((a, b) => a.span.from - b.span.from || b.span.to - a.span.to)) {
    let row = ends.findIndex((end) => end <= bar.span.from);
    if (row === -1) row = ends.length;
    // A single moment is drawn as a marker with its label beside it, which needs room.
    ends[row] = (bar.point ? bar.span.from + POINT_LABEL_MINUTES : bar.span.to) + pad;
    bar.row = row;
  }
  return Math.max(1, ends.length);
}

const POINT_LABEL_MINUTES = 9;

export interface TimelineMarker {
  at: number;
  label: string;
}

export interface TimelineBand {
  key: string;
  span: Span;
  label: string;
}

export interface TimelineData {
  rows: TimelineRow[];
  markers: TimelineMarker[];
  /** Opportunity windows the evidence establishes. */
  bands: TimelineBand[];
  /** Stretches a room is proven empty. */
  empties: { key: string; place: PlaceId; span: Span; source: string }[];
}

export function buildTimeline(
  pub: PublicCase,
  names: Names,
  claims: Claim[],
  found: Evidence[],
  contradictions: Contradiction[],
): TimelineData {
  const flagged = contradictedClaims(contradictions);

  const rows: TimelineRow[] = pub.suspects.map((suspect) => {
    const bars: TimelineBar[] = [];
    for (const claim of claims) {
      if (claim.subject !== suspect.id || claim.negated || !claim.place) continue;
      if (claim.kind !== "location" && claim.kind !== "sighting") continue;
      const when = claimSpan(claim, pub.window);
      if (!when) continue;
      bars.push({
        key: claim.id,
        lane: claim.speaker === suspect.id ? "says" : "others",
        place: claim.place,
        span: when.span,
        point: when.point,
        source: names.person(claim.speaker),
        conflict: flagged.has(claim.id),
        row: 0,
      });
    }
    for (const exhibit of found) {
      exhibit.facts.forEach((fact, i) => {
        if (fact.type !== "presence" || fact.person !== suspect.id) return;
        bars.push({
          key: `${exhibit.id}:${i}`,
          lane: "proven",
          place: fact.place,
          span: { from: fact.from, to: fact.to },
          point: false,
          source: exhibit.title,
          conflict: false,
          row: 0,
        });
      });
    }
    const depth = {
      says: packRows(bars.filter((b) => b.lane === "says")),
      others: packRows(bars.filter((b) => b.lane === "others")),
      proven: packRows(bars.filter((b) => b.lane === "proven")),
    };
    return { suspect, bars, depth };
  });

  const markers: TimelineMarker[] = [];
  const bands: TimelineBand[] = [];
  const empties: TimelineData["empties"] = [];
  for (const exhibit of found) {
    exhibit.facts.forEach((fact, i) => {
      if (fact.type === "timing") {
        markers.push({ at: fact.at, label: names.event(fact.event) });
      } else if (fact.type === "window") {
        bands.push({
          key: `${exhibit.id}:${i}`,
          span: { from: fact.from, to: fact.to },
          label: `${fact.step === "acquire" ? "Poison could be taken" : "Dish could be tampered with"} · ${PLACE_SHORT[fact.place]}`,
        });
      } else if (fact.type === "empty") {
        empties.push({ key: `${exhibit.id}:${i}`, place: fact.place, span: { from: fact.from, to: fact.to }, source: exhibit.title });
      }
    });
  }
  markers.sort((a, b) => a.at - b.at);
  return { rows, markers, bands, empties };
}
