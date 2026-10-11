/**
 * The solver: which (culprit, method, motive) theories does the evidence allow?
 *
 * It never reads the stored solution. It enumerates every theory and tries to
 * eliminate each one using nothing but evidence facts, the way a player would:
 *
 *   poison / vehicle  forensics name the poison or what it was served in
 *   motive            evidence refutes the motive
 *   acquire           the suspect could not have been where the poison was
 *                     taken at any minute it could have been taken
 *   administer        same, for where and when the dish was dosed
 *   sequence          the only times they could do each are in the wrong order
 *
 * Opportunity is interval arithmetic. For each step the evidence gives a
 * window (a place and a span). "Empty room" facts cut minutes out of it for
 * everyone; a suspect's proven presence somewhere else cuts minutes out for
 * that suspect. A theory dies when nothing is left.
 *
 * Because every rule only ever removes theories, the result is monotonic: the
 * more evidence, the fewer survivors. The validator requires exactly one
 * survivor under all the evidence; the UI runs the same function on what the
 * player has found so far.
 */
import {
  earliest,
  intersect,
  latest,
  normalize,
  subtract,
  type Span,
} from "./time";
import type { Fact, Method, Motive, PlaceId, Theory } from "./types";

export interface SourcedFact {
  evidence: string;
  fact: Fact;
}

export interface Candidates {
  suspects: string[];
  methods: Method[];
  motives: Pick<Motive, "id" | "suspect">[];
  /** The evening. An unconstrained step is possible at any minute of it. */
  window: Span;
}

export type Step = "acquire" | "administer";
export type EliminationRule = "poison" | "vehicle" | "motive" | Step | "sequence";

type PresenceFact = Extract<Fact, { type: "presence" | "absent" }>;

export interface Blocker {
  evidence: string;
  fact: PresenceFact;
}

/** When and where one step of a method was possible for anybody. */
export interface Opportunity {
  step: Step;
  /** False when no evidence constrains this step yet. */
  known: boolean;
  place: PlaceId | null;
  open: Span[];
  evidence: string[];
}

export type EliminationDetail =
  | { rule: "poison" | "vehicle"; item: string }
  | { rule: "motive" }
  | { rule: Step; place: PlaceId; open: Span[]; blockers: Blocker[] }
  | { rule: "sequence"; acquire: Span[]; administer: Span[] };

export interface Elimination {
  theory: Theory;
  rule: EliminationRule;
  /** The evidence this elimination rests on. */
  evidence: string[];
  detail: EliminationDetail;
}

export interface SolveResult {
  total: number;
  survivors: Theory[];
  eliminated: Elimination[];
  /** Per method id: the opportunity windows the evidence establishes. */
  opportunities: Record<string, { acquire: Opportunity; administer: Opportunity }>;
}

export function enumerateTheories(candidates: Candidates): Theory[] {
  const theories: Theory[] = [];
  for (const suspect of candidates.suspects) {
    for (const motive of candidates.motives.filter((m) => m.suspect === suspect)) {
      for (const method of candidates.methods) {
        theories.push({ culprit: suspect, method: method.id, motive: motive.id });
      }
    }
  }
  return theories;
}

const unique = (ids: string[]) => [...new Set(ids)];

function stepOpportunity(
  step: Step,
  item: string,
  facts: SourcedFact[],
  evening: Span,
): Opportunity {
  const windows = facts.filter(
    (f): f is SourcedFact & { fact: Extract<Fact, { type: "window" }> } =>
      f.fact.type === "window" && f.fact.step === step && f.fact.item === item,
  );
  if (windows.length === 0) {
    return { step, known: false, place: null, open: [evening], evidence: [] };
  }
  const place = windows[0].fact.place;
  const evidence = windows.map((w) => w.evidence);
  // Two windows that name different rooms cannot both hold: nothing is possible.
  if (windows.some((w) => w.fact.place !== place)) {
    return { step, known: true, place, open: [], evidence: unique(evidence) };
  }
  let open: Span[] = [evening];
  for (const w of windows) open = intersect(open, [{ from: w.fact.from, to: w.fact.to }]);
  for (const f of facts) {
    if (f.fact.type !== "empty" || f.fact.place !== place) continue;
    const cut = [{ from: f.fact.from, to: f.fact.to }];
    if (intersect(open, cut).length === 0) continue;
    open = subtract(open, cut);
    evidence.push(f.evidence);
  }
  return { step, known: true, place, open, evidence: unique(evidence) };
}

/**
 * The poison has to be taken before it can be used. So an acquire minute only
 * counts if some administer minute comes after it, and the other way round.
 * This is what rules out "he was in the alley at 20:58" when the poison was
 * already on the pass at 20:56.
 */
function orderSteps(acquire: Opportunity, administer: Opportunity): void {
  const lastUse = latest(administer.open);
  const before = lastUse === null ? [] : intersect(acquire.open, [{ from: -Infinity, to: lastUse }]);
  if (measureChanged(acquire.open, before)) acquire.evidence = unique([...acquire.evidence, ...administer.evidence]);
  acquire.open = before;
  const firstTake = earliest(acquire.open);
  const after =
    firstTake === null ? [] : intersect(administer.open, [{ from: firstTake + 1, to: Infinity }]);
  if (measureChanged(administer.open, after)) administer.evidence = unique([...administer.evidence, ...acquire.evidence]);
  administer.open = after;
}

function measureChanged(a: Span[], b: Span[]): boolean {
  return JSON.stringify(normalize(a)) !== JSON.stringify(normalize(b));
}

/** Minutes of `open` in which the evidence does not put `suspect` somewhere other than `place`. */
function availableTo(
  suspect: string,
  place: PlaceId,
  open: Span[],
  facts: SourcedFact[],
): { free: Span[]; blockers: Blocker[] } {
  let free = open;
  const blockers: Blocker[] = [];
  for (const f of facts) {
    const fact = f.fact;
    const blocks =
      (fact.type === "presence" && fact.person === suspect && fact.place !== place) ||
      (fact.type === "absent" && fact.person === suspect && fact.place === place);
    if (!blocks) continue;
    const cut = [{ from: fact.from, to: fact.to }];
    if (intersect(open, cut).length === 0) continue;
    free = subtract(free, cut);
    blockers.push({ evidence: f.evidence, fact });
  }
  return { free, blockers };
}

export function solve(candidates: Candidates, facts: SourcedFact[]): SolveResult {
  const theories = enumerateTheories(candidates);
  const methods = new Map(candidates.methods.map((m) => [m.id, m]));

  const opportunities: SolveResult["opportunities"] = {};
  for (const method of candidates.methods) {
    const acquire = stepOpportunity("acquire", method.poison, facts, candidates.window);
    const administer = stepOpportunity("administer", method.vehicle, facts, candidates.window);
    orderSteps(acquire, administer);
    opportunities[method.id] = { acquire, administer };
  }

  const poisonFacts = facts.filter((f) => f.fact.type === "poison");
  const vehicleFacts = facts.filter((f) => f.fact.type === "vehicle");
  const refuted = new Map<string, string[]>();
  for (const f of facts) {
    if (f.fact.type === "motive" && !f.fact.holds) {
      refuted.set(f.fact.motive, [...(refuted.get(f.fact.motive) ?? []), f.evidence]);
    }
  }

  const eliminate = (theory: Theory): Elimination | null => {
    const method = methods.get(theory.method);
    if (!method) return null;

    for (const f of poisonFacts) {
      if (f.fact.type === "poison" && f.fact.item !== method.poison) {
        return { theory, rule: "poison", evidence: [f.evidence], detail: { rule: "poison", item: f.fact.item } };
      }
    }
    for (const f of vehicleFacts) {
      if (f.fact.type === "vehicle" && f.fact.item !== method.vehicle) {
        return { theory, rule: "vehicle", evidence: [f.evidence], detail: { rule: "vehicle", item: f.fact.item } };
      }
    }
    const against = refuted.get(theory.motive);
    if (against) {
      return { theory, rule: "motive", evidence: unique(against), detail: { rule: "motive" } };
    }

    const { acquire, administer } = opportunities[theory.method];
    const free: Record<Step, Span[]> = { acquire: acquire.open, administer: administer.open };
    for (const opportunity of [acquire, administer]) {
      if (!opportunity.known || opportunity.place === null) continue;
      const { free: left, blockers } = availableTo(theory.culprit, opportunity.place, opportunity.open, facts);
      free[opportunity.step] = left;
      if (left.length === 0) {
        return {
          theory,
          rule: opportunity.step,
          evidence: unique([...opportunity.evidence, ...blockers.map((b) => b.evidence)]),
          detail: { rule: opportunity.step, place: opportunity.place, open: opportunity.open, blockers },
        };
      }
    }
    const firstTake = earliest(free.acquire);
    const lastUse = latest(free.administer);
    if (firstTake === null || lastUse === null || firstTake >= lastUse) {
      return {
        theory,
        rule: "sequence",
        evidence: unique([...acquire.evidence, ...administer.evidence]),
        detail: { rule: "sequence", acquire: free.acquire, administer: free.administer },
      };
    }
    return null;
  };

  const survivors: Theory[] = [];
  const eliminated: Elimination[] = [];
  for (const theory of theories) {
    const out = eliminate(theory);
    if (out) eliminated.push(out);
    else survivors.push(theory);
  }
  return { total: theories.length, survivors, eliminated, opportunities };
}

/** Every fact of the given evidence, tagged with where it came from. */
export function sourcedFacts(evidence: { id: string; facts: Fact[] }[]): SourcedFact[] {
  return evidence.flatMap((e) => e.facts.map((fact) => ({ evidence: e.id, fact })));
}
