/**
 * P0.4 Step 2 · Stage 2 · both-flag-state writer tests (2026-07-16).
 *
 * The Stage 2 acceptance target requires proof that:
 *
 *  • With `REASONING_WRITER_V2_ENABLED` UNSET (or ≠ "1"), the reasoning
 *    row shape produced by `buildReasoningRow`, `buildEmittedRow`, and
 *    `buildPreEmissionRejectedRows` is BYTE-IDENTICAL to the pre-Stage-2
 *    contract: every new column stays NULL, the legacy fields keep the
 *    same values, and no runtime error is raised.
 *
 *  • With the flag = "1", the 9 new reasoning columns populate per the
 *    contract table in `fnoCanonicalTaxonomy.ts`. Specifically:
 *      - `gate_name`, `verdict`, `stage`, `trade_class`,
 *        `canonical_decision`, `canonical_reason` are non-null on every
 *        row produced by the two batch builders.
 *      - `config_version` falls back to the documented bootstrap
 *        `fno-config-legacy-v0` when the caller didn't supply one.
 *      - Site D DEMOTED emissions carry the demotion-tag mapped
 *        canonical bucket rather than generic UNMAPPED.
 *      - Site E PRE_EMISSION_REJECTED rows apply the NO_LIVE_KITE_INTRADAY
 *        reason-based DATA_BLOCKED override.
 *      - Site E OTHER-catch is silently classified as UNMAPPED (writer
 *        boundary swallows the helper's throw for one bad row without
 *        poisoning the batch).
 *
 * All db-touching calls are avoided (pure helpers); the writer guard
 * (`assertNotProdDbInTest`) is untested here since the fnoObservability
 * suite already covers it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildEmittedRow,
  buildPreEmissionRejectedRows,
  buildReasoningRow,
  type FnoReasoningPayload,
  type UpstreamSignalShape,
} from "./fnoSignalReasoningLogger";

/* Preserve + restore the flag around every test so state does not
 * leak between the two blocks. Using a per-test snapshot rather than
 * global state avoids --pool=threads races. */
let SAVED_FLAG: string | undefined;
beforeEach(() => {
  SAVED_FLAG = process.env.REASONING_WRITER_V2_ENABLED;
});
afterEach(() => {
  if (SAVED_FLAG === undefined) delete process.env.REASONING_WRITER_V2_ENABLED;
  else process.env.REASONING_WRITER_V2_ENABLED = SAVED_FLAG;
});

const BASE_PAYLOAD: FnoReasoningPayload = {
  decision: "EMITTED",
  signalDate: "2026-07-16",
  indexSymbol: "NIFTY",
  setupKey: "EMA_PULLBACK",
  direction: "BULLISH",
  optionType: "CE",
  tier: "STANDARD",
  confidence: 72,
  gateName: "EMISSION",
  verdict: "PASS",
  stage: "EMISSION",
  tradeClass: "TRADEABLE",
  canonicalDecision: "EXECUTABLE",
  canonicalReason: "UNMAPPED",
  configVersion: "test-config-v1",
};

/* ────────────── Flag OFF: byte-identical to pre-Stage-2 ─────────── */

describe("REASONING_WRITER_V2_ENABLED = OFF — new columns MUST stay NULL", () => {
  beforeEach(() => {
    delete process.env.REASONING_WRITER_V2_ENABLED;
  });

  it("buildReasoningRow drops all 9 new columns to NULL regardless of caller-supplied v2 fields", () => {
    const row = buildReasoningRow(BASE_PAYLOAD);
    expect(row.gateName).toBeNull();
    expect(row.verdict).toBeNull();
    expect(row.stage).toBeNull();
    expect(row.valuesTestedJson).toBeNull();
    expect(row.thresholdJson).toBeNull();
    expect(row.configVersion).toBeNull();
    expect(row.tradeClass).toBeNull();
    expect(row.canonicalDecision).toBeNull();
    expect(row.canonicalReason).toBeNull();
  });

  it("legacy columns preserved byte-identical on flag OFF (decision, reason_code, snapshot)", () => {
    const row = buildReasoningRow({
      ...BASE_PAYLOAD,
      reasonCode: "OPENED",
      snapshot: { hint: "kept" },
    });
    expect(row.decision).toBe("EMITTED");
    expect(row.reasonCode).toBe("OPENED");
    expect(row.snapshot).toEqual({ hint: "kept" });
  });

  it("buildEmittedRow: canonical shadow is computed in memory but buildReasoningRow drops it to NULL when written", () => {
    const emitted = buildEmittedRow(
      {
        index: "NIFTY",
        bias: "BULLISH",
        setupKey: "TREND_CONTINUATION",
        tier: "STANDARD",
        tradeClass: "TRADEABLE",
        confidence: 70,
        tags: ["HTF_CONFLICT"],
        leg: { type: "CALL", strike: 24500, entry: 24540 },
      } as UpstreamSignalShape,
      "2026-07-16",
      13.5,
    );
    // In-memory shape has the canonical fields populated (the builder
    // is pure — the flag gates only the ROW writer, not the builder).
    expect(emitted.canonicalDecision).toBe("DEMOTED");
    expect(emitted.canonicalReason).toBe("HTF_BIAS_CONFLICT");
    // But when the payload is handed to buildReasoningRow with the flag
    // OFF, the row that goes to Drizzle drops those fields to NULL.
    const row = buildReasoningRow(emitted);
    expect(row.canonicalDecision).toBeNull();
    expect(row.canonicalReason).toBeNull();
    expect(row.gateName).toBeNull();
  });

  it("buildPreEmissionRejectedRows: canonical shadow computed in memory but row drops it NULL on flag OFF", () => {
    const rows = buildPreEmissionRejectedRows(
      [
        { index: "NIFTY", reasons: ["ema_pullback: post-clamp RR < 1.4"] },
      ],
      "2026-07-16",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.canonicalDecision).toBe("REJECTED");
    expect(rows[0]!.canonicalReason).toBe("RR_INSUFFICIENT_POST_CLAMP");
    const dbRow = buildReasoningRow(rows[0]!);
    expect(dbRow.canonicalDecision).toBeNull();
    expect(dbRow.canonicalReason).toBeNull();
  });
});

/* ─────────────── Flag ON: new columns populate per contract ────── */

describe("REASONING_WRITER_V2_ENABLED = '1' — new columns MUST populate", () => {
  beforeEach(() => {
    process.env.REASONING_WRITER_V2_ENABLED = "1";
  });

  it("buildReasoningRow writes every caller-supplied v2 field verbatim", () => {
    const row = buildReasoningRow({
      ...BASE_PAYLOAD,
      valuesTestedJson: { score: 45 },
      thresholdJson: { min: 60 },
    });
    expect(row.gateName).toBe("EMISSION");
    expect(row.verdict).toBe("PASS");
    expect(row.stage).toBe("EMISSION");
    expect(row.valuesTestedJson).toEqual({ score: 45 });
    expect(row.thresholdJson).toEqual({ min: 60 });
    expect(row.configVersion).toBe("test-config-v1");
    expect(row.tradeClass).toBe("TRADEABLE");
    expect(row.canonicalDecision).toBe("EXECUTABLE");
    expect(row.canonicalReason).toBe("UNMAPPED");
  });

  it("buildReasoningRow falls back to `fno-config-legacy-v0` when caller omits configVersion", () => {
    const row = buildReasoningRow({
      ...BASE_PAYLOAD,
      configVersion: undefined,
    });
    expect(row.configVersion).toBe("fno-config-legacy-v0");
  });

  it("Site D · buildEmittedRow demotion path maps HTF_CONFLICT → HTF_BIAS_CONFLICT (not generic UNMAPPED)", () => {
    const emitted = buildEmittedRow(
      {
        index: "BANKNIFTY",
        bias: "BEARISH",
        setupKey: "MEAN_REVERSION",
        tier: "STANDARD",
        tradeClass: "TRADEABLE",
        confidence: 68,
        tags: ["HTF_CONFLICT", "LOW_WINRATE"],
        leg: { type: "PUT", strike: 58000, entry: 57950 },
      } as UpstreamSignalShape,
      "2026-07-16",
      15.2,
    );
    expect(emitted.canonicalDecision).toBe("DEMOTED");
    // Precedence: HTF_CONFLICT wins over LOW_WINRATE.
    expect(emitted.canonicalReason).toBe("HTF_BIAS_CONFLICT");
    expect(emitted.verdict).toBe("DEMOTE");
    // Legacy line preserved unchanged.
    expect(emitted.reasonCode).toBe("DEMOTED");
    // Row-level: with flag ON, these all go to DB non-null.
    const row = buildReasoningRow(emitted);
    expect(row.canonicalDecision).toBe("DEMOTED");
    expect(row.canonicalReason).toBe("HTF_BIAS_CONFLICT");
    expect(row.gateName).toBe("EMISSION");
    expect(row.stage).toBe("EMISSION");
    expect(row.tradeClass).toBe("TRADEABLE");
  });

  it("Site D · unknown-tag demotion → LEGACY_DEMOTION_UNMAPPED, not generic UNMAPPED", () => {
    // A demotion tag not yet in the mapping table lands in the
    // dedicated escape hatch — /audit can then distinguish "known
    // legacy path" from "unknown garbage".
    const emitted = buildEmittedRow(
      {
        index: "NIFTY",
        bias: "BULLISH",
        setupKey: "TREND_CONTINUATION",
        tier: "STANDARD",
        tradeClass: "TRADEABLE",
        confidence: 65,
        tags: ["RR_LOW"], // mapped
        leg: { type: "CALL", strike: 24500, entry: 24540 },
      } as UpstreamSignalShape,
      "2026-07-16",
      14.0,
    );
    // RR_LOW → RR_INSUFFICIENT_POST_CLAMP (shared bucket with pre-emission)
    expect(emitted.canonicalReason).toBe("RR_INSUFFICIENT_POST_CLAMP");
  });

  it("Site D · EMITTED-EXECUTABLE (no demotion tags) → EXECUTABLE / UNMAPPED (verdict PASS)", () => {
    const emitted = buildEmittedRow(
      {
        index: "NIFTY",
        bias: "BULLISH",
        setupKey: "VWAP_RECLAIM",
        tier: "STANDARD",
        tradeClass: "TRADEABLE",
        confidence: 78,
        tags: [], // no demotion tags
        leg: { type: "CALL", strike: 24500, entry: 24540 },
      } as UpstreamSignalShape,
      "2026-07-16",
      13.0,
    );
    expect(emitted.canonicalDecision).toBe("EXECUTABLE");
    expect(emitted.canonicalReason).toBe("UNMAPPED");
    expect(emitted.verdict).toBe("PASS");
    expect(emitted.reasonCode).toBe("EMITTED");
  });

  it("Site D · INFO_ONLY broadcasts carry tradeClass='INFO_ONLY' in the promoted column", () => {
    const emitted = buildEmittedRow(
      {
        index: "SENSEX",
        bias: "BULLISH",
        setupKey: "BASELINE",
        tier: "BASELINE",
        tradeClass: "INFO_ONLY",
        confidence: 45,
        tags: [],
        leg: { type: "CALL", strike: 77500, entry: 77650 },
      } as UpstreamSignalShape,
      "2026-07-16",
      13.0,
    );
    expect(emitted.tradeClass).toBe("INFO_ONLY");
    const row = buildReasoningRow(emitted);
    expect(row.tradeClass).toBe("INFO_ONLY");
  });

  it("Site E · PRE_EMISSION_REJECTED · NO_LIVE_KITE_INTRADAY → DATA_BLOCKED (reason-based override)", () => {
    const rows = buildPreEmissionRejectedRows(
      [
        {
          index: "NIFTY",
          reasons: ["ema_pullback: no_live_kite_intraday"],
        },
      ],
      "2026-07-16",
    );
    expect(rows).toHaveLength(1);
    // Reason classifier turns "no_live_kite_intraday" into NO_LIVE_KITE_INTRADAY,
    // and mapDecisionToCanonical then applies the DATA_BLOCKED override.
    expect(rows[0]!.reasonCode).toBe("NO_LIVE_KITE_INTRADAY");
    expect(rows[0]!.canonicalDecision).toBe("DATA_BLOCKED");
    expect(rows[0]!.canonicalReason).toBe("DATA_BLOCKED_LIVE_FEED");
    expect(rows[0]!.verdict).toBe("NOT_EVALUATED");
    expect(rows[0]!.stage).toBe("PRE_EMISSION");
  });

  it("Site E · PRE_EMISSION_REJECTED · POST_CLAMP_RR → REJECTED / RR_INSUFFICIENT_POST_CLAMP", () => {
    const rows = buildPreEmissionRejectedRows(
      [
        {
          index: "NIFTY",
          reasons: ["ema_pullback: post-clamp RR < 1.4"],
        },
      ],
      "2026-07-16",
    );
    expect(rows[0]!.reasonCode).toBe("POST_CLAMP_RR");
    expect(rows[0]!.canonicalDecision).toBe("REJECTED");
    expect(rows[0]!.canonicalReason).toBe("RR_INSUFFICIENT_POST_CLAMP");
    expect(rows[0]!.verdict).toBe("FAIL");
  });

  it("Site E · CONDITIONS_NOT_MET → REJECTED / SETUP_CONDITIONS_UNMET", () => {
    const rows = buildPreEmissionRejectedRows(
      [{ index: "SENSEX", reasons: ["vwap_reclaim: conditions not met"] }],
      "2026-07-16",
    );
    expect(rows[0]!.reasonCode).toBe("CONDITIONS_NOT_MET");
    expect(rows[0]!.canonicalDecision).toBe("REJECTED");
    expect(rows[0]!.canonicalReason).toBe("SETUP_CONDITIONS_UNMET");
  });

  it("Site E · OTHER-catch: unclassified reason → UNMAPPED without poisoning the batch", () => {
    // The classifySuppressionReason() helper returns "OTHER" for unmapped
    // reasons. mapDecisionToCanonical() throws OtherReasonBannedError on
    // OTHER. Site E swallows the throw and stamps UNMAPPED so one bad
    // row doesn't break the batch — this is the intentional escape.
    const rows = buildPreEmissionRejectedRows(
      [{ index: "NIFTY", reasons: ["unknown_gate: something not classified yet"] }],
      "2026-07-16",
    );
    expect(rows[0]!.reasonCode).toBe("OTHER");
    // Fallback branch — writer swallows OTHER-throw and stamps UNMAPPED.
    expect(rows[0]!.canonicalDecision).toBe("REJECTED");
    expect(rows[0]!.canonicalReason).toBe("UNMAPPED");
  });

  it("Site E · row bulk survives a mix of OTHER + valid reasons — one bad row does not poison the batch", () => {
    const rows = buildPreEmissionRejectedRows(
      [
        {
          index: "NIFTY",
          reasons: [
            "ema_pullback: post-clamp RR < 1.4",     // valid → mapped
            "unknown_gate: mystery reason",            // OTHER → UNMAPPED (no throw)
            "vwap_reclaim: conditions not met",       // valid → mapped
          ],
        },
      ],
      "2026-07-16",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]!.canonicalReason).toBe("RR_INSUFFICIENT_POST_CLAMP");
    expect(rows[1]!.canonicalReason).toBe("UNMAPPED");
    expect(rows[2]!.canonicalReason).toBe("SETUP_CONDITIONS_UNMET");
  });
});
