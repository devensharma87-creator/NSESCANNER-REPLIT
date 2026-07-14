/**
 * Priority 7 — Equity DD-Latch Route Integration Test.
 *
 * Proves that `GET /api/paper/eq/sizing-preview` correctly wires the
 * sticky equity drawdown latches (daily / weekly / monthly) from
 * `paperAccount.getEqXxxRealizedDrawdown()` through `readEquitySnapshot`
 * into `computeEquitySizingPreview`, and that DD rejection wins over
 * later gates in the helper's documented gate order:
 *
 *   1.  INVALID_STOP
 *   2.  STOP_SANITY
 *   3.  DD_DAILY     ◄── must fire before
 *   4.  DD_WEEKLY    ◄── must fire before
 *   5.  DD_MONTHLY   ◄── must fire before
 *   6.  DAILY_CAP
 *   7.  CONCURRENT_CAP
 *   8.  DEPLOY_LE_0
 *   9.  QTY_LT_1
 *   10. INSUFF_BAL
 *   11. HEAT_CAP
 *
 * Test-only file. The helper and the route are exercised as-is — no
 * runtime / trading / data-ingestion / schema / scheduler logic is
 * changed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks. The route file is exercised verbatim. Only its dependencies
// (`@workspace/db` for the snapshot reads + the 3 DD getters in
// `paperAccount`) are stubbed so we control the latch state per test.
// `equitySizingHelper` is NOT mocked — that is the unit we are
// validating end-to-end.
// ---------------------------------------------------------------------------

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => false,
  setPublicAccess: () => {},
  logPublicAccessBootState: () => {},
}));

// Fixed account snapshot returned by the route's two `db.execute` calls.
// First execute = SELECT FROM paper_account; second = SELECT FROM
// paper_trade_eq. Order is deterministic inside `readEquitySnapshot`.
type AccountFixture = {
  balance: number;
  day_trade_count: number;
  day_open_count: number;
  book_value: number;
  heat: number;
};

let acctFixture: AccountFixture = {
  balance: 1_000_000,
  day_trade_count: 0,
  day_open_count: 0,
  book_value: 0,
  heat: 0,
};

let executeCallIdx = 0;

function nextExecuteResult(): { rows: Array<Record<string, unknown>> } {
  // Cycle: account row → heat row → account row → heat row → ...
  // The route always reads them in this order per request.
  const which = executeCallIdx % 2;
  executeCallIdx += 1;
  if (which === 0) {
    return {
      rows: [
        {
          balance: acctFixture.balance,
          day_trade_count: acctFixture.day_trade_count,
          day_open_count: acctFixture.day_open_count,
        },
      ],
    };
  }
  return {
    rows: [{ book_value: acctFixture.book_value, heat: acctFixture.heat }],
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async () => nextExecuteResult()),
  },
  swingScanResultTable: { symbol: { name: "symbol" } },
}));

// DD latch state. Each test sets these before calling the route.
type DdReading = {
  realisedPnl: number;
  drawdownPct: number;
  capReached: boolean;
  capPct: number;
  windowStart: string;
};

const ddState: { daily: DdReading; weekly: DdReading; monthly: DdReading } = {
  daily:   { realisedPnl: 0, drawdownPct: 0, capReached: false, capPct: 0.02, windowStart: "2026-05-15" },
  weekly:  { realisedPnl: 0, drawdownPct: 0, capReached: false, capPct: 0.04, windowStart: "2026-05-11" },
  monthly: { realisedPnl: 0, drawdownPct: 0, capReached: false, capPct: 0.08, windowStart: "2026-05-01" },
};

vi.mock("../../lib/paperAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/paperAccount")>();
  return {
    ...actual,
    ensureDailyReset: vi.fn(async () => {}),
    getEqDailyRealizedDrawdown:   async () => ({ ...ddState.daily }),
    getEqWeeklyRealizedDrawdown:  async () => ({ ...ddState.weekly }),
    getEqMonthlyRealizedDrawdown: async () => ({ ...ddState.monthly }),
  };
});

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Imports come AFTER mocks so hoisting applies cleanly.
const equitySizingRouter = (await import("../equitySizing")).default;
const { computeEquitySizingPreview } = await import("../../lib/equitySizingHelper");

// ---------------------------------------------------------------------------
// HTTP harness — same cookie-signing pattern as Priority 6.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-priority-7";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

const OWNER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("owner"))}`;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());
  app.use("/api", equitySizingRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!res.headersSent) res.status(500).json({ error: "test_handler_threw" });
  });

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

beforeEach(() => {
  executeCallIdx = 0;
  acctFixture = {
    balance: 1_000_000,
    day_trade_count: 0,
    day_open_count: 0,
    book_value: 0,
    heat: 0,
  };
  ddState.daily   = { realisedPnl: 0, drawdownPct: 0, capReached: false, capPct: 0.02, windowStart: "2026-05-15" };
  ddState.weekly  = { realisedPnl: 0, drawdownPct: 0, capReached: false, capPct: 0.04, windowStart: "2026-05-11" };
  ddState.monthly = { realisedPnl: 0, drawdownPct: 0, capReached: false, capPct: 0.08, windowStart: "2026-05-01" };
});

interface PreviewBody {
  accountSnapshot: {
    balance: number;
    bookValue: number;
    openCount: number;
    dayTradeCount: number;
    currentHeat: number;
    ddDailyCapReached: boolean;
    ddWeeklyCapReached: boolean;
    ddMonthlyCapReached: boolean;
    ddDailyPct: number;
    ddWeeklyPct: number;
    ddMonthlyPct: number;
  };
  preview: {
    verdict: "ACCEPT" | "REJECT";
    reason: string | null;
    detail: string;
    qty: number;
  };
}

async function callPreview(symbol: string, entry: number, stop: number): Promise<{ status: number; body: PreviewBody }> {
  const url = `${baseUrl}/api/paper/eq/sizing-preview?symbol=${symbol}&entry=${entry}&stop=${stop}`;
  const res = await fetch(url, { headers: { cookie: OWNER_COOKIE } });
  return { status: res.status, body: (await res.json()) as PreviewBody };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P7 — sizing-preview route happy path (no DD, no caps)", () => {
  it("ACCEPTs a clean entry and surfaces the wire-through DD snapshot fields", async () => {
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.status).toBe(200);
    expect(r.body.preview.verdict).toBe("ACCEPT");
    expect(r.body.preview.reason).toBeNull();
    // Snapshot fields are propagated, defaults to false.
    expect(r.body.accountSnapshot.ddDailyCapReached).toBe(false);
    expect(r.body.accountSnapshot.ddWeeklyCapReached).toBe(false);
    expect(r.body.accountSnapshot.ddMonthlyCapReached).toBe(false);
  });
});

describe("P7 — DD latch causes the route to reject with the matching reason", () => {
  it("DD_DAILY: daily cap latched → preview.reason === 'DD_DAILY'", async () => {
    ddState.daily = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.status).toBe(200);
    expect(r.body.preview.verdict).toBe("REJECT");
    expect(r.body.preview.reason).toBe("DD_DAILY");
    // The detail string echoes the wire-through % (sanity that the
    // route forwarded ddDailyPct, not just the boolean flag).
    expect(r.body.preview.detail).toContain("2.50%");
    expect(r.body.accountSnapshot.ddDailyCapReached).toBe(true);
    expect(r.body.accountSnapshot.ddDailyPct).toBe(0.025);
  });

  it("DD_WEEKLY: weekly cap latched → preview.reason === 'DD_WEEKLY'", async () => {
    ddState.weekly = { realisedPnl: -45_000, drawdownPct: 0.045, capReached: true, capPct: 0.04, windowStart: "2026-05-11" };
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_WEEKLY");
    expect(r.body.preview.detail).toContain("4.50%");
    expect(r.body.accountSnapshot.ddWeeklyCapReached).toBe(true);
  });

  it("DD_MONTHLY: monthly cap latched → preview.reason === 'DD_MONTHLY'", async () => {
    ddState.monthly = { realisedPnl: -85_000, drawdownPct: 0.085, capReached: true, capPct: 0.08, windowStart: "2026-05-01" };
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_MONTHLY");
    expect(r.body.preview.detail).toContain("8.50%");
    expect(r.body.accountSnapshot.ddMonthlyCapReached).toBe(true);
  });
});

describe("P7 — gate ordering: DD latch wins over downstream gates", () => {
  it("DD_DAILY fires BEFORE DAILY_CAP even when both would trip", async () => {
    ddState.daily = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    acctFixture.day_trade_count = 99; // would otherwise trip DAILY_CAP
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_DAILY");
  });

  it("DD_DAILY fires BEFORE CONCURRENT_CAP even when both would trip", async () => {
    ddState.daily = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    acctFixture.day_open_count = 99; // would otherwise trip CONCURRENT_CAP
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_DAILY");
  });

  it("DD_WEEKLY fires BEFORE DAILY_CAP and CONCURRENT_CAP when daily not latched", async () => {
    ddState.weekly = { realisedPnl: -45_000, drawdownPct: 0.045, capReached: true, capPct: 0.04, windowStart: "2026-05-11" };
    acctFixture.day_trade_count = 99;
    acctFixture.day_open_count = 99;
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_WEEKLY");
  });

  it("DD_MONTHLY fires BEFORE DAILY_CAP and CONCURRENT_CAP when daily/weekly not latched", async () => {
    ddState.monthly = { realisedPnl: -85_000, drawdownPct: 0.085, capReached: true, capPct: 0.08, windowStart: "2026-05-01" };
    acctFixture.day_trade_count = 99;
    acctFixture.day_open_count = 99;
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_MONTHLY");
  });

  it("DD ordering among DD gates: when ALL THREE are latched, DD_DAILY wins (gate 3 < 4 < 5)", async () => {
    ddState.daily   = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    ddState.weekly  = { realisedPnl: -45_000, drawdownPct: 0.045, capReached: true, capPct: 0.04, windowStart: "2026-05-11" };
    ddState.monthly = { realisedPnl: -85_000, drawdownPct: 0.085, capReached: true, capPct: 0.08, windowStart: "2026-05-01" };
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_DAILY");
  });

  it("DD ordering: weekly+monthly latched, daily clear → DD_WEEKLY wins", async () => {
    ddState.weekly  = { realisedPnl: -45_000, drawdownPct: 0.045, capReached: true, capPct: 0.04, windowStart: "2026-05-11" };
    ddState.monthly = { realisedPnl: -85_000, drawdownPct: 0.085, capReached: true, capPct: 0.08, windowStart: "2026-05-01" };
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DD_WEEKLY");
  });

  it("DD latch fires BEFORE valid sizing acceptance (no DD → ACCEPT proves the latch is the only thing flipping it)", async () => {
    // Identical inputs to the happy-path test, with daily DD flipped on.
    ddState.daily = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    const rejected = await callPreview("RELIANCE", 2500, 2400);
    expect(rejected.body.preview.verdict).toBe("REJECT");
    expect(rejected.body.preview.reason).toBe("DD_DAILY");

    // Same inputs again, latch off — should ACCEPT (proves the only
    // thing that changed the verdict was the DD wire-through).
    ddState.daily = { realisedPnl: 0, drawdownPct: 0, capReached: false, capPct: 0.02, windowStart: "2026-05-15" };
    const accepted = await callPreview("RELIANCE", 2500, 2400);
    expect(accepted.body.preview.verdict).toBe("ACCEPT");
    expect(accepted.body.preview.qty).toBeGreaterThan(0);
  });
});

describe("P7 — gate ordering downstream of DD: DAILY_CAP < CONCURRENT_CAP at route level", () => {
  // With every DD latch cleared, prove the in-route gate sequence
  // continues correctly into gates 6 → 7. This locks the full chain
  // DD_DAILY < DD_WEEKLY < DD_MONTHLY < DAILY_CAP < CONCURRENT_CAP
  // end-to-end through the route handler.
  it("DAILY_CAP wins when both day_trade_count AND day_open_count are over their caps", async () => {
    acctFixture.day_trade_count = 99;
    acctFixture.day_open_count = 99;
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("DAILY_CAP");
  });

  it("CONCURRENT_CAP wins when only day_open_count is over its cap", async () => {
    acctFixture.day_trade_count = 0;
    acctFixture.day_open_count = 99;
    const r = await callPreview("RELIANCE", 2500, 2400);
    expect(r.body.preview.reason).toBe("CONCURRENT_CAP");
  });
});

describe("P7 — DD-cap gates fire AFTER stop sanity (gates 1-2 still take precedence)", () => {
  // This documents the full ordering invariant: DD must NOT shadow
  // INVALID_STOP / STOP_SANITY_TIGHT / STOP_SANITY_WIDE.
  it("INVALID_STOP wins even when DD_DAILY is latched", async () => {
    ddState.daily = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    const r = await callPreview("RELIANCE", 2500, 2600); // stop > entry
    expect(r.body.preview.reason).toBe("INVALID_STOP");
  });

  it("STOP_SANITY_TIGHT wins even when DD_DAILY is latched", async () => {
    ddState.daily = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    const r = await callPreview("RELIANCE", 2500, 2495); // 0.2% — < 1%
    expect(r.body.preview.reason).toBe("STOP_SANITY_TIGHT");
  });

  it("STOP_SANITY_WIDE wins even when DD_DAILY is latched", async () => {
    ddState.daily = { realisedPnl: -25_000, drawdownPct: 0.025, capReached: true, capPct: 0.02, windowStart: "2026-05-15" };
    const r = await callPreview("RELIANCE", 2500, 2200); // 12% — > 8%
    expect(r.body.preview.reason).toBe("STOP_SANITY_WIDE");
  });
});

describe("P7 — helper-level gate-ordering invariant (route-independent)", () => {
  // Belt-and-braces unit assertions on the helper itself, in case
  // a future refactor changes how the route composes the input.
  const baseInput = {
    symbol: "RELIANCE",
    entry: 2500,
    stop: 2400,
    balance: 1_000_000,
    bookValue: 0,
    openCount: 0,
    dayTradeCount: 0,
    currentHeat: 0,
  } as const;

  it("DD_DAILY fires before DAILY_CAP in the helper directly", () => {
    const r = computeEquitySizingPreview({
      ...baseInput,
      dayTradeCount: 99,
      ddDailyCapReached: true,
      ddDailyPct: 0.025,
    });
    expect(r.reason).toBe("DD_DAILY");
  });

  it("DD_DAILY fires before CONCURRENT_CAP in the helper directly", () => {
    const r = computeEquitySizingPreview({
      ...baseInput,
      openCount: 99,
      ddDailyCapReached: true,
      ddDailyPct: 0.025,
    });
    expect(r.reason).toBe("DD_DAILY");
  });

  it("DD_WEEKLY fires before DD_MONTHLY when both latched", () => {
    const r = computeEquitySizingPreview({
      ...baseInput,
      ddWeeklyCapReached: true,
      ddMonthlyCapReached: true,
      ddWeeklyPct: 0.045,
      ddMonthlyPct: 0.085,
    });
    expect(r.reason).toBe("DD_WEEKLY");
  });

  it("DD_DAILY fires before DD_WEEKLY when both latched", () => {
    const r = computeEquitySizingPreview({
      ...baseInput,
      ddDailyCapReached: true,
      ddWeeklyCapReached: true,
      ddDailyPct: 0.025,
      ddWeeklyPct: 0.045,
    });
    expect(r.reason).toBe("DD_DAILY");
  });
});
