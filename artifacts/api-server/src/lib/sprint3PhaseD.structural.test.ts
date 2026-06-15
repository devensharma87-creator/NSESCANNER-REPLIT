/**
 * Sprint 3 Phase D — Professional Option Chain Table Foundation
 * Structural tests verifying the OptionChainTab component in oi-lab.tsx.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"),
  "utf-8"
);

// Helper: extract entire Phase D section (helpers + component)
const phaseDSection = uiSrc.slice(
  uiSrc.indexOf("// OPTION CHAIN TAB"),
  uiSrc.indexOf("// ─── GEX placeholder")
);
// Narrower: just the OptionChainTab component body
const chainSection = uiSrc.slice(
  uiSrc.indexOf("function OptionChainTab("),
  uiSrc.indexOf("// ─── GEX placeholder")
);

// ── 1. Component existence & shared state ───────────────────────────────────
describe("Phase D — OptionChainTab component exists", () => {
  it("OptionChainTab function is defined", () => {
    expect(uiSrc).toContain("function OptionChainTab(");
  });

  it("receives shared state as prop", () => {
    expect(chainSection).toContain("{ shared }: { shared: SharedOiState }");
  });

  it("parent passes shared state to OptionChainTab", () => {
    expect(uiSrc).toContain("<OptionChainTab shared={shared}");
  });

  it("does NOT call useOiInsights independently", () => {
    expect(chainSection).not.toContain("useOiInsights()");
  });

  it("does NOT own independent underlying state", () => {
    expect(chainSection).not.toContain('useState("NIFTY")');
    expect(chainSection).not.toContain("useState<string | undefined>");
  });

  it("does NOT fetch data independently", () => {
    expect(chainSection).not.toContain("api/options/oi-lab/insights/");
    expect(chainSection).not.toContain("api/options/oi-lab/universe");
  });

  it("destructures data/loading/error from shared state", () => {
    expect(chainSection).toContain("const { data, loading, error } = shared");
  });
});

// ── 2. Table layout ─────────────────────────────────────────────────────────
describe("Phase D — Table layout", () => {
  it("has a <table> element", () => {
    expect(chainSection).toContain("<table");
  });

  it("has CALLS section header", () => {
    expect(chainSection).toContain("CALLS");
  });

  it("has PUTS section header", () => {
    expect(chainSection).toContain("PUTS");
  });

  it("has STRIKE column header", () => {
    expect(chainSection).toContain("Strike");
  });

  it("call / strike / put three-section layout", () => {
    // Use the header group row labels which are on single lines
    const callsIdx = chainSection.indexOf("CALLS");
    const strikeComment = chainSection.indexOf("{/* Strike column");
    const putsIdx = chainSection.indexOf("{/* Put columns");
    expect(callsIdx).toBeGreaterThan(-1);
    expect(strikeComment).toBeGreaterThan(-1);
    expect(putsIdx).toBeGreaterThan(-1);
    expect(callsIdx).toBeLessThan(strikeComment);
    expect(strikeComment).toBeLessThan(putsIdx);
  });
});

// ── 3. Sticky positioning ───────────────────────────────────────────────────
describe("Phase D — Sticky header & strike column", () => {
  it("thead has sticky top-0 positioning", () => {
    expect(chainSection).toContain("sticky top-0");
  });

  it("strike column has sticky left positioning", () => {
    expect(chainSection).toContain('position: "sticky", left: 0');
  });

  it("table has horizontal overflow support", () => {
    expect(chainSection).toContain("overflow-auto");
  });
});

// ── 4. Row highlights ───────────────────────────────────────────────────────
describe("Phase D — ATM & Max Pain row highlights", () => {
  it("ATM row has amber highlight", () => {
    expect(chainSection).toContain("bg-amber-500/10");
    expect(chainSection).toContain("border-amber-500/30");
  });

  it("Max Pain row has orange highlight", () => {
    expect(chainSection).toContain("bg-orange-500/");
    expect(chainSection).toContain("border-orange-500/");
  });

  it("ATM strike has ATM label", () => {
    expect(chainSection).toContain(">ATM<");
  });

  it("Max Pain strike has MP label", () => {
    expect(chainSection).toContain(">MP<");
  });

  it("row hover effect", () => {
    expect(chainSection).toContain("hover:bg-zinc-800/50");
  });
});

// ── 5. ITM/OTM visual separation ────────────────────────────────────────────
describe("Phase D — ITM/OTM visual separation", () => {
  it("Call ITM has green tint", () => {
    expect(chainSection).toContain("bg-green-500/5");
  });

  it("Put ITM has red tint", () => {
    expect(chainSection).toContain("bg-red-500/5");
  });

  it("uses spot > strike for call ITM", () => {
    expect(chainSection).toContain("spot > r.strike");
  });

  it("uses spot < strike for put ITM", () => {
    expect(chainSection).toContain("spot < r.strike");
  });
});

// ── 6. Missing value rendering ──────────────────────────────────────────────
describe("Phase D — Missing values render as —", () => {
  it("em-dash for missing values in chain component", () => {
    // Count occurrences of "—" in the OptionChainTab section
    const dashCount = (chainSection.match(/\u2014/g) || []).length;
    expect(dashCount).toBeGreaterThanOrEqual(5);
  });

  it("safeNum returns — for null", () => {
    expect(uiSrc).toContain('function safeNum(v: number | null | undefined');
    // The function body returns "—" for null
    const safeNumFn = uiSrc.slice(
      uiSrc.indexOf("function safeNum("),
      uiSrc.indexOf("function oiChgPct(")
    );
    expect(safeNumFn).toContain('"—"');
  });

  it("fmtCompact returns — for null", () => {
    const fmtFn = uiSrc.slice(
      uiSrc.indexOf("function fmtCompact("),
      uiSrc.indexOf("function safeNum(")
    );
    expect(fmtFn).toContain('"—"');
  });

  it("oiChgPct returns — when denominator invalid", () => {
    const fn = uiSrc.slice(
      uiSrc.indexOf("function oiChgPct("),
      uiSrc.indexOf("function volOi(")
    );
    expect(fn).toContain("prevOi <= 0");
    expect(fn).toContain('"—"');
  });

  it("volOi returns — when OI <= 0", () => {
    const fn = uiSrc.slice(
      uiSrc.indexOf("function volOi("),
      uiSrc.indexOf("function intrinsic(")
    );
    expect(fn).toContain("oi <= 0");
    expect(fn).toContain('"—"');
  });

  it("intrinsic can return 0 legitimately (not —)", () => {
    const fn = uiSrc.slice(
      uiSrc.indexOf("function intrinsic("),
      uiSrc.indexOf("function timeValue(")
    );
    expect(fn).toContain("Math.max(0,");
    // Returns null only when spot invalid, not when intrinsic is 0
    expect(fn).toContain("return null");
  });

  it("timeValue returns — when LTP missing", () => {
    const fn = uiSrc.slice(
      uiSrc.indexOf("function timeValue("),
      uiSrc.indexOf("const BUILDUP_MAP")
    );
    expect(fn).toContain("ltp <= 0");
    expect(fn).toContain('"—"');
  });

  it("timeValue warns when negative", () => {
    const fn = uiSrc.slice(
      uiSrc.indexOf("function timeValue("),
      uiSrc.indexOf("const BUILDUP_MAP")
    );
    expect(fn).toContain("tv < 0");
    expect(fn).toContain("⚠");
  });
});

// ── 7. Buildup badges ───────────────────────────────────────────────────────
describe("Phase D — Buildup badges", () => {
  it("BUILDUP_MAP contains all 5 types", () => {
    expect(phaseDSection).toContain("LONG_BUILDUP");
    expect(phaseDSection).toContain("SHORT_BUILDUP");
    expect(phaseDSection).toContain("SHORT_COVERING");
    expect(phaseDSection).toContain("LONG_UNWINDING");
    expect(phaseDSection).toContain("NEUTRAL");
  });

  it("compact labels defined (LB/SB/SC/LU/N)", () => {
    expect(phaseDSection).toContain('"LB"');
    expect(phaseDSection).toContain('"SB"');
    expect(phaseDSection).toContain('"SC"');
    expect(phaseDSection).toContain('"LU"');
    expect(phaseDSection).toContain('"N"');
  });

  it("BuildupBadge component has tooltip", () => {
    expect(phaseDSection).toContain("title={m.full}");
  });

  it("BuildupBadge renders — for missing buildup", () => {
    const fn = phaseDSection.slice(
      phaseDSection.indexOf("function BuildupBadge("),
      phaseDSection.indexOf("function GreekCell(")
    );
    expect(fn).toContain(">—<");
  });
});

// ── 8. Greeks display ───────────────────────────────────────────────────────
describe("Phase D — Greeks honest display", () => {
  it("GreekCell component exists", () => {
    expect(phaseDSection).toContain("function GreekCell(");
  });

  it("GreekCell returns — for null", () => {
    const fn = phaseDSection.slice(
      phaseDSection.indexOf("function GreekCell("),
      phaseDSection.indexOf("function chgColor(")
    );
    expect(fn).toContain(">—<");
  });

  it("does not fake Greeks", () => {
    expect(phaseDSection).not.toContain("fakeDelta");
    expect(phaseDSection).not.toContain("fakeGamma");
    expect(phaseDSection).not.toContain("fakeTheta");
    expect(phaseDSection).not.toContain("fakeVega");
  });

  it("does not fake IV", () => {
    expect(phaseDSection).not.toContain("fakeIv");
    expect(phaseDSection).not.toContain("estimatedIv");
  });

  it("does not contain GEX", () => {
    expect(chainSection).not.toContain("gex");
    expect(chainSection).not.toContain("GEX");
    // Exception: BUILDUP_MAP and comments may contain uppercase
    // but the table columns should not have a GEX column
    expect(chainSection).not.toContain("GEX per");
  });

  it("hasGreeks checks data availability", () => {
    expect(chainSection).toContain("hasGreeks");
    expect(chainSection).toContain("r.ceDelta != null");
  });
});

// ── 9. Data columns ─────────────────────────────────────────────────────────
describe("Phase D — Required columns present", () => {
  it("LTP column header", () => {
    expect(chainSection).toContain(">LTP<");
  });

  it("IV column header", () => {
    expect(chainSection).toContain(">IV%<");
  });

  it("OI column header", () => {
    expect(chainSection).toContain(">OI<");
  });

  it("OI Change column header", () => {
    expect(chainSection).toContain(">OIΔ<");
  });

  it("OI Change % column header", () => {
    expect(chainSection).toContain(">OIΔ%<");
  });

  it("Volume column header", () => {
    expect(chainSection).toContain(">Vol<");
  });

  it("Vol/OI column header", () => {
    expect(chainSection).toContain(">V/OI<");
  });

  it("Intrinsic column header", () => {
    expect(chainSection).toContain(">Int<");
  });

  it("Time Value column header", () => {
    expect(chainSection).toContain(">TV<");
  });

  it("Buildup column header", () => {
    expect(chainSection).toContain(">Bld<");
  });

  it("Greek column headers when available", () => {
    expect(chainSection).toContain(">Δ<");
    expect(chainSection).toContain(">Γ<");
    expect(chainSection).toContain(">Θ<");
  });
});

// ── 10. Source / provenance badges ──────────────────────────────────────────
describe("Phase D — Source & stale badges", () => {
  it("shows spotSource badge", () => {
    expect(chainSection).toContain("data.spotSource");
  });

  it("shows spotTrusted warning", () => {
    expect(chainSection).toContain("UNTRUSTED");
    expect(chainSection).toContain("spotTrusted === false");
  });

  it("shows SYNTH FUTURE MODELLED badge", () => {
    expect(chainSection).toContain("SYNTH FUTURE");
    expect(chainSection).toContain("MODELLED");
  });

  it("shows source in footer", () => {
    expect(chainSection).toContain("data.source");
  });

  it("shows timestamp in footer", () => {
    expect(chainSection).toContain("data.generatedAt");
  });
});

// ── 11. No Yahoo ────────────────────────────────────────────────────────────
describe("Phase D — No Yahoo in option chain", () => {
  it("OptionChainTab does not reference Yahoo", () => {
    expect(chainSection.toLowerCase()).not.toContain("yahoo");
  });

  it("OptionChainTab does not import from Yahoo module", () => {
    expect(chainSection).not.toContain("fetchChart");
    expect(chainSection).not.toContain("yahooChart");
  });
});

// ── 12. Performance ─────────────────────────────────────────────────────────
describe("Phase D — Performance", () => {
  it("uses useMemo for derived rows", () => {
    expect(chainSection).toContain("useMemo(");
  });

  it("memoizes intrinsic/TV/OIΔ%/VolOI calculations", () => {
    expect(chainSection).toContain("ceIntrinsic: ceIntrin");
    expect(chainSection).toContain("ceOiChgPct: oiChgPct(");
    expect(chainSection).toContain("ceVolOi: volOi(");
    expect(chainSection).toContain("ceTv: timeValue(");
  });
});

// ── 13. Sprint 1/2/3 regression ─────────────────────────────────────────────
describe("Phase D — Sprint 1/2/3 infrastructure not disturbed", () => {
  it("OverviewTab still receives shared state", () => {
    expect(uiSrc).toContain("<OverviewTab shared={shared}");
  });

  it("PcrTab still receives shared state", () => {
    expect(uiSrc).toContain("<PcrTab shared={shared}");
  });

  it("MaxPainTab still receives shared state", () => {
    expect(uiSrc).toContain("<MaxPainTab shared={shared}");
  });

  it("InsightsTab still receives shared state", () => {
    expect(uiSrc).toContain("<InsightsTab shared={shared}");
  });

  it("GexPlaceholder still exists", () => {
    expect(uiSrc).toContain("function GexPlaceholder(");
  });

  it("MultiOiTab still exists", () => {
    expect(uiSrc).toContain("function MultiOiTab(");
  });

  it("no Yahoo import in OI Lab", () => {
    const importSection = uiSrc.slice(0, uiSrc.indexOf("export default"));
    expect(importSection.toLowerCase()).not.toContain("yahoo");
  });
});
