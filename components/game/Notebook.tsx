"use client";

import { contradictionText } from "@/lib/case/explain";
import { contradictedClaims, type Contradiction } from "@/lib/case/contradictions";
import { claimText } from "@/lib/case/explain";
import type { Names, PublicCase } from "@/lib/case/public";
import type { Claim, Evidence } from "@/lib/case/types";
import type { GameState } from "@/lib/game/state";

interface Props {
  pub: PublicCase;
  state: GameState;
  names: Names;
  found: Evidence[];
  contradictions: Contradiction[];
  onOpenExhibit: (id: string) => void;
}

const BASIS: Record<Contradiction["basis"], { label: string; tone: string }> = {
  evidence: { label: "Proven false", tone: "border-danger bg-danger-soft text-danger" },
  self: { label: "Changed story", tone: "border-accent bg-accent-soft text-accent" },
  testimony: { label: "Disputed", tone: "border-border text-muted" },
};
const BASIS_RANK: Contradiction["basis"][] = ["evidence", "self", "testimony"];

/** Conflicts about the same thing are shown as one entry, strongest first. */
function group(contradictions: Contradiction[]): Contradiction[][] {
  const groups = new Map<string, Contradiction[]>();
  for (const c of contradictions) {
    const key = `${c.rule}:${c.subject}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].sort(
    (a, b) => BASIS_RANK.indexOf(a[0].basis) - BASIS_RANK.indexOf(b[0].basis) || b.length - a.length,
  );
}

export function Notebook({ pub, state, names, found, contradictions, onOpenExhibit }: Props) {
  const claims = new Map(state.claims.map((c) => [c.id, c]));
  const exhibits = new Map(found.map((e) => [e.id, e]));
  const flagged = contradictedClaims(contradictions);
  const groups = group(contradictions);
  const speakers = pub.suspects.filter((s) => state.claims.some((c) => c.speaker === s.id));
  const latestTurn = state.turns[state.turns.length - 1];
  const fresh = new Set(latestTurn?.unlocked ?? []);

  return (
    <aside id="notebook" aria-label="Notebook" className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-surface p-4">
      <header>
        <h2 className="font-display text-xl">Notebook</h2>
        <p className="text-sm text-muted">Every checkable claim, filed as it is made. Conflicts are found by code, not guessed.</p>
      </header>

      <section aria-label="Conflicts">
        <h3 className="label mb-2 flex items-center gap-2">
          Conflicts
          <span className={`rounded px-1.5 font-mono text-xs ${groups.length ? "bg-danger text-bg" : "bg-raised text-muted"}`}>{groups.length}</span>
        </h3>
        {groups.length === 0 ? (
          <p className="text-sm text-muted">None yet. When two statements cannot both be true, or a statement contradicts an exhibit, it shows up here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((list) => {
              const lead = list[0];
              const text = contradictionText(names, lead, claims, exhibits, pub.window);
              const basis = BASIS[lead.basis];
              return (
                <li key={lead.id} className="rise rounded-md border border-border bg-raised">
                  <details open={lead.basis === "evidence"} className="group">
                    <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                      <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide ${basis.tone}`}>{basis.label}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{text.title}</span>
                      {list.length > 1 && <span className="shrink-0 font-mono text-xs text-muted">×{list.length}</span>}
                    </summary>
                    <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
                      {list.slice(0, 4).map((c) => (
                        <ConflictSides key={c.id} c={c} {...{ names, claims, exhibits, pub, onOpenExhibit }} />
                      ))}
                      {list.length > 4 && <p className="text-xs text-muted">and {list.length - 4} more of the same.</p>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Statements">
        <h3 className="label mb-2">Statements</h3>
        {speakers.length === 0 ? (
          <p className="text-sm text-muted">Nothing on record. Ask anyone a question to start the file.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {speakers.map((s) => {
              const mine = state.claims.filter((c) => c.speaker === s.id);
              return (
                <details key={s.id} open={s.id === state.suspect} className="rounded-md border border-border">
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
                    {s.name}
                    <span className="font-mono text-xs text-muted">{mine.length}</span>
                  </summary>
                  <ul className="flex flex-col divide-y divide-border border-t border-border">
                    {mine.map((claim) => (
                      <ClaimRow key={claim.id} claim={claim} names={names} pub={pub} conflicts={flagged.get(claim.id) ?? []} />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section aria-label="Exhibits">
        <h3 className="label mb-2 flex items-center gap-2">
          Exhibits
          <span className="rounded bg-raised px-1.5 font-mono text-xs text-muted">
            {found.length}/{pub.evidence.length}
          </span>
        </h3>
        <ul className="flex flex-col gap-1.5">
          {found.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onOpenExhibit(e.id)}
                className={`w-full rounded-md border px-3 py-2 text-left hover:border-accent ${fresh.has(e.id) ? "rise border-accent bg-accent-soft" : "border-border bg-raised"}`}
              >
                <span className="block text-sm font-medium">{e.title}</span>
                <span className="block text-xs text-muted">{e.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function ConflictSides({
  c,
  names,
  claims,
  exhibits,
  pub,
  onOpenExhibit,
}: {
  c: Contradiction;
  names: Names;
  claims: Map<string, Claim>;
  exhibits: Map<string, Evidence>;
  pub: PublicCase;
  onOpenExhibit: (id: string) => void;
}) {
  const text = contradictionText(names, c, claims, exhibits, pub.window);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
      {text.sides.map((side, i) => (
        <div key={i} className="contents">
          <dt className="text-xs font-semibold text-muted">
            {side.source.type === "evidence" ? (
              <button type="button" onClick={() => onOpenExhibit(side.source.id)} className="text-accent underline underline-offset-2">
                {side.label}
              </button>
            ) : (
              side.label
            )}
          </dt>
          <dd>{side.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function ClaimRow({ claim, names, pub, conflicts }: { claim: Claim; names: Names; pub: PublicCase; conflicts: Contradiction[] }) {
  const worst = BASIS_RANK.find((basis) => conflicts.some((c) => c.basis === basis));
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm">{claimText(names, claim, pub.window)}</span>
        {worst && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide ${BASIS[worst].tone}`}>{BASIS[worst].label}</span>}
      </div>
      <q className="text-xs italic text-muted">{claim.quote}</q>
    </li>
  );
}
