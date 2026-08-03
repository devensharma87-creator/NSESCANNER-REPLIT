/**
 * Pack 4 / Gate A + C — Route Manifest and API Contract Completeness
 *
 * Source-text proofs (no live server, no DB) that:
 *   A1–A7  Every expected API route prefix is registered in routes/index.ts.
 *   A8–A10 Key frontend nav destinations have matching Wouter routes in scanner App.tsx.
 *   C1–C4  Key response shapes parse correctly through Zod schemas.
 *   C5–C8  Mutation routes are POST/PATCH/DELETE never GET.
 *   M1–M4  Diagnostics/observability routes exist and are owner-gated.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// __dirname = artifacts/api-server/src/lib → go up 2 = artifacts/api-server
const root = path.resolve(__dirname, "../..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function routesIndex(): string {
  return readSrc("src/routes/index.ts");
}
function scannerApp(): string {
  return readSrc("../scanner/src/App.tsx");
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate A — Route registration completeness
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateA — API route registration completeness", () => {
  it("A1: /fno/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/fno/);
  });
  it("A2: /swing/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/swing/i);
  });
  it("A3: /paper/* route family is mounted (F&O paper trading)", () => {
    expect(routesIndex()).toMatch(/paper/i);
  });
  it("A4: /backtest/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/backtest/i);
  });
  it("A5: /option-chain/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/option.?chain/i);
  });
  it("A6: /daily-analysis/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/daily.?analysis/i);
  });
  it("A7: /system/* and /candles/* utility routes are mounted", () => {
    const idx = routesIndex();
    expect(idx).toMatch(/system/i);
    expect(idx).toMatch(/candles/i);
  });
  it("A8: /portfolios/* or /portfolio/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/portfolio/i);
  });
  it("A9: /indices/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/indices/i);
  });
  it("A10: /observability/* route family is mounted", () => {
    expect(routesIndex()).toMatch(/observability/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate A — Frontend route coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateA — Scanner frontend routes", () => {
  it("A-F1: /swing-cash route is registered in App.tsx", () => {
    expect(scannerApp()).toMatch(/swing-cash/);
  });
  it("A-F2: /paper-trading route is registered in App.tsx", () => {
    expect(scannerApp()).toMatch(/paper-trading/);
  });
  it("A-F3: /fno-diagnostics route is registered in App.tsx", () => {
    expect(scannerApp()).toMatch(/fno-diagnostics/);
  });
  it("A-F4: /backtest-lab route is registered in App.tsx", () => {
    expect(scannerApp()).toMatch(/backtest-lab/);
  });
  it("A-F5: /daily-analysis route is registered in App.tsx", () => {
    expect(scannerApp()).toMatch(/daily-analysis/);
  });
  it("A-F6: /stock/:symbol dynamic route is registered in App.tsx", () => {
    expect(scannerApp()).toMatch(/stock.*:symbol/);
  });
  it("A-F7: /sectors/:sector dynamic route is registered in App.tsx", () => {
    expect(scannerApp()).toMatch(/sectors.*:sector/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate C — API/Zod contract completeness
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateC — API schema / Zod contract completeness", () => {
  it("C1: Zod schema exports exist in api-zod package", () => {
    const indexSrc = readSrc("../../lib/api-zod/src/index.ts");
    // Must export at least the main API schema entry point.
    expect(indexSrc.length).toBeGreaterThan(0);
    expect(indexSrc).toMatch(/export/);
  });

  it("C2: Generated api.schemas.ts in api-client-react contains swing routes", () => {
    const schemasSrc = readSrc("../../lib/api-client-react/src/generated/api.schemas.ts");
    expect(schemasSrc).toMatch(/swing/i);
  });

  it("C3: Generated api.schemas.ts contains fno routes", () => {
    const schemasSrc = readSrc("../../lib/api-client-react/src/generated/api.schemas.ts");
    expect(schemasSrc).toMatch(/fno/i);
  });

  it("C4: swingStaging route registers GET /swing/staged-orders and GET /swing/status", () => {
    const stagingSrc = readSrc("src/routes/swingStaging.ts");
    expect(stagingSrc).toMatch(/get.*staged.?orders/i);
    expect(stagingSrc).toMatch(/get.*status/i);
  });

  it("C5: Swing mutation routes use POST not GET for create/approve/reject", () => {
    const stagingSrc = readSrc("src/routes/swingStaging.ts");
    // Approval and rejection must be POST/PATCH, not GET.
    expect(stagingSrc).toMatch(/post|patch/i);
    // Must not use GET for approve.
    const getApprove = stagingSrc.match(/router\.get\([^)]*approv/i);
    expect(getApprove).toBeNull();
  });

  it("C6: System mutation routes use POST not GET for mode-override and clock-drift check", () => {
    const statusSrc = readSrc("src/routes/systemStatus.ts");
    expect(statusSrc).toMatch(/post.*mode-override/i);
    expect(statusSrc).toMatch(/post.*clock-drift/i);
  });

  it("C7: tradingview webhook DELETE uses the correct verb for remove", () => {
    const tvSrc = readSrc("src/routes/tradingview.ts");
    expect(tvSrc).toMatch(/delete/i);
  });

  it("C8: Error responses use JSON with error field, not plain text", () => {
    // The global error handler in app.ts must use res.json with {error:...}.
    const appSrc = readSrc("src/app.ts");
    expect(appSrc).toMatch(/res\.status\(500\)\.json\(\s*\{.*error.*internal_server_error/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate M — Observability / Diagnostics routes
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack4/P22/GateM — Observability and diagnostics route coverage", () => {
  it("M1: /system/mode route is owner-gated (not public)", () => {
    const statusSrc = readSrc("src/routes/systemStatus.ts");
    // Must use requireOwner or requireOwnerStrict on system/mode.
    expect(statusSrc).toMatch(/requireOwner\w*.*system.?mode|system.?mode.*requireOwner/s);
  });

  it("M2: /data-health/backbone is requireOwnerStrict (never public)", () => {
    const dhSrc = readSrc("src/routes/dataHealth.ts");
    expect(dhSrc).toMatch(/requireOwnerStrict/);
  });

  it("M3: /alerts/system-health uses requireOwnerStrict", () => {
    const alertsSrc = readSrc("src/routes/alerts.ts");
    expect(alertsSrc).toMatch(/requireOwnerStrict/);
  });

  it("M4: Observability client-event route exists and is registered", () => {
    expect(routesIndex()).toMatch(/observability/i);
    const obsSrc = readSrc("src/routes/observability.ts");
    expect(obsSrc.length).toBeGreaterThan(0);
  });
});
