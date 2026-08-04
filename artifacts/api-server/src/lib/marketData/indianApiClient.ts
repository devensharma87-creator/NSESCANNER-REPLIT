/**
 * IndianAPI low-level HTTP client.
 *
 * Implements transport for the IndianAPI fundamentals/reference-data service.
 *
 * ## Plan and host model (Gate A, 23B)
 *
 * IndianAPI uses per-plan subdomains.  The documented mapping is:
 *   FREE / HOBBY    → stock.indianapi.in
 *   DEVELOPER       → dev.indianapi.in
 *   GROWTH_ANALYST  → analyst.indianapi.in
 *   PRO             → pro.indianapi.in
 *
 * A configured base URL whose hostname does not exactly match the selected
 * plan host produces an INVALID_PROVIDER_CONFIG state.  The client makes
 * zero network calls in that state.
 *
 * ## Endpoint contract (Gate B, 23B)
 *
 * One canonical transport endpoint:
 *   GET /stock?name=<company-or-symbol>
 *
 * Profile and ratios are both extracted from the same /stock response.
 * The deprecated /stock_ratios path is not used.
 *
 * ## Authentication
 *   x-api-key: <key>   (server-side only — never exposed to clients)
 *
 * Pack 5 constraint: reference/fundamentals data only.  Not used for live
 * quotes, candles, option chains, or any trade-sensitive domain.
 */

export type FetchImpl = typeof fetch;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type IndianApiErrorKind =
  | "config"        // API key absent or INVALID_PROVIDER_CONFIG
  | "auth"          // 401 / 403
  | "not_found"     // 404
  | "rate_limit"    // 429 — transient; will be retried
  | "rate_limited"  // 429 — permanent within session (RATE_LIMITED capability state)
  | "server"        // 5xx
  | "timeout"
  | "network"
  | "payload";      // response schema invalid

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
// Plan / host model (Gate A, 23B)
// ---------------------------------------------------------------------------

/**
 * IndianAPI subscription plans.
 * Sourced from IndianAPI's public plan documentation (2026).
 */
export type IndianApiPlan =
  | "FREE"
  | "HOBBY"
  | "DEVELOPER"
  | "GROWTH_ANALYST"
  | "PRO";

/**
 * Authoritative plan → documented hostname mapping.
 * Only these hostnames are accepted.  Never use undocumented hosts.
 */
export const INDIANAPI_PLAN_HOST: Readonly<Record<IndianApiPlan, string>> = {
  FREE:           "stock.indianapi.in",
  HOBBY:          "stock.indianapi.in",
  DEVELOPER:      "dev.indianapi.in",
  GROWTH_ANALYST: "analyst.indianapi.in",
  PRO:            "pro.indianapi.in",
} as const;

/** Reverse map: documented hostname → canonical plan (first match wins). */
const HOST_TO_PLAN: Readonly<Record<string, IndianApiPlan>> = {
  "stock.indianapi.in":   "FREE",
  "dev.indianapi.in":     "DEVELOPER",
  "analyst.indianapi.in": "GROWTH_ANALYST",
  "pro.indianapi.in":     "PRO",
} as const;

/**
 * Detect plan from base URL hostname.
 * Returns the plan for known documented hosts, or null for unknown hosts.
 * Never silently maps an unknown host to a plan.
 */
export function detectIndianApiPlan(baseUrl: string): IndianApiPlan | null {
  try {
    const host = new URL(baseUrl).hostname;
    return HOST_TO_PLAN[host] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Configuration (Gate A security requirements)
// ---------------------------------------------------------------------------

export type IndianApiConfigState = "VALID" | "INVALID_PROVIDER_CONFIG";

export interface IndianApiConfig {
  baseUrl:      string;
  apiKey:       string | null;
  plan:         IndianApiPlan;
  configState:  IndianApiConfigState;
  /** Human-readable reason when configState === "INVALID_PROVIDER_CONFIG" (no secrets). */
  configError?: string;
  timeoutMs:    number;
  maxRetries:   number;
  retryBaseMs:  number;
}

const DEFAULT_PLAN:      IndianApiPlan = "FREE";
const DEFAULT_TIMEOUT    = 12_000;
const DEFAULT_RETRIES    = 1;
const DEFAULT_BASE_MS    = 1_000;

/**
 * Validate a base URL against the requirements of Gate A:
 *   - https only
 *   - no username/password credentials
 *   - hostname must exactly match expected plan host (no substring/regex)
 *   - no non-standard port
 *   - trailing slash normalised away
 */
function validateBaseUrl(
  rawUrl: string,
  expectedHost: string,
): { ok: true; normalised: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "INDIANAPI_BASE_URL is not a valid URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "INDIANAPI_BASE_URL must use https://." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "INDIANAPI_BASE_URL must not embed credentials (username/password)." };
  }
  // Exact hostname match — prevents subdomain-confusion attacks.
  if (parsed.hostname !== expectedHost) {
    // Expose the selected plan's expected host in diagnostics (not the key)
    return {
      ok: false,
      error: `INDIANAPI_BASE_URL hostname does not match the configured plan host (expected: ${expectedHost}).`,
    };
  }
  // Non-standard port check: empty string = default port; "443" = explicit but standard https
  const port = parsed.port;
  if (port !== "" && port !== "443") {
    return { ok: false, error: `Non-standard port (${port}) is not accepted.` };
  }
  return { ok: true, normalised: rawUrl.replace(/\/+$/, "") };
}

/**
 * Resolve IndianAPI configuration from environment variables.
 *
 *   INDIANAPI_PLAN        (default "FREE") — selects the plan and its documented host
 *   INDIANAPI_API_KEY     — authentication key; null → NOT_CONFIGURED (no startup crash)
 *   INDIANAPI_BASE_URL    — optional override; MUST exactly match the plan host or
 *                           configState becomes INVALID_PROVIDER_CONFIG
 *   INDIANAPI_TIMEOUT_MS  — optional timeout override
 *
 * Invalid plan or host → INVALID_PROVIDER_CONFIG with zero network calls.
 * No silent fallback.
 */
export function resolveIndianApiConfig(): IndianApiConfig {
  const key = process.env["INDIANAPI_API_KEY"]?.trim() || null;
  // Treat absent or empty string as "not set" → use default plan
  const rawPlanEnv = process.env["INDIANAPI_PLAN"]?.trim();
  const rawPlan: string = (rawPlanEnv && rawPlanEnv.length > 0)
    ? rawPlanEnv.toUpperCase()
    : DEFAULT_PLAN;
  const timeout = Number(process.env["INDIANAPI_TIMEOUT_MS"]);

  // Validate plan
  if (!(rawPlan in INDIANAPI_PLAN_HOST)) {
    return {
      baseUrl:     "https://stock.indianapi.in",
      apiKey:      key,
      plan:        DEFAULT_PLAN,
      configState: "INVALID_PROVIDER_CONFIG",
      configError: `INDIANAPI_PLAN value "${rawPlan}" is not a recognized plan. Valid values: FREE, HOBBY, DEVELOPER, GROWTH_ANALYST, PRO.`,
      timeoutMs:   DEFAULT_TIMEOUT,
      maxRetries:  DEFAULT_RETRIES,
      retryBaseMs: DEFAULT_BASE_MS,
    };
  }

  const plan         = rawPlan as IndianApiPlan;
  const expectedHost = INDIANAPI_PLAN_HOST[plan];
  const defaultBase  = `https://${expectedHost}`;

  const rawBase = process.env["INDIANAPI_BASE_URL"]?.trim();

  // If INDIANAPI_BASE_URL is set, validate it against the plan host
  if (rawBase) {
    const validation = validateBaseUrl(rawBase, expectedHost);
    if (!validation.ok) {
      return {
        baseUrl:     defaultBase, // diagnostics: show what the valid base WOULD be
        apiKey:      key,
        plan,
        configState: "INVALID_PROVIDER_CONFIG",
        configError: validation.error,
        timeoutMs:   DEFAULT_TIMEOUT,
        maxRetries:  DEFAULT_RETRIES,
        retryBaseMs: DEFAULT_BASE_MS,
      };
    }
    return {
      baseUrl:     validation.normalised,
      apiKey:      key,
      plan,
      configState: "VALID",
      timeoutMs:   Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
      maxRetries:  DEFAULT_RETRIES,
      retryBaseMs: DEFAULT_BASE_MS,
    };
  }

  // No INDIANAPI_BASE_URL — use plan default
  return {
    baseUrl:     defaultBase,
    apiKey:      key,
    plan,
    configState: "VALID",
    timeoutMs:   Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
    maxRetries:  DEFAULT_RETRIES,
    retryBaseMs: DEFAULT_BASE_MS,
  };
}

// ---------------------------------------------------------------------------
// Domain types for the /stock endpoint (Gate B, 23B)
// ---------------------------------------------------------------------------

/**
 * Company profile sub-fields from GET /stock?name={symbol}.
 * Fields absent in the response are preserved as null (never fabricated).
 * IndianAPI current_price / ltp fields are deliberately excluded from this
 * type — Kite remains the sole canonical live-price authority.
 */
export interface IndianApiStockProfile {
  companyName:  string | null;
  symbol:       string;
  isin:         string | null;
  sector:       string | null;
  industry:     string | null;
  marketCap:    number | null;
  currency:     string | null;
}

/**
 * Financial ratios sub-fields from GET /stock?name={symbol}.
 * Same response as profile — extracted by separate normalizer.
 */
export interface IndianApiStockRatios {
  symbol:        string;
  pe:            number | null;
  pb:            number | null;
  eps:           number | null;
  dividendYield: number | null;
  roe:           number | null;
  debtToEquity:  number | null;
  period:        string | null;
}

/**
 * Merged normalized output of a single GET /stock?name={symbol} call.
 * Both profile and ratios fields come from the same HTTP response.
 */
export interface IndianApiStockData {
  profile:      IndianApiStockProfile;
  ratios:       IndianApiStockRatios;
  /**
   * Provider-supplied as-of timestamp if present in the response.
   * null when the provider omits it — do not fabricate.
   */
  providerAsOf: string | null;
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface IndianApiClient {
  readonly config: IndianApiConfig;
  /**
   * GET /stock?name={symbol} — company profile + key metrics in one call.
   * Returned `IndianApiStockData` includes both profile and ratios sub-types.
   */
  getStock(symbol: string): Promise<IndianApiStockData>;
}

// ---------------------------------------------------------------------------
// Pure normalizers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extract safe finite number from an unknown value.
 * Rejects non-numbers, NaN, and ±Infinity.
 */
function safeNumber(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v))   return null;
  return v;
}

/**
 * Extract safe string (null if absent, non-string, or empty).
 */
function safeString(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

/** Extract stock profile fields from raw /stock response. */
export function extractStockProfile(
  raw: Record<string, unknown>,
  symbol: string,
): IndianApiStockProfile {
  return {
    companyName: safeString(raw["company_name"]) ?? safeString(raw["companyName"]),
    symbol,
    isin:        safeString(raw["isin"]),
    sector:      safeString(raw["sector"]),
    industry:    safeString(raw["industry"]),
    // Reject non-finite market caps
    marketCap:   safeNumber(raw["market_cap"]) ?? safeNumber(raw["marketCap"]),
    currency:    safeString(raw["currency"]) ?? "INR",
  };
}

/** Extract financial ratio fields from raw /stock response. */
export function extractStockRatios(
  raw: Record<string, unknown>,
  symbol: string,
): IndianApiStockRatios {
  return {
    symbol,
    pe:            safeNumber(raw["pe_ratio"]) ?? safeNumber(raw["pe"]),
    pb:            safeNumber(raw["pb_ratio"]) ?? safeNumber(raw["pb"]),
    eps:           safeNumber(raw["eps"]),
    dividendYield: safeNumber(raw["dividend_yield"]) ?? safeNumber(raw["dividendYield"]),
    roe:           safeNumber(raw["roe"]),
    debtToEquity:  safeNumber(raw["debt_to_equity"]) ?? safeNumber(raw["debtToEquity"]),
    period:        safeString(raw["reporting_period"]) ?? safeString(raw["period"]),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createIndianApiClient(
  opts: { config?: IndianApiConfig; fetchImpl?: FetchImpl } = {},
): IndianApiClient {
  const cfg    = opts.config ?? resolveIndianApiConfig();
  const _fetch: FetchImpl = opts.fetchImpl ?? globalThis.fetch;

  async function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    // Fail closed on INVALID_PROVIDER_CONFIG — zero network calls
    if (cfg.configState === "INVALID_PROVIDER_CONFIG") {
      throw new IndianApiError(
        `IndianAPI provider configuration is invalid (INVALID_PROVIDER_CONFIG). Check INDIANAPI_PLAN and INDIANAPI_BASE_URL.`,
        "config",
      );
    }

    if (!cfg.apiKey) {
      throw new IndianApiError("INDIANAPI_API_KEY not configured.", "config");
    }

    // Build URL with safe URLSearchParams encoding
    const url = new URL(`${cfg.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

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
        const kind    = isAbort ? "timeout" : "network";
        const msg     = isAbort
          ? `IndianAPI request timed out (${cfg.timeoutMs}ms).`
          : `IndianAPI network error: ${err instanceof Error ? err.message : String(err)}`;
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
        const raHdr       = Number(res.headers.get("Retry-After") ?? "10");
        const retryAfterMs = Number.isFinite(raHdr) ? raHdr * 1000 : 10_000;
        if (attempt >= maxAttempts) {
          throw new IndianApiError("IndianAPI rate limited.", "rate_limit", 429, retryAfterMs);
        }
        await delay(retryAfterMs);
        continue;
      }
      if (res.status >= 500) {
        if (attempt >= maxAttempts) {
          throw new IndianApiError(`IndianAPI server error: HTTP ${res.status}.`, "server", res.status);
        }
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
      if (body == null || typeof body !== "object" || Array.isArray(body)) {
        throw new IndianApiError("IndianAPI: response body is not a JSON object.", "payload", res.status);
      }
      return body as T;
    }
    throw new IndianApiError("IndianAPI: exhausted retries.", "network");
  }

  async function getStock(symbol: string): Promise<IndianApiStockData> {
    const raw = await request<Record<string, unknown>>("/stock", { name: symbol });
    return {
      profile:     extractStockProfile(raw, symbol),
      ratios:      extractStockRatios(raw, symbol),
      providerAsOf: safeString(raw["timestamp"]) ?? safeString(raw["as_of"]) ?? safeString(raw["asOf"]) ?? null,
    };
  }

  return { config: cfg, getStock };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
