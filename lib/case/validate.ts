/**
 * The case validator. A case is only playable if all six checks pass:
 *
 *   structure     ids are unique and every reference resolves
 *   timeline      nobody is in two places at once; the crime fits the timeline
 *   evidence      every fact an exhibit "proves" is true under the ground truth
 *   alibis        every alibi matches the truth or is tied to a declared lie,
 *                 and every declared lie really is false
 *   solution      the solver, using evidence alone, leaves exactly one theory,
 *                 and it is the stored one
 *   reachability  every exhibit, lead, and motive can be reached from the start
 *
 * The same function gates the handcrafted case (in tests) and every generated
 * case (at runtime). Its error messages are written to be sent straight back to
 * the model as repair instructions.
 */
import { claimVerdict, wasAtThroughout, wasEverAt } from "./claims";
import { eliminationText } from "./explain";
import { namesOf } from "./public";
import { reachability } from "./reach";
import { solve, sourcedFacts, type SolveResult } from "./solver";
import { formatClock, formatSpan } from "./time";
import {
  PLACE_AT,
  VICTIM_ID,
  isPlace,
  sameTheory,
  type CaseFile,
  type Fact,
  type Theory,
} from "./types";

export const SUSPECT_COUNT = 5;

export type CheckId = "structure" | "timeline" | "evidence" | "alibis" | "solution" | "reachability";

export interface Issue {
  check: CheckId;
  message: string;
}

export interface CheckResult {
  id: CheckId;
  label: string;
  ok: boolean;
  /** One line saying what was established, or how many problems were found. */
  detail: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: Issue[];
  checks: CheckResult[];
  stats: {
    suspects: number;
    theories: number;
    survivors: number;
    evidence: number;
    reachableEvidence: number;
    lies: number;
  };
}

const CHECK_LABELS: Record<CheckId, string> = {
  structure: "Well-formed case file",
  timeline: "Consistent timeline",
  evidence: "Evidence agrees with the truth",
  alibis: "Alibis are true or declared lies",
  solution: "Exactly one solution",
  reachability: "Every clue reachable",
};

const ID = /^[a-z][a-z0-9_]*$/;
const QUESTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function theoryLabel(kase: CaseFile, theory: Theory): string {
  const who = kase.suspects.find((s) => s.id === theory.culprit)?.short ?? theory.culprit;
  return `${who} / ${theory.method} / ${theory.motive}`;
}

export function solveCase(kase: CaseFile): SolveResult {
  return solve(
    {
      suspects: kase.suspects.map((s) => s.id),
      methods: kase.methods,
      motives: kase.motives,
      window: kase.window,
    },
    sourcedFacts(kase.evidence),
  );
}

function checkStructure(kase: CaseFile): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };

  const suspects = new Set(kase.suspects.map((s) => s.id));
  const people = new Set([...suspects, VICTIM_ID]);
  const items = new Map(kase.items.map((i) => [i.id, i]));
  const events = new Set(kase.events.map((e) => e.id));
  const evidence = new Set(kase.evidence.map((e) => e.id));
  const leads = new Set(kase.leads.map((l) => l.id));
  const methods = new Set(kase.methods.map((m) => m.id));
  const motives = new Map(kase.motives.map((m) => [m.id, m]));

  const groups: [string, string[]][] = [
    ["suspect", kase.suspects.map((s) => s.id)],
    ["item", kase.items.map((i) => i.id)],
    ["event", kase.events.map((e) => e.id)],
    ["evidence or lead", [...kase.evidence.map((e) => e.id), ...kase.leads.map((l) => l.id)]],
    ["method", kase.methods.map((m) => m.id)],
    ["motive", kase.motives.map((m) => m.id)],
    ["lie", kase.suspects.flatMap((s) => s.lies.map((l) => l.id))],
  ];
  for (const [kind, ids] of groups) {
    const seen = new Set<string>();
    for (const id of ids) {
      need(ID.test(id), `${kind} id "${id}" must be lowercase letters, digits, and underscores`);
      need(!seen.has(id), `duplicate ${kind} id "${id}"`);
      seen.add(id);
    }
  }
  need(!suspects.has(VICTIM_ID), `"${VICTIM_ID}" is reserved for the victim and cannot be a suspect id`);
  need(kase.suspects.length === SUSPECT_COUNT, `a case needs exactly ${SUSPECT_COUNT} suspects, found ${kase.suspects.length}`);
  need(kase.methods.length >= 2, "a case needs at least 2 candidate methods");
  need(kase.window.from < kase.window.to, "the evening window is empty");
  need(kase.briefing.length > 0, "the briefing is empty");

  const inWindow = (from: number, to: number) =>
    Number.isInteger(from) && Number.isInteger(to) && from < to && from >= kase.window.from && to <= kase.window.to;
  const span = (from: number, to: number, what: string) =>
    need(
      inWindow(from, to),
      `${what} spans ${formatClock(from)}–${formatClock(to)}, which is empty or outside the evening (${formatSpan(kase.window)})`,
    );
  const person = (id: string, what: string) => need(people.has(id), `${what} refers to unknown person "${id}"`);
  const place = (id: string, what: string) => need(isPlace(id), `${what} refers to unknown place "${id}"`);
  const item = (id: string, what: string) => need(items.has(id), `${what} refers to unknown item "${id}"`);
  const exhibit = (id: string, what: string) => need(evidence.has(id), `${what} refers to unknown evidence "${id}"`);

  for (const s of kase.suspects) {
    need(Boolean(s.name && s.short && s.role && s.blurb && s.voice && s.opening), `suspect ${s.id} is missing a name, role, blurb, voice, or opening line`);
    need(s.deflections.length > 0, `suspect ${s.id} needs at least one in-character deflection line`);
    need(kase.motives.some((m) => m.suspect === s.id), `suspect ${s.id} has no candidate motive, so they could never be accused`);
    for (const a of s.alibi) {
      place(a.place, `${s.id}'s alibi`);
      span(a.from, a.to, `${s.id}'s alibi`);
      if (a.lie !== null) need(s.lies.some((l) => l.id === a.lie), `${s.id}'s alibi names lie "${a.lie}", which ${s.id} does not have`);
    }
    for (const sight of s.sightings) {
      person(sight.subject, `${s.id}'s sighting`);
      need(sight.subject !== s.id, `${s.id} cannot sight themselves`);
      place(sight.place, `${s.id}'s sighting`);
      span(sight.from, sight.to, `${s.id}'s sighting`);
    }
    for (const lie of s.lies) {
      for (const e of lie.breaksWith) exhibit(e, `lie ${lie.id}`);
      for (const a of lie.asserts) {
        person(a.subject, `lie ${lie.id}`);
        if (a.place !== null) place(a.place, `lie ${lie.id}`);
        if (a.kind === "timing") need(a.object !== null && events.has(a.object), `lie ${lie.id} times unknown event "${a.object}"`);
        if (a.kind === "possession") need(a.object !== null && items.has(a.object), `lie ${lie.id} refers to unknown item "${a.object}"`);
        if (a.kind === "relationship") need(a.object !== null && people.has(a.object), `lie ${lie.id} refers to unknown person "${a.object}"`);
      }
    }
  }

  for (const m of kase.truth.movements) {
    person(m.person, "a movement");
    place(m.place, `${m.person}'s movement`);
    span(m.from, m.to, `${m.person}'s movement`);
  }
  for (const r of kase.truth.relationships) {
    person(r.a, "a relationship");
    person(r.b, "a relationship");
  }
  for (const p of kase.truth.possessions) {
    person(p.person, "a possession");
    item(p.item, "a possession");
    span(p.from, p.to, `${p.person}'s possession of ${p.item}`);
  }

  for (const m of kase.methods) {
    need(items.get(m.poison)?.kind === "poison", `method ${m.id}: "${m.poison}" is not a poison item`);
    need(items.get(m.vehicle)?.kind === "vehicle", `method ${m.id}: "${m.vehicle}" is not a vehicle item`);
  }
  for (const m of kase.motives) {
    need(suspects.has(m.suspect), `motive ${m.id} belongs to unknown suspect "${m.suspect}"`);
    for (const id of m.revealedBy) {
      need(evidence.has(id) || leads.has(id), `motive ${m.id} is revealed by unknown evidence or lead "${id}"`);
    }
  }

  for (const e of kase.evidence) {
    need(Boolean(e.title && e.summary && e.detail), `evidence ${e.id} is missing a title, summary, or detail`);
    if (e.foundAt !== null) place(e.foundAt, `evidence ${e.id}`);
    if (e.unlock.type === "lead") {
      need(e.unlock.any.length > 0, `evidence ${e.id} unlocks from an empty list of leads`);
      for (const l of e.unlock.any) need(leads.has(l), `evidence ${e.id} unlocks from unknown lead "${l}"`);
    }
    if (e.unlock.type === "evidence") {
      need(e.unlock.all.length > 0, `evidence ${e.id} unlocks from an empty list of evidence`);
      for (const id of e.unlock.all) {
        exhibit(id, `evidence ${e.id}'s unlock`);
        need(id !== e.id, `evidence ${e.id} unlocks from itself`);
      }
    }
    for (const fact of e.facts) checkFactRefs(e.id, fact);
    const used =
      e.facts.length > 0 ||
      kase.leads.some((l) => l.requires.includes(e.id)) ||
      kase.evidence.some((o) => o.unlock.type === "evidence" && o.unlock.all.includes(e.id)) ||
      kase.suspects.some((s) => s.lies.some((l) => l.breaksWith.includes(e.id))) ||
      kase.motives.some((m) => m.revealedBy.includes(e.id));
    need(used, `evidence ${e.id} proves nothing and leads nowhere; give it a fact or remove it`);
  }

  function checkFactRefs(id: string, fact: Fact): void {
    const what = `evidence ${id}`;
    switch (fact.type) {
      case "presence":
      case "absent":
        person(fact.person, what);
        place(fact.place, what);
        span(fact.from, fact.to, what);
        break;
      case "empty":
        place(fact.place, what);
        span(fact.from, fact.to, what);
        break;
      case "poison":
        need(items.get(fact.item)?.kind === "poison", `${what}: "${fact.item}" is not a poison item`);
        break;
      case "vehicle":
        need(items.get(fact.item)?.kind === "vehicle", `${what}: "${fact.item}" is not a vehicle item`);
        break;
      case "window":
        item(fact.item, what);
        place(fact.place, what);
        span(fact.from, fact.to, what);
        break;
      case "motive":
        need(motives.has(fact.motive), `${what} refers to unknown motive "${fact.motive}"`);
        break;
      case "possession":
        person(fact.person, what);
        item(fact.item, what);
        span(fact.from, fact.to, what);
        break;
      case "relationship":
        person(fact.a, what);
        person(fact.b, what);
        break;
      case "timing":
        need(events.has(fact.event), `${what} times unknown event "${fact.event}"`);
        break;
    }
  }

  for (const l of kase.leads) {
    need(suspects.has(l.suspect), `lead ${l.id} belongs to unknown suspect "${l.suspect}"`);
    need(Boolean(l.reveal), `lead ${l.id} has no reveal text`);
    for (const e of l.requires) exhibit(e, `lead ${l.id}`);
    const used =
      kase.evidence.some((e) => e.unlock.type === "lead" && e.unlock.any.includes(l.id)) ||
      kase.motives.some((m) => m.revealedBy.includes(l.id));
    need(used, `lead ${l.id} unlocks nothing; attach it to evidence or a motive, or remove it`);
  }

  const sol = kase.solution;
  need(suspects.has(sol.culprit), `the solution's culprit "${sol.culprit}" is not a suspect`);
  need(methods.has(sol.method), `the solution's method "${sol.method}" is not a candidate method`);
  need(motives.get(sol.motive)?.suspect === sol.culprit, `the solution's motive "${sol.motive}" must be one of the culprit's candidate motives`);
  place(sol.acquire.place, "the solution's acquire step");
  place(sol.administer.place, "the solution's administer step");
  need(sol.narrative.length > 0 && Boolean(sol.confession), "the solution needs a narrative and a confession");

  const questionIds = new Set<string>();
  for (const q of kase.questions) {
    need(QUESTION_ID.test(q.id), `question id "${q.id}" must be lowercase letters, digits, and hyphens`);
    need(!questionIds.has(q.id), `duplicate question id "${q.id}"`);
    questionIds.add(q.id);
    need(suspects.has(q.suspect), `question ${q.id} is for unknown suspect "${q.suspect}"`);
    for (const e of q.presents) exhibit(e, `question ${q.id}`);
  }
  return errors;
}

function checkTimeline(kase: CaseFile): string[] {
  const errors: string[] = [];
  for (const s of kase.suspects) {
    const moves = kase.truth.movements.filter((m) => m.person === s.id).sort((a, b) => a.from - b.from);
    if (moves.length === 0) {
      errors.push(`${s.short} has no movements; the truth must say where every suspect was all evening`);
      continue;
    }
    if (moves[0].from !== kase.window.from) {
      errors.push(`${s.short}'s movements start at ${formatClock(moves[0].from)}, not at the start of the evening (${formatClock(kase.window.from)})`);
    }
    for (let i = 1; i < moves.length; i++) {
      const prev = moves[i - 1];
      const next = moves[i];
      if (next.from < prev.to) {
        errors.push(`${s.short} is in two places at once: ${PLACE_AT[prev.place]} until ${formatClock(prev.to)} but ${PLACE_AT[next.place]} from ${formatClock(next.from)}`);
      } else if (next.from > prev.to) {
        errors.push(`${s.short} is unaccounted for between ${formatClock(prev.to)} and ${formatClock(next.from)}`);
      }
    }
    const last = moves[moves.length - 1];
    if (last.to !== kase.window.to) {
      errors.push(`${s.short}'s movements end at ${formatClock(last.to)}, not at the end of the evening (${formatClock(kase.window.to)})`);
    }
  }

  const sol = kase.solution;
  const who = kase.suspects.find((s) => s.id === sol.culprit)?.short ?? sol.culprit;
  const minute = (at: number) => ({ from: at, to: at + 1 });
  if (!wasAtThroughout(kase, sol.culprit, sol.acquire.place, minute(sol.acquire.at))) {
    errors.push(`the solution has ${who} taking the poison ${PLACE_AT[sol.acquire.place]} at ${formatClock(sol.acquire.at)}, but the movements put them somewhere else then`);
  }
  if (!wasAtThroughout(kase, sol.culprit, sol.administer.place, minute(sol.administer.at))) {
    errors.push(`the solution has ${who} dosing the dish ${PLACE_AT[sol.administer.place]} at ${formatClock(sol.administer.at)}, but the movements put them somewhere else then`);
  }
  if (sol.acquire.at >= sol.administer.at) {
    errors.push("the solution uses the poison before it was taken");
  }
  return errors;
}

function checkEvidence(kase: CaseFile): string[] {
  const errors: string[] = [];
  const sol = kase.solution;
  const method = kase.methods.find((m) => m.id === sol.method);
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const everyone = [...kase.suspects.map((s) => s.id), VICTIM_ID];

  for (const e of kase.evidence) {
    const wrong = (message: string) => errors.push(`evidence ${e.id} is false: ${message}`);
    for (const fact of e.facts) {
      switch (fact.type) {
        case "presence":
          if (!wasAtThroughout(kase, fact.person, fact.place, fact)) {
            wrong(`${fact.person} was not ${PLACE_AT[fact.place]} for all of ${formatSpan(fact)}`);
          }
          break;
        case "absent":
          if (wasEverAt(kase, fact.person, fact.place, fact)) {
            wrong(`${fact.person} was ${PLACE_AT[fact.place]} during ${formatSpan(fact)}`);
          }
          break;
        case "empty": {
          const there = everyone.filter((p) => wasEverAt(kase, p, fact.place, fact));
          if (there.length) wrong(`${there.join(", ")} was ${PLACE_AT[fact.place]} during ${formatSpan(fact)}`);
          break;
        }
        case "poison":
          if (method && fact.item !== method.poison) wrong(`the true poison is ${method.poison}, not ${fact.item}`);
          break;
        case "vehicle":
          if (method && fact.item !== method.vehicle) wrong(`the true vehicle is ${method.vehicle}, not ${fact.item}`);
          break;
        case "window": {
          const step = fact.step === "acquire" ? sol.acquire : sol.administer;
          const relevant = method && fact.item === (fact.step === "acquire" ? method.poison : method.vehicle);
          if (!relevant) break;
          if (fact.place !== step.place || step.at < fact.from || step.at >= fact.to) {
            wrong(`its ${fact.step} window (${PLACE_AT[fact.place]}, ${formatSpan(fact)}) excludes what really happened (${PLACE_AT[step.place]} at ${formatClock(step.at)})`);
          }
          break;
        }
        case "motive":
          if (fact.motive === sol.motive && !fact.holds) wrong("it refutes the true motive");
          break;
        case "possession": {
          const held = kase.truth.possessions.some(
            (p) => p.person === fact.person && p.item === fact.item && p.from < fact.to && fact.from < p.to,
          );
          if (held !== fact.holds) wrong(`${fact.person} ${held ? "did have" : "did not have"} ${fact.item} during ${formatSpan(fact)}`);
          break;
        }
        case "relationship": {
          const known = kase.truth.relationships.some((r) => pairKey(r.a, r.b) === pairKey(fact.a, fact.b));
          if (known !== fact.holds) wrong(`${fact.a} and ${fact.b} ${known ? "do" : "do not"} know each other`);
          break;
        }
        case "timing": {
          const event = kase.events.find((ev) => ev.id === fact.event);
          if (event && event.at !== fact.at) wrong(`${fact.event} happened at ${formatClock(event.at)}, not ${formatClock(fact.at)}`);
          break;
        }
      }
    }
  }
  return errors;
}

function checkAlibis(kase: CaseFile): string[] {
  const errors: string[] = [];
  for (const s of kase.suspects) {
    for (const a of s.alibi) {
      const holds = wasAtThroughout(kase, s.id, a.place, a);
      const where = `${PLACE_AT[a.place]} ${formatSpan(a)}`;
      if (a.lie === null && !holds) {
        errors.push(`${s.short}'s alibi (${where}) does not match the truth and is not marked as a lie`);
      }
      if (a.lie !== null && holds) {
        errors.push(`${s.short}'s alibi (${where}) is marked as lie "${a.lie}" but is actually true`);
      }
    }
    for (const sight of s.sightings) {
      if (!wasAtThroughout(kase, sight.subject, sight.place, sight)) {
        errors.push(`${s.short} cannot have seen ${sight.subject} ${PLACE_AT[sight.place]} ${formatSpan(sight)}: they were not there the whole time`);
      }
    }
    for (const lie of s.lies) {
      if (lie.asserts.length === 0) {
        errors.push(`lie ${lie.id} asserts nothing checkable`);
      }
      for (const assertion of lie.asserts) {
        const verdict = claimVerdict(kase, assertion);
        if (verdict !== "false") {
          errors.push(`lie ${lie.id} is not a lie: its ${assertion.kind} assertion is ${verdict} under the truth`);
        }
      }
    }
  }
  return errors;
}

function checkSolution(kase: CaseFile, result: SolveResult): string[] {
  const errors: string[] = [];
  const names = namesOf(kase);
  const truth: Theory = {
    culprit: kase.solution.culprit,
    method: kase.solution.method,
    motive: kase.solution.motive,
  };
  const truthSurvives = result.survivors.some((t) => sameTheory(t, truth));

  if (!truthSurvives) {
    const why = result.eliminated.find((e) => sameTheory(e.theory, truth));
    errors.push(
      `the evidence rules out the real solution (${theoryLabel(kase, truth)})${
        why ? `: ${eliminationText(names, why, kase.methods)} [${why.evidence.join(", ")}]` : ""
      }`,
    );
  }
  const extra = result.survivors.filter((t) => !sameTheory(t, truth));
  if (extra.length > 0) {
    const shown = extra.slice(0, 6).map((t) => theoryLabel(kase, t)).join("; ");
    errors.push(
      `${result.survivors.length} theories survive all the evidence; exactly 1 must. Also still possible: ${shown}${
        extra.length > 6 ? `; and ${extra.length - 6} more` : ""
      }. Add evidence that places each innocent suspect elsewhere during an opportunity window, refutes a spare motive, or identifies the poison and the dish`,
    );
  }
  const supported = kase.evidence.some((e) =>
    e.facts.some((f) => f.type === "motive" && f.motive === truth.motive && f.holds),
  );
  if (!supported) {
    errors.push(`no evidence supports the true motive "${truth.motive}"; a fair mystery lets the player prove why`);
  }
  return errors;
}

function checkReachability(kase: CaseFile): { errors: string[]; reachable: number } {
  const errors: string[] = [];
  const reach = reachability(kase);
  for (const s of reach.stuck) {
    errors.push(`evidence ${s.id} can never be found${s.waitingOn.length ? `: it waits on ${s.waitingOn.join(", ")}` : ""}`);
  }
  for (const l of reach.deadLeads) {
    errors.push(`lead ${l.id} can never be given: it requires ${l.waitingOn.join(", ")}, which cannot be found first`);
  }
  const have = new Set([...reach.evidence, ...reach.leads]);
  for (const m of kase.motives) {
    if (m.revealedBy.length > 0 && !m.revealedBy.some((id) => have.has(id))) {
      errors.push(`motive ${m.id} can never be uncovered`);
    }
  }
  return { errors, reachable: reach.evidence.length };
}

export function validateCase(kase: CaseFile): ValidationReport {
  const errors: Issue[] = [];
  const checks: CheckResult[] = [];
  const lies = kase.suspects.reduce((n, s) => n + s.lies.length, 0);
  const stats = {
    suspects: kase.suspects.length,
    theories: 0,
    survivors: 0,
    evidence: kase.evidence.length,
    reachableEvidence: 0,
    lies,
  };

  const record = (id: CheckId, found: string[], passed: string) => {
    for (const message of found) errors.push({ check: id, message });
    checks.push({
      id,
      label: CHECK_LABELS[id],
      ok: found.length === 0,
      detail: found.length === 0 ? passed : `${found.length} problem${found.length === 1 ? "" : "s"}`,
    });
  };

  const structure = checkStructure(kase);
  record("structure", structure, `${kase.suspects.length} suspects, ${kase.evidence.length} exhibits, ${kase.leads.length} leads`);
  if (structure.length > 0) {
    // The remaining checks assume every reference resolves.
    for (const id of ["timeline", "evidence", "alibis", "solution", "reachability"] as const) {
      checks.push({ id, label: CHECK_LABELS[id], ok: false, detail: "not run: fix the case file first" });
    }
    return { ok: false, errors, checks, stats };
  }

  record("timeline", checkTimeline(kase), "nobody is in two places at once");
  record("evidence", checkEvidence(kase), `${kase.evidence.reduce((n, e) => n + e.facts.length, 0)} facts hold`);
  record("alibis", checkAlibis(kase), `${lies} declared lies, all false; every other alibi is true`);

  const result = solveCase(kase);
  stats.theories = result.total;
  stats.survivors = result.survivors.length;
  record("solution", checkSolution(kase, result), `1 of ${result.total} theories survives the evidence`);

  const reach = checkReachability(kase);
  stats.reachableEvidence = reach.reachable;
  record("reachability", reach.errors, `${reach.reachable} of ${kase.evidence.length} exhibits reachable`);

  return { ok: errors.length === 0, errors, checks, stats };
}
