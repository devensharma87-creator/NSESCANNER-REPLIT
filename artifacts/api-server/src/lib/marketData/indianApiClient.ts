/**
 * IndianAPI low-level HTTP client.
 *
 * Implements transport for the IndianAPI fundamentals/reference-data service.
 * Authentication: `x-api-key` header (server-side only — never exposed to clients).
 * Base URL: configurable via INDIANAPI_BASE_URL.
 *
 * Pack 5 constraint: reference/fundamentals data only. Not used for live quotes,
 * candles, option chains, or any trade-sensitive domain. All capabilities are
 * marked NOT_CONFIGURED until credentials are present.
 *
 * The `fetchImpl` seam allows full unit-testing without live credentials.
 */

export type FetchImpl = typeof fetch;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type IndianApiErrorKind =
  | "config"      // API key absent
  | "auth"        // 401 / 403
  | "not_found"   // 404
  | "rate_limit"  // 429
  | "server"      // 5xx
  | "timeout"
  | "network"
  | "payload";    // response schema invalid

export class IndianApiError extends Error {
  constructor(
    message: string,
    readonly kind: IndianApiErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "IndianApiError";
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface IndianApiConfig {
  baseUrl:     string;
  apiKey:      string | null;
  timeoutMs:   number;
  maxRetries:  number;
  retryBaseMs: number;
}

const DEFAULT_BASE     = "https://api.indianapi.in";
const DEFAULT_TIMEOUT  = 12_000;
const DEFAULT_RETRIES  = 1;
const DEFAULT_BASE_MS  = 1_000;

export function resolveIndianApiConfig(): IndianApiConfig {
  const key  = process.env["INDIANAPI_API_KEY"]?.trim() || null;
  const base = (process.env["INDIANAPI_BASE_URL"] || DEFAULT_BASE).replace(/\/+$/, "");
  const timeout = Number(process.env["INDIANAPI_TIMEOUT_MS"]);
  return {
    baseUrl:     base,
    apiKey:      key,
    timeoutMs:   Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
    maxRetries:  DEFAULT_RETRIES,
    retryBaseMs: DEFAULT_BASE_MS,
  };
}

// ---------------------------------------------------------------------------
// Domain types for contracted IndianAPI endpoints
// ---------------------------------------------------------------------------

/** Company profile — confirmed endpoint: GET /stock?name={symbol} */
export interface IndianApiStockProfile {
  companyName:      string | null;
  symbol:           string;
  isin:             string | null;
  sector:           string | null;
  industry:         string | null;
  marketCap:        number | null;
  /** Currency of reported values, e.g. "INR" */
  currency:         string | null;
}

/** Financial ratios — confirmed endpoint: GET /stock_ratios?name={symbol} */
export interface IndianApiStockRatios {
  symbol:           string;
  pe:               number | null;
  pb:               number | null;
  eps:              number | null;
  dividendYield:    number | null;
  roe:              number | null;
  debtToEquity:     number | null;
  /** Reporting period context, e.g. "TTM" */
  period:           string | null;
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface IndianApiClient {
  readonly config: IndianApiConfig;
  /** GET /stock?name={symbol} — company profile */
  getStockProfile(symbol: string): Promise<IndianApiStockProfile>;
  /** GET /stock_ratios?name={symbol} — financial ratios */
  getStockRatios(symbol: string): Promise<IndianApiStockRatios>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createIndianApiClient(
  opts: { config?: IndianApiConfig; fetchImpl?: FetchImpl } = {},
): IndianApiClient {
  const cfg   = opts.config ?? resolveIndianApiConfig();
  const _fetch: FetchImpl = opts.fetchImpl ?? globalThis.fetch;

  async function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    if (!cfg.apiKey) {
      throw new IndianApiError("INDIANAPI_API_KEY not configured.", "config");
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
            "x-api-key": cfg.apiKey,
            Accept:      "application/json",
          },
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const isAbort = err instanceof Error && err.name === "AbortError";
        const kind = isAbort ? "timeout" : "network";
        const msg  = isAbort ? `IndianAPI request timed out (${cfg.timeoutMs}ms).` : `IndianAPI network error: ${err instanceof Error ? err.message : String(err)}`;
        if (attempt >= maxAttempts) throw new IndianApiError(msg, kind);
        await delay(Math.min(cfg.retryBaseMs * Math.pow(2, attempt - 1) + Math.random() * cfg.retryBaseMs, 8_000));
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 401 || res.status === 403) {
        throw new IndianApiError(`IndianAPI auth error: HTTP ${res.status}.`, "auth", res.status);
      }
      if (res.status === 404) {
        throw new IndianApiError("IndianAPI: resource not found.", "not_found", 404);
      }
      if (res.status === 429) {
        const raHdr = Number(res.headers.get("Retry-After") ?? "10");
        const retryAfterMs = Number.isFinite(raHdr) ? raHdr * 1000 : 10_000;
        if (attempt >= maxAttempts) throw new IndianApiError("IndianAPI rate limited.", "rate_limit", 429, retryAfterMs);
        await delay(retryAfterMs);
        continue;
      }
      if (res.status >= 500) {
        if (attempt >= maxAttempts) throw new IndianApiError(`IndianAPI server error: HTTP ${res.status}.`, "server", res.status);
        await delay(Math.min(cfg.retryBaseMs * Math.pow(2, attempt - 1) + Math.random() * cfg.retryBaseMs, 8_000));
        continue;
      }
      if (!res.ok) {
        throw new IndianApiError(`IndianAPI unexpected HTTP ${res.status}.`, "server", res.status);
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new IndianApiError("IndianAPI: response is not valid JSON.", "payload", res.status);
      }
      if (body == null || typeof body !== "object") {
        throw new IndianApiError("IndianAPI: response body is not an object.", "payload", res.status);
      }
      return body as T;
    }
    throw new IndianApiError("IndianAPI: exhausted retries.", "network");
  }

  async function getStockProfile(symbol: string): Promise<IndianApiStockProfile> {
    const raw = await request<Record<string, unknown>>("/stock", { name: symbol });
    return {
      companyName:  typeof raw["companyName"] === "string" ? raw["companyName"] : null,
      symbol,
      isin:         typeof raw["isin"]         === "string" ? raw["isin"]         : null,
      sector:       typeof raw["sector"]        === "string" ? raw["sector"]        : null,
      industry:     typeof raw["industry"]      === "string" ? raw["industry"]      : null,
      marketCap:    typeof raw["marketCap"]     === "number" ? raw["marketCap"]     : null,
      currency:     typeof raw["currency"]      === "string" ? raw["currency"]      : "INR",
    };
  }

  async function getStockRatios(symbol: string): Promise<IndianApiStockRatios> {
    const raw = await request<Record<string, unknown>>("/stock_ratios", { name: symbol });
    return {
      symbol,
      pe:             typeof raw["pe"]             === "number" ? raw["pe"]             : null,
      pb:             typeof raw["pb"]             === "number" ? raw["pb"]             : null,
      eps:            typeof raw["eps"]            === "number" ? raw["eps"]            : null,
      dividendYield:  typeof raw["dividendYield"]  === "number" ? raw["dividendYield"]  : null,
      roe:            typeof raw["roe"]            === "number" ? raw["roe"]            : null,
      debtToEquity:   typeof raw["debtToEquity"]   === "number" ? raw["debtToEquity"]   : null,
      period:         typeof raw["period"]         === "string" ? raw["period"]         : null,
    };
  }

  return { config: cfg, getStockProfile, getStockRatios };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
