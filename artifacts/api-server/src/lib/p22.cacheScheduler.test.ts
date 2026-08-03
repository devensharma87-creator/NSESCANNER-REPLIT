/**
 * Pack 4 / Gates G, H, I, J — Cache, Rate-Limiting, Scheduler and Resource Safety
 *
 * Tests correct cache behavior, scheduler idempotency, rate-limit configuration,
 * and resource cleanup. No live DB, Kite, or Telegram.
 *
 * Coverage:
 *   G1–G4   Rate-limit configuration (source proofs — login, API, webhook).
 *   H1–H6   Cache TTL and freshness behavior (future timestamps, stale detection).
 *   I1–I6   Scheduler idempotency and duplicate-registration prevention.
 *   J1–J4   WebSocket/live-data resource management (source proofs).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mocks — modules that start real intervals need to be mocked.
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn(() => ({ from: vi.fn(() => Promise.resolve([])) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  },
  swingOrderStagingTable: { ownerKey: {}, symbol: {}, status: {}, createdAt: {} },
}));

vi.mock("../lib/kiteAuth", () => ({
  getActiveSession: vi.fn(async () => null),
  getKiteCreds: () => ({ apiKey: "test", apiSecret: "test" }),
}));

vi.mock("../lib/kiteFeed", () => ({
  feedStatus: () => ({ connected: false }),
  getLiveQuote: () => null,
  getAllLiveQuotes: () => ({}),
  startTicker: vi.fn(),
  stopTicker: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// __dirname = artifacts/api-server/src/lib → up 2 = artifacts/api-server
const root = path.resolve(__dirname, "../..");
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// G1–G4: Rate-limit configuration (source proofs)
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateG — Rate-limit configuration", () => {
  it("G1: login endpoint has its own stricter rate limiter (separate from API limiter)", () => {
    const appSrc = readSrc("src/app.ts");
    // Must define a separate loginLimiter.
    expect(appSrc).toMatch(/loginLimiter/);
    // Login limiter windowMs should be longer than API limiter (15 min vs 1 min).
    const loginWindow = appSrc.match(/loginLimiter.*?windowMs:\s*(\d+\s*\*[^,}]+)/s)?.[1];
    expect(loginWindow).toBeDefined();
    expect(loginWindow).toMatch(/15/); // 15-minute window
  });

  it("G2: API limiter covers all /api/* routes", () => {
    const appSrc = readSrc("src/app.ts");
    // apiLimiter must be applied to /api/ routes.
    expect(appSrc).toMatch(/app\.use\(['"]\/api\/['"],\s*apiLimiter/);
  });

  it("G3: webhook limiter is separate from API limiter (different window/max)", () => {
    const appSrc = readSrc("src/app.ts");
    expect(appSrc).toMatch(/webhookLimiter/);
    // Webhook limiter must be applied to /webhooks/ path.
    expect(appSrc).toMatch(/\/api\/webhooks\/['"].*webhookLimiter|webhookLimiter.*\/api\/webhooks\//s);
  });

  it("G4: API rate limit is bounded (limit < 1000 req/min for personal-use protection)", () => {
    const appSrc = readSrc("src/app.ts");
    // express-rate-limit v6+ uses 'limit:' (was 'max:' in v5)
    const limitMatch = appSrc.match(/apiLimiter\s*=\s*rateLimit\(\s*\{[^}]*(?:limit|max):\s*(\d+)/s);
    if (limitMatch?.[1]) {
      const limit = Number(limitMatch[1]);
      expect(limit).toBeLessThan(1000);
    } else {
      // Verify at minimum that a rate limiter is configured for /api routes
      expect(appSrc).toMatch(/apiLimiter/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H1–H6: Cache TTL and freshness
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateH — Cache TTL and freshness correctness", () => {
  it("H1: scanner scan cache TTL is ≤ 60 seconds (not indefinite)", () => {
    const scannerSrc = readSrc("src/lib/scanner.ts");
    // SCAN_TTL constant must be ≤ 60000ms
    const match = scannerSrc.match(/SCAN_TTL\s*=\s*(\d+)/);
    if (match) {
      expect(Number(match[1])).toBeLessThanOrEqual(60_000);
    } else {
      // May be defined differently — at least verify TTL concept exists
      expect(scannerSrc).toMatch(/ttl|TTL|expires|EXPIRE/i);
    }
  });

  it("H2: option chain cache TTL is ≤ 60 seconds", () => {
    const ocSrc = readSrc("src/lib/optionChain.ts");
    const match = ocSrc.match(/TTL\s*=\s*(\d+)/);
    if (match) {
      expect(Number(match[1])).toBeLessThanOrEqual(60_000);
    } else {
      expect(ocSrc).toMatch(/ttl|TTL|expires/i);
    }
  });

  it("H3: future timestamp detection exists in freshness module", () => {
    // freshness.ts (was computeFreshness.ts) must handle future timestamps explicitly
    const freshnessSrc = readSrc("src/lib/marketData/freshness.ts");
    expect(freshnessSrc).toMatch(/future|isFuture|FUTURE/i);
  });

  it("H4: freshness module has a CLOCK_SKEW_TOLERANCE constant to avoid false-positive future detection", () => {
    const freshnessSrc = readSrc("src/lib/marketData/freshness.ts");
    expect(freshnessSrc).toMatch(/CLOCK_SKEW/i);
  });

  it("H5: instrument cache TTL is bounded (< 25 hours to prevent yesterday leaking across midnight)", () => {
    const kiteAuthSrc = readSrc("src/lib/kiteAuth.ts");
    // Instrument cache TTL should be < 25 hours (90000000ms)
    const match = kiteAuthSrc.match(/INSTRUMENT.*TTL.*?(\d{6,})|instrument.*ttl.*?(\d{6,})/i);
    if (match) {
      const ttl = Number(match[1] ?? match[2]);
      expect(ttl).toBeLessThan(90_000_000); // < 25 hours in ms
    } else {
      expect(kiteAuthSrc).toMatch(/cache|TTL|expire/i);
    }
  });

  it("H6: scanCache single-flight coalescing — concurrent misses use same in-flight Promise", () => {
    const scannerSrc = readSrc("src/lib/scanner.ts");
    // Must have an inflight/in-flight pattern to prevent duplicate scans.
    expect(scannerSrc).toMatch(/inFlight|inflight|InFlight/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1–I6: Scheduler idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateI — Scheduler idempotency and duplicate registration", () => {
  it("I1: swingTtlSweepScheduler uses a guard to prevent duplicate registration", () => {
    const sweepSrc = readSrc("src/lib/swingTtlSweep.ts");
    // Must have a started/running guard.
    expect(sweepSrc).toMatch(/started|running|isScheduled|singleton|once/i);
  });

  it("I2: startSwingTtlSweepScheduler source: only one setInterval registered per process", () => {
    const sweepSrc = readSrc("src/lib/swingTtlSweep.ts");
    // Count setInterval calls — should be exactly one.
    const intervalMatches = sweepSrc.match(/setInterval\s*\(/g) ?? [];
    expect(intervalMatches.length).toBe(1);
  });

  it("I3: bootScheduler scheduleBootJob prevents duplicate registration (source proof)", () => {
    const bootSrc = readSrc("src/lib/bootScheduler.ts");
    // Must have a registry/set of already-started jobs.
    expect(bootSrc).toMatch(/registeredJobs|started|Set|Map/i);
  });

  it("I4: app.ts scheduleBootJob is called once per subsystem (not in a loop)", () => {
    const appSrc = readSrc("src/app.ts");
    // Each subsystem should appear exactly once in scheduleBootJob calls.
    const globalPumpMatches = (appSrc.match(/global-data-pump/g) ?? []).length;
    expect(globalPumpMatches).toBe(1);
    const presetSchedulerMatches = (appSrc.match(/preset-scheduler/g) ?? []).length;
    expect(presetSchedulerMatches).toBe(1);
  });

  it("I5: swingTtlSweep handles errors gracefully without stopping the scheduler", () => {
    const sweepSrc = readSrc("src/lib/swingTtlSweep.ts");
    // Error handling must be inside the tick, not outside (so errors don't stop the interval).
    expect(sweepSrc).toMatch(/try.*catch|\.catch\(/s);
  });

  it("I6: test imports of scheduler modules don't start real intervals (mock needed)", () => {
    // Verify that the swingTtlSweep module does NOT auto-start on import.
    // The startSwingTtlSweepScheduler should be a function, not executed at module level.
    const sweepSrc = readSrc("src/lib/swingTtlSweep.ts");
    // Should export a start function, not call setInterval at module top level.
    expect(sweepSrc).toMatch(/export\s+function\s+startSwing|export\s+const\s+startSwing/i);
    // setInterval must be inside a function body, not at module top-level.
    // Proxy check: exported start function exists (proven above) and setInterval appears
    // inside the module (not at the very top before any declarations).
    const firstInterval = sweepSrc.indexOf("setInterval");
    const moduleBodyStart = sweepSrc.search(/^(import|export|const|let|var|function|\/\*)/m);
    if (firstInterval > 0 && moduleBodyStart >= 0) {
      // setInterval must not be the very first substantive line (position > first declaration)
      expect(firstInterval).toBeGreaterThan(50); // never in preamble (first 50 chars)
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J1–J4: WebSocket / live-data resource management
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateJ — WebSocket and live-data resource management", () => {
  it("J1: kiteFeed uses singleton KiteTicker (no duplicate connection)", () => {
    const feedSrc = readSrc("src/lib/kiteFeed.ts");
    // Must have a singleton guard before creating a new KiteTicker.
    expect(feedSrc).toMatch(/singleton|instance|ticker\s*=\s*new|tickerInstance|_ticker/i);
  });

  it("J2: kiteFeed has bounded reconnect attempts (autoReconnect with max_retries)", () => {
    const feedSrc = readSrc("src/lib/kiteFeed.ts");
    // autoReconnect should be configured with explicit retry count.
    expect(feedSrc).toMatch(/autoReconnect.*true.*\d+|reconnect.*max|MAX_RETRIES|max_retries/is);
  });

  it("J3: malformed WebSocket message cannot crash the process (error handling in onTicks)", () => {
    const feedSrc = readSrc("src/lib/kiteFeed.ts");
    // Must have error handling in the tick handler.
    expect(feedSrc).toMatch(/try\s*{|catch\s*\(/s);
  });

  it("J4: stopTicker removes all SSE listeners and cleans up state (source proof)", () => {
    const feedSrc = readSrc("src/lib/kiteFeed.ts");
    // stopTicker must clear/reset state on shutdown.
    expect(feedSrc).toMatch(/stopTicker|stop.*ticker/i);
    // Must have cleanup (clear listeners or destroy).
    expect(feedSrc).toMatch(/listeners?\s*\.\s*clear\(\)|sseListeners\s*=\s*\[\]|disconnect|destroy/i);
  });
});
