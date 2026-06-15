/**
 * Sprint 3 Phase C — OI Lab UI Structural Tests
 *
 * These tests verify:
 * 1. Backend passes Sprint 3 fields through OiInsightsResponse
 * 2. computeOiInsights returns Sprint 3 provenance fields
 * 3. No Yahoo in OI Lab data path
 * 4. GEX not imported from OI Lab
 * 5. Missing values never return 0 when unavailable
 * 6. Sprint 1/2 regression (F&O gate, paper trading, sizing unchanged)
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── 1. OiInsightsResponse interface includes Sprint 3 fields ────────────────
describe("Phase C — OiInsightsResponse Sprint 3 fields", () => {
  const oiLabSrc = fs.readFileSync(
    path.resolve(__dirname, "oiLab.ts"), "utf-8"
  );

  it("includes spotSource field", () => {
    expect(oiLabSrc).toContain("spotSource:");
  });

  it("includes spotTrusted field", () => {
    expect(oiLabSrc).toContain("spotTrusted:");
  });

  it("includes futurePrice field", () => {
    expect(oiLabSrc).toContain("futurePrice:");
  });

  it("includes futureSource field", () => {
    expect(oiLabSrc).toContain("futureSource:");
  });

  it("includes futureExpiry field", () => {
    expect(oiLabSrc).toContain("futureExpiry:");
  });

  it("includes syntheticFuture field", () => {
    expect(oiLabSrc).toContain("syntheticFuture:");
  });

  it("includes syntheticFutureModelled field", () => {
    expect(oiLabSrc).toContain("syntheticFutureModelled:");
  });
});

// ── 2. computeOiInsights passes Sprint 3 fields from OcResponse ─────────────
describe("Phase C — computeOiInsights passes Sprint 3 provenance", () => {
  const oiLabSrc = fs.readFileSync(
    path.resolve(__dirname, "oiLab.ts"), "utf-8"
  );

  it("passes spotSource from chain", () => {
    expect(oiLabSrc).toContain('chain.spotSource');
  });

  it("passes spotTrusted from chain", () => {
    expect(oiLabSrc).toContain('chain.spotTrusted');
  });

  it("passes futurePrice from chain", () => {
    expect(oiLabSrc).toContain('chain.futurePrice');
  });

  it("passes futureSource from chain", () => {
    expect(oiLabSrc).toContain('chain.futureSource');
  });

  it("passes futureExpiry from chain", () => {
    expect(oiLabSrc).toContain('chain.futureExpiry');
  });

  it("passes syntheticFuture from chain", () => {
    expect(oiLabSrc).toContain('chain.syntheticFuture');
  });

  it("passes syntheticFutureModelled from chain", () => {
    expect(oiLabSrc).toContain('chain.syntheticFutureModelled');
  });

  it("defaults spotSource to unavailable when missing", () => {
    expect(oiLabSrc).toContain('chain.spotSource ?? "unavailable"');
  });

  it("defaults futurePrice to null when missing", () => {
    expect(oiLabSrc).toContain('chain.futurePrice ?? null');
  });
});

// ── 3. Frontend InsightResp includes Sprint 3 fields ────────────────────────
describe("Phase C — Frontend InsightResp Sprint 3 fields", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("interface InsightResp has spotSource", () => {
    expect(uiSrc).toContain("spotSource?:");
  });

  it("interface InsightResp has spotTrusted", () => {
    expect(uiSrc).toContain("spotTrusted?:");
  });

  it("interface InsightResp has futurePrice", () => {
    expect(uiSrc).toContain("futurePrice?:");
  });

  it("interface InsightResp has syntheticFuture", () => {
    expect(uiSrc).toContain("syntheticFuture?:");
  });

  it("interface InsightResp has syntheticFutureModelled", () => {
    expect(uiSrc).toContain("syntheticFutureModelled?:");
  });
});

// ── 4. OI Lab tab structure ─────────────────────────────────────────────────
describe("Phase C — OI Lab tab structure", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("has Overview tab", () => {
    expect(uiSrc).toContain('value="overview"');
    expect(uiSrc).toContain("OverviewTab");
  });

  it("has Open Interest tab", () => {
    expect(uiSrc).toContain('value="oi"');
  });

  it("has Put-Call Ratio tab", () => {
    expect(uiSrc).toContain('value="pcr"');
    expect(uiSrc).toContain("PcrTab");
  });

  it("has Max Pain tab", () => {
    expect(uiSrc).toContain('value="maxpain"');
    expect(uiSrc).toContain("MaxPainTab");
  });

  it("has Option Chain tab (Phase D)", () => {
    expect(uiSrc).toContain('value="chain"');
    expect(uiSrc).toContain("OptionChainTab");
  });

  it("has Multi OI & Volume tab", () => {
    expect(uiSrc).toContain('value="multi"');
    expect(uiSrc).toContain("MultiOiTab");
  });

  it("has Gamma Exposure placeholder tab", () => {
    expect(uiSrc).toContain('value="gex"');
    expect(uiSrc).toContain("GexPlaceholder");
  });

  it("existing SnapshotTab preserved", () => {
    expect(uiSrc).toContain("function SnapshotTab()");
  });

  it("existing HeatmapTab preserved", () => {
    expect(uiSrc).toContain("function HeatmapTab()");
  });

  it("existing TrackerTab preserved", () => {
    expect(uiSrc).toContain("function TrackerTab()");
  });

  it("existing InsightsTab preserved (with shared state)", () => {
    expect(uiSrc).toContain("function InsightsTab(");
  });
});

// ── 5. Overview tab content ────────────────────────────────────────────────
describe("Phase C — Overview tab content", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("shows spot source badge", () => {
    expect(uiSrc).toContain("data.spotSource");
  });

  it("shows future price or unavailable", () => {
    expect(uiSrc).toContain("data.futurePrice");
  });

  it("shows synthetic future with MODELLED badge", () => {
    expect(uiSrc).toContain("SYNTH FUTURE · MODELLED");
  });

  it("renders — for missing values (not 0)", () => {
    // Check that missing future shows — not 0
    expect(uiSrc).toContain('"—"');
    // Check that unavailable label is shown
    expect(uiSrc).toContain("Unavailable");
  });

  it("shows data warnings section", () => {
    expect(uiSrc).toContain("Data Warnings");
  });

  it("shows sentiment panel", () => {
    expect(uiSrc).toContain("SentimentGauge");
    expect(uiSrc).toContain("Market Sentiment");
  });

  it("shows market insight", () => {
    expect(uiSrc).toContain("data.marketInsight");
  });

  it("shows top resistance and support", () => {
    expect(uiSrc).toContain("Top Resistance (Call OI)");
    expect(uiSrc).toContain("Top Support (Put OI)");
  });
});

// ── 6. PCR tab content ──────────────────────────────────────────────────────
describe("Phase C — PCR tab content", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("shows PCR by OI", () => {
    expect(uiSrc).toContain("PCR by OI");
  });

  it("shows PCR by Volume", () => {
    expect(uiSrc).toContain("PCR by Volume");
  });

  it("shows PCR by OI Change", () => {
    expect(uiSrc).toContain("PCR by OI Change");
  });

  it("shows interpretation badges", () => {
    expect(uiSrc).toContain("pcrInterpretation");
  });

  it("has bullish/bearish/neutral/insufficient interpretation", () => {
    expect(uiSrc).toContain('"bullish"');
    expect(uiSrc).toContain('"bearish"');
    expect(uiSrc).toContain('"neutral"');
    expect(uiSrc).toContain('"insufficient"');
  });

  it("shows threshold markers at 1.3 and 0.7", () => {
    expect(uiSrc).toContain("1.3 Bullish");
    expect(uiSrc).toContain("0.7 Bearish");
  });

  it("handles zero call OI change gracefully (no divide by zero)", () => {
    // Shows — when callOiAdded is 0
    expect(uiSrc).toContain("data.callOiAdded !== 0");
  });
});

// ── 7. Max Pain tab content ──────────────────────────────────────────────────
describe("Phase C — Max Pain tab content", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("shows Max Pain strike value", () => {
    expect(uiSrc).toContain("Max Pain Strike");
  });

  it("shows Spot vs Max Pain deviation", () => {
    expect(uiSrc).toContain("Spot vs Max Pain");
    expect(uiSrc).toContain("deviation");
  });

  it("shows explanation tooltip", () => {
    expect(uiSrc).toContain("Derived from current OI snapshot for");
  });

  it("shows incomplete data warning", () => {
    expect(uiSrc).toContain("Max pain unavailable — insufficient OI data");
  });

  it("has What is Max Pain tooltip", () => {
    expect(uiSrc).toContain("What is Max Pain?");
  });
});

// ── 8. GEX placeholder ─────────────────────────────────────────────────────
describe("Phase C — GEX placeholder", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("shows MODELLED GEX badge", () => {
    expect(uiSrc).toContain("MODELLED GEX — not exchange provided");
  });

  it("shows GEX status checklist", () => {
    expect(uiSrc).toContain("✓ Implemented");
    expect(uiSrc).toContain("✓ Verified (contracts × lotSize)");
    expect(uiSrc).toContain("◌ Pending Phase D");
    expect(uiSrc).toContain("✕ Not permitted");
  });

  it("does not have a fake GEX chart", () => {
    // GexPlaceholder should not contain recharts chart components
    const gexSection = uiSrc.slice(
      uiSrc.indexOf("function GexPlaceholder"),
      uiSrc.indexOf("function SnapshotTab")
    );
    expect(gexSection).not.toContain("<BarChart");
    expect(gexSection).not.toContain("<LineChart");
    expect(gexSection).not.toContain("<ResponsiveContainer");
  });
});

// ── 9. No Yahoo in OI Lab path ──────────────────────────────────────────────
describe("Phase C — No Yahoo in OI Lab data path", () => {
  const oiLabSrc = fs.readFileSync(
    path.resolve(__dirname, "oiLab.ts"), "utf-8"
  );

  it("oiLab.ts does not import from Yahoo module", () => {
    expect(oiLabSrc).not.toMatch(/from\s+['"]\.\/(yahoo|fetchChart)['"]/);
  });

  it("oiLab.ts does not call fetchChart", () => {
    expect(oiLabSrc).not.toContain("fetchChart(");
  });

  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, "../routes/oiLab.ts"), "utf-8"
  );

  it("oiLab route does not import Yahoo", () => {
    expect(routeSrc).not.toMatch(/from\s+['"]\.\/(yahoo|fetchChart)['"]/);
  });
});

// ── 10. Parent-owned shared state architecture ──────────────────────────────
describe("Phase C — Parent-owned shared state", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("useOiInsights hook is defined", () => {
    expect(uiSrc).toContain("function useOiInsights");
  });

  it("SharedOiState type is defined", () => {
    expect(uiSrc).toContain("type SharedOiState = ReturnType<typeof useOiInsights>");
  });

  it("parent OiLab calls useOiInsights() once", () => {
    const oiLabSection = uiSrc.slice(
      uiSrc.indexOf("export default function OiLab"),
      uiSrc.indexOf("function MultiOiTab")
    );
    expect(oiLabSection).toContain("const shared = useOiInsights()");
  });

  it("parent passes shared state to OverviewTab", () => {
    expect(uiSrc).toContain("<OverviewTab shared={shared}");
  });

  it("parent passes shared state to InsightsTab", () => {
    expect(uiSrc).toContain("<InsightsTab shared={shared}");
  });

  it("parent passes shared state to PcrTab", () => {
    expect(uiSrc).toContain("<PcrTab shared={shared}");
  });

  it("parent passes shared state to MaxPainTab", () => {
    expect(uiSrc).toContain("<MaxPainTab shared={shared}");
  });

  it("parent passes shared state to OptionChainTab", () => {
    expect(uiSrc).toContain("<OptionChainTab shared={shared}");
  });

  it("parent passes shared state to UnderlyingPicker", () => {
    expect(uiSrc).toContain("<UnderlyingPicker shared={shared}");
  });

  it("OverviewTab does NOT call useOiInsights independently", () => {
    const overviewSection = uiSrc.slice(
      uiSrc.indexOf("function OverviewTab"),
      uiSrc.indexOf("function PcrTab")
    );
    expect(overviewSection).not.toContain("useOiInsights()");
    expect(overviewSection).toContain("{ shared }: { shared: SharedOiState }");
  });

  it("PcrTab does NOT call useOiInsights independently", () => {
    const pcrSection = uiSrc.slice(
      uiSrc.indexOf("function PcrTab"),
      uiSrc.indexOf("function MaxPainTab")
    );
    expect(pcrSection).not.toContain("useOiInsights()");
    expect(pcrSection).toContain("{ shared }: { shared: SharedOiState }");
  });

  it("MaxPainTab does NOT call useOiInsights independently", () => {
    const maxPainSection = uiSrc.slice(
      uiSrc.indexOf("function MaxPainTab"),
      uiSrc.indexOf("function InsightsTab")
    );
    expect(maxPainSection).not.toContain("useOiInsights()");
    expect(maxPainSection).toContain("{ shared }: { shared: SharedOiState }");
  });

  it("InsightsTab does NOT call useOiInsights independently", () => {
    const insightsSection = uiSrc.slice(
      uiSrc.indexOf("function InsightsTab"),
      uiSrc.indexOf("function SentimentGauge")
    );
    expect(insightsSection).not.toContain("useOiInsights()");
    expect(insightsSection).toContain("{ shared }: { shared: SharedOiState }");
  });

  it("OptionChainTab receives shared state", () => {
    const chainSection = uiSrc.slice(
      uiSrc.indexOf("function OptionChainTab("),
      uiSrc.indexOf("// ─── GEX placeholder")
    );
    expect(chainSection).toContain("{ shared }: { shared: SharedOiState }");
  });

  it("InsightsTab does not have its own underlying/expiry/data state", () => {
    const insightsSection = uiSrc.slice(
      uiSrc.indexOf("function InsightsTab"),
      uiSrc.indexOf("function SentimentGauge")
    );
    // Should not contain useState for underlying, expiry, or data
    expect(insightsSection).not.toContain("useState(\"NIFTY\")");
    expect(insightsSection).not.toContain("useState<InsightResp");
  });

  it("shared hook includes strikesAround state", () => {
    const hookSection = uiSrc.slice(
      uiSrc.indexOf("function useOiInsights"),
      uiSrc.indexOf("type SharedOiState")
    );
    expect(hookSection).toContain("strikesAround, setStrikesAround");
  });

  it("shared hook includes timeframe state", () => {
    const hookSection = uiSrc.slice(
      uiSrc.indexOf("function useOiInsights"),
      uiSrc.indexOf("type SharedOiState")
    );
    expect(hookSection).toContain("timeframe, setTimeframe");
  });

  it("shared hook expiry resets on underlying change (parent level)", () => {
    const hookSection = uiSrc.slice(
      uiSrc.indexOf("function useOiInsights"),
      uiSrc.indexOf("type SharedOiState")
    );
    expect(hookSection).toContain("setExpiry(undefined)");
    expect(hookSection).toContain("[underlying]");
  });

  it("no duplicate universe fetch in InsightsTab", () => {
    const insightsSection = uiSrc.slice(
      uiSrc.indexOf("function InsightsTab"),
      uiSrc.indexOf("function SentimentGauge")
    );
    expect(insightsSection).not.toContain("api/options/oi-lab/universe");
  });

  it("no duplicate insights fetch in InsightsTab", () => {
    const insightsSection = uiSrc.slice(
      uiSrc.indexOf("function InsightsTab"),
      uiSrc.indexOf("function SentimentGauge")
    );
    expect(insightsSection).not.toContain("api/options/oi-lab/insights/");
  });
});

// ── 11. Sprint 1/2 regression checks ───────────────────────────────────────
describe("Phase C — Sprint 1/2 infrastructure not disturbed", () => {
  it("paper trading module not imported by oiLab", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "oiLab.ts"), "utf-8");
    expect(src).not.toContain("paperTradingFO");
  });

  it("dynamic sizing module not imported by oiLab", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "oiLab.ts"), "utf-8");
    expect(src).not.toContain("fnoSizingHelper");
  });

  it("capital ledger not imported by oiLab", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "oiLab.ts"), "utf-8");
    expect(src).not.toContain("capitalLedger");
  });

  it("GEX not imported by oiLab", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "oiLab.ts"), "utf-8");
    expect(src).not.toContain("from './gex'");
    expect(src).not.toContain('from "./gex"');
  });
});

// ── 12. Tab IDs for browser testing ────────────────────────────────────────
describe("Phase C — Unique tab IDs for testing", () => {
  const uiSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"), "utf-8"
  );

  it("overview tab has unique ID", () => {
    expect(uiSrc).toContain('id="oi-lab-tab-overview"');
  });

  it("oi tab has unique ID", () => {
    expect(uiSrc).toContain('id="oi-lab-tab-oi"');
  });

  it("pcr tab has unique ID", () => {
    expect(uiSrc).toContain('id="oi-lab-tab-pcr"');
  });

  it("maxpain tab has unique ID", () => {
    expect(uiSrc).toContain('id="oi-lab-tab-maxpain"');
  });

  it("chain tab has unique ID", () => {
    expect(uiSrc).toContain('id="oi-lab-tab-chain"');
  });

  it("multi tab has unique ID", () => {
    expect(uiSrc).toContain('id="oi-lab-tab-multi"');
  });

  it("gex tab has unique ID", () => {
    expect(uiSrc).toContain('id="oi-lab-tab-gex"');
  });
});
