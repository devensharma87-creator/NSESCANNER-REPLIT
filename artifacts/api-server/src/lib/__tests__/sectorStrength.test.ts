/**
 * S4b (2026-05-28) — pure aggregator unit tests for sector-strength.
 *
 * Verifies the aggregator math, the low-confidence partition, the
 * deterministic sort order, the unavailable-metrics surface, and the
 * static guard that the pure helper does NOT pull in any I/O / DB /
 * Kite / scoring modules.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeSectorStrength,
  SECTOR_STRENGTH_MIN_MEMBERS,
  type SectorStrengthInputRow,
} from "../sectorStrength";

function row(
  symbol: string,
  sector: string | null,
  score: number,
  rsScore: number | null,
  action: string = "WATCH",
  extras: Partial<SectorStrengthInputRow> = {},
): SectorStrengthInputRow {
  return {
    symbol,
    sector,
    industry: extras.industry ?? null,
    score,
    rsScore,
    rs20: extras.rs20 ?? null,
    rs50: extras.rs50 ?? null,
    rs120: extras.rs120 ?? null,
    action,
  };
}

// Helper: build N rows for a sector with a baseline score/RS.
function bulk(
  sector: string,
  n: number,
  baseScore: number,
  baseRs: number,
): SectorStrengthInputRow[] {
  return Array.from({ length: n }, (_, i) =>
    row(`${sector}${i}`, sector, baseScore + i, baseRs + i, "BUY", {
      rs20: baseRs + i,
      rs50: baseRs + i - 1,
      rs120: baseRs + i - 2,
    }),
  );
}

describe("computeSectorStrength (S4b pure aggregator)", () => {
  it("returns an empty summary for empty input", () => {
    const s = computeSectorStrength([], { scanDate: null, nowIso: "2026-05-28T07:00:00Z" });
    expect(s).toMatchObject({
      generatedAt: "2026-05-28T07:00:00Z",
      scanDate: null,
      totalRows: 0,
      totalSectors: 0,
      confidentSectors: 0,
      minMembers: SECTOR_STRENGTH_MIN_MEMBERS,
      sectors: [],
    });
    expect(s.unavailableMetrics.length).toBeGreaterThanOrEqual(4);
    expect(s.unavailableMetrics.map((u) => u.metric)).toEqual(
      expect.arrayContaining(["pctAboveEma20", "pctAboveEma50", "pctAboveEma200", "pct20dHigh"]),
    );
  });

  it("groups by sector, computes averages, and ranks confident sectors by avgRsScore desc", () => {
    const rows: SectorStrengthInputRow[] = [
      ...bulk("Auto", 6, 60, 70), // avgRs ~ 72.5
      ...bulk("IT", 6, 50, 80), // avgRs ~ 82.5  ← should rank #1
      ...bulk("FMCG", 6, 55, 60), // avgRs ~ 62.5  ← should rank #3
    ];
    const s = computeSectorStrength(rows, { scanDate: "2026-05-28", nowIso: "x" });
    expect(s.totalRows).toBe(18);
    expect(s.totalSectors).toBe(3);
    expect(s.confidentSectors).toBe(3);
    const ranks = Object.fromEntries(s.sectors.map((x) => [x.sector, x.rank]));
    expect(ranks).toEqual({ IT: 1, Auto: 2, FMCG: 3 });
    const ordered = s.sectors.map((x) => x.sector);
    expect(ordered).toEqual(["IT", "Auto", "FMCG"]);
  });

  it("marks sectors below the member-count floor as low-confidence and gives them rank=null", () => {
    const rows: SectorStrengthInputRow[] = [
      ...bulk("Auto", SECTOR_STRENGTH_MIN_MEMBERS, 60, 70),
      ...bulk("Cement", SECTOR_STRENGTH_MIN_MEMBERS - 1, 80, 90), // would-be #1 by RS but unconfident
    ];
    const s = computeSectorStrength(rows, { scanDate: "2026-05-28" });
    expect(s.confidentSectors).toBe(1);
    const auto = s.sectors.find((x) => x.sector === "Auto")!;
    const cement = s.sectors.find((x) => x.sector === "Cement")!;
    expect(auto.confident).toBe(true);
    expect(auto.rank).toBe(1);
    expect(cement.confident).toBe(false);
    expect(cement.rank).toBeNull();
    // Confident appears before unconfident regardless of avgRsScore.
    expect(s.sectors[0]!.sector).toBe("Auto");
    expect(s.sectors[1]!.sector).toBe("Cement");
  });

  it("counts actions correctly and limits top-N lists to 5", () => {
    const rows: SectorStrengthInputRow[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push(row(`X${i}`, "Auto", 50 + i, 60 + i, i < 3 ? "BUY ZONE" : i < 6 ? "BUY" : "WATCH", { rs20: 60 + i, rs50: 60 + i, rs120: 60 + i }));
    }
    const s = computeSectorStrength(rows, { scanDate: "2026-05-28" });
    const auto = s.sectors[0]!;
    expect(auto.actionCounts).toEqual({ "BUY ZONE": 3, BUY: 3, WATCH: 2 });
    expect(auto.topByScore).toHaveLength(5);
    expect(auto.topByRsScore).toHaveLength(5);
    expect(auto.topByScore[0]!.symbol).toBe("X7");
    expect(auto.topByRsScore[0]!.symbol).toBe("X7");
  });

  it("handles partial nulls — sectors with no rs data get avgRsScore=null but still get a confident rank slot at the bottom", () => {
    const rows: SectorStrengthInputRow[] = [
      ...bulk("Auto", 6, 60, 70),
      ...Array.from({ length: 6 }, (_, i) => row(`Y${i}`, "Cement", 55 + i, null, "BUY")),
    ];
    const s = computeSectorStrength(rows, { scanDate: "2026-05-28" });
    expect(s.confidentSectors).toBe(2);
    const cement = s.sectors.find((x) => x.sector === "Cement")!;
    expect(cement.avgRsScore).toBeNull();
    expect(cement.confident).toBe(true);
    // Cement (null RS) should sort to the bottom of the confident group.
    expect(s.sectors.map((x) => x.sector)).toEqual(["Auto", "Cement"]);
    expect(cement.rank).toBe(2);
  });

  it("drops rows with null / empty / whitespace sector", () => {
    const rows: SectorStrengthInputRow[] = [
      ...bulk("Auto", 5, 60, 70),
      row("ORPHAN1", null, 80, 90),
      row("ORPHAN2", "", 80, 90),
      row("ORPHAN3", "   ", 80, 90),
    ];
    const s = computeSectorStrength(rows, { scanDate: "2026-05-28" });
    expect(s.totalRows).toBe(8); // raw input count is preserved
    expect(s.totalSectors).toBe(1);
    expect(s.sectors[0]!.memberCount).toBe(5);
  });

  it("input rows are not mutated by the aggregator", () => {
    const rows = bulk("Auto", 6, 60, 70);
    const snapshot = JSON.parse(JSON.stringify(rows));
    computeSectorStrength(rows, { scanDate: "2026-05-28" });
    expect(rows).toEqual(snapshot);
  });
});

describe("sectorStrength.ts static dependency guard", () => {
  // Scope-creep guard, same pattern used by swingScannerData.benchmark.test.ts.
  // The pure aggregator must NEVER import I/O, DB, Kite, scoring, or paper-
  // trader modules. If a future refactor accidentally pulls one of these in,
  // this test fails fast and the architect review can catch the regression
  // before it ships.
  const FORBIDDEN = [
    "@workspace/db",
    "drizzle-orm",
    "../kiteClient",
    "../kiteAuth",
    "../yahoo",
    "../swingScanner",
    "../swingScannerData",
    "../swingScannerStore",
    "../scoring",
    "../optionSignals",
    "../paperAccount",
    "../paperTrading",
    "../fnoCostModel",
    "node-fetch",
    "axios",
  ];

  it("does not import any I/O / DB / Kite / scoring / paper-trader module", () => {
    const path = resolve(__dirname, "..", "sectorStrength.ts");
    const src = readFileSync(path, "utf8");
    for (const dep of FORBIDDEN) {
      expect(
        src.includes(`from "${dep}"`) || src.includes(`from '${dep}'`),
        `sectorStrength.ts must not import "${dep}" — pure aggregator scope`,
      ).toBe(false);
    }
  });
});

describe("universe.ts sector taxonomy (S4a)", () => {
  // S4a normalised three obvious sector aliases. Pin the normalisation so a
  // future re-edit of UNIVERSE_RAW that re-introduces "Automobile" /
  // "Information Technology" / "Realty" fails fast — it would otherwise
  // silently split sector aggregations.
  it("contains no rows using the obsolete alias sector labels", () => {
    const path = resolve(__dirname, "..", "universe.ts");
    const src = readFileSync(path, "utf8");
    expect(src.includes('sector: "Automobile"')).toBe(false);
    expect(src.includes('sector: "Information Technology"')).toBe(false);
    expect(src.includes('sector: "Realty"')).toBe(false);
  });

  it("does NOT merge ambiguous sector pairs left for owner decision", () => {
    // These pairs are intentionally preserved per S4a guardrails — they are
    // not obvious aliases and must NOT be silently merged. Test pins both
    // sides remain present so a future "cleanup" doesn't collapse them.
    // (Defence vs Capital Goods specifically: BEL / HAL / MAZDOCK / etc.
    // appear under both sectors in different copies of UNIVERSE_RAW.)
    const path = resolve(__dirname, "..", "universe.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toMatch(/sector: "Pharma"/);
    expect(src).toMatch(/sector: "Healthcare"/);
    expect(src).toMatch(/sector: "Banking"/);
    expect(src).toMatch(/sector: "Financials"/);
    expect(src).toMatch(/sector: "Defence"/);
    expect(src).toMatch(/sector: "Capital Goods"/);
  });
});

describe("computeSectorStrength — top-N determinism", () => {
  it("breaks score / rsScore ties on symbol ASC so output is DB-row-order-independent", () => {
    // All six rows have identical score AND identical rsScore. Without a
    // secondary tie-break the slice(0,5) winner would depend on input
    // order. The architect S4b review asked us to pin this.
    const rows: SectorStrengthInputRow[] = [
      row("ZEBRA", "Auto", 70, 80, "BUY", { rs20: 80, rs50: 80, rs120: 80 }),
      row("ALPHA", "Auto", 70, 80, "BUY", { rs20: 80, rs50: 80, rs120: 80 }),
      row("MIKE",  "Auto", 70, 80, "BUY", { rs20: 80, rs50: 80, rs120: 80 }),
      row("KILO",  "Auto", 70, 80, "BUY", { rs20: 80, rs50: 80, rs120: 80 }),
      row("BETA",  "Auto", 70, 80, "BUY", { rs20: 80, rs50: 80, rs120: 80 }),
      row("YANKEE","Auto", 70, 80, "BUY", { rs20: 80, rs50: 80, rs120: 80 }),
    ];
    const s = computeSectorStrength(rows, { scanDate: "2026-05-28" });
    const auto = s.sectors[0]!;
    expect(auto.topByScore.map((x) => x.symbol)).toEqual(["ALPHA", "BETA", "KILO", "MIKE", "YANKEE"]);
    expect(auto.topByRsScore.map((x) => x.symbol)).toEqual(["ALPHA", "BETA", "KILO", "MIKE", "YANKEE"]);
  });
});
