/**
 * Sprint 3 Phase E — Option Chain Settings Drawer + Column Visibility MVP
 * Structural tests for settings drawer, column visibility, presets, persistence.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../scanner/src/pages/oi-lab.tsx"),
  "utf-8"
);

// Phase E section: from Phase E header to GEX placeholder
const phaseESection = uiSrc.slice(
  uiSrc.indexOf("// Phase E: Option Chain Settings"),
  uiSrc.indexOf("// ─── GEX placeholder")
);

// Settings drawer only
const drawerSection = uiSrc.slice(
  uiSrc.indexOf("function ChainSettingsDrawer("),
  uiSrc.indexOf("function OptionChainTab(")
);

// OptionChainTab component only
const chainSection = uiSrc.slice(
  uiSrc.indexOf("function OptionChainTab("),
  uiSrc.indexOf("// ─── GEX placeholder")
);

// Backend OI Lab
const backendSrc = fs.readFileSync(
  path.resolve(__dirname, "oiLab.ts"),
  "utf-8"
);

// ── 1. Settings types & defaults ────────────────────────────────────────────
describe("Phase E — Settings types & defaults", () => {
  it("ChainSettings interface defined", () => {
    expect(phaseESection).toContain("interface ChainSettings");
  });

  it("ChainColKey type defined with ltpChg", () => {
    expect(phaseESection).toContain("type ChainColKey");
    expect(phaseESection).toContain('"ltpChg"');
  });

  it("DEFAULT_SETTINGS defined", () => {
    expect(phaseESection).toContain("const DEFAULT_SETTINGS: ChainSettings");
  });

  it("default preset is 'all'", () => {
    const defaults = phaseESection.slice(
      phaseESection.indexOf("const DEFAULT_SETTINGS"),
      phaseESection.indexOf("const LS_KEY")
    );
    expect(defaults).toContain('preset: "all"');
  });

  it("default ATM basis is 'spot'", () => {
    const defaults = phaseESection.slice(
      phaseESection.indexOf("const DEFAULT_SETTINGS"),
      phaseESection.indexOf("const LS_KEY")
    );
    expect(defaults).toContain('atmBasis: "spot"');
  });

  it("default strikesAround is '10'", () => {
    const defaults = phaseESection.slice(
      phaseESection.indexOf("const DEFAULT_SETTINGS"),
      phaseESection.indexOf("const LS_KEY")
    );
    expect(defaults).toContain('strikesAround: "10"');
  });

  it("default fontSize is 'M'", () => {
    const defaults = phaseESection.slice(
      phaseESection.indexOf("const DEFAULT_SETTINGS"),
      phaseESection.indexOf("const LS_KEY")
    );
    expect(defaults).toContain('fontSize: "M"');
  });

  it("default displayUnit is 'lots'", () => {
    const defaults = phaseESection.slice(
      phaseESection.indexOf("const DEFAULT_SETTINGS"),
      phaseESection.indexOf("const LS_KEY")
    );
    expect(defaults).toContain('displayUnit: "lots"');
  });

  it("default buildupMode is 'compact'", () => {
    const defaults = phaseESection.slice(
      phaseESection.indexOf("const DEFAULT_SETTINGS"),
      phaseESection.indexOf("const LS_KEY")
    );
    expect(defaults).toContain('buildupMode: "compact"');
  });
});

// ── 2. Presets ──────────────────────────────────────────────────────────────
describe("Phase E — Presets", () => {
  it("LTP_PRESET_COLS defined", () => {
    expect(phaseESection).toContain("const LTP_PRESET_COLS");
  });

  it("ALL_PRESET_COLS defined", () => {
    expect(phaseESection).toContain("const ALL_PRESET_COLS");
  });

  it("LTP preset includes ltp/iv/oi/oiChg/vol", () => {
    const ltp = phaseESection.slice(
      phaseESection.indexOf("const LTP_PRESET_COLS"),
      phaseESection.indexOf("const ALL_PRESET_COLS")
    );
    expect(ltp).toContain("ltp: true");
    expect(ltp).toContain("iv: true");
    expect(ltp).toContain("oi: true");
    expect(ltp).toContain("oiChg: true");
    expect(ltp).toContain("vol: true");
  });

  it("LTP preset disables advanced columns", () => {
    const ltp = phaseESection.slice(
      phaseESection.indexOf("const LTP_PRESET_COLS"),
      phaseESection.indexOf("const ALL_PRESET_COLS")
    );
    expect(ltp).toContain("intrinsic: false");
    expect(ltp).toContain("tv: false");
    expect(ltp).toContain("delta: false");
  });

  it("ALL preset enables all columns", () => {
    const all = phaseESection.slice(
      phaseESection.indexOf("const ALL_PRESET_COLS"),
      phaseESection.indexOf("const DEFAULT_SETTINGS")
    );
    expect(all).toContain("intrinsic: true");
    expect(all).toContain("tv: true");
    expect(all).toContain("buildup: true");
    expect(all).toContain("delta: true");
  });
});

// ── 3. localStorage persistence ─────────────────────────────────────────────
describe("Phase E — localStorage persistence", () => {
  it("localStorage key defined", () => {
    expect(phaseESection).toContain('const LS_KEY = "oi-lab-chain-settings-v1"');
  });

  it("useChainSettings reads from localStorage", () => {
    expect(phaseESection).toContain("localStorage.getItem(LS_KEY)");
  });

  it("useChainSettings writes to localStorage", () => {
    expect(phaseESection).toContain("localStorage.setItem(LS_KEY");
  });

  it("handles corrupt localStorage gracefully", () => {
    expect(phaseESection).toContain("catch {");
  });

  it("merges with defaults for forward-compat", () => {
    expect(phaseESection).toContain("...DEFAULT_SETTINGS, ...parsed");
  });
});

// ── 4. Settings drawer ──────────────────────────────────────────────────────
describe("Phase E — Settings drawer", () => {
  it("ChainSettingsDrawer component defined", () => {
    expect(phaseESection).toContain("function ChainSettingsDrawer(");
  });

  it("drawer has data-testid", () => {
    expect(drawerSection).toContain('data-testid="chain-settings-drawer"');
  });

  it("settings gear button exists in OptionChainTab", () => {
    expect(chainSection).toContain('data-testid="chain-settings-btn"');
  });

  it("drawer opens/closes via state", () => {
    expect(chainSection).toContain("setDrawerOpen(true)");
    expect(chainSection).toContain("setDrawerOpen(false)");
  });

  it("drawer has backdrop", () => {
    expect(drawerSection).toContain("bg-black/30");
  });

  it("drawer has close button", () => {
    expect(drawerSection).toContain("onClose");
    expect(drawerSection).toContain("<X");
  });

  it("drawer renders all 9 sections (A through I)", () => {
    expect(drawerSection).toContain("A. Quick Preset");
    expect(drawerSection).toContain("B. ATM Based On");
    expect(drawerSection).toContain("C. Strikes Around ATM");
    expect(drawerSection).toContain("D. Table Font Size");
    expect(drawerSection).toContain("E. Display Unit");
    expect(drawerSection).toContain("F. Totals Position");
    expect(drawerSection).toContain("G. Buildup Labels");
    expect(drawerSection).toContain("H. Column Visibility");
    expect(drawerSection).toContain("I. Reset");
  });

  it("drawer has Reset All button", () => {
    expect(drawerSection).toContain("Reset All Settings");
  });
});

// ── 5. Column visibility ────────────────────────────────────────────────────
describe("Phase E — Column visibility toggles", () => {
  it("header cells gated by cols.ltp", () => {
    expect(chainSection).toContain("cols.ltp &&");
  });

  it("header cells gated by cols.iv", () => {
    expect(chainSection).toContain("cols.iv &&");
  });

  it("header cells gated by cols.oi", () => {
    expect(chainSection).toContain("cols.oi &&");
  });

  it("header cells gated by cols.ltpChg (LTP Change)", () => {
    expect(chainSection).toContain("cols.ltpChg &&");
  });

  it("header cells gated by cols.buildup", () => {
    expect(chainSection).toContain("cols.buildup &&");
  });

  it("Greek columns gated by cols.delta/gamma/theta/vega", () => {
    expect(chainSection).toContain("cols.delta &&");
    expect(chainSection).toContain("cols.gamma &&");
    expect(chainSection).toContain("cols.theta &&");
    expect(chainSection).toContain("cols.vega &&");
  });

  it("Strike column is NEVER hidden (no cols.strike gate)", () => {
    // Strike column must always be visible
    expect(drawerSection).toContain("Strike column is always visible");
    // There should be no gate on the strike <td>
    const strikeTd = chainSection.slice(
      chainSection.indexOf("STRIKE COLUMN (sticky)"),
      chainSection.indexOf("PUT SIDE")
    );
    expect(strikeTd).not.toContain("cols.");
  });

  it("drawer column visibility section has checkboxes", () => {
    expect(drawerSection).toContain('type="checkbox"');
  });

  it("drawer has Price/OI/Value/Greeks subsections", () => {
    expect(drawerSection).toContain(">Price<");
    expect(drawerSection).toContain(">Open Interest / Volume<");
    expect(drawerSection).toContain(">Value<");
    expect(drawerSection).toContain(">Greeks<");
  });
});

// ── 6. Font size ────────────────────────────────────────────────────────────
describe("Phase E — Font size S/M/L", () => {
  it("fontClass computed from settings", () => {
    expect(chainSection).toContain("settings.fontSize");
  });

  it("S font size maps to text-[10px]", () => {
    expect(chainSection).toContain('text-[10px]"');
  });

  it("M font size maps to text-[11px]", () => {
    expect(chainSection).toContain('text-[11px]"');
  });

  it("L font size maps to text-[13px]", () => {
    expect(chainSection).toContain('text-[13px]"');
  });

  it("table applies fontClass dynamically", () => {
    expect(chainSection).toContain("${fontClass}");
  });
});

// ── 7. Display unit ─────────────────────────────────────────────────────────
describe("Phase E — Display unit Lots/Full", () => {
  it("fmtOi uses displayUnit setting", () => {
    expect(chainSection).toContain("settings.displayUnit");
  });

  it("full quantity multiplies by lotSize", () => {
    expect(chainSection).toContain("n * lotSize");
  });

  it("QTY MODE badge shown when full", () => {
    expect(chainSection).toContain("QTY MODE");
  });

  it("footer shows lotSize multiplier in full mode", () => {
    expect(chainSection).toContain("×{lotSize}");
  });

  it("OI cells use fmtOi (unit-aware)", () => {
    expect(chainSection).toContain("fmtOi(r.ceOi)");
    expect(chainSection).toContain("fmtOi(r.peOi)");
  });
});

// ── 8. Buildup mode ─────────────────────────────────────────────────────────
describe("Phase E — Buildup compact/full mode", () => {
  it("renderBuildup checks buildupMode", () => {
    expect(chainSection).toContain("settings.buildupMode");
  });

  it("full mode shows first part of full label", () => {
    expect(chainSection).toContain('m.full.split(" — ")[0]');
  });

  it("compact mode uses BuildupBadge component", () => {
    expect(chainSection).toContain("<BuildupBadge buildup=");
  });
});

// ── 9. ATM basis ────────────────────────────────────────────────────────────
describe("Phase E — ATM basis Spot/Future/Synth", () => {
  it("futureAvailable computed from data", () => {
    expect(chainSection).toContain("data.futurePrice != null");
  });

  it("synthAvailable computed from data", () => {
    expect(chainSection).toContain("data.syntheticFuture != null");
  });

  it("future unavailable state shown in drawer", () => {
    expect(drawerSection).toContain("Future ✗");
    expect(drawerSection).toContain("!futureAvailable");
  });

  it("synth unavailable state shown in drawer", () => {
    expect(drawerSection).toContain("Synth ✗");
    expect(drawerSection).toContain("!synthAvailable");
  });

  it("fallback warning when future unavailable", () => {
    expect(drawerSection).toContain("future unavailable — ATM uses spot");
  });

  it("fallback warning when synth unavailable", () => {
    expect(drawerSection).toContain("Synthetic future unavailable — ATM uses spot");
  });
});

// ── 10. Strikes around ──────────────────────────────────────────────────────
describe("Phase E — Strikes around controls", () => {
  it("drawer has strikesAround options", () => {
    // Source code uses template: ±${s} — at runtime produces ±5, ±10, etc.
    expect(drawerSection).toContain("±${s}");
    expect(drawerSection).toContain('"All"');
    expect(drawerSection).toContain('"5"');
    expect(drawerSection).toContain('"10"');
    expect(drawerSection).toContain('"20"');
    expect(drawerSection).toContain('"30"');
    expect(drawerSection).toContain('"40"');
  });

  it("settings syncs strikesAround to shared state", () => {
    expect(chainSection).toContain("shared.setStrikesAround(target)");
  });
});

// ── 11. LTP Change source audit ─────────────────────────────────────────────
describe("Phase E — LTP Change audit", () => {
  it("backend OiStrikeRow has ceLtpChg field", () => {
    expect(backendSrc).toContain("ceLtpChg?: number | null");
  });

  it("backend OiStrikeRow has peLtpChg field", () => {
    expect(backendSrc).toContain("peLtpChg?: number | null");
  });

  it("backend maps ceLtpChg from ltpChange", () => {
    expect(backendSrc).toContain("ceLtpChg: r.ce?.ltpChange ?? null");
  });

  it("backend maps peLtpChg from ltpChange", () => {
    expect(backendSrc).toContain("peLtpChg: r.pe?.ltpChange ?? null");
  });

  it("frontend InsightStrike has ceLtpChg", () => {
    expect(uiSrc).toContain("ceLtpChg?: number | null");
  });

  it("frontend InsightStrike has peLtpChg", () => {
    expect(uiSrc).toContain("peLtpChg?: number | null");
  });

  it("LTP Change column renders ceLtpChg", () => {
    expect(chainSection).toContain("r.ceLtpChg");
  });

  it("LTP Change column renders peLtpChg", () => {
    expect(chainSection).toContain("r.peLtpChg");
  });

  it("LTP Change shows — when null", () => {
    // The cell renders "—" when value is null
    expect(chainSection).toContain("r.ceLtpChg != null");
    expect(chainSection).toContain("r.peLtpChg != null");
  });

  it("LTP Change shows + prefix for positive", () => {
    expect(chainSection).toContain('(r.ceLtpChg >= 0 ? "+" : "")');
  });
});

// ── 12. No Yahoo ────────────────────────────────────────────────────────────
describe("Phase E — No Yahoo", () => {
  it("Phase E section has no Yahoo", () => {
    expect(phaseESection.toLowerCase()).not.toContain("yahoo");
  });
});

// ── 13. No fake data ────────────────────────────────────────────────────────
describe("Phase E — No fake data", () => {
  it("no fake LTP Change", () => {
    expect(phaseESection).not.toContain("fakeLtpChg");
    expect(phaseESection).not.toContain("estimateLtpChg");
  });

  it("no fake Greeks", () => {
    expect(phaseESection).not.toContain("fakeDelta");
    expect(phaseESection).not.toContain("fakeGamma");
  });

  it("no fake IV", () => {
    expect(phaseESection).not.toContain("fakeIv");
  });

  it("no fake future", () => {
    expect(phaseESection).not.toContain("fakeFuture");
  });
});

// ── 14. Shared state preserved ──────────────────────────────────────────────
describe("Phase E — Shared state preserved", () => {
  it("OptionChainTab still uses shared state", () => {
    expect(chainSection).toContain("const { data, loading, error } = shared");
  });

  it("OptionChainTab does NOT call useOiInsights", () => {
    expect(chainSection).not.toContain("useOiInsights()");
  });

  it("useChainSettings is separate from useOiInsights", () => {
    expect(chainSection).toContain("useChainSettings()");
  });
});

// ── 15. Sprint regression ───────────────────────────────────────────────────
describe("Phase E — Sprint 1/2/3 regression", () => {
  it("OverviewTab still exists", () => {
    expect(uiSrc).toContain("function OverviewTab(");
  });

  it("PcrTab still exists", () => {
    expect(uiSrc).toContain("function PcrTab(");
  });

  it("MaxPainTab still exists", () => {
    expect(uiSrc).toContain("function MaxPainTab(");
  });

  it("InsightsTab still exists", () => {
    expect(uiSrc).toContain("function InsightsTab(");
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
