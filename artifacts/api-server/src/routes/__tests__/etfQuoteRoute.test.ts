/**
 * ETF live-quote endpoint — GET /etf/:symbol/quote
 *
 * Locks in the honest contract of the lightweight ETF quote branch so a future
 * change can't silently break it or fabricate a price:
 *
 *   1. Recognised ETF (curated seed) + quote available  → 200 with a real price.
 *   2. Recognised ETF (seed) + Kite offline             → 503 KITE_OFFLINE.
 *   3. Genuinely-unknown non-ETF symbol                 → 404.
 *   4. Data-driven ETF (NOT in the seed) detected from the live Kite
 *      instrument master                                → 200.
 *
 * Strategy: the REAL `kiteScanner` helpers (`isRecognisedEtf`,
 * `loadKiteNseEqInstruments`, `loadKiteEtfQuote`) run end-to-end. The only
 * mocked seam is the Kite REST client (`getRestClient` in `kiteAuth`) — toggled
 * online/offline and fed a fixed instrument master + quote map. This means the
 * data-driven ETF-detection logic is genuinely exercised, not stubbed.
 *
 * Strict scope: no DB, no scoring/trading/scheduler/schema/workflow changes.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — wired BEFORE the route module import.
// ---------------------------------------------------------------------------

// Controllable Kite client. `online=false` → getRestClient returns null, which
// the lib treats as "Kite offline" (never a fabricated price).
const kiteState = {
  online: true,
  // Raw NSE instrument-master rows. ALPHAETF is the data-driven (non-seed) ETF;
  // RELIANCE is a plain equity that must NOT be recognised as an ETF.
  instruments: [
    { instrument_token: 1, exchange_token: 1, tradingsymbol: "ALPHAETF", name: "Alpha Nifty ETF", exchange: "NSE", segment: "NSE", instrument_type: "EQ" },
    { instrument_token: 2, exchange_token: 2, tradingsymbol: "NIFTYBEES", name: "Nippon Nifty BeES", exchange: "NSE", segment: "NSE", instrument_type: "EQ" },
    { instrument_token: 3, exchange_token: 3, tradingsymbol: "RELIANCE", name: "RELIANCE INDUSTRIES LIMITED", exchange: "NSE", segment: "NSE", instrument_type: "EQ" },
  ] as unknown[],
  // Quote map keyed by Kite's "NSE:SYMBOL" form.
  quotes: {
    "NSE:NIFTYBEES": {
      instrument_token: 2,
      last_price: 250.5,
      volume: 120000,
      average_price: 249.8,
      buy_quantity: 5000,
      sell_quantity: 4000,
      ohlc: { open: 248, high: 252, low: 247.5, close: 249 },
    },
    "NSE:ALPHAETF": {
      instrument_token: 1,
      last_price: 110.25,
      volume: 50000,
      ohlc: { open: 109, high: 111, low: 108.5, close: 108.75 },
    },
  } as Record<string, unknown>,
};

const getRestClientMock = vi.fn(async () => {
  if (!kiteState.online) return null;
  return {
    kc: {
      getInstruments: async (_exchange: string | string[]) => kiteState.instruments,
      getQuote: async (keys: string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          if (kiteState.quotes[k]) out[k] = kiteState.quotes[k];
        }
        return out;
      },
    },
    session: { kiteUserId: "TEST", accessToken: "x", loginAt: Date.now() },
  };
});

vi.mock("../../lib/kiteAuth", () => ({
  getRestClient: getRestClientMock,
}));

// Silence pino.
vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Prevent the route module's top-level `startFullNseScannerBackground()` from
// actually starting a background scanner during the test.
vi.mock("../../lib/fullNseScanner", () => ({
  startFullNseScannerBackground: () => {},
  scanFullNse: vi.fn(),
  getFullNseStatus: vi.fn(() => ({})),
  getAllScannedRows: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
const scannerRouter = (await import("../scanner")).default;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/", scannerRouter);
  app.use(
    (
      _err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (!res.headersSent) res.status(500).json({ error: "test_handler_threw" });
    },
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function getEtf(symbol: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/etf/${encodeURIComponent(symbol)}/quote`, { method: "GET" });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { _raw: text };
    }
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
describe("GET /etf/:symbol/quote", () => {
  it("case 1: recognised seed ETF + quote available → 200 with a real price", async () => {
    kiteState.online = true;
    const r = await getEtf("NIFTYBEES");
    expect(r.status).toBe(200);
    expect(r.body["symbol"]).toBe("NIFTYBEES");
    expect(r.body["instrumentType"]).toBe("ETF");
    expect(r.body["exchange"]).toBe("NSE");
    // Real price echoed from the mocked Kite quote (round2 applied).
    expect(r.body["price"]).toBe(250.5);
    expect(r.body["previousClose"]).toBe(249);
    expect(typeof r.body["changePercent"]).toBe("number");
    expect(typeof r.body["updatedAt"]).toBe("string");
  });

  it("case 2: recognised seed ETF + Kite offline → 503 KITE_OFFLINE (no fabricated price)", async () => {
    kiteState.online = false;
    const r = await getEtf("NIFTYBEES");
    expect(r.status).toBe(503);
    expect(r.body["code"]).toBe("KITE_OFFLINE");
    // Never ships a price field on the offline path.
    expect(r.body).not.toHaveProperty("price");
    kiteState.online = true;
  });

  it("case 3: genuinely-unknown non-ETF symbol → 404", async () => {
    kiteState.online = true;
    const r = await getEtf("RELIANCE");
    expect(r.status).toBe(404);
    expect(r.body).not.toHaveProperty("price");
  });

  it("case 4: data-driven (non-seed) ETF detected from the instrument master → 200", async () => {
    kiteState.online = true;
    // ALPHAETF is NOT in ETF_WHITELIST — recognition must come from the live
    // Kite instrument master (looksLikeEtf over the raw rows).
    const r = await getEtf("ALPHAETF");
    expect(r.status).toBe(200);
    expect(r.body["symbol"]).toBe("ALPHAETF");
    expect(r.body["instrumentType"]).toBe("ETF");
    expect(r.body["price"]).toBe(110.25);
    expect(r.body["name"]).toBe("Alpha Nifty ETF");
  });
});
