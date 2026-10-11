/**
 * How clues unlock. Used three ways with the same code:
 * - the browser applies leads from an answer to the player's progress,
 * - the server refuses leads a suspect could not have given yet,
 * - the validator proves every clue can be reached from the opening state.
 */
import type { Evidence, Lead, Motive } from "./types";

type EvidenceRule = Pick<Evidence, "id" | "unlock">;
type LeadRule = Pick<Lead, "id" | "suspect" | "requires">;

export function startingEvidence(evidence: EvidenceRule[]): string[] {
  return evidence.filter((e) => e.unlock.type === "start").map((e) => e.id);
}

/**
 * Evidence found given the leads revealed so far. Runs to a fixed point because
 * finding one exhibit can release another (a lab result, a pulled log).
 */
export function unlockEvidence(
  evidence: EvidenceRule[],
  leads: Iterable<string>,
  found: Iterable<string>,
): string[] {
  const known = new Set(leads);
  const have = new Set(found);
  for (const id of startingEvidence(evidence)) have.add(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of evidence) {
      if (have.has(e.id)) continue;
      const open =
        (e.unlock.type === "lead" && e.unlock.any.some((lead) => known.has(lead))) ||
        (e.unlock.type === "evidence" && e.unlock.all.every((id) => have.has(id)));
      if (open) {
        have.add(e.id);
        changed = true;
      }
    }
  }
  // Keep the case file's order so the result is stable.
  return evidence.filter((e) => have.has(e.id)).map((e) => e.id);
}

/**
 * Which of the leads named in an answer actually count: the lead must belong
 * to the suspect who spoke, and every exhibit it depends on must have been put
 * in front of that suspect.
 */
export function acceptLeads(
  leads: LeadRule[],
  suspect: string,
  named: string[],
  shown: Iterable<string>,
): string[] {
  const seen = new Set(shown);
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  return [...new Set(named)].filter((id) => {
    const lead = byId.get(id);
    return Boolean(lead && lead.suspect === suspect && lead.requires.every((e) => seen.has(e)));
  });
}

export function motiveRevealed(
  motive: Pick<Motive, "revealedBy">,
  found: Iterable<string>,
  leads: Iterable<string>,
): boolean {
  if (motive.revealedBy.length === 0) return true;
  const have = new Set([...found, ...leads]);
  return motive.revealedBy.some((id) => have.has(id));
}

export interface Reachability {
  evidence: string[];
  leads: string[];
  /** Evidence that can never be found, with what it is waiting on. */
  stuck: { id: string; waitingOn: string[] }[];
  /** Leads no suspect can ever be brought to give. */
  deadLeads: { id: string; waitingOn: string[] }[];
}

/**
 * The best case for the player: every suspect is asked everything and shown
 * every exhibit as soon as it is found. Anything still missing is unreachable.
 */
export function reachability(kase: { evidence: EvidenceRule[]; leads: LeadRule[] }): Reachability {
  let found = startingEvidence(kase.evidence);
  let leads: string[] = [];
  for (;;) {
    const have = new Set(found);
    const nextLeads = kase.leads
      .filter((l) => l.requires.every((e) => have.has(e)))
      .map((l) => l.id);
    const nextFound = unlockEvidence(kase.evidence, nextLeads, found);
    const grew = nextLeads.length > leads.length || nextFound.length > found.length;
    leads = nextLeads;
    found = nextFound;
    if (!grew) break;
  }
  const have = new Set(found);
  const known = new Set(leads);
  return {
    evidence: found,
    leads,
    stuck: kase.evidence
      .filter((e) => !have.has(e.id))
      .map((e) => ({
        id: e.id,
        waitingOn:
          e.unlock.type === "lead"
            ? e.unlock.any.filter((l) => !known.has(l))
            : e.unlock.type === "evidence"
              ? e.unlock.all.filter((id) => !have.has(id))
              : [],
      })),
    deadLeads: kase.leads
      .filter((l) => !known.has(l.id))
      .map((l) => ({ id: l.id, waitingOn: l.requires.filter((e) => !have.has(e)) })),
  };
}
