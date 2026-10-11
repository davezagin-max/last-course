/** Limits shared by the server and the browser. No server-only imports here. */

/** Questions one suspect will answer in a live session. Keeps the context and the bill bounded. */
export const MAX_TURNS = 20;
export const MAX_QUESTION_CHARS = 400;
/** Exhibits that can be put in front of a suspect with a single question. */
export const MAX_EVIDENCE_PER_TURN = 3;
