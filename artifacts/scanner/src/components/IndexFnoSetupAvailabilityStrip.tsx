/**
 * A0.3.2 — Index F&O Setup Availability Disclosure strip.
 *
 * Extracted from the inline IIFE in options.tsx (A0.3 / A0.3.1) into an
 * exported component so it can be render-tested against the PRODUCTION
 * serialisation path rather than a hand-rolled mirror.
 *
 * Contract:
 *   - Accepts exactly 9 records (3 indices × 3 setups). Any other cardinality
 *     renders a degraded/error indicator — no ?? [] fallback.
 *   - Visually groups by status:
 *       UNAVAILABLE_REQUIRED_INPUT → amber section (data unavailability)
 *       RETIRED_INDEX_FNO_POLICY   → purple section (policy decision)
 *   - React key and data-testid use composite identity (indexSymbol-setupKey)
 *     to avoid duplicate-key warnings and to support per-index assertions in tests.
 */

import React from "react";
import { Ban } from "lucide-react";

/** Minimal entry shape — compatible with FnoSetupAvailabilityEntry from api-client-react. */
export type AvailabilityEntryStrip = {
  indexSymbol: string;
  setupKey: string;
  status: "ACTIVE" | "UNAVAILABLE_REQUIRED_INPUT" | "RETIRED_INDEX_FNO_POLICY";
  reasonCode: string;
  explanation: string;
};

interface Props {
  /**
   * All availability entries from setupState.indexFnoSetupAvailability.
   * Undefined when the API response has not yet loaded or the field is absent.
   * The component renders an explicit degraded state — never falls back to [].
   */
  entries: AvailabilityEntryStrip[] | undefined;
}

/**
 * Renders the authoritative availability disclosure for Index F&O setups.
 *
 * A0.3.2 change: entries must be provided with the correct cardinality (9).
 * When entries is undefined/null → loading state.
 * When entries.length ≠ 9    → explicit incomplete-data error.
 * When all entries are ACTIVE → returns null (no strip shown).
 */
export function IndexFnoSetupAvailabilityStrip({ entries }: Props) {
  // A0.3.2: explicit degraded state — no ?? [] fallback. Missing entries mean
  // the API field was absent or the response has not loaded yet.
  if (entries === undefined || entries === null) {
    return (
      <div
        className="rounded border border-border/30 bg-secondary/10 px-4 py-2 text-[11px] text-muted-foreground/50"
        data-testid="fno-setup-availability-strip-degraded"
      >
        <span className="font-mono text-[10px]">
          Index F&amp;O setup availability — loading…
        </span>
      </div>
    );
  }
  // A0.3.2: cardinality guard — 3 indices × 3 setups = 9 records always.
  if (entries.length !== 9) {
    return (
      <div
        className="rounded border border-destructive/30 bg-destructive/5 px-4 py-2 text-[11px] text-destructive/70"
        data-testid="fno-setup-availability-strip-degraded"
      >
        <span className="font-mono text-[10px]">
          Setup availability data incomplete — expected 9 records, received {entries.length}.
        </span>
      </div>
    );
  }

  const unavailableInput = entries.filter(
    (e) => e.status === "UNAVAILABLE_REQUIRED_INPUT",
  );
  const retiredPolicy = entries.filter(
    (e) => e.status === "RETIRED_INDEX_FNO_POLICY",
  );
  // All ACTIVE — nothing to disclose.
  if (unavailableInput.length === 0 && retiredPolicy.length === 0) return null;

  return (
    <div
      className="rounded border border-border/40 bg-secondary/15 px-4 py-2.5 text-[11px] space-y-2"
      data-testid="fno-setup-availability-strip"
    >
      <div className="flex items-center gap-2">
        <Ban className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
        <span className="font-semibold text-muted-foreground/80 uppercase tracking-wider text-[10px]">
          Index F&amp;O — setups not available in this lane
        </span>
      </div>

      {unavailableInput.length > 0 && (
        <div
          className="rounded border border-amber-500/30 bg-amber-500/8 px-3 py-2 space-y-1.5"
          data-testid="fno-availability-unavailable-required-input"
        >
          <div className="text-[9px] font-mono uppercase tracking-wider text-amber-400/80 mb-1">
            Missing required input — data unavailability
          </div>
          {unavailableInput.map((entry) => (
            <div
              key={`${entry.indexSymbol}-${entry.setupKey}`}
              className="flex items-start gap-3"
              data-testid={`avail-entry-${entry.indexSymbol}-${entry.setupKey}`}
            >
              <span className="font-mono text-[10px] text-amber-300/50 shrink-0 w-20 pt-px">
                {entry.indexSymbol}
              </span>
              <span className="font-mono text-[10px] text-amber-300/70 shrink-0 w-36 pt-px">
                {entry.setupKey}
              </span>
              <span className="text-muted-foreground/70 leading-snug flex-1">
                {entry.explanation}
              </span>
              <span
                className="font-mono text-[9px] text-amber-400/40 shrink-0 pt-px whitespace-nowrap"
                data-testid={`reason-${entry.indexSymbol}-${entry.setupKey}`}
              >
                {entry.reasonCode}
              </span>
            </div>
          ))}
        </div>
      )}

      {retiredPolicy.length > 0 && (
        <div
          className="rounded border border-purple-500/20 bg-purple-500/5 px-3 py-2 space-y-1.5"
          data-testid="fno-availability-retired-policy"
        >
          <div className="text-[9px] font-mono uppercase tracking-wider text-purple-400/60 mb-1">
            Retired under current index F&amp;O policy
          </div>
          {retiredPolicy.map((entry) => (
            <div
              key={`${entry.indexSymbol}-${entry.setupKey}`}
              className="flex items-start gap-3"
              data-testid={`avail-entry-${entry.indexSymbol}-${entry.setupKey}`}
            >
              <span className="font-mono text-[10px] text-muted-foreground/40 shrink-0 w-20 pt-px">
                {entry.indexSymbol}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/50 shrink-0 w-36 pt-px">
                {entry.setupKey}
              </span>
              <span className="text-muted-foreground/60 leading-snug flex-1">
                {entry.explanation}
              </span>
              <span
                className="font-mono text-[9px] text-muted-foreground/35 shrink-0 pt-px whitespace-nowrap"
                data-testid={`reason-${entry.indexSymbol}-${entry.setupKey}`}
              >
                {entry.reasonCode}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
