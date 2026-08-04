/**
 * Upstox low-level HTTP client — read-only market data only.
 *
 * ## Authentication modes (Gate A — Pack 5 23A)
 *
 * Two distinct token types are supported. They share the same bearer header
 * at transport level but have different expiry semantics:
 *
 *   ANALYTICS_TOKEN  — UPSTOX_ANALYTICS_TOKEN env var.
 *                      One-year read-only token. Supports market-data APIs
 *                      listed below. Cannot place orders.
 *                      Preferred mode for this shadow-parity integration.
 *
 *   STANDARD_DAILY_TOKEN — UPSTOX_ACCESS_TOKEN env var.
 *                           Short-lived daily OAuth2 token. Fallback if the
 *                           analytics token is not set.
 *                           Only use if this codebase separately needs the
 *                           standard flow for another identified purpose.
 *
 * Configuration ALWAYS prefers UPSTOX_ANALYTICS_TOKEN over UPSTOX_ACCESS_TOKEN.
 * They are never silently treated as interchangeable in diagnostics.
 *
 * ## Endpoint inventory (all Upstox REST API V2 unless noted)
 *
 *   GET /market-quote/quotes           — Upstox Market Quote API V2
 *   GET /historical-candle/{key}/...   — Upstox Historical Candle API V2
 *   GET /option/chain                  — Upstox Options Chain API V2
 *
 * The Market Data Feed (streaming) uses a V3 authorization path
 * (/v3/feed/market-data-feed/authorize). NOT implemented in Pack 5.
 *
 * ## Order placement
 * This adapter contains NO order, portfolio-mutation, or trading endpoints.
 * The Upstox Order API V2 is intentionally excluded.
 *
 * ## Seam
 * The `fetchImpl` constructor parameter makes every method fully unit-testable
 * without live credentials.
 */

export type FetchImpl = typeof fetch;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type UpstoxErrorKind =
  | "config"      // token absent / base URL invalid
  | "auth"        // 401 / 403
  | "not_found"   // 404 — instrument not found
  | "rate_limit"  // 429 — rate limited; retryAfterMs set
  | "server"      // 5xx
  | "timeout"     // request timed out
  | "network"     // fetch threw (DNS, connection refused, etc.)
  | "payload"     // 2xx but body unparseable or schema-invalid
  | "partial";    // 2xx but some batch items failed

export class UpstoxError extends Error {
  constructor(
    message: string,
    readonly kind: UpstoxErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "UpstoxError";
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Authentication mode (Gate A)
// ---------------------------------------------------------------------------

/**
 * Which token type is active. NEVER expose the token itself in any diagnostic
 * or error output — only the mode enum value is safe to surface.
 */
export type UpstoxAuthMode =
  | "ANALYTICS_TOKEN"      // UPSTOX_ANALYTICS_TOKEN — 1-year, read-only, preferred
  | "STANDARD_DAILY_TOKEN" // UPSTOX_ACCESS_TOKEN    — daily OAuth2, fallback
  | "NOT_CONFIGURED";      // No token present; all calls suppressed

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface UpstoxConfig {
  /** Base URL without trailing slash. */
  baseUrl: string;
  /**
   * Bearer token — NEVER logged or included in error messages.
   * null when neither UPSTOX_ANALYTICS_TOKEN nor UPSTOX_ACCESS_TOKEN is set.
   */
  accessToken: string | null;
  /** Which auth mode sourced the token. */
  authMode: UpstoxAuthMode;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** Maximum retry attempts for retryable failures. */
  maxRetries: number;
  /** Base backoff in ms for exponential retry. */
  retryBaseMs: number;
}

const DEFAULT_BASE_URL  = "https://api.upstox.com/v2";
const DEFAULT_TIMEOUT   = 15_000;
const DEFAULT_MAX_RETRY = 2;
const DEFAULT_BASE_MS   = 500;

/**
 * Resolve Upstox configuration from environment variables.
 *
 * Preference order: UPSTOX_ANALYTICS_TOKEN > UPSTOX_ACCESS_TOKEN.
 * These two token types have different expiry semantics and must not be
 * silently interchanged.
 */
export function resolveUpstoxConfig(): UpstoxConfig {
  const analyticsToken = process.env["UPSTOX_ANALYTICS_TOKEN"]?.trim() || null;
  const standardToken  = process.env["UPSTOX_ACCESS_TOKEN"]?.trim()    || null;

  let accessToken: string | null;
  let authMode: UpstoxAuthMode;
  if (analyticsToken) {
    accessToken = analyticsToken;
    authMode    = "ANALYTICS_TOKEN";
  } else if (standardToken) {
    accessToken = standardToken;
    authMode    = "STANDARD_DAILY_TOKEN";
  } else {
    accessToken = null;
    authMode    = "NOT_CONFIGURED";
  }

  const base    = (process.env["UPSTOX_API_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeout = Number(process.env["UPSTOX_TIMEOUT_MS"]);
  return {
    baseUrl:     base,
    accessToken,
    authMode,
    timeoutMs:   Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
    maxRetries:  DEFAULT_MAX_RETRY,
    retryBaseMs: DEFAULT_BASE_MS,
  };
}

// ---------------------------------------------------------------------------
// Circuit breaker (per client instance)
// ---------------------------------------------------------------------------

interface CircuitState {
  state: "closed" | "open" | "half_open";
  failures: number;
  openedAt: number | null;
  halfOpenAt: number | null;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS           = 30_000;
const CIRCUIT_HALF_OPEN_MS      = 10_000;

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface UpstoxInstrument {
  instrument_key: string;    // e.g. "NSE_EQ|INE009A01021"
  exchange:       string;    // "NSE" / "BSE" / "NFO" / "BFO" / "MCX"
  segment:        string;    // "NSE_EQ" / "NFO_OPT" / etc.
  trading_symbol: string;
  name:           string;
  isin:           string | null;
  expiry?:        string | null;
  strike?:        number | null;
  lot_size?:      number | null;
  tick_size?:     number | null;
  option_type?:   "CE" | "PE" | null;
  underlying_key?: string | null;
}

export interface UpstoxQuote {
  instrument_token: string;   // same as instrument_key
  timestamp:        string;   // ISO-8601 UTC
  last_price:       number;
  ohlc: {
    open:  number;
    high:  number;
    low:   number;
    close: number;  // previous close
  };
  volume: number;
  average_price: number | null;
  net_change:    number | null;
  depth?: {
    buy:  Array<{ price: number; quantity: number; orders: number }>;
    sell: Array<{ price: number; quantity: number; orders: number }>;
  } | null;
}

export interface UpstoxCandle {
  timestamp: string;  // ISO-8601 UTC
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
}

export interface UpstoxOptionRow {
  expiry:           string;
  strike_price:     number;
  call_options?: {
    instrument_key: string;
    market_data: {
      ltp:    number;
      oi:     number;
      volume: number;
      iv:     number | null;
      delta:  number | null;
      gamma:  number | null;
      theta:  number | null;
      vega:   number | null;
    } | null;
  } | null;
  put_options?: {
    instrument_key: string;
    market_data: {
      ltp:    number;
      oi:     number;
      volume: number;
      iv:     number | null;
      delta:  number | null;
      gamma:  number | null;
      theta:  number | null;
      vega:   number | null;
    } | null;
  } | null;
}

export interface UpstoxClient {
  readonly config: UpstoxConfig;
  readonly circuitState: () => CircuitState["state"];
  /** GET /market-quote/quotes for up to 500 instrument keys. */
  getQuotes(instrumentKeys: string[]): Promise<Map<string, UpstoxQuote>>;
  /** GET /historical-candle/{instrument_key}/{interval}/{to}/{from} */
  getCandles(
    instrumentKey: string,
    interval: UpstoxCandleInterval,
    from: string,  // YYYY-MM-DD
    to:   string,  // YYYY-MM-DD
  ): Promise<UpstoxCandle[]>;
  /** GET /option/chain for a single expiry. */
  getOptionChain(instrumentKey: string, expiryDate: string): Promise<UpstoxOptionRow[]>;
}

export type UpstoxCandleInterval =
  | "1minute" | "3minute" | "5minute" | "10minute" | "15minute" | "30minute" | "60minute"
  | "day" | "week" | "month";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUpstoxClient(
  opts: { config?: UpstoxConfig; fetchImpl?: FetchImpl } = {},
): UpstoxClient {
  const cfg  = opts.config ?? resolveUpstoxConfig();
  const _fetch: FetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const circuit: CircuitState = { state: "closed", failures: 0, openedAt: null, halfOpenAt: null };

  // -- Circuit breaker helpers
  function circuitAllow(): boolean {
    const now = Date.now();
    if (circuit.state === "closed")    return true;
    if (circuit.state === "open") {
      if (circuit.openedAt != null && now - circuit.openedAt > CIRCUIT_OPEN_MS) {
        circuit.state    = "half_open";
        circuit.halfOpenAt = now;
        return true;
      }
      return false;
    }
    // half_open: allow one probe
    if (circuit.halfOpenAt != null && now - circuit.halfOpenAt > CIRCUIT_HALF_OPEN_MS) {
      circuit.state = "open";
      return false;
    }
    return true;
  }
  function circuitSuccess(): void {
    circuit.failures = 0;
    circuit.state    = "closed";
    circuit.openedAt = null;
  }
  function circuitFailure(): void {
    circuit.failures++;
    if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuit.state    = "open";
      circuit.openedAt = Date.now();
    }
  }

  // -- Base request
  async function request<T>(
    path:   string,
    params: Record<string, string> = {},
  ): Promise<T> {
    if (!cfg.accessToken) {
      throw new UpstoxError("Upstox not configured (authMode=NOT_CONFIGURED).", "config");
    }
    if (!circuitAllow()) {
      throw new UpstoxError("Upstox circuit breaker open — requests suppressed.", "network");
    }

    const url = new URL(`${cfg.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let attempt = 0;
    const maxAttempts = cfg.maxRetries + 1;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

      let res: Response;
      try {
        res = await _fetch(url.toString(), {
          method:  "GET",
          headers: {
            Authorization: `Bearer ${cfg.accessToken}`,
            Accept:        "application/json",
          },
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const isAbort = err instanceof Error && err.name === "AbortError";
        circuitFailure();
        const kind = isAbort ? "timeout" : "network";
        const msg  = isAbort ? `Upstox request timed out (${cfg.timeoutMs}ms).` : `Upstox network error: ${err instanceof Error ? err.message : String(err)}`;
        if (attempt >= maxAttempts) throw new UpstoxError(msg, kind);
        await backoff(attempt, cfg.retryBaseMs);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 401 || res.status === 403) {
        circuitFailure();
        throw new UpstoxError(`Upstox auth error: HTTP ${res.status}.`, "auth", res.status);
      }
      if (res.status === 404) {
        throw new UpstoxError("Upstox: instrument not found.", "not_found", 404);
      }
      if (res.status === 429) {
        const retryAfterSec = Number(res.headers.get("Retry-After") ?? "5");
        const retryAfterMs  = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 5_000;
        circuitFailure();
        if (attempt >= maxAttempts) throw new UpstoxError("Upstox rate limited.", "rate_limit", 429, retryAfterMs);
        await delay(retryAfterMs);
        continue;
      }
      if (res.status >= 500) {
        circuitFailure();
        if (attempt >= maxAttempts) throw new UpstoxError(`Upstox server error: HTTP ${res.status}.`, "server", res.status);
        await backoff(attempt, cfg.retryBaseMs);
        continue;
      }
      if (!res.ok) {
        circuitFailure();
        throw new UpstoxError(`Upstox unexpected HTTP ${res.status}.`, "server", res.status);
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        circuitFailure();
        throw new UpstoxError("Upstox: response body is not valid JSON.", "payload", res.status);
      }

      // Upstox V2 wraps responses: { status: "success", data: T }
      if (typeof body !== "object" || body === null || !("status" in body)) {
        circuitFailure();
        throw new UpstoxError("Upstox: response missing status field.", "payload", res.status);
      }
      const envelope = body as Record<string, unknown>;
      if (envelope["status"] !== "success") {
        circuitFailure();
        const msg = typeof envelope["message"] === "string" ? envelope["message"] : "status !== success";
        throw new UpstoxError(`Upstox API error: ${msg}`, "payload", res.status);
      }
      circuitSuccess();
      return envelope["data"] as T;
    }
    throw new UpstoxError("Upstox: exhausted retries.", "network");
  }

  // -- Public methods
  async function getQuotes(instrumentKeys: string[]): Promise<Map<string, UpstoxQuote>> {
    if (instrumentKeys.length === 0) return new Map();
    // Upstox supports up to 500 instrument_key per request
    const BATCH = 500;
    const out = new Map<string, UpstoxQuote>();
    for (let i = 0; i < instrumentKeys.length; i += BATCH) {
      const chunk = instrumentKeys.slice(i, i + BATCH);
      const data = await request<Record<string, UpstoxQuote>>("/market-quote/quotes", {
        instrument_key: chunk.join(","),
      });
      for (const [k, v] of Object.entries(data)) out.set(k, v);
    }
    return out;
  }

  async function getCandles(
    instrumentKey: string,
    interval: UpstoxCandleInterval,
    from: string,
    to:   string,
  ): Promise<UpstoxCandle[]> {
    // Path: /historical-candle/{instrument_key}/{interval}/{to_date}/{from_date}
    const data = await request<{ candles: unknown[][] }>(
      `/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${to}/${from}`,
    );
    if (!Array.isArray(data?.candles)) return [];
    return data.candles.map((row) => ({
      timestamp: String(row[0]),
      open:      Number(row[1]),
      high:      Number(row[2]),
      low:       Number(row[3]),
      close:     Number(row[4]),
      volume:    Number(row[5]),
    }));
  }

  async function getOptionChain(instrumentKey: string, expiryDate: string): Promise<UpstoxOptionRow[]> {
    const data = await request<UpstoxOptionRow[]>("/option/chain", {
      instrument_key: instrumentKey,
      expiry_date:    expiryDate,
    });
    if (!Array.isArray(data)) return [];
    return data;
  }

  return {
    config: cfg,
    circuitState: () => circuit.state,
    getQuotes,
    getCandles,
    getOptionChain,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number, baseMs: number): Promise<void> {
  const jitter = Math.random() * baseMs;
  return delay(Math.min(baseMs * Math.pow(2, attempt - 1) + jitter, 10_000));
}
