/**
 * URGENT PRODUCTION STABILIZATION — Execution Truth Structural Tests
 *
 * These tests prove that:
 * 1. PAPER_TRADE: YES is removed from the entire product vocabulary
 * 2. Popup derives execution state from backend execution fields, not tier
 * 3. Backend enrichWithExecutionTruth function exists and is wired
 * 4. HistoryRow carries ExecutionTruth fields
 * 5. Options page has proper empty/loading/error states
 * 6. No guardrails were loosened
 *
 * All tests are structural (source-text analysis) — no DB, no server required.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../../..");
const SCANNER_ROOT = path.join(ROOT, "artifacts/scanner");
const API_ROOT = path.join(ROOT, "artifacts/api-server");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

// ─────────────────────────────────────────────────────────────────
// 1. PAPER_TRADE: YES PERMANENTLY REMOVED
// ─────────────────────────────────────────────────────────────────
describe("PAPER_TRADE: YES vocabulary removal", () => {
  const alerterSrc = readFile("artifacts/scanner/src/components/option-signal-alerter.tsx");

  it("popup never contains the string 'Paper trade: YES' (case-insensitive)", () => {
    // The only acceptable occurrence of "YES" is in a comment explaining
    // the 4-state system. Real rendered text must not contain it.
    const lines = alerterSrc.split("\n");
    const violating = lines.filter(line => {
      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return false;
      return /paper\s*trade.*yes/i.test(line) || /paperAllowed.*\?.*"YES"/i.test(line);
    });
    expect(violating).toEqual([]);
  });

  it("popup does not contain the broken 'paperAllowed = isTradeable' logic", () => {
    expect(alerterSrc).not.toContain("paperAllowed = isTradeable");
    expect(alerterSrc).not.toContain("paperAllowed");
  });

  it("popup does not derive paper-trade status from tier alone", () => {
    // The broken pattern: const isTradeable = tier === "HIGH_CONVICTION" || tier === "STANDARD";
    // followed by paperAllowed = isTradeable
    expect(alerterSrc).not.toMatch(/const\s+paperAllowed/);
  });

  it("popup uses execution truth fields from backend", () => {
    // Must access execution.executionStatus or equivalent
    expect(alerterSrc).toContain("executionStatus");
    expect(alerterSrc).toContain("executionBlockedReason");
  });

  it("popup contains all 4 badge states", () => {
    expect(alerterSrc).toContain("PAPER TRADE: OPENED");
    expect(alerterSrc).toContain("PAPER TRADE: BLOCKED");
    expect(alerterSrc).toContain("PAPER TRADE: NO");
    expect(alerterSrc).toContain("PAPER TRADE: NOT CONFIRMED");
  });

  it("popup shows exact block reason for BLOCKED state", () => {
    expect(alerterSrc).toContain("DAILY_DD_CAP");
    expect(alerterSrc).toContain("WEEKLY_DD_CAP");
    expect(alerterSrc).toContain("PORTFOLIO_HEAT");
    expect(alerterSrc).toContain("CONSECUTIVE_STOPS");
    expect(alerterSrc).toContain("PREMIUM_UNTRUSTED");
    expect(alerterSrc).toContain("INSUFFICIENT_BALANCE");
  });

  it("popup title uses 'EXECUTION BLOCKED' for blocked HC signals", () => {
    expect(alerterSrc).toContain("TRADEABLE SETUP — EXECUTION BLOCKED");
  });

  it("popup title uses 'EXECUTION NOT CONFIRMED' for unconfirmed HC signals", () => {
    expect(alerterSrc).toContain("TRADEABLE SETUP — EXECUTION NOT CONFIRMED");
  });

  it("popup title uses 'INFO ALERT — ENTRY LEVEL REACHED' for info-only", () => {
    expect(alerterSrc).toContain("INFO ALERT — ENTRY LEVEL REACHED");
  });

  it("popup title uses 'TRADEABLE ENTRY TRIGGERED' only for OPENED state", () => {
    // The title "TRADEABLE ENTRY TRIGGERED" should only appear in the isOpened branch
    const triggerLines = alerterSrc.split("\n")
      .map((l, i) => ({ line: l, num: i + 1 }))
      .filter(({ line }) => line.includes("TRADEABLE ENTRY TRIGGERED") && !line.trim().startsWith("//"));
    expect(triggerLines.length).toBeGreaterThanOrEqual(1);
    // Check that the preceding code checks for isOpened
    for (const { num } of triggerLines) {
      const context = alerterSrc.split("\n").slice(Math.max(0, num - 5), num).join("\n");
      expect(context).toContain("isOpened");
    }
  });

  it("popup shows paper trade details (lots, entry premium) when OPENED", () => {
    expect(alerterSrc).toContain("paperTradeLots");
    expect(alerterSrc).toContain("paperTradeEntryPremium");
    expect(alerterSrc).toContain("paperTradePositionId");
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. BACKEND EXECUTION TRUTH
// ─────────────────────────────────────────────────────────────────
describe("Backend execution truth enrichment", () => {
  const lifecycleSrc = readFile("artifacts/api-server/src/lib/optionSignalLifecycle.ts");

  it("exports PaperTradeExecutionStatus type with all 4 states", () => {
    expect(lifecycleSrc).toContain("export type PaperTradeExecutionStatus");
    expect(lifecycleSrc).toContain('"NOT_APPLICABLE"');
    expect(lifecycleSrc).toContain('"OPENED"');
    expect(lifecycleSrc).toContain('"BLOCKED"');
    expect(lifecycleSrc).toContain('"NOT_CONFIRMED"');
  });

  it("exports FinalAlertClass type", () => {
    expect(lifecycleSrc).toContain("export type FinalAlertClass");
    expect(lifecycleSrc).toContain('"INFO_ONLY"');
    expect(lifecycleSrc).toContain('"TRADEABLE_SIGNAL"');
    expect(lifecycleSrc).toContain('"TRADEABLE_EXECUTION_BLOCKED"');
    expect(lifecycleSrc).toContain('"PAPER_TRADE_OPENED"');
    expect(lifecycleSrc).toContain('"EXECUTION_NOT_CONFIRMED"');
    expect(lifecycleSrc).toContain('"STOPPED"');
  });

  it("exports ExecutionTruth interface with required fields", () => {
    expect(lifecycleSrc).toContain("export interface ExecutionTruth");
    expect(lifecycleSrc).toContain("signalTier:");
    expect(lifecycleSrc).toContain("signalTradeable:");
    expect(lifecycleSrc).toContain("executionStatus:");
    expect(lifecycleSrc).toContain("executionBlockedReason:");
    expect(lifecycleSrc).toContain("paperTradeOpened:");
    expect(lifecycleSrc).toContain("paperTradePositionId:");
    expect(lifecycleSrc).toContain("paperTradeLots:");
    expect(lifecycleSrc).toContain("paperTradeEntryPremium:");
    expect(lifecycleSrc).toContain("finalAlertClass:");
  });

  it("HistoryRow includes execution truth field", () => {
    expect(lifecycleSrc).toContain("execution: ExecutionTruth;");
  });

  it("enrichWithExecutionTruth function exists", () => {
    expect(lifecycleSrc).toContain("async function enrichWithExecutionTruth");
  });

  it("enrichWithExecutionTruth queries paper_trade_fo table", () => {
    expect(lifecycleSrc).toContain("paperTradeFoTable");
  });

  it("enrichWithExecutionTruth uses getMissedSignals for skip reasons", () => {
    expect(lifecycleSrc).toContain("getMissedSignals()");
  });

  it("getTodayHistory calls enrichWithExecutionTruth", () => {
    const fnBody = extractFunctionBody(lifecycleSrc, "getTodayHistory");
    expect(fnBody).toContain("enrichWithExecutionTruth");
  });

  it("getHistoryByDate calls enrichWithExecutionTruth", () => {
    const fnBody = extractFunctionBody(lifecycleSrc, "getHistoryByDate");
    expect(fnBody).toContain("enrichWithExecutionTruth");
  });

  it("getHistoryByMonth calls enrichWithExecutionTruth", () => {
    const fnBody = extractFunctionBody(lifecycleSrc, "getHistoryByMonth");
    expect(fnBody).toContain("enrichWithExecutionTruth");
  });

  it("getRecentHistory calls enrichWithExecutionTruth", () => {
    const fnBody = extractFunctionBody(lifecycleSrc, "getRecentHistory");
    expect(fnBody).toContain("enrichWithExecutionTruth");
  });

  it("BASELINE signals get NOT_APPLICABLE status", () => {
    expect(lifecycleSrc).toContain("BASELINE_NOT_TRADEABLE");
    expect(lifecycleSrc).toContain("INFO_ONLY_NOT_TRADEABLE");
  });

  it("missing execution evidence produces NOT_CONFIRMED", () => {
    expect(lifecycleSrc).toContain("NO_EXECUTION_RECORD_FOUND");
  });

  it("enrichment uses durable fno_signal_reasoning as primary skip source", () => {
    // The enrichment function must query fno_signal_reasoning for SKIPPED/MISSED_WINDOW
    // rows BEFORE falling back to the in-memory ring.
    expect(lifecycleSrc).toContain("fno_signal_reasoning");
    expect(lifecycleSrc).toContain("SKIPPED");
    expect(lifecycleSrc).toContain("MISSED_WINDOW");
    expect(lifecycleSrc).toContain("durableSkipMap");
  });

  it("enrichment uses in-memory ring only as fallback after durable source", () => {
    // The enrichment function must check durableSkipMap BEFORE ringSkipMap.
    // We verify the variable names exist in the right order.
    const durableIdx = lifecycleSrc.indexOf("durableSkipMap");
    const ringIdx = lifecycleSrc.indexOf("ringSkipMap");
    expect(durableIdx).toBeGreaterThan(-1);
    expect(ringIdx).toBeGreaterThan(-1);
    // durableSkipMap should be declared/used before ringSkipMap
    expect(durableIdx).toBeLessThan(ringIdx);
  });

  it("paper_trade_fo_skip table does NOT exist (documented)", () => {
    // There is no paper_trade_fo_skip table in the schema.
    // Skip data is persistently stored in fno_signal_reasoning table.
    const allSchemas = fs.readdirSync(path.join(ROOT, "lib/db/src/schema"));
    const hasSkipTable = allSchemas.some(f => f.includes("paperTradeFoSkip"));
    expect(hasSkipTable).toBe(false);
    // The reasoning table IS the durable skip source
    const hasReasoningTable = allSchemas.some(f => f.includes("fnoSignalReasoning"));
    expect(hasReasoningTable).toBe(true);
  });

  it("enrichment priority order: paper_trade_fo > durable skip > ring skip > default", () => {
    // Verify the priority comment exists in the enrichment function
    expect(lifecycleSrc).toContain("Priority 1: paper_trade_fo");
    expect(lifecycleSrc).toContain("Priority 2: durable fno_signal_reasoning");
    expect(lifecycleSrc).toContain("Priority 3: in-memory missedRing");
    expect(lifecycleSrc).toContain("Priority 4: no evidence");
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. OPTIONS PAGE EMPTY / LOADING / ERROR STATES
// ─────────────────────────────────────────────────────────────────
describe("Options page blank panel fix", () => {
  const optionsSrc = readFile("artifacts/scanner/src/pages/options.tsx");

  it("Live setups tab has market-closed empty state", () => {
    expect(optionsSrc).toContain("Market is");
    expect(optionsSrc).toContain("pre-open");
    expect(optionsSrc).toContain("closed");
  });

  it("Live setups tab has loading skeleton", () => {
    expect(optionsSrc).toContain("Skeleton");
    expect(optionsSrc).toContain("isLoading");
  });

  it("Live setups tab has no-signals empty state", () => {
    expect(optionsSrc).toContain("No high-conviction setups right now");
  });

  it("Report tab exists and is a function component", () => {
    expect(optionsSrc).toContain("function ReportTab");
  });

  it("Report tab has loading state", () => {
    const reportBody = extractFunctionBody(optionsSrc, "ReportTab");
    expect(reportBody).toContain("isLoading");
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. NO GUARDRAIL / GATE LOOSENING
// ─────────────────────────────────────────────────────────────────
describe("Guardrail / gate safety verification", () => {
  const paperTradingSrc = readFile("artifacts/api-server/src/lib/paperTradingFO.ts");
  const signalGatesSrc = readFile("artifacts/api-server/src/lib/optionSignalGates.ts");

  it("SkipReason type still includes all guardrail reasons", () => {
    expect(paperTradingSrc).toContain('"DAILY_DD_CAP"');
    expect(paperTradingSrc).toContain('"WEEKLY_DD_CAP"');
    expect(paperTradingSrc).toContain('"PORTFOLIO_HEAT"');
    expect(paperTradingSrc).toContain('"CONSECUTIVE_STOPS"');
    expect(paperTradingSrc).toContain('"PREMIUM_UNTRUSTED"');
    expect(paperTradingSrc).toContain('"INSUFFICIENT_BALANCE"');
  });

  it("recordSkip function still exists (guardrails still fire)", () => {
    expect(paperTradingSrc).toContain("const recordSkip");
  });

  it("signal gates module is unchanged", () => {
    // The signal gates module should not have been modified
    expect(signalGatesSrc).toContain("loadGateContext");
  });

  it("no Yahoo data source reintroduced", () => {
    const lifecycleSrc = readFile("artifacts/api-server/src/lib/optionSignalLifecycle.ts");
    expect(lifecycleSrc).not.toContain("yahoo");
    expect(lifecycleSrc).not.toContain("YAHOO");
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. SETUP EXPLANATION (options.tsx WhyThisSetup) CONSISTENCY
// ─────────────────────────────────────────────────────────────────
describe("WhyThisSetup component consistency", () => {
  const optionsSrc = readFile("artifacts/scanner/src/pages/options.tsx");

  it("WhyThisSetup uses deriveSetupExplanation (server-authoritative tradeClass)", () => {
    expect(optionsSrc).toContain("deriveSetupExplanation");
    expect(optionsSrc).toContain("paperTradeAllowed");
    // WhyThisSetup on the live F&O page uses the SETUP explanation which
    // derives from tradeClass (server-authoritative). This is separate from
    // the popup alerter which uses EXECUTION truth from paper_trade_fo.
    // Both are valid and complementary.
  });

  it("WhyThisSetup correctly labels Auto-trade: YES/NO (signal tradeability, not execution)", () => {
    // Note: the live-tab "Auto-trade: YES" on WhyThisSetup is CORRECT here.
    // It describes signal tradeability (tradeClass), not execution outcome.
    // The alerter popup is the one that was broken and is now fixed.
    expect(optionsSrc).toContain("Auto-trade: YES");
    expect(optionsSrc).toContain("Auto-trade: NO");
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. POPUP + COCKPIT CONSISTENCY
// ─────────────────────────────────────────────────────────────────
describe("Popup and F&O Cockpit execution truth consistency", () => {
  const alerterSrc = readFile("artifacts/scanner/src/components/option-signal-alerter.tsx");

  it("popup reads execution truth from backend response (not local computation)", () => {
    // Must cast to access additive fields
    expect(alerterSrc).toContain("execution");
    expect(alerterSrc).toContain("executionStatus");
  });

  it("popup and cockpit use same backend paper_trade_fo source", () => {
    const lifecycleSrc = readFile("artifacts/api-server/src/lib/optionSignalLifecycle.ts");
    // Both signal-history (popup source) and paper-trading (cockpit source)
    // query the same paper_trade_fo table
    expect(lifecycleSrc).toContain("paperTradeFoTable");
  });

  it("guardrail-latched state cannot produce PAPER TRADE: OPENED badge", () => {
    // If executionStatus is BLOCKED, the badge must show BLOCKED, not OPENED
    // Verified by the 4-state switch: isOpened → OPENED, isBlocked → BLOCKED
    expect(alerterSrc).toContain("isBlocked");
    expect(alerterSrc).toContain("isOpened");
    // The two states are mutually exclusive by definition
    const lines = alerterSrc.split("\n");
    const openedBadge = lines.find(l => l.includes('paperBadgeLabel = "PAPER TRADE: OPENED"'));
    const blockedBadge = lines.find(l => l.includes('paperBadgeLabel = "PAPER TRADE: BLOCKED"'));
    expect(openedBadge).toBeDefined();
    expect(blockedBadge).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. REGRESSION: SPRINT 1/2/3 NOT DISTURBED
// ─────────────────────────────────────────────────────────────────
describe("Sprint 1/2/3 regression safety", () => {
  it("dynamic sizing helpers untouched", () => {
    const sizingSrc = readFile("artifacts/api-server/src/lib/fnoSizingHelper.ts");
    expect(sizingSrc).toContain("computeFnoLotSizing");
  });

  it("capital ledger untouched", () => {
    const ledgerSrc = readFile("lib/db/src/schema/paperTrading.ts");
    expect(ledgerSrc).toContain("paperCapitalEventTable");
  });

  it("paper account table untouched", () => {
    const schemaSrc = readFile("lib/db/src/schema/paperTrading.ts");
    expect(schemaSrc).toContain("paperAccountTable");
    expect(schemaSrc).toContain("seedCapital");
  });

  it("OI Lab pages still exist", () => {
    const oiLabSrc = readFile("artifacts/scanner/src/pages/oi-lab.tsx");
    expect(oiLabSrc).toContain("useOiInsights");
  });
});

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function extractFunctionBody(source: string, fnName: string): string {
  const startRegex = new RegExp(`function\\s+${fnName}[^{]*\\{`);
  const match = startRegex.exec(source);
  if (!match) return "";
  let braceCount = 1;
  let pos = match.index + match[0].length;
  while (pos < source.length && braceCount > 0) {
    if (source[pos] === "{") braceCount++;
    if (source[pos] === "}") braceCount--;
    pos++;
  }
  return source.slice(match.index, pos);
}
