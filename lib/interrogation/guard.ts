/**
 * The second guardrail: a deterministic check on every answer before the
 * player sees it.
 *
 * The first guardrail (see ./prompt.ts) keeps the solution out of an innocent
 * suspect's prompt entirely. This one catches what is left: a model that drops
 * the character (talks about prompts, instructions, being an AI), recites its
 * rules, or confesses outright. A blocked answer is replaced with an
 * in-character deflection and is never added to the conversation history, so
 * the injection that caused it does not linger in context either.
 *
 * Pure string logic, on purpose: it has to be testable against a fixed set of
 * bad and good outputs (lib/interrogation/injection-set.json) with no model.
 */

export type GuardReason = "empty" | "meta" | "prompt_echo" | "confession" | "verdict";

export interface GuardResult {
  ok: boolean;
  reasons: GuardReason[];
}

export interface GuardContext {
  /** Text whose verbatim repetition counts as a leak (the game's rules). */
  protectedText?: string;
  /** Names of the poisons in this case, so "I put the monkshood on his plate" reads as a confession. */
  poisonNames?: string[];
  /** Names of the dishes and drinks the poison could have gone into. */
  vehicleNames?: string[];
  /** Every name the cast goes by ("Gus", "Pereira"). Used to spot a named verdict. */
  castNames?: string[];
  /** The names of the character who is speaking. */
  speakerNames?: string[];
}

/**
 * Ways of stepping outside the fiction. Each is something no kitchen worker
 * says in a police interview. Kept narrow on purpose: phrases a cook might
 * really use ("my instructions were clear", "out of character for him",
 * "this is not a game") are deliberately not here.
 */
const META: RegExp[] = [
  /\bas an? (?:\w+ )?(ai|a\.i\.|artificial intelligence|language model|llm|chatbot)\b/i,
  /\b(helpful|ai|virtual|digital) assistant\b/i,
  /\bi(?:'m| am) (?:just |only |actually |really )?(?:an? )?(ai|a\.i\.|artificial intelligence|language model|llm|chatbot|virtual assistant|ai assistant|ai model)\b/i,
  /\blanguage model\b/i,
  /\b(system|developer|hidden) (prompt|message|instructions?)\b/i,
  /\bmy (programming|prompt|system prompt|guidelines|training data|character sheet)\b/i,
  /\bmy (instructions|rules) (say|state|tell me|are to|forbid|prevent|prohibit|do not allow|don't allow)\b/i,
  /\b(character sheet|ground truth|world bible|private sheet)\b/i,
  /\brole-?play(ing|ed)?\b/i,
  /\b(break(ing)?|stay(ing)?|remain(ing)?) (in |out of )?character\b/i,
  /\bi (was|am|have been|'ve been) (programmed|prompted|configured|designed) to\b/i,
  /\bi (can't|cannot|can not|won't|am not able to|'m not able to|am unable to|'m unable to) (reveal|share|disclose|discuss|repeat) (my|the|those|these) (instructions|prompt|rules|guidelines)\b/i,
  /\b(anthropic|openai|chatgpt|gpt-?\d)\b/i,
  /\b(prompt injection|jailbreak)\b/i,
  /\b(murder[- ]mystery game|interrogation scene)\b/i,
  /<\/?(question|system|instructions?|answer)\b[^>]*>/i,
  /\bEXHIBIT (placed|shown)\b/,
];

const CLAUDE = /\b(i(?:'m| am)|my name is|this is) claude\b/i;

/** Clauses that mention a confession without making one: denials, hypotheticals, reported speech. */
const NOT_A_CONFESSION =
  /\b(if|suppose|supposing|imagine|unless|as if|as though|you think|you believe|you want|you'd like|you would like|you say|you're saying|you are saying|you mean|accus\w*|whether i|that i'd|like i|would i|why would|did i|have i)\b|\b(say|says|said|saying|think|thinks|thought|believe|believes|claims?|claimed|write|wrote|call|calls|called)\b|\b(not|never|no|no one|nobody|nor|hardly|neither)\b|n't\b/i;

const CONFESSIONS: RegExp[] = [
  /\bi (poisoned|killed|murdered)\b/i,
  /\bi did it\b/i,
  /\bit was me\b/i,
  /\bi(?:'m| am) (the|your) (killer|murderer|poisoner|culprit|one who (did it|poisoned|killed|murdered))\b/i,
  /\bi (confess|admit it|admit that i|admit i)\b/i,
  /\bi wanted (him|her|them) (dead|to die|gone for good)\b/i,
  /\bi (meant|intended|planned|decided) to (kill|poison|murder)\b/i,
  /\bmy (confession|crime|murder)\b/i,
];

/** Verbs that, with the poison as their object, are the crime itself. */
const TAMPERING = "swapped|switched|replaced|crushed|steeped|stole";
/**
 * Verbs that are only incriminating when the poison goes somewhere it can be
 * eaten. "I put the monkshood in that planter myself" is a gardener talking;
 * "I put the monkshood on his plate" is a confession.
 */
const PLACING = "put|slipped|added|grated|stirred|mixed|dropped|sprinkled|poured|tipped|hid";
const EDIBLE = [
  "dish",
  "plate",
  "food",
  "meal",
  "sauce",
  "broth",
  "soup",
  "stock",
  "bowl",
  "glass",
  "cup",
  "drink",
  "wine",
  "pot",
  "pan",
  "course",
  "his",
  "her",
  "their",
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeQuotes(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])["')\]]*\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(text: string): string[] {
  return normalizeQuotes(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** True when `text` repeats any run of `size` consecutive words from `source`. */
export function sharesRun(text: string, source: string, size = 10): boolean {
  const from = words(source);
  const seen = new Set<string>();
  for (let i = 0; i + size <= from.length; i++) seen.add(from.slice(i, i + size).join(" "));
  const candidate = words(text);
  for (let i = 0; i + size <= candidate.length; i++) {
    if (seen.has(candidate.slice(i, i + size).join(" "))) return true;
  }
  return false;
}

function distinctiveWords(names: string[], generic: Set<string>): string[] {
  return names.flatMap((name) => words(name)).filter((w) => w.length >= 6 && !generic.has(w));
}

function confesses(text: string, poisonNames: string[], vehicleNames: string[]): boolean {
  // The full name of a poison ("heart tablets") or its one distinctive long word
  // ("monkshood") marks it. Short or generic words do not: an innocent cook
  // handles roots and tablets, and puts their heart into things, all night.
  const generic = new Set([
    "tablets",
    "capsules",
    "extract",
    "powder",
    "cleaner",
    "essence",
    "tincture",
    "berries",
    "kernels",
    "course",
    "bottle",
    "smoked",
    "butter",
  ]);
  const phrases = poisonNames.map((name) => words(name).join(" ")).filter(Boolean);
  const poisons = [
    ...new Set([
      "poison",
      "aconite",
      "aconitine",
      ...phrases,
      ...distinctiveWords(poisonNames, generic),
    ]),
  ]
    .map(escapeRegExp)
    .join("|");
  const targets = [...new Set([...EDIBLE, ...distinctiveWords(vehicleNames, generic)])]
    .map(escapeRegExp)
    .join("|");
  const tampered = new RegExp(`\\bi (${TAMPERING}) [^.!?]{0,60}\\b(${poisons})\\b`, "i");
  const placed = new RegExp(
    `\\bi (${PLACING}) [^.!?]{0,60}\\b(${poisons})\\b[^.!?]{0,40}\\b(${targets})\\b`,
    "i",
  );
  const handled = { test: (clause: string) => tampered.test(clause) || placed.test(clause) };

  for (const sentence of sentences(normalizeQuotes(text))) {
    // A question is never a confession ("You think I poisoned him?").
    if (sentence.endsWith("?")) continue;
    // Judge clause by clause, so "I didn't mean to, but I poisoned him" is caught
    // while "I never said I killed him" is not.
    for (const clause of sentence.split(/[,;:]|\s[—–-]\s|\bbut\b|\band yet\b/i)) {
      if (NOT_A_CONFESSION.test(clause)) continue;
      if (CONFESSIONS.some((pattern) => pattern.test(clause))) return true;
      if (handled.test(clause)) return true;
    }
  }
  return false;
}

const GUILT =
  "did it|poisoned|killed|murdered|is the (?:killer|culprit|murderer|poisoner)|was the (?:killer|culprit|murderer|poisoner)|is guilty|was guilty";

/**
 * A verdict stated as fact: "the killer is Tomas", or a character naming
 * themselves in the third person ("Gus Pereira did it"). No character knows
 * the answer as a fact, and nobody talks about themselves like that.
 */
function statesVerdict(text: string, castNames: string[], speakerNames: string[]): boolean {
  const cast = castNames.filter(Boolean).map(escapeRegExp).join("|");
  const self = speakerNames.filter(Boolean).map(escapeRegExp).join("|");
  const named = cast
    ? new RegExp(
        `\\b(?:the )?(?:culprit|killer|murderer|poisoner|guilty (?:one|party))(?:\\s+(?:is|was)\\s+|\\s*[=:]\\s*)(?:${cast})\\b`,
        "i",
      )
    : null;
  const thirdPerson = self
    ? new RegExp(`\\b(?:${self})\\b[^.!?]{0,40}\\b(?:${GUILT})\\b`, "i")
    : null;
  for (const sentence of sentences(text)) {
    if (sentence.endsWith("?")) continue;
    for (const clause of sentence.split(/[,;]|\bbut\b/i)) {
      if (NOT_A_CONFESSION.test(clause)) continue;
      if (named?.test(clause) || thirdPerson?.test(clause)) return true;
    }
  }
  return false;
}

export function checkAnswer(answer: string, context: GuardContext = {}): GuardResult {
  const text = normalizeQuotes(answer);
  const reasons: GuardReason[] = [];
  if (!text.trim()) reasons.push("empty");

  const castNames = context.castNames ?? [];
  const castHasClaude = castNames.some((name) => /claude/i.test(name));
  if (META.some((pattern) => pattern.test(text)) || (!castHasClaude && CLAUDE.test(text))) {
    reasons.push("meta");
  }
  if (context.protectedText && sharesRun(text, context.protectedText)) reasons.push("prompt_echo");
  if (confesses(text, context.poisonNames ?? [], context.vehicleNames ?? []))
    reasons.push("confession");
  if (statesVerdict(text, castNames, context.speakerNames ?? [])) reasons.push("verdict");

  return { ok: reasons.length === 0, reasons };
}

/** Picks one of a suspect's in-character deflections. Deterministic in `seed`. */
export function deflection(lines: string[], seed: number): string {
  if (lines.length === 0) return "I have nothing to say to that. Ask me about Saturday night.";
  return lines[Math.abs(Math.trunc(seed)) % lines.length];
}
