/**
 * PHASE 0.8B — REAL PROVIDER ADAPTER (CONSTRUCTED ON DEMAND, NEVER ON IMPORT)
 *
 * The only file in the feed foundation that knows the provider's name. It is
 * written so that importing it costs nothing and reaches nothing.
 *
 * THE IMPORT-TIME RULE
 * --------------------
 * `kiteconnect` is resolved with a dynamic `import()` inside `connect()`, not
 * with a top-level import. The difference matters because a top-level import
 * executes the SDK's module body the moment ANY file in its transitive import
 * graph is loaded — including every test that touches the manager, and the
 * server's own boot, whether or not the feed is enabled. The SDK would then
 * read configuration and allocate at a point where the process has explicitly
 * decided not to have a feed.
 *
 * Deferring to `connect()` means an un-activated process never loads the
 * provider SDK at all: the gates are evaluated, activation is refused, and no
 * `connect()` is ever called, so the dynamic import never runs.
 *
 * WHY THE FACTORY IS EXPORTED AS A FUNCTION RATHER THAN AN INSTANCE
 * -----------------------------------------------------------------
 * An exported instance is constructed at import time by definition. A factory
 * defers construction to the caller and lets the manager decide, after the
 * gates, whether to build anything at all.
 *
 * PHASE STATUS: this adapter is complete but unreachable — the manager's
 * `FEED_RUNTIME_ACTIVATION_AUTHORIZED` lock is false, so nothing calls it.
 */

import type {
  FeedClientFactory,
  FeedClientOpResult,
  FeedClientPort,
  FeedClientState,
  FeedSubscribeResult,
  FeedTickEnvelope,
} from "./feedClientPort";

/**
 * Minimal structural view of the provider ticker.
 *
 * Declared here rather than imported so this file has NO type-level dependency
 * that could tempt a value import. It also documents exactly how much of the
 * SDK this adapter is allowed to touch.
 */
interface ProviderTicker {
  connect(): void;
  disconnect(): void;
  autoReconnect(enable: boolean, retries: number, delaySec: number): void;
  subscribe(tokens: number[]): void;
  setMode(mode: string, tokens: number[]): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

interface ProviderRawTick {
  instrument_token?: unknown;
  last_price?: unknown;
  ohlc?: { open?: unknown; high?: unknown; low?: unknown; close?: unknown };
  volume?: unknown;
  change?: unknown;
  exchange_timestamp?: unknown;
}

function num(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

/**
 * Translate one provider tick into the neutral envelope.
 *
 * Returns null when the tick has no usable token or price. It NEVER
 * substitutes a value: a missing OHLC field stays undefined so that the
 * ingestion layer can tell "not reported" from "reported as zero".
 */
export function toEnvelope(raw: ProviderRawTick, nowMs: number): FeedTickEnvelope | null {
  const token = num(raw.instrument_token);
  const ltp = num(raw.last_price);
  if (token === undefined || !Number.isSafeInteger(token) || token <= 0) return null;
  if (ltp === undefined) return null;

  // exchange_timestamp is a Date in the SDK; fall back to receipt time only
  // when the provider sent nothing at all.
  let ts = nowMs;
  const stamp = raw.exchange_timestamp;
  if (stamp instanceof Date) {
    const t = stamp.getTime();
    if (Number.isFinite(t) && t > 0) ts = t;
  }

  const envelope: {
    -readonly [K in keyof FeedTickEnvelope]: FeedTickEnvelope[K];
  } = { providerToken: token, ltp, ts };

  const open = num(raw.ohlc?.open);
  const high = num(raw.ohlc?.high);
  const low = num(raw.ohlc?.low);
  const close = num(raw.ohlc?.close);
  const volume = num(raw.volume);
  const changePercent = num(raw.change);
  if (open !== undefined) envelope.open = open;
  if (high !== undefined) envelope.high = high;
  if (low !== undefined) envelope.low = low;
  if (close !== undefined) envelope.close = close;
  if (volume !== undefined) envelope.volume = volume;
  if (changePercent !== undefined) envelope.changePercent = changePercent;

  return envelope;
}

export interface KiteAdapterCredentials {
  readonly apiKey: string;
  readonly accessToken: string;
}

/**
 * Build a factory bound to one credential pair.
 *
 * Credentials are captured in the closure and never placed on the port, so no
 * diagnostic that serialises a client can leak them.
 */
/**
 * How long to wait for the provider's `connect` event before calling the
 * attempt failed. The Kite SDK supplies no default timeout of its own, so an
 * unreachable endpoint would otherwise hang the startup sequence until the OS
 * gave up on the TCP connection.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

export function createKiteFeedClientFactory(
  getCredentials: () => KiteAdapterCredentials | null,
  now: () => number = () => Date.now(),
  connectTimeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): FeedClientFactory {
  return async (spec) => {
    let ticker: ProviderTicker | null = null;
    let state: FeedClientState = "CONSTRUCTED";
    let subscribed: number[] = [];

    const port: FeedClientPort = {
      shardId: spec.shardId,
      state: () => state,

      async connect(): Promise<FeedClientOpResult> {
        const creds = getCredentials();
        if (creds === null) {
          state = "FAILED";
          return { ok: false, detail: "PROVIDER_CREDENTIALS_UNAVAILABLE" };
        }
        state = "CONNECTING";
        try {
          // The deferred provider load. Nothing above this line touches the SDK.
          const mod = (await import("kiteconnect")) as unknown as {
            KiteTicker: new (o: { api_key: string; access_token: string }) => ProviderTicker;
          };
          const t = new mod.KiteTicker({ api_key: creds.apiKey, access_token: creds.accessToken });

          t.on("ticks", (...args: unknown[]) => {
            const list = args[0];
            if (!Array.isArray(list)) return;
            const nowMs = now();
            const envelopes: FeedTickEnvelope[] = [];
            for (const item of list) {
              const env = toEnvelope(item as ProviderRawTick, nowMs);
              if (env !== null) envelopes.push(env);
            }
            if (envelopes.length > 0) spec.events.onTicks(envelopes);
          });
          // `connect()` must not resolve until the socket is genuinely open.
          // Returning as soon as the request was issued would let the manager
          // subscribe to a dead socket and then declare RUNNING — a feed that
          // reports healthy and delivers nothing. The settle-once latch below
          // converts the provider's event callbacks into a single awaited
          // outcome, and a timeout is a FAILURE, never an assumed success.
          let settle: ((r: FeedClientOpResult) => void) | null = null;
          const settleOnce = (r: FeedClientOpResult): boolean => {
            if (settle === null) return false;
            const resolve = settle;
            settle = null;
            resolve(r);
            return true;
          };

          t.on("connect", () => {
            state = "CONNECTED";
            settleOnce({ ok: true, detail: "CONNECTED" });
            spec.events.onConnected();
          });
          t.on("disconnect", (...args: unknown[]) => {
            state = "CLOSED";
            const reason = String(args[0] ?? "disconnected");
            // A disconnect BEFORE the connect handshake completed is a failed
            // connect, not the loss of an established shard. Reporting it as a
            // disconnect would tell the manager it lost a socket it never had.
            if (settleOnce({ ok: false, detail: `DISCONNECTED_BEFORE_CONNECT: ${reason}` })) return;
            spec.events.onDisconnected(reason);
          });
          t.on("error", (...args: unknown[]) => {
            const message = String(args[0] ?? "error");
            if (settleOnce({ ok: false, detail: `PROVIDER_ERROR: ${message}` })) return;
            spec.events.onError(message);
          });

          // Provider-side auto-reconnect is left OFF: the manager owns the
          // reconnect policy, and two independent reconnect loops would race
          // to hold the same shard's socket.
          t.autoReconnect(false, 0, 0);

          // Retained BEFORE awaiting so a timed-out or refused connection can
          // still be disconnected by close() rather than being abandoned.
          ticker = t;

          const outcome = await new Promise<FeedClientOpResult>((resolve) => {
            const timer = setTimeout(() => {
              settleOnce({
                ok: false,
                detail: `PROVIDER_CONNECT_TIMEOUT_${connectTimeoutMs}MS`,
              });
            }, connectTimeoutMs);
            // Never hold the event loop open on this timer.
            timer.unref?.();
            settle = (r: FeedClientOpResult) => {
              clearTimeout(timer);
              resolve(r);
            };
            try {
              t.connect();
            } catch (err) {
              settleOnce({
                ok: false,
                detail: `CONNECT_THREW: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          });

          if (!outcome.ok) state = "FAILED";
          return outcome;
        } catch (err) {
          state = "FAILED";
          return {
            ok: false,
            detail: `PROVIDER_CONNECT_FAILED: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },

      async subscribe(tokens: readonly number[]): Promise<FeedSubscribeResult> {
        // Both conditions matter. A retained ticker proves only that a socket
        // was once constructed; if it has since dropped, writing a subscribe
        // to it would silently succeed and the caller would believe the shard
        // is covered. Only a currently CONNECTED socket may be subscribed.
        if (ticker === null || state !== "CONNECTED") {
          return {
            ok: false,
            acceptedTokens: [],
            detail: ticker === null ? "NOT_CONNECTED" : `NOT_CONNECTED_STATE_${state}`,
            confirmation: "REQUEST_ACCEPTED_UNCONFIRMED",
          };
        }
        try {
          const list = [...tokens];
          ticker.subscribe(list);
          ticker.setMode("full", list);
          subscribed = list;
          // The Kite ticker never acknowledges a subscription: these calls
          // write to an open socket and return. Echoing the request back as
          // `acceptedTokens` is therefore the request, NOT provider truth, and
          // it is labelled as such so no caller can mistake it for agreement.
          return {
            ok: true,
            acceptedTokens: list,
            detail: `SUBSCRIBE_REQUESTED_${list.length}`,
            confirmation: "REQUEST_ACCEPTED_UNCONFIRMED",
          };
        } catch (err) {
          return {
            ok: false,
            acceptedTokens: [],
            detail: `SUBSCRIBE_FAILED: ${err instanceof Error ? err.message : String(err)}`,
            confirmation: "REQUEST_ACCEPTED_UNCONFIRMED",
          };
        }
      },

      async close(): Promise<FeedClientOpResult> {
        if (ticker === null) {
          state = "CLOSED";
          return { ok: true, detail: "NOTHING_TO_CLOSE" };
        }
        state = "CLOSING";
        try {
          ticker.disconnect();
          ticker = null;
          subscribed = [];
          state = "CLOSED";
          return { ok: true, detail: "DISCONNECTED" };
        } catch (err) {
          state = "FAILED";
          return {
            ok: false,
            detail: `DISCONNECT_FAILED: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },

      subscribedTokenCount: () => subscribed.length,
    };

    return port;
  };
}
