import { describe, expect, it } from "vitest";
import { THE_FOURTH_COURSE } from "@/lib/case/handcrafted";
import { parseClock } from "@/lib/case/time";
import type { CaseFile } from "@/lib/case/types";
import { validateCase, type CheckId } from "@/lib/case/validate";

const t = (clock: string) => parseClock(clock)!;

/** Validates a copy of the handcrafted case with one thing broken. */
function broken(mutate: (kase: CaseFile) => void) {
  const kase = structuredClone(THE_FOURTH_COURSE);
  mutate(kase);
  const report = validateCase(kase);
  const messages = (check: CheckId) => report.errors.filter((e) => e.check === check).map((e) => e.message);
  return { report, messages };
}
const exhibit = (kase: CaseFile, id: string) => kase.evidence.find((e) => e.id === id)!;
const suspect = (kase: CaseFile, id: string) => kase.suspects.find((s) => s.id === id)!;

describe("validator: timeline", () => {
  it("rejects a suspect in two places at once", () => {
    const { report, messages } = broken((k) => {
      k.truth.movements.find((m) => m.person === "odile" && m.place === "office")!.from = t("20:35");
    });
    expect(report.ok).toBe(false);
    expect(messages("timeline")).toContain("Odile is in two places at once: at the pass until 20:41 but in the office from 20:35");
  });

  it("rejects a gap in a suspect's evening", () => {
    const { messages } = broken((k) => {
      k.truth.movements.find((m) => m.person === "priya" && m.place === "walk_in")!.from = t("21:22");
    });
    expect(messages("timeline")).toContain("Priya is unaccounted for between 21:20 and 21:22");
  });

  it("rejects a crime the culprit's own movements do not allow", () => {
    const { messages } = broken((k) => {
      k.solution.acquire.at = t("20:30");
    });
    expect(messages("timeline")[0]).toMatch(/Gus taking the poison in the alley at 20:30, but the movements put them somewhere else/);
  });
});

describe("validator: evidence must be true", () => {
  it("rejects an exhibit that 'proves' someone was where they were not", () => {
    const { messages } = broken((k) => {
      exhibit(k, "phone_log").facts = [{ type: "presence", person: "odile", place: "office", from: t("20:35"), to: t("20:53") }];
    });
    expect(messages("evidence")).toEqual(["evidence phone_log is false: odile was not in the office for all of 20:35–20:53"]);
  });

  it("rejects an 'empty room' fact when somebody was there", () => {
    const { messages } = broken((k) => {
      exhibit(k, "door_log").facts.push({ type: "empty", place: "alley", from: t("20:44"), to: t("20:49") });
    });
    expect(messages("evidence")).toEqual(["evidence door_log is false: gus was in the alley during 20:44–20:49"]);
  });

  it("rejects forensics, windows, and times that disagree with what happened", () => {
    expect(broken((k) => void (exhibit(k, "tox_report").facts = [{ type: "poison", item: "rodent_bait" }])).messages("evidence")[0]).toMatch(/true poison is monkshood_root/);
    expect(
      broken((k) => void (exhibit(k, "planter").facts = [{ type: "window", step: "acquire", item: "monkshood_root", place: "alley", from: t("20:50"), to: t("21:11") }])).messages("evidence")[0],
    ).toMatch(/acquire window .* excludes what really happened \(in the alley at 20:46\)/);
    expect(broken((k) => void exhibit(k, "ticket_t7").facts.push({ type: "timing", event: "collapse", at: t("21:30") })).messages("evidence")[0]).toMatch(/collapse happened at 21:34, not 21:30/);
    expect(broken((k) => void exhibit(k, "lineup_sheet").facts.push({ type: "motive", motive: "gus_revenge", holds: false })).messages("evidence")[0]).toMatch(/refutes the true motive/);
  });
});

describe("validator: alibis and lies", () => {
  it("rejects a false alibi that is not marked as a lie", () => {
    const { messages } = broken((k) => {
      suspect(k, "marit").alibi[0].lie = null;
    });
    expect(messages("alibis")).toContain("Marit's alibi (at the cold station 20:00–21:40) does not match the truth and is not marked as a lie");
  });

  it("rejects an alibi marked as a lie that is actually true", () => {
    const { messages } = broken((k) => {
      suspect(k, "priya").lies.push({ ...suspect(k, "priya").lies[0], id: "priya_fake" });
      suspect(k, "priya").alibi[0].lie = "priya_fake";
    });
    expect(messages("alibis")).toContain('Priya\'s alibi (at the pastry station 20:00–21:20) is marked as lie "priya_fake" but is actually true');
  });

  it("rejects a declared lie that turns out to be true, and a sighting that cannot have happened", () => {
    expect(
      broken((k) => {
        suspect(k, "gus").lies[2].asserts[0].from = t("20:51");
      }).messages("alibis"),
    ).toEqual(["lie gus_dish_time is not a lie: its timing assertion is true under the truth"]);
    expect(
      broken((k) => {
        suspect(k, "marit").sightings[0].place = "walk_in";
      }).messages("alibis")[0],
    ).toMatch(/Marit cannot have seen tomas in the walk-in/);
  });
});

describe("validator: exactly one solution", () => {
  it("rejects a case where an innocent suspect cannot be ruled out, and names them", () => {
    const { report, messages } = broken((k) => {
      exhibit(k, "keypad_log").facts = [];
    });
    expect(report.stats.survivors).toBe(2);
    expect(messages("solution")[0]).toMatch(/^2 theories survive all the evidence; exactly 1 must\. Also still possible: Marit \/ root_on_turbot \/ marit_fraud\./);
  });

  it("rejects a case with a spare motive for the culprit", () => {
    const { messages } = broken((k) => {
      exhibit(k, "lineup_sheet").facts = [{ type: "motive", motive: "odile_review", holds: false }];
    });
    expect(messages("solution")[0]).toMatch(/Gus \/ root_on_turbot \/ gus_loyalty/);
  });

  it("rejects a case whose evidence rules out the real solution, and says why", () => {
    const { messages } = broken((k) => {
      exhibit(k, "machine_log").facts = [{ type: "presence", person: "gus", place: "dish_pit", from: t("20:40"), to: t("20:50") }];
    });
    expect(messages("solution")[0]).toMatch(/^the evidence rules out the real solution \(Gus \/ root_on_turbot \/ gus_revenge\): Monkshood root could only have been taken in the alley, 20:44–20:49\. Gus was at the dish pit 20:40–20:50\./);
  });

  it("rejects a case with no evidence for the true motive", () => {
    const { messages } = broken((k) => {
      exhibit(k, "locker_clipping").facts = [{ type: "relationship", a: "gus", b: "victim", holds: true }];
    });
    expect(messages("solution")).toEqual(['no evidence supports the true motive "gus_revenge"; a fair mystery lets the player prove why']);
  });
});

describe("validator: reachability", () => {
  it("rejects a clue locked behind itself", () => {
    const { messages } = broken((k) => {
      k.leads.find((l) => l.id === "gus_machine")!.requires = ["bin_cage"];
    });
    expect(messages("reachability")).toEqual([
      "evidence machine_log can never be found: it waits on gus_machine",
      "evidence bin_cage can never be found: it waits on gus_bins",
      "lead gus_machine can never be given: it requires bin_cage, which cannot be found first",
      "lead gus_bins can never be given: it requires machine_log, which cannot be found first",
    ]);
  });

  it("rejects a motive that can never be uncovered", () => {
    const { messages } = broken((k) => {
      // The bin cage now waits on a lead that itself needs the bin cage,
      // and both leads that reveal the motive wait on the bin cage.
      k.leads.find((l) => l.id === "gus_bins")!.requires = ["machine_log", "bin_cage"];
      k.leads.find((l) => l.id === "tomas_brasa")!.requires = ["bin_cage"];
      k.leads.find((l) => l.id === "priya_brasa")!.requires = ["bin_cage"];
    });
    expect(messages("reachability")).toContain("motive tomas_takeover can never be uncovered");
  });
});

describe("validator: structure", () => {
  it("stops at broken references and does not run the other checks", () => {
    const { report, messages } = broken((k) => {
      exhibit(k, "phone_log").facts = [{ type: "presence", person: "nobody", place: "office", from: t("20:41"), to: t("20:53") }];
    });
    expect(messages("structure")).toEqual(['evidence phone_log refers to unknown person "nobody"']);
    expect(report.checks.filter((c) => c.id !== "structure").every((c) => !c.ok && c.detail.startsWith("not run"))).toBe(true);
  });

  it("requires five suspects, unique ids, a motive per suspect, and sane spans", () => {
    expect(broken((k) => void k.suspects.pop()).messages("structure")).toContain("a case needs exactly 5 suspects, found 4");
    expect(broken((k) => void (k.evidence[1].id = "tox_report")).messages("structure")).toContain('duplicate evidence or lead id "tox_report"');
    expect(broken((k) => void (k.motives = k.motives.filter((m) => m.suspect !== "marit"))).messages("structure")).toContain("suspect marit has no candidate motive, so they could never be accused");
    expect(broken((k) => void (k.truth.movements[0].to = t("23:00"))).messages("structure")[0]).toMatch(/spans 20:00–23:00, which is empty or outside the evening/);
    expect(broken((k) => void (k.solution.motive = "odile_debt")).messages("structure")).toContain('the solution\'s motive "odile_debt" must be one of the culprit\'s candidate motives');
  });

  it("rejects exhibits and leads that do nothing", () => {
    expect(
      broken((k) => {
        k.leads.find((l) => l.id === "gus_bins")!.requires = [];
        const lie = suspect(k, "gus").lies.find((l) => l.id === "gus_pit")!;
        lie.breaksWith = lie.breaksWith.filter((id) => id !== "machine_log");
      }).messages("structure"),
    ).toContain("evidence machine_log proves nothing and leads nowhere; give it a fact or remove it");
    expect(
      broken((k) => {
        k.leads.push({ id: "idle_talk", suspect: "gus", reveal: "Nothing much.", requires: [] });
      }).messages("structure"),
    ).toContain("lead idle_talk unlocks nothing; attach it to evidence or a motive, or remove it");
  });
});
