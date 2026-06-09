/**
 * INDstocks low-level HTTP client.
 *
 * Thin, dependency-injectable wrapper over the documented INDstocks REST API
 * (https://api-docs.indstocks.com). It ONLY knows how to authenticate, build a
 * URL, perform a GET, and surface honest typed errors — it has no opinion about
 * trust tiers, validation or mapping (those live a layer up).
 *
 * Auth: the access token is passed RAW in the `Authorization` header (no
 * `Bearer` prefix), exactly as the INDstocks docs specify. Tokens expire every
 * 24h and live-trading requires static-IP whitelisting; that is the owner's
 * operational concern. This module never logs the token.
 *
 * The `fetchImpl` seam makes every method unit-testable with a fake fetch, so
 * the adapter can be fully exercised WITHOUT network access or real creds — the
 * provider stays disabled by default regardless.
 */

export interface IndstocksConfig {
  /** Base REST URL, no trailing slash. */
  baseUrl: string;
  /** Raw access token, or null when not configured. */
  token: string | null;
  /** Price-feed websocket URL. */
  wsUrl: string;
  /** Per-request timeout (ms). */
  timeoutMs: number;
}

export type FetchImpl = typeof fetch;

export type IndstocksErrorKind =
  | "config" // missing token / base url
  | "network" // fetch threw / timed out
  | "http" // non-2xx response
  | "payload"; // 2xx but status !== "success" or unparseable

export class IndstocksError extends Error {
  constructor(
    message: string,
    readonly kind: IndstocksErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IndstocksError";
  }
}

const DEFAULT_BASE = "https://api.indstocks.com";
const DEFAULT_WS = "wss://ws-prices.indstocks.com/api/v1/ws/prices";
const DEFAULT_TIMEOUT_MS = 8_000;

/** Resolve the INDstocks config from the environment (token is a secret). */
export function resolveIndstocksConfig(): IndstocksConfig {
  const base = (process.env["INDSTOCKS_API_BASE"] || DEFAULT_BASE).trim();
  const token = process.env["INDSTOCKS_API_TOKEN"]?.trim() || null;
  const ws = (process.env["INDSTOCKS_WS_URL"] || DEFAULT_WS).trim();
  const timeoutRaw = Number(process.env["INDSTOCKS_TIMEOUT_MS"]);
  return {
    baseUrl: base.replace(/\/+$/, ""),
    token,
    wsUrl: ws,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
  };
}

export type QueryParams = Record<string, string | number | undefined>;

export interface IndstocksClient {
  readonly config: IndstocksConfig;
  /** GET a JSON endpoint, returning `body.data` after asserting status==="success". */
  getJson<T>(path: string, params?: QueryParams): Promise<T>;
  /** GET a raw CSV endpoint (instrument master), returning the text body. */
  getCsv(path: string, params?: QueryParams): Promise<string>;
}

function buildUrl(baseUrl: string, path: string, params?: QueryParams): string {
  const url = new URL(baseUrl + (path.startsWith("/") ? path : `/${path}`));
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function withTimeout<T>(
  fetchImpl: FetchImpl,
  url: string,
  token: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: token, Accept: "*/*" },
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new IndstocksError(`INDstocks request failed: ${msg}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Construct a client. Reads env config + global fetch unless overridden. */
export function createIndstocksClient(opts?: {
  config?: Partial<IndstocksConfig>;
  fetchImpl?: FetchImpl;
}): IndstocksClient {
  const config: IndstocksConfig = { ...resolveIndstocksConfig(), ...(opts?.config ?? {}) };
  const fetchImpl = opts?.fetchImpl ?? fetch;

  function requireToken(): string {
    if (!config.token) {
      throw new IndstocksError(
        "INDstocks access token not configured (set INDSTOCKS_API_TOKEN).",
        "config",
      );
    }
    return config.token;
  }

  return {
    config,
    async getJson<T>(path: string, params?: QueryParams): Promise<T> {
      const token = requireToken();
      const url = buildUrl(config.baseUrl, path, params);
      const res = await withTimeout(fetchImpl, url, token, config.timeoutMs);
      if (!res.ok) {
        throw new IndstocksError(
          `INDstocks ${path} returned HTTP ${res.status}.`,
          "http",
          res.status,
        );
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new IndstocksError(`INDstocks ${path} returned non-JSON body.`, "payload", res.status);
      }
      const obj = body as { status?: string; data?: T; message?: string };
      if (!obj || obj.status !== "success" || obj.data === undefined) {
        throw new IndstocksError(
          `INDstocks ${path} status="${obj?.status ?? "?"}"${obj?.message ? ` (${obj.message})` : ""}.`,
          "payload",
          res.status,
        );
      }
      return obj.data;
    },
    async getCsv(path: string, params?: QueryParams): Promise<string> {
      const token = requireToken();
      const url = buildUrl(config.baseUrl, path, params);
      const res = await withTimeout(fetchImpl, url, token, config.timeoutMs);
      if (!res.ok) {
        throw new IndstocksError(
          `INDstocks ${path} returned HTTP ${res.status}.`,
          "http",
          res.status,
        );
      }
      return res.text();
    },
  };
}
