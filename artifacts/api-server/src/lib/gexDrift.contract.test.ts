/**
 * Sprint 3 Phase G — GEX Formula Drift Contract Test
 *
 * Proves that the frontend (oi-lab.tsx) GEX computation formula matches the
 * backend (gex.ts) formula in text, unit model, and sign convention.
 *
 * This test exists because Phase F introduced an inline frontend GEX compute
 * function (`computeGexFromStrikes`) that mirrors the backend `computeGexPerStrike`.
 * Any future change to either side must update both — this test will break if
 * they drift.
 *
 * ACCEPTED RATIONALE for frontend computation:
 *   - GEX is a MODELLED value for UI-only display
 *   - NOT used for signal generation, paper trading, or risk sizing
 *   - Frontend computation avoids extra API call and works with shared state
 *   - Backend gex.ts remains the canonical source of truth for any future
 *     server-side GEX usage
 *
 * FUTURE IMPROVEMENT: Move GEX calculation into backend DTO / shared helper
 *   if GEX is ever needed outside the OI Lab UI context.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const backendSrc = fs.readFileSync(
  path.resolve(__dirname, "gex.ts"),
  "utf-8"
);

const uiSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"),
  "utf-8"
);

const frontendGex = uiSrc.slice(
  uiSrc.indexOf("function computeGexFromStrikes("),
  uiSrc.indexOf("function fmtGex(")
);

// ── 1. Formula text alignment ───────────────────────────────────────────────
describe("GEX Formula Drift — Formula alignment", () => {
  it("backend uses spot * spot * 0.01", () => {
    expect(backendSrc).toContain("spot * spot * 0.01");
  });

  it("frontend uses spot * spot * 0.01", () => {
    expect(frontendGex).toContain("spot * spot * 0.01");
  });

  it("backend call GEX = gamma × effectiveQty × spotSqPct", () => {
    expect(backendSrc).toContain("row.ce.gamma * effectiveQty * spotSqPct");
  });

  it("frontend call GEX = gamma × (OI × lotSize) × spotSqPct", () => {
    expect(frontendGex).toContain("s.ceGamma * (s.ceOi * lotSize) * spotSqPct");
  });

  it("backend put GEX is negated", () => {
    expect(backendSrc).toContain("-(row.pe.gamma * effectiveQty * spotSqPct)");
  });

  it("frontend put GEX is negated", () => {
    expect(frontendGex).toContain("-(s.peGamma * (s.peOi * lotSize) * spotSqPct)");
  });
});

// ── 2. Sign convention alignment ────────────────────────────────────────────
describe("GEX Formula Drift — Sign convention", () => {
  it("backend: call GEX positive (no negation)", () => {
    // Backend assigns callGex without negation
    expect(backendSrc).toContain("callGex = row.ce.gamma");
  });

  it("backend: put GEX negative (negated)", () => {
    expect(backendSrc).toContain("putGex = -(row.pe.gamma");
  });

  it("frontend: call GEX positive (cGex = ..., no negation)", () => {
    expect(frontendGex).toContain("cGex = s.ceGamma");
  });

  it("frontend: put GEX negative (pGex = -(...))", () => {
    expect(frontendGex).toContain("pGex = -(s.peGamma");
  });
});

// ── 3. Unit model alignment ────────────────────────────────────────────────
describe("GEX Formula Drift — Unit model", () => {
  it("backend uses OI × lotSize via normalizeOiToQuantity", () => {
    expect(backendSrc).toContain("normalizeOiToQuantity(rawOI, openInterestUnit, lotSize)");
  });

  it("frontend uses OI × lotSize directly", () => {
    // Frontend inline: s.ceOi * lotSize (equivalent to normalizeOiToQuantity for contracts)
    expect(frontendGex).toContain("s.ceOi * lotSize");
    expect(frontendGex).toContain("s.peOi * lotSize");
  });

  it("backend normalizeOiToQuantity for contracts = rawOI × lotSize", () => {
    expect(backendSrc).toContain("return rawOI * lotSize;");
  });

  it("both require lotSize > 0", () => {
    expect(backendSrc).toContain("lotSize <= 0");
    expect(frontendGex).toContain("lotSize <= 0");
  });

  it("both require spot > 0", () => {
    expect(backendSrc).toContain("spot <= 0");
    expect(frontendGex).toContain("spot <= 0");
  });
});

// ── 4. Missing data guard alignment ────────────────────────────────────────
describe("GEX Formula Drift — Missing data guards", () => {
  it("both return null when no gamma available", () => {
    expect(backendSrc).toContain("if (!hasAnyGamma) return null");
    expect(frontendGex).toContain("if (!hasAnyGamma) return null");
  });

  it("both return null when spot invalid", () => {
    expect(backendSrc).toContain("if (!Number.isFinite(spot)");
    expect(frontendGex).toContain("if (!Number.isFinite(spot)");
  });

  it("both return null when no rows/strikes", () => {
    expect(backendSrc).toContain("rows.length === 0");
    expect(frontendGex).toContain("!strikes.length");
  });

  it("both check gamma > 0 before computing", () => {
    expect(backendSrc).toContain("row.ce.gamma > 0");
    expect(frontendGex).toContain("s.ceGamma > 0");
    expect(backendSrc).toContain("row.pe.gamma > 0");
    expect(frontendGex).toContain("s.peGamma > 0");
  });

  it("both check OI > 0 before computing", () => {
    expect(backendSrc).toContain("rawOI > 0");
    expect(frontendGex).toContain("s.ceOi > 0");
    expect(frontendGex).toContain("s.peOi > 0");
  });
});

// ── 5. Flip point alignment ────────────────────────────────────────────────
describe("GEX Formula Drift — Flip point", () => {
  it("both compute flip point from cumulative netGex sign change", () => {
    expect(backendSrc).toContain("cumGex");
    expect(frontendGex).toContain("cum");
  });

  it("both use linear interpolation", () => {
    expect(backendSrc).toContain("Math.abs(cumGex) / Math.abs(newCum - cumGex)");
    expect(frontendGex).toContain("Math.abs(cum) / Math.abs(newCum - cum)");
  });
});

// ── 6. MODELLED label alignment ────────────────────────────────────────────
describe("GEX Formula Drift — Modelled label", () => {
  it("backend marks as modelled", () => {
    expect(backendSrc).toContain("modelled: true");
  });

  it("frontend UI shows MODELLED badge", () => {
    expect(uiSrc).toContain("MODELLED GEX — not exchange provided");
  });

  it("backend label explicitly says not exchange-verified", () => {
    expect(backendSrc).toContain("not exchange-verified");
  });
});

// ── 7. Safety constraints ──────────────────────────────────────────────────
describe("GEX Formula Drift — Safety constraints", () => {
  it("backend comment: NOT used for paper-trade gate", () => {
    expect(backendSrc).toContain("NOT used for: paper-trade gate");
  });

  it("frontend UI: NOT for signal / paper trade / risk sizing", () => {
    expect(uiSrc).toContain("NOT for signal / paper trade / risk sizing");
  });
});
