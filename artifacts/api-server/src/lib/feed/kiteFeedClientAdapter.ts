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
 * that could tempt a value import.
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
  oi?: unknown;
  oi_day_high?: unknown;
  oi_day_low?: unknown;
  buy_quantity?: unknown;
  sell_quantity?: unknown;
  exchange_token?: unknown;
}

export interface KiteCredentials {
  readonly apiKey: string;
  readonly accessToken: string;
}

function num(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

function safeToken(raw: unknown): number | undefined {
  const n = num(raw);
  if (n === undefined || !Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

/**
 * Translate one provider tick into the neutral envelope.
 *
 * Returns null when the tick has no usable token or price. It NEVER
 * substitutes a value: a missing OHLC field stays undefined so that the
 * ingestion layer can tell "not reported" from "reported as zero".
 *
 * TIMESTAMP CONTRACT: exchangeTimestamp is ONLY set when the provider supplies
 * a valid Date. It is NEVER replaced by receivedTimestamp (nowMs).
 * receivedTimestamp is always nowMs — the local adapter receipt time.
 */
export function toEnvelope(raw: ProviderRawTick, nowMs: number): FeedTickEnvelope | null {
  const token = safeToken(raw.instrument_token);
  const ltp = num(raw.last_price);
  if (token === undefined) return null;
  if (ltp === undefined) return null;

  const envelope: {
    -readonly [K in keyof FeedTickEnvelope]: FeedTickEnvelope[K];
  } = {
    providerToken: token,
    ltp,
    receivedTimestamp: nowMs,
  };

  // exchangeTimestamp from provider — absent means absent, not nowMs.
  const stamp = raw.exchange_timestamp;
  if (stamp instanceof Date) {
    const t = stamp.getTime();
    if (Number.isFinite(t) && t > 0) envelope.exchangeTimestamp = t;
  }

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

  const oi = num(raw.oi);
  const oiDayHigh = num(raw.oi_day_high);
  const oiDayLow = num(raw.oi_day_low);
  const buyQty = num(raw.buy_quantity);
  const sellQty = num(raw.sell_quantity);
  if (oi !== undefined) envelope.oi = oi;
  if (oiDayHigh !== undefined) envelope.oiDayHigh = oiDayHigh;
  if (oiDayLow !== undefined) envelope.oiDayLow = oiDayLow;
  if (buyQty !== undefined) envelope.buyQty = buyQty;
  if (sellQty !== undefined) envelope.sellQty = sellQty;

  const providerExchangeToken = safeToken(raw.exchange_token);
  if (providerExchangeToken !== undefined) envelope.providerExchangeToken = providerExchangeToken;

  return Object.freeze(envelope);
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/**
 * The real Kite feed client adapter factory factory.
 *
 * Takes a credential provider and optional config, returns a FeedClientFactory.
 * Each factory call produces one adapter that wraps one KiteTicker instance.
 * The KiteTicker is constructed lazily inside `connect()` — never at factory
 * invocation time — so importing this file is side-effect free.
 *
 * @param getCredentials  Called at connect() time to retrieve the current API credentials.
 * @param nowMs           Time source, defaults to Date.now.
 * @param connectTimeoutMs  Timeout for the initial connection handshake, defaults to 15s.
 */
export function createKiteFeedClientFactory(
  getCredentials?: () => KiteCredentials | null,
  nowMs: () => number = Date.now,
  connectTimeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): FeedClientFactory {
  return async (spec) => {
    let ticker: ProviderTicker | null = null;
    let state: FeedClientState = "CONSTRUCTED";
    let subscribed: number[] = [];

    return Object.freeze<FeedClientPort>({
      shardId: spec.shardId,

      state: () => state,
      subscribedTokenCount: () => subscribed.length,

      async connect(): Promise<FeedClientOpResult> {
        if (state !== "CONSTRUCTED") {
          return { ok: false, detail: `connect called in state ${state}` };
        }

        // Validate credentials BEFORE loading the SDK — so a missing-credentials
        // environment can be detected without any provider side-effect.
        const creds = getCredentials?.() ?? null;
        if (getCredentials !== undefined && creds === null) {
          state = "FAILED";
          return { ok: false, detail: "PROVIDER_CREDENTIALS_UNAVAILABLE" };
        }

        state = "CONNECTING";

        // Dynamic import: the SDK is loaded here and ONLY here.
        const { KiteTicker } = await import("kiteconnect");
        const resolvedCreds = creds ?? { apiKey: "", accessToken: "" };

        const t = new KiteTicker({
          api_key: resolvedCreds.apiKey,
          access_token: resolvedCreds.accessToken,
        }) as unknown as ProviderTicker;
        t.autoReconnect(false, 0, 0);

        type ConnectResult =
          | { ok: true }
          | { ok: false; detail: "PROVIDER_CONNECT_TIMEOUT" | "PROVIDER_ERROR" | "DISCONNECTED_BEFORE_CONNECT" };

        const connected = await new Promise<ConnectResult>((resolve) => {
          let settled = false;
          const settle = (result: ConnectResult) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(result);
            }
          };

          const timer = setTimeout(
            () => settle({ ok: false, detail: "PROVIDER_CONNECT_TIMEOUT" }),
            connectTimeoutMs,
          );
          // Unref so the timer doesn't keep the event loop alive in tests.
          if (typeof (timer as NodeJS.Timeout).unref === "function") {
            (timer as NodeJS.Timeout).unref();
          }

          t.on("connect", () => settle({ ok: true }));
          t.on("disconnect", () =>
            settle({ ok: false, detail: "DISCONNECTED_BEFORE_CONNECT" }),
          );
          t.on("error", () => settle({ ok: false, detail: "PROVIDER_ERROR" }));

          t.connect();
        });

        void nowMs; // retained for future observation windows

        if (!connected.ok) {
          state = "FAILED";
          ticker = t;
          return { ok: false, detail: connected.detail };
        }

        ticker = t;
        state = "CONNECTED";

        // Wire ongoing disconnect handler AFTER connect.
        // Forward the raw provider reason so the manager/tests can inspect it.
        t.on("disconnect", (reason: unknown) => {
          state = "FAILED";
          spec.events.onDisconnected(String(reason ?? "PROVIDER_DISCONNECT"));
        });
        t.on("error", (msg: unknown) => {
          spec.events.onError(String(msg));
        });
        t.on("ticks", (ticks: unknown[]) => {
          const receiveMs = nowMs();
          const envelopes: FeedTickEnvelope[] = [];
          for (const raw of ticks) {
            const e = toEnvelope(raw as ProviderRawTick, receiveMs);
            if (e !== null) envelopes.push(e);
          }
          if (envelopes.length > 0) spec.events.onTicks(envelopes);
        });

        spec.events.onConnected();
        return { ok: true, detail: "CONNECTED" };
      },

      async subscribe(tokens: readonly number[]): Promise<FeedSubscribeResult> {
        if (state !== "CONNECTED") {
          return {
            ok: false,
            acceptedTokens: [],
            detail: "NOT_CONNECTED",
            confirmation: "REQUEST_ACCEPTED_UNCONFIRMED",
          };
        }
        const list = [...tokens];
        try {
          ticker!.subscribe(list);
          ticker!.setMode("full", list);
          subscribed = list;
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
    });
  };
}

/**
 * Direct FeedClientFactory — no credentials, default timeout.
 * Used when activation is controlled by the lock (always disabled today).
 */
export const createKiteFeedClientAdapter: FeedClientFactory = createKiteFeedClientFactory();
