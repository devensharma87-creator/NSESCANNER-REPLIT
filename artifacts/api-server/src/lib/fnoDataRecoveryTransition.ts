/**
 * FNO_DATA_RECOVERED degrade/recover handling for the F&O signal cycle
 * (docs/telegram-alert-quality-audit-2026-07-03.md).
 *
 * Extracted out of optionSignals.ts into its own lightweight module (only
 * depends on systemAlertDedup + alerting) so it is unit-testable without
 * importing optionSignals.ts's heavy dependency chain (Kite, market-data
 * router, confluence engine, etc.) — matches the existing convention in this
 * codebase of keeping alert-plumbing tests import-light.
 *
 * Pure plumbing — no signal/threshold/confluence logic here.
 */
import { alertOwner } from "./alerting";
import { transitionSystemAlertState } from "./systemAlertDedup";

/**
 * Handle the OK<->DEGRADED CAS transition for the "all F&O indices
 * suppressed" data-health condition and fire the FNO_DATA_RECOVERED alert
 * exactly once per genuine degrade→recover incident (never zero, never
 * duplicated — see systemAlertDedup.ts). Replaces a process-local boolean
 * that reset on autoscale cold starts / multi-replica deploys, which could
 * either miss the recovery alert or double-send it.
 */
export async function handleFnoDataSuppressionTransition(
  isAllDataSuppressed: boolean,
  recoveredIndices: string[],
): Promise<void> {
  if (isAllDataSuppressed) {
    await transitionSystemAlertState("fno_data", "OK", "DEGRADED").catch(() => undefined);
    return;
  }
  const { claimed, incidentId } = await transitionSystemAlertState(
    "fno_data",
    "DEGRADED",
    "OK",
  ).catch(() => ({ claimed: false, incidentId: null }));
  if (!claimed) return;
  alertOwner(
    "FNO_DATA_RECOVERED",
    `F&O data connection restored. Signal cycle resumed. Indices: ${recoveredIndices.join(", ")}.`,
    {
      affectedIndices: recoveredIndices,
      recoveredAt: new Date().toISOString(),
      dashboardPath: "/fno-diagnostics",
      isDataIssue: false,
    },
    0,
    incidentId ? `FNO_DATA_RECOVERED::${incidentId}` : "FNO_DATA_RECOVERED::unknown-incident",
  );
}
