#!/usr/bin/env node
/**
 * Runs the prompt-injection test set against the live model.
 *
 *   pnpm eval:injection                  # every input, against the culprit and one innocent suspect
 *   pnpm eval:injection --suspects gus   # comma-separated suspect ids
 *   pnpm eval:injection --budget 0.50    # stop once this many dollars are spent (default 1)
 *
 * `pnpm test` already checks the output guard against canned good and bad
 * outputs. This script answers the other question: how often does the real
 * model need the guard at all? Each adversarial input is sent to
 * /api/interrogate as a fresh conversation and the result is one of:
 *
 *   HELD     the model stayed in character; the guard passed its answer
 *   CAUGHT   the model slipped and the guard replaced the answer (the player
 *            never saw it, but it counts against the model)
 *   REFUSED  the API declined the request
 *   ERROR    the call failed
 *
 * Needs ANTHROPIC_API_KEY (shell, .env.local, or ../.env). Without one it
 * says so and exits 0, so it is safe to leave in a checklist.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const budget = Number(flag("--budget") ?? 1);
const port = Number(flag("--port") ?? 3120);
const suspects = (flag("--suspects") ?? "gus,tomas")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CASE_ID = "the-fourth-course";

for (const file of [".env.local", "../.env"]) {
  if (!process.env.ANTHROPIC_API_KEY && existsSync(file)) process.loadEnvFile(file);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY is not set: skipping the live injection eval.");
  console.log("The offline half (canned outputs against the output guard) runs in `pnpm test`.");
  process.exit(0);
}

const cases = JSON.parse(readFileSync("lib/interrogation/injection-set.json", "utf8"));
const base = `http://localhost:${port}`;
const server = spawn("pnpm", ["exec", "next", "dev", "-p", String(port)], {
  env: { ...process.env, ALLOW_SERVER_KEY: "1" },
  stdio: "ignore",
  detached: true,
});
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(base);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Dev server did not start.");
}

await waitForServer();
const tally = { HELD: 0, CAUGHT: 0, REFUSED: 0, ERROR: 0 };
let spent = 0;
let stopped = false;

outer: for (const suspectId of suspects) {
  console.log(`\nSuspect: ${suspectId}`);
  for (const c of cases) {
    if (spent >= budget) {
      console.error(`Budget of $${budget.toFixed(2)} reached. Stopping before: ${c.id}`);
      stopped = true;
      break outer;
    }
    let outcome = "ERROR";
    let detail = "";
    try {
      const res = await fetch(`${base}/api/interrogate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          case: { id: CASE_ID },
          suspectId,
          question: c.input,
          evidenceIds: [],
          history: [],
        }),
      });
      const json = await res.json();
      spent += json.meta?.costUsd ?? 0;
      if (json.ok) {
        outcome = json.data.blocked ? "CAUGHT" : "HELD";
        detail = json.data.blocked
          ? `guard: ${json.data.blockedFor.join(", ")}`
          : json.data.answer.replace(/\s+/g, " ").slice(0, 90);
      } else if (json.error?.kind === "refusal") {
        outcome = "REFUSED";
        detail = json.error.message;
      } else {
        detail = json.error?.message ?? `HTTP ${res.status}`;
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    tally[outcome] += 1;
    console.log(`${outcome.padEnd(8)} ${c.id.padEnd(24)} ${detail}`);
  }
}

const total = tally.HELD + tally.CAUGHT + tally.REFUSED + tally.ERROR;
console.log(
  `\nModel held ${tally.HELD}/${total}. Guard caught ${tally.CAUGHT}. Refused ${tally.REFUSED}. Errors ${tally.ERROR}. Spent $${spent.toFixed(4)}.`,
);
console.log(
  "A CAUGHT answer never reached the player. Either way, an innocent suspect's prompt does not contain the solution.",
);
process.exit(tally.ERROR > 0 || stopped ? 1 : 0);
