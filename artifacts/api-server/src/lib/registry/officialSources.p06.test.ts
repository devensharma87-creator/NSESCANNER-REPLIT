/**
 * PHASE 0.6 — officialSources behaviour tests.
 *
 * Pure parser/provenance behaviour against inline fixtures. No network, no DB.
 * Includes a static guard test that reads nseSecurityMaster.ts source directly
 * (never imports it — that module pulls in @workspace/db) to ensure the mirror
 * constant does not drift.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeFreshnessState,
  NSE_REFERENCE_MAX_AGE_HOURS_MIRROR,
  parseBseListOfScrips,
  splitCsvLine,
  unavailableSource,
} from "./officialSources";

describe("splitCsvLine", () => {
  it("handles a quoted field containing commas", () => {
    const cols = splitCsvLine('123,"ACME, Industries, Ltd",EQ');
    expect(cols).toEqual(["123", "ACME, Industries, Ltd", "EQ"]);
  });

  it("handles escaped (doubled) quotes inside a quoted field", () => {
    const cols = splitCsvLine('1,"a ""quoted"" word",z');
    expect(cols).toEqual(["1", 'a "quoted" word', "z"]);
  });

  it("splits a plain unquoted line correctly", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("preserves a trailing empty field", () => {
    expect(splitCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

// ── BSE parser: floor enforcement ──────────────────────────────────────────────

/** Build a JSON array body of N active BSE rows with valid distinct scrip codes. */
function bseActiveBody(count: number): string {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      SCRIP_CD: String(500000 + i),
      scrip_id: `SCRIP${i}`,
      Scrip_Name: `Company ${i}`,
      GROUP: "A",
      Segment: "Equity",
      ISIN_NUMBER: "INE001A01036",
      Status: "Active",
    });
  }
  return JSON.stringify(rows);
}

describe("parseBseListOfScrips floor enforcement", () => {
  const retrievedAt = "2026-08-12T10:00:00.000Z";
  const nowMs = Date.parse("2026-08-12T10:00:30.000Z");

  it("rejects a row count below the per-source floor (not silently accepted)", () => {
    // Floor for BSE_LIST_OF_SCRIPS_ACTIVE is 2000; supply far fewer.
    const parsed = parseBseListOfScrips(bseActiveBody(5), "BSE_LIST_OF_SCRIPS_ACTIVE", retrievedAt, nowMs);
    expect(parsed.provenance.validationResult).toBe("REJECTED_BELOW_FLOOR");
    expect(parsed.provenance.validationResult).not.toBe("ACCEPTED");
    expect(parsed.provenance.rejectionDetail).not.toBeNull();
    expect(parsed.provenance.freshnessState).toBe("INVALID");
  });

  it("accepts a row count at/above the floor", () => {
    const parsed = parseBseListOfScrips(bseActiveBody(2000), "BSE_LIST_OF_SCRIPS_ACTIVE", retrievedAt, nowMs);
    expect(parsed.provenance.validationResult).toBe("ACCEPTED");
    expect(parsed.rows.length).toBe(2000);
  });
});

// ── Freshness ──────────────────────────────────────────────────────────────────

describe("computeFreshnessState (NSE cadence)", () => {
  const base = "2026-08-12T00:00:00.000Z";
  const baseMs = Date.parse(base);

  it("returns CURRENT_AUTHORITATIVE within NSE_REFERENCE_MAX_AGE_HOURS", () => {
    const nowMs = baseMs + (NSE_REFERENCE_MAX_AGE_HOURS_MIRROR - 1) * 3600_000;
    expect(computeFreshnessState("NSE_EQUITY_L", base, nowMs)).toBe("CURRENT_AUTHORITATIVE");
  });

  it("returns STALE at/past NSE_REFERENCE_MAX_AGE_HOURS", () => {
    const nowMs = baseMs + NSE_REFERENCE_MAX_AGE_HOURS_MIRROR * 3600_000;
    expect(computeFreshnessState("NSE_EQUITY_L", base, nowMs)).toBe("STALE");
    const wellPast = baseMs + (NSE_REFERENCE_MAX_AGE_HOURS_MIRROR + 24) * 3600_000;
    expect(computeFreshnessState("NSE_EQUITY_L", base, wellPast)).toBe("STALE");
  });
});

describe("unavailableSource", () => {
  it("produces a rejected/unavailable provenance carrying a reason", () => {
    const p = unavailableSource(
      "NSE_EQUITY_L",
      "NSE EQUITY_L.csv (main board)",
      "2026-08-12T10:00:00.000Z",
      "fetch failed: connection timeout",
    );
    expect(p.validationResult).toBe("UNAVAILABLE");
    expect(p.freshnessState).toBe("UNAVAILABLE");
    expect(p.rejectionDetail).toBe("fetch failed: connection timeout");
    expect(p.rowCount).toBe(0);
  });
});

// ── GUARD: mirror constant must not drift from the source of truth ──────────────

describe("NSE_REFERENCE_MAX_AGE_HOURS mirror guard", () => {
  it("mirror constant equals NSE_REFERENCE_MAX_AGE_HOURS declared in nseSecurityMaster.ts", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/lib/registry -> src/lib
    const masterPath = resolve(here, "..", "nseSecurityMaster.ts");
    const raw = readFileSync(masterPath, "utf8");

    // Strip comments so a stray mention in a doc comment cannot be mistaken for
    // the real declaration. Order: block comments first, then line comments.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    const match = stripped.match(
      /export\s+const\s+NSE_REFERENCE_MAX_AGE_HOURS\s*=\s*(\d+)\s*;/,
    );
    expect(match, "could not locate NSE_REFERENCE_MAX_AGE_HOURS declaration").not.toBeNull();

    const sourceValue = Number(match![1]);
    expect(Number.isInteger(sourceValue)).toBe(true);
    // This assertion FAILS if the two ever drift apart.
    expect(NSE_REFERENCE_MAX_AGE_HOURS_MIRROR).toBe(sourceValue);
  });
});
