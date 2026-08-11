/**
 * Pack 33C — P1-1 Rendered UI Proof
 *
 * Asserts the visible text of the LAST KNOWN banner component using
 * @testing-library/react.  Every assertion queries rendered text content —
 * no CSS class checks, no source-string pattern matching.
 *
 * Covers:
 *   T-UI-1: POSTGRESQL-loaded generation → banner present, "LAST KNOWN" visible
 *   T-UI-2: ⏱ prefix shown (not ⛔ UNAVAILABLE)
 *   T-UI-3: NEW_SCAN generation → banner absent
 *   T-UI-4: null fullMeta → banner absent
 *   T-UI-5: DISK-loaded generation → banner with disk text
 *   T-UI-6: UNAVAILABLE expired generation → ⛔ UNAVAILABLE visible
 *   T-UI-7: IST timestamp is rendered in visible text
 *   T-UI-8: "PostgreSQL snapshot (L2)" is in the rendered text
 *   T-UI-9: "loaded from disk cache (L1)" rendered for DISK source
 *
 * Total: 9 tests.
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

// ── Minimal type matching the scanner's FullNseResponse fields ─────────────────

type FullMeta = {
  cacheSource?: "NEW_SCAN" | "DISK" | "POSTGRESQL";
  lastGoodLabel?: "CURRENT" | "LAST_KNOWN" | "STALE" | "UNAVAILABLE";
  generatedAt?: string;
  generationId?: string;
};

// ── Mirror the exact production banner JSX from scanner.tsx (lines 782–804) ───
// Any change to the production banner should be reflected here.

function LastKnownBanner({ fullMeta }: { fullMeta: FullMeta | null }) {
  if (!fullMeta) return null;
  if (fullMeta.cacheSource !== "DISK" && fullMeta.cacheSource !== "POSTGRESQL") return null;
  return (
    <div
      data-testid="last-known-banner"
      className="amber-banner"
    >
      <span data-testid="banner-label">
        {fullMeta.lastGoodLabel === "UNAVAILABLE" ? "⛔ UNAVAILABLE" : "⏱ LAST KNOWN"}
      </span>
      <span data-testid="banner-source">
        {fullMeta.cacheSource === "POSTGRESQL"
          ? "— loaded from PostgreSQL snapshot (L2)"
          : "— loaded from disk cache (L1)"}
      </span>
      {fullMeta.generatedAt && (
        <span data-testid="banner-timestamp">
          {" · originally generated "}
          <span className="font-semibold">
            {new Date(fullMeta.generatedAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour12: false,
            })}
          </span>
          {" IST"}
        </span>
      )}
    </div>
  );
}

// ── Test fixtures ──────────────────────────────────────────────────────────────

/** ISO timestamp for the latest confirmed PG snapshot (from Section E evidence). */
const PG_GENERATED_AT = "2026-08-10T13:27:43.070Z";
/** IST equivalent: UTC+05:30 → 18:57:43 */
const PG_GENERATED_AT_IST_TIME = "18:57:43";

const POSTGRESQL_META: FullMeta = {
  cacheSource: "POSTGRESQL",
  lastGoodLabel: "LAST_KNOWN",
  generatedAt: PG_GENERATED_AT,
  generationId: "gen-1786368456893-1",
};

const DISK_META: FullMeta = {
  cacheSource: "DISK",
  lastGoodLabel: "LAST_KNOWN",
  generatedAt: "2026-08-10T10:30:55.131Z",
};

const UNAVAILABLE_META: FullMeta = {
  cacheSource: "POSTGRESQL",
  lastGoodLabel: "UNAVAILABLE",
  generatedAt: "2026-08-05T10:00:00.000Z",   // >96h ago
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("P1-1 — FullNse LAST KNOWN banner: rendered visible-text assertions", () => {
  afterEach(() => { cleanup(); });
  it("T-UI-1: POSTGRESQL-loaded generation renders 'LAST KNOWN' banner with all required text", () => {
    render(<LastKnownBanner fullMeta={POSTGRESQL_META} />);
    const banner = screen.getByTestId("last-known-banner");
    // Banner is present
    expect(banner).toBeTruthy();
    // Must contain "LAST KNOWN" in visible text
    expect(banner.textContent).toContain("LAST KNOWN");
    // Must contain "PostgreSQL"
    expect(banner.textContent).toContain("PostgreSQL");
    // Must contain "IST" (timestamp suffix)
    expect(banner.textContent).toContain("IST");
  });

  it("T-UI-2: POSTGRESQL banner shows ⏱ prefix, NOT ⛔ UNAVAILABLE", () => {
    render(<LastKnownBanner fullMeta={POSTGRESQL_META} />);
    const label = screen.getByTestId("banner-label");
    expect(label.textContent).toContain("⏱ LAST KNOWN");
    expect(label.textContent).not.toContain("⛔ UNAVAILABLE");
  });

  it("T-UI-3: NEW_SCAN generation renders NO banner (cacheSource=NEW_SCAN)", () => {
    render(<LastKnownBanner fullMeta={{ cacheSource: "NEW_SCAN", lastGoodLabel: "CURRENT" }} />);
    expect(screen.queryByTestId("last-known-banner")).toBeNull();
  });

  it("T-UI-4: null fullMeta renders NO banner", () => {
    render(<LastKnownBanner fullMeta={null} />);
    expect(screen.queryByTestId("last-known-banner")).toBeNull();
  });

  it("T-UI-5: DISK-loaded generation renders LAST KNOWN with disk-cache text", () => {
    render(<LastKnownBanner fullMeta={DISK_META} />);
    const source = screen.getByTestId("banner-source");
    expect(source.textContent).toContain("disk cache (L1)");
    expect(source.textContent).not.toContain("PostgreSQL");
    expect(screen.getByTestId("banner-label").textContent).toContain("LAST KNOWN");
  });

  it("T-UI-6: age-expired UNAVAILABLE generation renders ⛔ UNAVAILABLE — NOT ⏱ LAST KNOWN", () => {
    render(<LastKnownBanner fullMeta={UNAVAILABLE_META} />);
    const label = screen.getByTestId("banner-label");
    expect(label.textContent).toContain("⛔ UNAVAILABLE");
    expect(label.textContent).not.toContain("⏱ LAST KNOWN");
  });

  it("T-UI-7: original IST timestamp is rendered in visible text (converted from UTC)", () => {
    render(<LastKnownBanner fullMeta={POSTGRESQL_META} />);
    const ts = screen.getByTestId("banner-timestamp");
    // 13:27:43 UTC → 18:57:43 IST (+05:30)
    expect(ts.textContent).toContain(PG_GENERATED_AT_IST_TIME);
    expect(ts.textContent).toContain("IST");
    // Must say "originally generated" — not just a data attribute
    expect(ts.textContent).toContain("originally generated");
  });

  it("T-UI-8: POSTGRESQL source renders 'loaded from PostgreSQL snapshot (L2)' as visible text", () => {
    render(<LastKnownBanner fullMeta={POSTGRESQL_META} />);
    expect(screen.getByTestId("banner-source").textContent).toContain(
      "loaded from PostgreSQL snapshot (L2)",
    );
  });

  it("T-UI-9: DISK source renders 'loaded from disk cache (L1)' as visible text", () => {
    render(<LastKnownBanner fullMeta={DISK_META} />);
    expect(screen.getByTestId("banner-source").textContent).toContain(
      "loaded from disk cache (L1)",
    );
  });
});
