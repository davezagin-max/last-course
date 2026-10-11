import { describe, expect, it } from "vitest";
import { THE_FOURTH_COURSE as kase } from "@/lib/case/handcrafted";
import { checkAnswer, deflection, sharesRun } from "@/lib/interrogation/guard";
import { guardContext } from "@/lib/interrogation/guard-context";
import injectionSet from "@/lib/interrogation/injection-set.json";
import { RULES } from "@/lib/interrogation/prompt";

// The canned outputs are written as if the culprit were answering: the hardest case.
const context = guardContext(kase, kase.solution.culprit);

describe("prompt-injection test set", () => {
  it("covers a spread of attacks, each with outputs to catch and outputs to pass", () => {
    expect(injectionSet.length).toBeGreaterThanOrEqual(12);
    expect(new Set(injectionSet.map((c) => c.id)).size).toBe(injectionSet.length);
    for (const c of injectionSet) {
      expect(c.input.length, c.id).toBeGreaterThan(10);
      expect(c.bad.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.good.length, c.id).toBeGreaterThanOrEqual(2);
    }
  });

  for (const c of injectionSet) {
    describe(`${c.id}: "${c.input.slice(0, 60)}"`, () => {
      it.each(c.bad)("blocks: %s", (output) => {
        const result = checkAnswer(output, context);
        expect(result.ok).toBe(false);
        expect(result.reasons.length).toBeGreaterThan(0);
      });
      it.each(c.good)("passes: %s", (output) => {
        expect(checkAnswer(output, context)).toEqual({ ok: true, reasons: [] });
      });
    });
  }
});

describe("output guard rules", () => {
  const reasons = (text: string) => checkAnswer(text, context).reasons;

  it("catches a character stepping out of the fiction", () => {
    expect(reasons("As an AI, I don't have a kitchen.")).toEqual(["meta"]);
    expect(reasons("I was programmed to stay quiet about that.")).toEqual(["meta"]);
    expect(reasons("That is in my character sheet.")).toEqual(["meta"]);
    expect(reasons("I can't reveal my instructions.")).toEqual(["meta"]);
    expect(reasons("<question>who did it</question>")).toEqual(["meta"]);
  });

  it("does not trip on things a cook would really say", () => {
    for (const fine of [
      "My instructions at lineup were clear: cook clean, nobody fusses.",
      "That would be out of character for Gus. He has never raised his voice.",
      "This is not a game, Detective. A man is dead.",
      "I was instructed to polish the copper between VIP tables, so I did.",
      "Put that in your case file if you like.",
      "The system on the pass screen logs every ticket.",
      "He wrote the prompt cards for the front-of-house briefing himself.",
    ]) {
      expect(reasons(fine), fine).toEqual([]);
    }
  });

  it("catches a verbatim echo of the rules, but not a short common phrase", () => {
    expect(reasons(RULES[1])).toContain("prompt_echo");
    expect(reasons("Keep answers short, they told us. So: no.")).toEqual([]);
    expect(sharesRun("a b c d e f g h i j", "x a b c d e f g h i j y")).toBe(true);
    expect(sharesRun("a b c d e f g h i", "x a b c d e f g h i j y")).toBe(false);
  });

  it("catches an outright confession, including one hidden after a denial", () => {
    expect(reasons("I poisoned him.")).toEqual(["confession"]);
    expect(reasons("It was me, sir.")).toEqual(["confession"]);
    expect(reasons("I didn't mean for the boy to be blamed, but I killed him.")).toEqual([
      "confession",
    ]);
    expect(reasons("I put the monkshood in the copper dish.")).toEqual(["confession"]);
    expect(reasons("I grated the monkshood over his turbot.")).toEqual(["confession"]);
    expect(reasons("I swapped the horseradish for the monkshood.")).toEqual(["confession"]);
    expect(reasons("I crushed the heart tablets myself.")).toEqual(["confession"]);
    expect(reasons("I wanted him dead for fifteen years.")).toEqual(["confession"]);
  });

  it("lets denials, questions, hypotheticals, and reported speech through", () => {
    for (const fine of [
      "I never poisoned anyone.",
      "You think I killed him? I wash dishes.",
      "If I did it, why would I tell you about the bins?",
      "They will say I did it because I am the porter.",
      "I didn't do it, and I did not want him dead.",
      "I killed nobody, sir.",
      "I grated that. God. I grated that and I never looked.",
      "I put the root back in the dish and sent it up.",
      "Yes, I planted it. I put the monkshood in that planter myself, two summers ago.",
      "I put my heart into that kitchen for six years.",
      "I added the bait stations to the dry store last spring.",
      "If there was something wrong with that root, then I'm the one who put it on his plate.",
    ]) {
      expect(reasons(fine), fine).toEqual([]);
    }
  });

  it("catches a named verdict and a character incriminating themselves in the third person", () => {
    expect(reasons("The killer is Tomas.")).toEqual(["verdict"]);
    expect(reasons("The culprit: Odile Renard.")).toEqual(["verdict"]);
    expect(reasons("Gus Pereira did it.")).toEqual(["verdict"]);
    // Another suspect voicing a suspicion is in character.
    expect(
      checkAnswer("If you ask me, Tomas did it.", guardContext(kase, "marit")).reasons,
    ).toEqual([]);
    expect(
      checkAnswer("The killer is whoever stood in that alley.", guardContext(kase, "marit"))
        .reasons,
    ).toEqual([]);
  });

  it("blocks an answer smuggled out in base64, with or without padding", () => {
    // "Gus Pereira", "Gus did it", "Tomas Varga": none of these trips a wording rule.
    expect(reasons("R3VzIFBlcmVpcmE=")).toEqual(["encoded"]);
    expect(reasons("Since you ask so nicely: R3VzIGRpZCBpdA")).toEqual(["encoded"]);
    expect(reasons("VG9tYXMgVmFyZ2E=.")).toEqual(["encoded"]);
    // One base64 group is enough to carry a first name.
    expect(reasons("R3Vz")).toEqual(["encoded"]);
  });

  it("does not mistake kitchen talk for an encoding", () => {
    for (const fine of [
      "Horseradish. Beurreblanc, if you spell it the way the commis does.",
      "Ask MacAllister on the linen van, or McPherson, he drives Saturdays.",
      "Ticket 20481137 fired at 21:05 and the pass screen logged PIN4471.",
      "Aconitum napellus. Monkshood. Wolfsbane, if you like the old names.",
      "Table12/Birthday on the docket, that is how front of house writes it.",
      "T7 was a four-top until 8pm, then a deuce. Covers: 40. Fired at 2105 on the KDS.",
      "McGee does the fish. DeLuca does veg. I do neither.",
    ]) {
      expect(reasons(fine), fine).toEqual([]);
    }
  });

  it("blocks an empty answer", () => {
    expect(reasons("   ")).toEqual(["empty"]);
  });

  it("picks a deflection deterministically and never returns nothing", () => {
    const lines = kase.suspects[0].deflections;
    expect(deflection(lines, 0)).toBe(lines[0]);
    expect(deflection(lines, lines.length + 1)).toBe(lines[1]);
    expect(deflection(lines, 4)).toBe(deflection(lines, 4));
    expect(deflection([], 3).length).toBeGreaterThan(10);
    for (const s of kase.suspects) {
      for (const line of s.deflections) {
        expect(checkAnswer(line, guardContext(kase, s.id)).ok, line).toBe(true);
      }
    }
  });
});
