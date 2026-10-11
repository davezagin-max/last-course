/**
 * Route-handler wrappers that give every API route the same behavior:
 * rate limiting, a body size cap, input validation, bring-your-own-key,
 * demo-mode replay, fixture recording, and safe error mapping.
 *
 *   export const POST = jsonRoute({ store, fixtures, schema, live });
 *   export const POST = streamRoute({ store, fixtures, schema, live });
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { clientFromRequest, toApiError, type Refusal } from "./claude";
import { ZERO_USAGE, type Usage } from "./config";
import { findFixture, requestKey, type Fixture, type FixtureStore } from "./demo";
import { clientIp, createRateLimiter } from "./rate-limit";

/**
 * Thrown by a handler to fail with a specific status and a message that is
 * safe to show the visitor (anything else thrown becomes a generic 500).
 */
export class RouteError extends Error {
  constructor(
    readonly status: number,
    readonly kind: ErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "RouteError";
  }
}

export type ErrorKind =
  | "invalid"
  | "too_large"
  | "rate_limit"
  | "auth"
  | "refusal"
  | "demo_miss"
  | "server";

export interface ApiMeta {
  mode: "live" | "demo";
  /** Demo data is a hand-written sample, not a recorded model run. */
  placeholder: boolean;
  recordedAt: string | null;
  model: string | null;
  usage: Usage;
  costUsd: number;
}

export type ApiResponse<D> =
  | { ok: true; data: D; meta: ApiMeta }
  | { ok: false; error: { kind: ErrorKind; message: string }; meta?: ApiMeta };

/** What a live handler returns: data plus what it cost, or a refusal. */
export type LiveResult<D> =
  | { data: D; model: string; usage: Usage; costUsd: number }
  | { refusal: Refusal; model: string; usage: Usage; costUsd: number };

interface RouteConfig<B> {
  /** Fixture file name: `fixtures/<store>.json`. */
  store: string;
  schema: z.ZodType<B>;
  /** Request body cap in bytes. Default 64 KB. */
  maxBytes?: number;
  rateLimit?: { limit: number; windowMs: number };
}

/**
 * Optional last step applied to both live results and fixture replays before
 * they are sent. Fixtures always store the handler's own data, so `present`
 * can strip server-only fields or add per-server values (a seal, for example)
 * without those ever being recorded.
 */
type Present<B, D, P> = (data: D, body: B) => P | Promise<P>;

export interface JsonRouteConfig<B, D, P = D> extends RouteConfig<B> {
  fixtures: FixtureStore<D>;
  live: (ctx: { body: B; client: Anthropic; req: Request }) => Promise<LiveResult<D>>;
  present?: Present<B, D, P>;
}

export interface StreamRouteConfig<B, D, E, P = D> extends RouteConfig<B> {
  fixtures: FixtureStore<D, E>;
  present?: Present<B, D, P>;
  live: (ctx: {
    body: B;
    client: Anthropic;
    req: Request;
    emit: (event: E) => void;
  }) => Promise<LiveResult<D>>;
  /** Demo replay speed-up. 1 = real time. Default 4. */
  replaySpeed?: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_RATE = { limit: 20, windowMs: 60_000 };

function fail(status: number, kind: ErrorKind, message: string, headers?: HeadersInit): Response {
  const body: ApiResponse<never> = { ok: false, error: { kind, message } };
  return Response.json(body, { status, headers });
}

function refusalMessage(refusal: Refusal): string {
  return refusal.category
    ? `Claude declined this request (safety category: ${refusal.category}). Try rephrasing it.`
    : "Claude declined this request. Try rephrasing it.";
}

function demoMeta(fixture: Fixture): ApiMeta {
  return {
    mode: "demo",
    placeholder: fixture.placeholder,
    recordedAt: fixture.recordedAt,
    model: fixture.model,
    usage: fixture.usage,
    costUsd: fixture.costUsd,
  };
}

function liveMeta(result: LiveResult<unknown>): ApiMeta {
  return {
    mode: "live",
    placeholder: false,
    recordedAt: null,
    model: result.model,
    usage: result.usage,
    costUsd: result.costUsd,
  };
}

const MISS_MESSAGE =
  "Demo mode only replays recorded runs. Pick one of the presets, or add your Anthropic key to run this live.";

/** Shared front half of every route: rate limit, size cap, parse, validate. */
function createGate<B>(config: RouteConfig<B>) {
  const rate = config.rateLimit ?? DEFAULT_RATE;
  const limiter = createRateLimiter(rate.limit, rate.windowMs);
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;

  return async function gate(req: Request): Promise<{ body: B } | Response> {
    // Recording replays every preset back to back from one address.
    const recording = process.env.RECORD_FIXTURES === "1" && process.env.NODE_ENV !== "production";
    const verdict = limiter(clientIp(req));
    if (!verdict.allowed && !recording) {
      return fail(429, "rate_limit", "Too many requests. Wait a moment and try again.", {
        "retry-after": String(verdict.retryAfterSeconds),
      });
    }
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > maxBytes) return fail(413, "too_large", "Request body is too large.");
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > maxBytes) {
      return fail(413, "too_large", "Request body is too large.");
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(400, "invalid", "Request body must be JSON.");
    }
    const parsed = config.schema.safeParse(json);
    if (!parsed.success) return fail(400, "invalid", "Request body has an invalid shape.");
    return { body: parsed.data };
  };
}

async function record(store: string, key: string, fixture: Fixture): Promise<void> {
  const recorder = await import("./demo-record");
  if (recorder.recordingEnabled()) await recorder.saveFixture(store, key, fixture);
}

function labelOf(body: unknown): string {
  if (body && typeof body === "object" && "demoId" in body) {
    const id = (body as { demoId?: unknown }).demoId;
    if (typeof id === "string") return id;
  }
  return "recorded request";
}

function mapError(error: unknown): { status: number; kind: ErrorKind; message: string } {
  if (error instanceof RouteError) return { status: error.status, kind: error.kind, message: error.message };
  const mapped = toApiError(error);
  const kind: ErrorKind =
    mapped.status === 401 || mapped.status === 403
      ? "auth"
      : mapped.status === 429
        ? "rate_limit"
        : mapped.status === 400
          ? "invalid"
          : "server";
  return { status: mapped.status, kind, message: mapped.message };
}

export function jsonRoute<B, D, P = D>(config: JsonRouteConfig<B, D, P>) {
  const gate = createGate(config);
  const present = async (data: D, body: B): Promise<P> =>
    config.present ? config.present(data, body) : (data as unknown as P);

  return async function POST(req: Request): Promise<Response> {
    const gated = await gate(req);
    if (gated instanceof Response) return gated;
    const { body } = gated;

    try {
      const client = clientFromRequest(req);
      const key = await requestKey(body);

      if (!client) {
        const fixture = findFixture(config.fixtures, key);
        if (!fixture) return fail(404, "demo_miss", MISS_MESSAGE);
        const response: ApiResponse<P> = {
          ok: true,
          data: await present(fixture.data, body),
          meta: demoMeta(fixture),
        };
        return Response.json(response);
      }

      const result = await config.live({ body, client, req });
      if ("refusal" in result) {
        const response: ApiResponse<P> = {
          ok: false,
          error: { kind: "refusal", message: refusalMessage(result.refusal) },
          meta: liveMeta(result),
        };
        return Response.json(response, { status: 422 });
      }
      await record(config.store, key, {
        label: labelOf(body),
        placeholder: false,
        recordedAt: new Date().toISOString(),
        model: result.model,
        usage: result.usage,
        costUsd: result.costUsd,
        data: result.data,
      });
      const response: ApiResponse<P> = {
        ok: true,
        data: await present(result.data, body),
        meta: liveMeta(result),
      };
      return Response.json(response);
    } catch (error) {
      const mapped = mapError(error);
      return fail(mapped.status, mapped.kind, mapped.message);
    }
  };
}

/** Server-sent event frames written by `streamRoute` and read by `streamApi`. */
export type StreamFrame<D, E> =
  | { type: "meta"; meta: Pick<ApiMeta, "mode" | "placeholder" | "recordedAt"> }
  | { type: "event"; event: E }
  | { type: "done"; data: D; meta: ApiMeta }
  | { type: "error"; error: { kind: ErrorKind; message: string }; meta?: ApiMeta };

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function streamRoute<B, D, E, P = D>(config: StreamRouteConfig<B, D, E, P>) {
  const gate = createGate(config);
  const speed = config.replaySpeed ?? 4;
  const present = async (data: D, body: B): Promise<P> =>
    config.present ? config.present(data, body) : (data as unknown as P);

  return async function POST(req: Request): Promise<Response> {
    const gated = await gate(req);
    if (gated instanceof Response) return gated;
    const { body } = gated;

    let client: Anthropic | null;
    try {
      client = clientFromRequest(req);
    } catch (error) {
      return fail(401, "auth", toApiError(error).message);
    }
    const key = await requestKey(body);
    const fixture = client ? null : findFixture(config.fixtures, key);
    if (!client && !fixture) return fail(404, "demo_miss", MISS_MESSAGE);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (frame: StreamFrame<P, E>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        };
        try {
          if (fixture) {
            send({
              type: "meta",
              meta: { mode: "demo", placeholder: fixture.placeholder, recordedAt: fixture.recordedAt },
            });
            let clock = 0;
            for (const { at, event } of fixture.events ?? []) {
              await sleep(Math.min(Math.max(at - clock, 0) / speed, 1500));
              clock = at;
              send({ type: "event", event });
            }
            send({ type: "done", data: await present(fixture.data, body), meta: demoMeta(fixture) });
          } else if (client) {
            send({ type: "meta", meta: { mode: "live", placeholder: false, recordedAt: null } });
            const started = Date.now();
            const events: { at: number; event: E }[] = [];
            const result = await config.live({
              body,
              client,
              req,
              emit: (event) => {
                events.push({ at: Date.now() - started, event });
                send({ type: "event", event });
              },
            });
            if ("refusal" in result) {
              send({
                type: "error",
                error: { kind: "refusal", message: refusalMessage(result.refusal) },
                meta: liveMeta(result),
              });
            } else {
              await record(config.store, key, {
                label: labelOf(body),
                placeholder: false,
                recordedAt: new Date().toISOString(),
                model: result.model,
                usage: result.usage,
                costUsd: result.costUsd,
                data: result.data,
                events,
              });
              send({ type: "done", data: await present(result.data, body), meta: liveMeta(result) });
            }
          }
        } catch (error) {
          const mapped = mapError(error);
          send({ type: "error", error: { kind: mapped.kind, message: mapped.message } });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  };
}

const LOCAL_META: ApiMeta = {
  mode: "live",
  placeholder: false,
  recordedAt: null,
  model: "none",
  usage: ZERO_USAGE,
  costUsd: 0,
};

/**
 * A route that never calls a model: same rate limit, body cap, validation, and
 * error mapping, but no key, no fixtures, and no cost. It behaves identically
 * with and without a key.
 */
export function localRoute<B, D>(config: Omit<RouteConfig<B>, "store"> & { handler: (body: B) => D | Promise<D> }) {
  const gate = createGate({ ...config, store: "local" });
  return async function POST(req: Request): Promise<Response> {
    const gated = await gate(req);
    if (gated instanceof Response) return gated;
    try {
      const response: ApiResponse<D> = { ok: true, data: await config.handler(gated.body), meta: LOCAL_META };
      return Response.json(response);
    } catch (error) {
      const mapped = mapError(error);
      return fail(mapped.status, mapped.kind, mapped.message);
    }
  };
}

/** Meta for a result that made no model call (for example a purely deterministic step). */
export const NO_CALL = { model: "none", usage: ZERO_USAGE, costUsd: 0 } as const;
