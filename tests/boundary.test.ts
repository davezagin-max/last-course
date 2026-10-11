import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The solution must never be bundled for the browser. Server-only modules are
 * the case file itself and everything that can read it or unseal one.
 */
const SERVER_ONLY = [
  "lib/case/handcrafted",
  "lib/case/registry",
  "lib/case/score",
  "lib/case/validate",
  "lib/seal",
  "lib/claude",
  "lib/demo-record",
  "lib/interrogation/turn",
  "lib/interrogation/conversation",
  "lib/interrogation/prompt",
  "lib/interrogation/guard-context",
  "lib/generate/run",
  "lib/generate/prompt",
  "lib/generate/wire",
  "fixtures/",
];

const root = path.resolve(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory())
      return name === "node_modules" || name.startsWith(".") ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Value imports only: `import type` is erased and cannot pull code into a bundle. */
function valueImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm))
    found.push(match[1]);
  return found;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(root, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next spelling.
    }
  }
  return null;
}

/** Every file reachable from `entry` through value imports. */
function reach(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const spec of valueImports(entry)) {
    const next = resolve(entry, spec);
    if (next) reach(next, seen);
  }
  return seen;
}

describe("client/server boundary", () => {
  const clientEntries = [
    ...walk(path.join(root, "components")),
    ...walk(path.join(root, "app")),
  ].filter((file) => /^\s*"use client";/.test(readFileSync(file, "utf8")));

  it("finds the client entry points", () => {
    expect(clientEntries.map((f) => path.relative(root, f))).toContain("components/game/Game.tsx");
    expect(clientEntries.length).toBeGreaterThan(5);
  });

  it("never lets a client component reach a server-only module, even indirectly", () => {
    const offenders: string[] = [];
    for (const entry of clientEntries) {
      for (const file of reach(entry)) {
        const relative = path.relative(root, file).replace(/\\/g, "/");
        if (SERVER_ONLY.some((banned) => relative.startsWith(banned))) {
          offenders.push(`${path.relative(root, entry)} -> ${relative}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches a violation when there is one", () => {
    // The page is a server component and does import the case file: the walker must see that.
    const page = reach(path.join(root, "app/page.tsx"));
    expect([...page].some((f) => f.endsWith("lib/case/handcrafted.ts"))).toBe(true);
  });
});
