/**
 * Sprint 3 Phase F — Option Chain Functional Completion + GEX Honest Visualization
 * Structural tests for totals row, ATM basis, GEX tab, Greek source indicator.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"),
  "utf-8"
);

// OptionChainTab component body
const chainSection = uiSrc.slice(
  uiSrc.indexOf("function OptionChainTab("),
  uiSrc.indexOf("// ─── GEX Tab")
);

// GEX section: from GEX Tab header to Snapshot tab
const gexSection = uiSrc.slice(
  uiSrc.indexOf("// ─── GEX Tab"),
  uiSrc.indexOf("// ─── Snapshot tab")
);

// ── 1. Totals row rendering ────────────────────────────────────────────────
describe("Phase F — Totals row rendering", () => {
  it("totals computation exists (memoized)", () => {
    expect(chainSection).toContain("const totals = useMemo(");
  });

  it("computes total Call OI", () => {
    expect(chainSection).toContain("tCeOi += r.ceOi");
  });

  it("computes total Put OI", () => {
    expect(chainSection).toContain("tPeOi += r.peOi");
  });

  it("computes total Call OI Change", () => {
    expect(chainSection).toContain("tCeOiChg += r.ceOiChg");
  });

  it("computes total Put OI Change", () => {
    expect(chainSection).toContain("tPeOiChg += r.peOiChg");
  });

  it("computes total Call Volume", () => {
    expect(chainSection).toContain("tCeVol += r.ceVolume");
  });

  it("computes total Put Volume", () => {
    expect(chainSection).toContain("tPeVol += r.peVolume");
  });

  it("computes PCR OI", () => {
    expect(chainSection).toContain("pcrOi = tCeOi > 0 ? +(tPeOi / tCeOi)");
  });

  it("computes PCR Volume", () => {
    expect(chainSection).toContain("pcrVol = tCeVol > 0 ? +(tPeVol / tCeVol)");
  });

  it("computes Net OI Difference", () => {
    expect(chainSection).toContain("netOiDiff = tPeOi - tCeOi");
  });

  it("computes Net OI Change Difference", () => {
    expect(chainSection).toContain("netOiChgDiff = tPeOiChg - tCeOiChg");
  });

  it("totals row JSX exists", () => {
    expect(chainSection).toContain("const totalsRow =");
  });

  it("totals row shows TOTAL label", () => {
    // JSX renders the text content with newlines around it
    expect(chainSection).toContain("TOTAL");
    expect(chainSection).toContain("totalsRow");
  });

  it("totals row shows PCR in strike column", () => {
    expect(chainSection).toContain("PCR:");
    expect(chainSection).toContain("totals.pcrOi");
  });

  it("totals row shows total CE OI", () => {
    expect(chainSection).toContain("fmtOi(totals.tCeOi)");
  });

  it("totals row shows total PE OI", () => {
    expect(chainSection).toContain("fmtOi(totals.tPeOi)");
  });

  it("totals row shows CE/PE OI Change", () => {
    expect(chainSection).toContain("totals.tCeOiChg");
    expect(chainSection).toContain("totals.tPeOiChg");
  });

  it("totals row shows CE/PE Volume", () => {
    expect(chainSection).toContain("totals.tCeVol");
    expect(chainSection).toContain("totals.tPeVol");
  });
});

// ── 2. Totals position top/bottom ───────────────────────────────────────────
describe("Phase F — Totals position setting", () => {
  it("totals row renders at top when setting is top", () => {
    expect(chainSection).toContain('settings.totalsPos === "top" && totalsRow');
  });

  it("totals row renders at bottom when setting is bottom", () => {
    expect(chainSection).toContain('settings.totalsPos === "bottom" && totalsRow');
  });
});

// ── 3. Totals summary bar ───────────────────────────────────────────────────
describe("Phase F — Totals summary bar", () => {
  it("shows visible strikes count", () => {
    expect(chainSection).toContain("visible strikes");
  });

  it("shows PCR OI in summary", () => {
    expect(chainSection).toContain("PCR (OI)");
  });

  it("shows PCR Volume when available", () => {
    expect(chainSection).toContain("PCR (Vol)");
  });

  it("shows Net OI Diff", () => {
    expect(chainSection).toContain("Net OI Diff");
  });

  it("shows Net OI Chg Diff", () => {
    expect(chainSection).toContain("Net OI Chg Diff");
  });
});

// ── 4. ATM basis runtime ────────────────────────────────────────────────────
describe("Phase F — ATM basis runtime effect", () => {
  it("atmBasisPrice computed from settings", () => {
    expect(chainSection).toContain("const atmBasisPrice = useMemo(");
  });

  it("uses future price when basis is future and available", () => {
    expect(chainSection).toContain('settings.atmBasis === "future" && futureAvailable');
    expect(chainSection).toContain("data.futurePrice!");
  });

  it("uses synthetic future when basis is synth and available", () => {
    expect(chainSection).toContain('settings.atmBasis === "synth" && synthAvailable');
    expect(chainSection).toContain("data.syntheticFuture!");
  });

  it("falls back to spot when unavailable", () => {
    expect(chainSection).toContain("return spot; // fallback to spot");
  });

  it("atmBasisLabel computed correctly", () => {
    expect(chainSection).toContain('"ATM by Future"');
    expect(chainSection).toContain('"ATM by Synth Future"');
    expect(chainSection).toContain('"ATM by Spot"');
  });

  it("resolvedAtmStrike computed from nearest strike", () => {
    expect(chainSection).toContain("const resolvedAtmStrike = useMemo(");
  });

  it("ATM badge shown in header", () => {
    expect(chainSection).toContain("{atmBasisLabel}");
  });

  it("table rows use resolvedAtmStrike", () => {
    expect(chainSection).toContain("r.strike === resolvedAtmStrike");
  });

  it("header shows resolvedAtmStrike", () => {
    expect(chainSection).toContain("{resolvedAtmStrike}");
  });
});

// ── 5. Greek source indicator ───────────────────────────────────────────────
describe("Phase F — Greek source indicator", () => {
  it("greekSourceLabel defined", () => {
    expect(chainSection).toContain("const greekSourceLabel =");
  });

  it("shows 'Greeks Available' when present", () => {
    expect(chainSection).toContain('"Greeks Available"');
  });

  it("shows 'Greeks Unavailable' when missing", () => {
    expect(chainSection).toContain('"Greeks Unavailable"');
  });

  it("badge uses green for available, zinc for unavailable", () => {
    expect(chainSection).toContain("border-green-500/30 text-green-300");
    expect(chainSection).toContain("border-zinc-500/30 text-zinc-400");
  });
});

// ── 6. GEX Tab structure ────────────────────────────────────────────────────
describe("Phase F — GEX Tab structure", () => {
  it("GexTab function defined", () => {
    expect(gexSection).toContain("function GexTab(");
  });

  it("GexTab accepts shared state", () => {
    expect(gexSection).toContain("{ shared }: { shared: SharedOiState }");
  });

  it("GEX tab wired in OiLab with shared", () => {
    expect(uiSrc).toContain("<GexTab shared={shared} />");
  });

  it("GexPlaceholder still exists for backward compat", () => {
    expect(uiSrc).toContain("function GexPlaceholder()");
  });

  it("computeGexFromStrikes function defined", () => {
    expect(gexSection).toContain("function computeGexFromStrikes(");
  });

  it("fmtGex formatter defined", () => {
    expect(gexSection).toContain("function fmtGex(");
  });
});

// ── 7. GEX computation ─────────────────────────────────────────────────────
describe("Phase F — GEX computation", () => {
  it("uses approved formula: gamma × OI × lotSize × spot² × 0.01", () => {
    expect(gexSection).toContain("spot * spot * 0.01");
  });

  it("call GEX is positive", () => {
    expect(gexSection).toContain("s.ceGamma * (s.ceOi * lotSize) * spotSqPct");
  });

  it("put GEX is negative", () => {
    expect(gexSection).toContain("-(s.peGamma * (s.peOi * lotSize) * spotSqPct)");
  });

  it("returns null when no gamma available", () => {
    expect(gexSection).toContain("if (!hasAnyGamma) return null");
  });

  it("returns null when spot invalid", () => {
    expect(gexSection).toContain("if (!Number.isFinite(spot) || spot <= 0) return null");
  });

  it("returns null when lotSize invalid", () => {
    expect(gexSection).toContain("if (lotSize == null || !Number.isFinite(lotSize) || lotSize <= 0) return null");
  });

  it("returns null when no strikes", () => {
    expect(gexSection).toContain("if (!strikes.length) return null");
  });

  it("computes flip point", () => {
    expect(gexSection).toContain("flipPoint");
  });

  it("finds top positive GEX strike", () => {
    expect(gexSection).toContain("topPositive");
    expect(gexSection).toContain("topPos");
  });

  it("finds top negative GEX strike", () => {
    expect(gexSection).toContain("topNegative");
    expect(gexSection).toContain("topNeg");
  });
});

// ── 8. GEX unavailable states ───────────────────────────────────────────────
describe("Phase F — GEX unavailable states", () => {
  it("shows unavailable reason", () => {
    expect(gexSection).toContain('data-testid="gex-unavailable-reason"');
    expect(gexSection).toContain("GEX unavailable —");
  });

  it("checks for missing spot", () => {
    expect(gexSection).toContain("Spot price unavailable");
  });

  it("checks for missing lot size", () => {
    expect(gexSection).toContain("Lot size unavailable");
  });

  it("checks for missing gamma", () => {
    expect(gexSection).toContain("Gamma values unavailable");
  });

  it("checks for no strikes", () => {
    expect(gexSection).toContain("No strikes available");
  });

  it("checks for no data", () => {
    expect(gexSection).toContain("No option chain data loaded");
  });

  it("unavailable state does NOT show fake chart", () => {
    // The unavailable branch must not contain BarChart
    const unavailBranch = gexSection.slice(
      gexSection.indexOf("GEX unavailable — honest"),
      gexSection.indexOf("GEX available — summary")
    );
    expect(unavailBranch).not.toContain("BarChart");
    expect(unavailBranch).not.toContain("ResponsiveContainer");
  });
});

// ── 9. GEX MODELLED badge ───────────────────────────────────────────────────
describe("Phase F — GEX MODELLED badge", () => {
  it("shows MODELLED GEX badge when calculated", () => {
    expect(gexSection).toContain('data-testid="gex-modelled-badge"');
    expect(gexSection).toContain("MODELLED GEX — not exchange provided");
  });

  it("footer says NOT for signal / paper trade / risk sizing", () => {
    expect(gexSection).toContain("NOT for signal / paper trade / risk sizing");
  });
});

// ── 10. GEX summary cards ───────────────────────────────────────────────────
describe("Phase F — GEX summary cards", () => {
  it("shows Total Call GEX", () => {
    expect(gexSection).toContain("Total Call GEX");
    expect(gexSection).toContain('data-testid="gex-call-total"');
  });

  it("shows Total Put GEX", () => {
    expect(gexSection).toContain("Total Put GEX");
    expect(gexSection).toContain('data-testid="gex-put-total"');
  });

  it("shows Net GEX", () => {
    expect(gexSection).toContain("Net GEX");
    expect(gexSection).toContain('data-testid="gex-net-total"');
  });

  it("shows Zero Gamma Level", () => {
    expect(gexSection).toContain("Zero Gamma Level");
    expect(gexSection).toContain('data-testid="gex-flip-point"');
  });

  it("shows Top +GEX Strike", () => {
    expect(gexSection).toContain("Top +GEX Strike");
  });

  it("shows Top −GEX Strike", () => {
    expect(gexSection).toContain("Top −GEX Strike");
  });

  it("call GEX is green, put GEX is red", () => {
    expect(gexSection).toContain("text-green-400");
    expect(gexSection).toContain("text-red-400");
  });
});

// ── 11. GEX bar chart ───────────────────────────────────────────────────────
describe("Phase F — GEX bar chart", () => {
  it("uses Recharts BarChart", () => {
    expect(gexSection).toContain("<BarChart");
  });

  it("chart is vertical layout", () => {
    expect(gexSection).toContain('layout="vertical"');
  });

  it("chart has call GEX bar (green)", () => {
    expect(gexSection).toContain('dataKey="callGex"');
    expect(gexSection).toContain('fill="#22c55e"');
  });

  it("chart has put GEX bar (red)", () => {
    expect(gexSection).toContain('dataKey="putGex"');
    expect(gexSection).toContain('fill="#ef4444"');
  });

  it("chart has flip point reference line", () => {
    expect(gexSection).toContain("gexResult.flipPoint");
    expect(gexSection).toContain("ReferenceLine");
  });

  it("chart only shown when data is reliable", () => {
    expect(gexSection).toContain("chartData.length > 0");
  });
});

// ── 12. GEX not used for signals/paper trading ──────────────────────────────
describe("Phase F — GEX signal/paper trade safety", () => {
  it("GEX section does not use signalGate", () => {
    expect(gexSection).not.toContain("signalGate");
  });

  it("GEX section does not use paperTrade", () => {
    expect(gexSection).not.toContain("paperTrade");
    expect(gexSection).not.toContain("paper_trade");
  });

  it("GEX section does not use riskSize", () => {
    expect(gexSection).not.toContain("riskSize");
    expect(gexSection).not.toContain("risk_size");
  });
});

// ── 13. No Yahoo ────────────────────────────────────────────────────────────
describe("Phase F — No Yahoo", () => {
  it("GEX section has no Yahoo reference", () => {
    expect(gexSection.toLowerCase()).not.toContain("yahoo");
  });

  it("chain section has no Yahoo reference", () => {
    expect(chainSection.toLowerCase()).not.toContain("yahoo");
  });
});

// ── 14. Shared state preserved ──────────────────────────────────────────────
describe("Phase F — Shared state preserved", () => {
  it("GexTab uses shared state", () => {
    expect(gexSection).toContain("const { data, loading } = shared");
  });

  it("GexTab does not call useOiInsights", () => {
    expect(gexSection).not.toContain("useOiInsights()");
  });

  it("OptionChainTab still uses shared state", () => {
    expect(chainSection).toContain("const { data, loading, error } = shared");
  });
});

// ── 15. Sprint regression ───────────────────────────────────────────────────
describe("Phase F — Sprint regression", () => {
  it("OverviewTab exists", () => {
    expect(uiSrc).toContain("function OverviewTab(");
  });

  it("PcrTab exists", () => {
    expect(uiSrc).toContain("function PcrTab(");
  });

  it("MaxPainTab exists", () => {
    expect(uiSrc).toContain("function MaxPainTab(");
  });

  it("InsightsTab exists", () => {
    expect(uiSrc).toContain("function InsightsTab(");
  });

  it("OptionChainTab exists", () => {
    expect(uiSrc).toContain("function OptionChainTab(");
  });

  it("MultiOiTab exists", () => {
    expect(uiSrc).toContain("function MultiOiTab(");
  });

  it("ChainSettingsDrawer exists (Phase E)", () => {
    expect(uiSrc).toContain("function ChainSettingsDrawer(");
  });

  it("useChainSettings exists (Phase E)", () => {
    expect(uiSrc).toContain("function useChainSettings()");
  });

  it("GexPlaceholder backward compat exists", () => {
    expect(uiSrc).toContain("function GexPlaceholder()");
  });

  it("no Yahoo import", () => {
    const imports = uiSrc.slice(0, uiSrc.indexOf("export default"));
    expect(imports.toLowerCase()).not.toContain("yahoo");
  });
});
