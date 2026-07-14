import { describe, expect, it } from "vitest";
import {
  FNO_BASELINE_GUARDRAILS,
  FNO_BASELINE_RISK,
  FNO_RISK,
  riskPctForConfidence,
} from "./paperAccount";

describe("riskPctForConfidence (2026-05-11 sub-tier sizing)", () => {
  it("returns STANDARD risk pct for any STANDARD confidence", () => {
    expect(riskPctForConfidence("STANDARD", 70)).toBe(FNO_RISK.MAX_LOSS_PCT_PER_TRADE);
    expect(riskPctForConfidence("STANDARD", 99)).toBe(FNO_RISK.MAX_LOSS_PCT_PER_TRADE);
    // STANDARD ignores confidence sub-tiering — even a (theoretically
    // impossible) 50-conf STANDARD would size at 2 % since the upstream
    // confidence floor would already have rejected it.
    expect(riskPctForConfidence("STANDARD", 50)).toBe(FNO_RISK.MAX_LOSS_PCT_PER_TRADE);
  });

  it("returns MICRO (0.25%) for BASELINE 55-59 confidence band", () => {
    expect(riskPctForConfidence("BASELINE", 55)).toBe(FNO_BASELINE_RISK.MICRO_RISK_PCT);
    expect(riskPctForConfidence("BASELINE", 59)).toBe(FNO_BASELINE_RISK.MICRO_RISK_PCT);
  });

  it("returns BASELINE (0.5%) for BASELINE 60-64 confidence band", () => {
    expect(riskPctForConfidence("BASELINE", 60)).toBe(FNO_BASELINE_RISK.BASELINE_RISK_PCT);
    expect(riskPctForConfidence("BASELINE", 64)).toBe(FNO_BASELINE_RISK.BASELINE_RISK_PCT);
  });

  it("BASELINE 65+ still uses BASELINE_RISK_PCT (tier=BASELINE never gets STANDARD sizing)", () => {
    // Tier choice is upstream — once the engine has classified a signal
    // as BASELINE, riskPctForConfidence respects that envelope. A 65-conf
    // setup that should size at 2 % gets there by being emitted as
    // tier=STANDARD from the detector, not by sub-tier escalation here.
    expect(riskPctForConfidence("BASELINE", 65)).toBe(FNO_BASELINE_RISK.BASELINE_RISK_PCT);
    expect(riskPctForConfidence("BASELINE", 80)).toBe(FNO_BASELINE_RISK.BASELINE_RISK_PCT);
  });

  it("dial values are sane (MICRO < BASELINE < STANDARD)", () => {
    expect(FNO_BASELINE_RISK.MICRO_RISK_PCT).toBeLessThan(FNO_BASELINE_RISK.BASELINE_RISK_PCT);
    expect(FNO_BASELINE_RISK.BASELINE_RISK_PCT).toBeLessThan(FNO_RISK.MAX_LOSS_PCT_PER_TRADE);
  });

  it("BASELINE guardrails are tighter than the global FNO caps", () => {
    expect(FNO_BASELINE_GUARDRAILS.MAX_TRADES_PER_DAY).toBeLessThan(FNO_RISK.MAX_TRADES_PER_DAY);
    expect(FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT).toBeLessThan(FNO_RISK.MAX_DAILY_LOSS_PCT);
    // 14:45 IST = 14*60+45 = 885; 15:25 IST = 15*60+25 = 925.
    expect(FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN).toBe(885);
    expect(FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN).toBeLessThan(15 * 60 + 25);
  });
});
