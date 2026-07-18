/**
 * ContainmentBanner — permanent amber strip informing all users that
 * paper-trading automation is suspended and data provenance limits apply.
 *
 * C0 — displayed unconditionally until automation is re-enabled in M2b/M2c.
 * Remove this component only when FNO_AUTO_OPEN_C0_BLOCKED and
 * EQUITY_AUTO_OPEN_C0_BLOCKED are both lifted.
 */
export function ContainmentBanner() {
  return (
    <div
      className="bg-amber-950/60 border-b border-amber-700/50 text-amber-300 text-xs text-center py-1.5 px-3 font-medium tracking-wide"
      data-testid="containment-banner"
    >
      ⚠ Analysis mode — automation suspended — provenance limits apply
    </div>
  );
}
