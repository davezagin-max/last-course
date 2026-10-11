/**
 * Rebuilds a suspect's conversation on the server, every turn, from a compact
 * transcript the browser holds.
 *
 * The browser sends, per earlier turn: the question, the ids of any evidence
 * presented with it, the assistant content blocks exactly as the model
 * returned them (thinking blocks included), and a seal. From those the server
 * deterministically produces the message list:
 *
 *   user       the question, wrapped as untrusted text
 *   system     (only when evidence was presented) a note built from the case
 *              file by evidence id
 *   assistant  the stored content, untouched
 *
 * The client never supplies system text, only ids. The same transcript always
 * yields a byte-identical message list, so the prompt cache hits on every turn
 * and thinking blocks from earlier turns remain valid.
 */
import type { CaseFile } from "@/lib/case/types";
import { untrusted, withSystemNote, type Msg } from "@/lib/claude";
import { sign, verify } from "@/lib/seal";
import { evidenceNote } from "./prompt";

export { MAX_EVIDENCE_PER_TURN, MAX_QUESTION_CHARS, MAX_TURNS } from "./limits";

/** One earlier exchange, as the browser stores it. */
export interface TurnRecord {
  question: string;
  evidenceIds: string[];
  /** The assistant's content blocks exactly as returned. Opaque to the client. */
  assistantContent: unknown[];
  seal: string;
}

export interface Ask {
  question: string;
  evidenceIds: string[];
}

export function questionMessage(question: string): Msg {
  return { role: "user", content: untrusted("question", question) };
}

/** Evidence this suspect has been shown in the given turns, in order, without repeats. */
export function shownEvidence(turns: Pick<TurnRecord, "evidenceIds">[]): string[] {
  return [...new Set(turns.flatMap((t) => t.evidenceIds))];
}

export function buildMessages(kase: CaseFile, suspectId: string, history: TurnRecord[], ask: Ask): Msg[] {
  let messages: Msg[] = [];
  const shown: string[] = [];
  const addUserTurn = (turn: Ask) => {
    messages.push(questionMessage(turn.question));
    if (turn.evidenceIds.length > 0) {
      messages = withSystemNote(messages, evidenceNote(kase, suspectId, turn.evidenceIds, shown));
      for (const id of turn.evidenceIds) if (!shown.includes(id)) shown.push(id);
    }
  };
  for (const turn of history) {
    addUserTurn(turn);
    messages.push({ role: "assistant", content: turn.assistantContent as Msg["content"] });
  }
  addUserTurn(ask);
  return messages;
}

interface SealInput {
  caseId: string;
  suspectId: string;
  index: number;
  previous: string | null;
  question: string;
  evidenceIds: string[];
  assistantContent: unknown[];
}

/** Seals turn `index` of a conversation, binding it to the case, the suspect, and the turn before. */
export function sealTurn(input: SealInput, secret?: string): string {
  return sign(input, secret);
}

/**
 * True when every turn's seal matches and the chain is unbroken. An empty
 * history is trivially valid.
 */
export function verifyHistory(caseId: string, suspectId: string, history: TurnRecord[], secret?: string): boolean {
  let previous: string | null = null;
  for (let index = 0; index < history.length; index++) {
    const turn = history[index];
    const expected: SealInput = {
      caseId,
      suspectId,
      index,
      previous,
      question: turn.question,
      evidenceIds: turn.evidenceIds,
      assistantContent: turn.assistantContent,
    };
    if (!verify(expected, turn.seal, secret)) return false;
    previous = turn.seal;
  }
  return true;
}
