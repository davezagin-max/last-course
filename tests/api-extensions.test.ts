import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  RouteError,
  jsonRoute,
  localRoute,
  streamRoute,
  type ApiResponse,
  type StreamFrame,
} from "@/lib/api";
import { ZERO_USAGE } from "@/lib/config";
import type { FixtureStore } from "@/lib/demo";

/** This repo's additions to the kit's route wrappers: typed errors, `present`, and `localRoute`. */

const schema = z.object({ demoId: z.string().optional(), n: z.number() });
type Data = { secret: string; shown: string };
type Shown = { shown: string; doubled: number };

const fixture = (data: Data, extra: object = {}) => ({
  label: "preset",
  placeholder: true,
  recordedAt: null,
  model: "claude-opus-5-5",
  usage: ZERO_USAGE,
  costUsd: 0,
  data,
  ...extra,
});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const KEY = { "x-anthropic-key": "sk-ant-test-0123456789abcdef" };

vi.mock("@/lib/claude", async (original) => ({
  ...(await original<typeof import("@/lib/claude")>()),
  clientFromRequest: (req: Request) =>
    req.headers.get("x-anthropic-key") ? ({} as Anthropic) : null,
}));

describe("present: a last step applied to replays and live results alike", () => {
  const fixtures: FixtureStore<Data> = { p1: fixture({ secret: "the answer", shown: "recorded" }) };
  const present = (data: Data, body: { n: number }): Shown => ({
    shown: data.shown,
    doubled: body.n * 2,
  });

  it("strips server-only fields from a demo replay", async () => {
    const route = jsonRoute({ store: "x", fixtures, schema, live: vi.fn(), present });
    const json = (await (await route(post({ demoId: "p1", n: 2 }))).json()) as ApiResponse<Shown>;
    expect(json.ok && json.data).toEqual({ shown: "recorded", doubled: 4 });
    expect(JSON.stringify(json)).not.toContain("the answer");
  });

  it("applies to live results too", async () => {
    const live = vi.fn(async () => ({
      data: { secret: "s", shown: "live" },
      model: "m",
      usage: ZERO_USAGE,
      costUsd: 0.01,
    }));
    const route = jsonRoute({ store: "x", fixtures, schema, live, present });
    const json = (await (await route(post({ n: 5 }, KEY))).json()) as ApiResponse<Shown>;
    expect(json.ok && json.data).toEqual({ shown: "live", doubled: 10 });
  });

  it("applies to the final frame of a stream", async () => {
    const store: FixtureStore<Data, { step: number }> = {
      p1: fixture({ secret: "x", shown: "done" }, { events: [{ at: 0, event: { step: 1 } }] }),
    };
    const route = streamRoute({
      store: "x",
      fixtures: store,
      schema,
      live: vi.fn(),
      present,
      replaySpeed: 100,
    });
    const text = await (await route(post({ demoId: "p1", n: 1 }))).text();
    const frames = text
      .split("\n\n")
      .filter(Boolean)
      .map((c) => JSON.parse(c.slice(6)) as StreamFrame<Shown, { step: number }>);
    const done = frames.at(-1)!;
    expect(done.type === "done" && done.data).toEqual({ shown: "done", doubled: 2 });
    expect(text).not.toContain('"secret"');
  });
});

describe("RouteError: a handler can fail with a message that is safe to show", () => {
  it("maps to its own status, kind, and message in a JSON route", async () => {
    const live = vi.fn(async () => {
      throw new RouteError(409, "invalid", "No more questions.");
    });
    const res = await jsonRoute({ store: "x", fixtures: {}, schema, live })(post({ n: 1 }, KEY));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: { kind: "invalid", message: "No more questions." },
    });
  });

  it("still hides the message of any other error", async () => {
    const live = vi.fn(async () => {
      throw new Error("stack trace with internals");
    });
    const res = await jsonRoute({ store: "x", fixtures: {}, schema, live })(post({ n: 1 }, KEY));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("internals");
  });

  it("arrives as an error frame in a stream", async () => {
    const live = vi.fn(async () => {
      throw new RouteError(422, "invalid", "Could not build a valid case.");
    });
    const text = await (
      await streamRoute({ store: "x", fixtures: {}, schema, live })(post({ n: 1 }, KEY))
    ).text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("Could not build a valid case.");
  });
});

describe("localRoute: a deterministic endpoint with the same gate and no model", () => {
  const route = () => localRoute({ schema, handler: ({ n }) => ({ squared: n * n }) });

  it("answers with or without a key, at no cost", async () => {
    for (const headers of [{}, KEY]) {
      const json = (await (await route()(post({ n: 7 }, headers))).json()) as ApiResponse<{
        squared: number;
      }>;
      expect(json).toMatchObject({
        ok: true,
        data: { squared: 49 },
        meta: { model: "none", costUsd: 0 },
      });
    }
  });

  it("validates, caps, and rate limits like every other route", async () => {
    expect((await route()(post({ n: "seven" }))).status).toBe(400);
    const limited = localRoute({
      schema,
      handler: () => ({}),
      rateLimit: { limit: 1, windowMs: 60_000 },
    });
    const headers = { "x-forwarded-for": "7.7.7.7" };
    expect((await limited(post({ n: 1 }, headers))).status).toBe(200);
    expect((await limited(post({ n: 1 }, headers))).status).toBe(429);
  });

  it("maps a RouteError thrown by the handler", async () => {
    const failing = localRoute({
      schema,
      handler: () => {
        throw new RouteError(404, "invalid", "No such case.");
      },
    });
    const res = await failing(post({ n: 1 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { message: "No such case." } });
  });
});
