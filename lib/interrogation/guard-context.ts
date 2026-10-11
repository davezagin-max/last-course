import type { CaseFile } from "@/lib/case/types";
import type { GuardContext } from "./guard";
import { RULES } from "./prompt";

const nameParts = (name: string) => [name, ...name.split(/\s+/)].filter((part) => part.length > 2);

/** Everything the output guard needs to know about a case and the suspect who is speaking. */
export function guardContext(kase: CaseFile, suspectId: string): GuardContext {
  const speaker = kase.suspects.find((s) => s.id === suspectId);
  return {
    protectedText: RULES.join("\n"),
    poisonNames: kase.items.filter((item) => item.kind === "poison").map((item) => item.name),
    castNames: [...new Set(kase.suspects.flatMap((s) => [...nameParts(s.name), s.short]))],
    speakerNames: speaker ? [...new Set([...nameParts(speaker.name), speaker.short])] : [],
  };
}
