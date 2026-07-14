/**
 * BACKUP — pre-Phase-3 F&O signal emission policy.
 *
 * Captured 2026-05-06 immediately before the confluence-engine rewrite.
 * NOT compiled, NOT imported. Kept verbatim so the previous behaviour
 * can be reconstructed without trawling git history. The active emit
 * logic lives in `optionSignals.ts::buildSignalsForIndex` and now
 * delegates per-detector confidence scoring to `confluenceEngine.ts`.
 *
 * What this captures:
 *   - the per-detector loop in buildSignalsForIndex
 *   - the raw `r.confidence` value as returned by each detector
 *   - the vol-regime haircut (-4 HIGH / -8 EXTREME)
 *   - the HC_EMISSION_FLOOR demote (default 65)
 *   - the trigger-realism + clamp + RR floor 1.4 sequence
 *
 * Rollback recipe: restore the body of buildSignalsForIndex's
 * `for (const det of detectors)` loop to the version below, and remove
 * the `confluenceEngine` import + call sites in optionSignals.ts.
 */
export const LEGACY_EMIT_POLICY_NOTE = `
[pre-Phase-3 — replaced 2026-05-06]

for (const det of detectors) {
  // ... opening-noise / late-cutoff / vwap-reclaim gates as today ...
  const r = det.fn(ctx);
  if (!r) { suppressed.push(\`\${det.name}: conditions not met\`); continue; }

  // bias-flip cooldown (gateCtx) — unchanged

  // Vol-regime haircut applied BEFORE the HC floor.
  if (ctx.volRegime === "EXTREME") {
    r.confidence -= 8;
    r.drivers.push({ label: "VOL_REGIME", weight: -8, ... });
  } else if (ctx.volRegime === "HIGH") {
    r.confidence -= 4;
    r.drivers.push({ label: "VOL_REGIME", weight: -4, ... });
  }

  // No further confluence scoring — detector's raw confidence + vol
  // haircut was the sole emission signal. EMA stack alignment, VWAP
  // relation, volume-profile zone, regime, and IVR were NOT folded
  // into the score; they appeared on the card as informational
  // chips only (not as a numeric confidence delta).

  if (r.confidence < HC_EMISSION_FLOOR) {  // 65
    suppressed.push(\`\${det.name}: confidence \${r.confidence} < HC emission floor\`);
    continue;
  }
  const realistic = applyTriggerRealism(r, ctx);
  const clamped = clampPlanForIntraday(realistic, ctx);  // RR floor 1.4
  if (!clamped) { suppressed.push(\`\${det.name}: post-clamp RR < 1.4\`); continue; }
  highConviction.push(clamped);
}
`;
