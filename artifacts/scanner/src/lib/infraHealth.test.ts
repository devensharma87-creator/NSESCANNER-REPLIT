import { describe, it, expect } from "vitest";
import {
  deriveAgeSeverity,
  deriveCoverageSeverity,
  deriveSnapshotSeverity,
  deriveCandleSeverity,
  deriveSnapshotSectionSeverity,
  formatAge,
  rollUp,
  deriveP25Gate,
  gateStateToSeverity,
  deriveRsCoverage,
  latestTimestamp,
  derivePublicFreshness,
  type GateState,
  type SnapshotDiagnostics,
} from "./infraHealth";

const NOW = Date.parse("2026-05-15T13:00:00Z");

describe("deriveAgeSeverity", () => {
  it("returns fail for null / unparseable timestamps", () => {
    expect(deriveAgeSeverity(null, NOW, 30)).toBe("fail");
    expect(deriveAgeSeverity(undefined, NOW, 30)).toBe("fail");
    expect(deriveAgeSeverity("not-a-date", NOW, 30)).toBe("fail");
  });
  it("returns ok when age < threshold", () => {
    const t = new Date(NOW - 5 * 60_000).toISOString();
    expect(deriveAgeSeverity(t, NOW, 30)).toBe("ok");
  });
  it("returns stale when threshold <= age < 2*threshold", () => {
    const t = new Date(NOW - 45 * 60_000).toISOString();
    expect(deriveAgeSeverity(t, NOW, 30)).toBe("stale");
  });
  it("returns fail when age >= 2*threshold", () => {
    const t = new Date(NOW - 120 * 60_000).toISOString();
    expect(deriveAgeSeverity(t, NOW, 30)).toBe("fail");
  });
  it("clamps future timestamps (clock skew) to ok", () => {
    const t = new Date(NOW + 60_000).toISOString();
    expect(deriveAgeSeverity(t, NOW, 30)).toBe("ok");
  });
});

describe("deriveCoverageSeverity", () => {
  it("100% → ok, 95-99 → warn, <95 → fail", () => {
    expect(deriveCoverageSeverity(100)).toBe("ok");
    expect(deriveCoverageSeverity(99.5)).toBe("warn");
    expect(deriveCoverageSeverity(94.9)).toBe("fail");
    expect(deriveCoverageSeverity(null)).toBe("fail");
  });
});

describe("deriveSnapshotSeverity", () => {
  const universe = ["NIFTY", "BANKNIFTY", "SENSEX"];
  it("disabled when ingestion env gate off", () => {
    const r = deriveSnapshotSeverity(
      { config: { enabled: false, universe }, todayRowsTotal: 0, coverage: [] },
      NOW,
    );
    expect(r.severity).toBe("disabled");
  });
  it("ok when all underlyings present and snapshots are fresh", () => {
    const fresh = new Date(NOW - 5 * 60_000).toISOString();
    const r = deriveSnapshotSeverity(
      {
        config: { enabled: true, universe },
        todayRowsTotal: 1000,
        coverage: universe.map((u) => ({ underlying: u, latest_snapshot: fresh })),
      },
      NOW,
    );
    expect(r.severity).toBe("ok");
  });
  it("fail when an underlying is missing entirely", () => {
    const fresh = new Date(NOW - 5 * 60_000).toISOString();
    const r = deriveSnapshotSeverity(
      {
        config: { enabled: true, universe },
        todayRowsTotal: 100,
        coverage: [{ underlying: "NIFTY", latest_snapshot: fresh }],
      },
      NOW,
    );
    expect(r.severity).toBe("fail");
    expect(r.reasons.join(" ")).toMatch(/BANKNIFTY/);
  });
  it("stale when one snapshot is older than threshold but <2x", () => {
    const fresh = new Date(NOW - 5 * 60_000).toISOString();
    const stale = new Date(NOW - 20 * 60_000).toISOString();
    const r = deriveSnapshotSeverity(
      {
        config: { enabled: true, universe },
        todayRowsTotal: 100,
        coverage: [
          { underlying: "NIFTY", latest_snapshot: fresh },
          { underlying: "BANKNIFTY", latest_snapshot: stale },
          { underlying: "SENSEX", latest_snapshot: fresh },
        ],
      },
      NOW,
      15,
    );
    expect(r.severity).toBe("stale");
  });
});

describe("deriveCandleSeverity", () => {
  it("fail when no intervals are reported", () => {
    expect(deriveCandleSeverity([], NOW).severity).toBe("fail");
  });
  it("uses interval-aware thresholds (day=36h, 15min=60min)", () => {
    const fresh = new Date(NOW - 5 * 60_000).toISOString();
    const dayOldish = new Date(NOW - 30 * 60 * 60_000).toISOString(); // 30h
    const r = deriveCandleSeverity(
      [
        { interval: "15minute", rows: 1000, latest_ts: fresh },
        { interval: "day", rows: 5000, latest_ts: dayOldish },
      ],
      NOW,
    );
    expect(r.severity).toBe("ok");
    expect(r.perInterval.find((p) => p.interval === "day")?.severity).toBe("ok");
  });
  it("flags 15min stale past 60min", () => {
    const stale = new Date(NOW - 90 * 60_000).toISOString();
    const fresh = new Date(NOW - 60_000).toISOString();
    const r = deriveCandleSeverity(
      [
        { interval: "15minute", rows: 1000, latest_ts: stale },
        { interval: "day", rows: 5000, latest_ts: fresh },
      ],
      NOW,
    );
    expect(r.severity).toBe("stale");
  });
});

describe("formatAge", () => {
  it("renders compact relative-time strings", () => {
    expect(formatAge(null, NOW)).toBe("—");
    expect(formatAge(new Date(NOW - 30_000).toISOString(), NOW)).toMatch(/s ago$/);
    expect(formatAge(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5m ago");
    expect(formatAge(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toMatch(/^3h /);
    expect(formatAge(new Date(NOW - 3 * 86400_000).toISOString(), NOW)).toMatch(/^3d /);
  });
});

describe("deriveSnapshotSectionSeverity (composition: diag + analytics)", () => {
  const universe = ["NIFTY", "BANKNIFTY", "SENSEX"];
  const fresh = new Date(NOW - 5 * 60_000).toISOString();
  const healthyDiag: SnapshotDiagnostics = {
    config: { enabled: true, universe },
    todayRowsTotal: 100,
    coverage: universe.map((u) => ({ underlying: u, latest_snapshot: fresh })),
  };
  it("ok when both diagnostics and analytics are healthy", () => {
    expect(
      deriveSnapshotSectionSeverity(
        { data: healthyDiag, error: null, loading: false },
        { data: { groups: [] }, error: null, loading: false },
        NOW,
      ),
    ).toBe("ok");
  });
  it("warn when analytics fails but diagnostics are healthy", () => {
    // Critical regression guard: section badge must NOT show OK when
    // analytics endpoint is down even if diagnostics are green.
    expect(
      deriveSnapshotSectionSeverity(
        { data: healthyDiag, error: null, loading: false },
        { data: null, error: "HTTP 500", loading: false },
        NOW,
      ),
    ).toBe("warn");
  });
  it("fail wins when diagnostics fail regardless of analytics", () => {
    expect(
      deriveSnapshotSectionSeverity(
        { data: null, error: "HTTP 500", loading: false },
        { data: { groups: [] }, error: null, loading: false },
        NOW,
      ),
    ).toBe("fail");
  });
  it("disabled when ingestion gate is off and analytics is healthy", () => {
    expect(
      deriveSnapshotSectionSeverity(
        { data: { ...healthyDiag, config: { enabled: false, universe } }, error: null, loading: false },
        { data: { groups: [] }, error: null, loading: false },
        NOW,
      ),
    ).toBe("disabled");
  });
});

describe("rollUp", () => {
  it("worst severity wins; fail > stale > warn > disabled > ok", () => {
    expect(rollUp(["ok", "ok", "ok"])).toBe("ok");
    expect(rollUp(["ok", "disabled", "ok"])).toBe("disabled");
    expect(rollUp(["ok", "warn", "disabled"])).toBe("warn");
    expect(rollUp(["stale", "warn", "ok"])).toBe("stale");
    expect(rollUp(["stale", "fail", "ok"])).toBe("fail");
  });
});

// ── W1A helpers ──────────────────────────────────────────────────────────────

describe("deriveP25Gate", () => {
  it("derives official from mfeAvailableCount, NOT raw row counts", () => {
    const g = deriveP25Gate({
      enabled: true,
      mfeAvailableCount: 5,
      rawRowCount: 41,
      processedRowCount: 14,
      lowSampleThreshold: 20,
      lowSampleWarning: true,
    });
    expect(g.official).toBe(5); // from mfeAvailableCount, not 41 or 14
    expect(g.threshold).toBe(20);
    expect(g.remaining).toBe(15);
    expect(g.excludedPreFix).toBe(9); // processedRowCount(14) - official(5)
    expect(g.rawRowCount).toBe(41);
    expect(g.gateOpen).toBe(true);
    expect(g.severity).toBe("warn");
  });

  it("falls back to threshold 20 and computes gateOpen when lowSampleWarning absent", () => {
    const g = deriveP25Gate({ enabled: true, mfeAvailableCount: 25, processedRowCount: 25 });
    expect(g.threshold).toBe(20);
    expect(g.remaining).toBe(0);
    expect(g.gateOpen).toBe(false); // 25 >= 20
    expect(g.severity).toBe("ok");
    expect(g.excludedPreFix).toBe(0);
  });

  it("returns disabled when the feature flag is off or report missing", () => {
    expect(deriveP25Gate({ enabled: false }).severity).toBe("disabled");
    expect(deriveP25Gate({ enabled: false }).enabled).toBe(false);
    expect(deriveP25Gate(null).severity).toBe("disabled");
    expect(deriveP25Gate(undefined).excludedPreFix).toBeNull();
  });

  it("never returns negative remaining or excludedPreFix", () => {
    const g = deriveP25Gate({
      enabled: true,
      mfeAvailableCount: 30,
      processedRowCount: 10,
      lowSampleThreshold: 20,
    });
    expect(g.remaining).toBe(0);
    expect(g.excludedPreFix).toBe(0); // max(0, 10 - 30)
  });
});

describe("gateStateToSeverity", () => {
  it("maps every GateState to a display severity", () => {
    const cases: Array<[GateState, string]> = [
      ["verified", "ok"],
      ["live_closed", "ok"],
      ["partial", "warn"],
      ["live_open", "warn"],
      ["pending", "disabled"],
      ["not_approved", "disabled"],
    ];
    for (const [state, sev] of cases) {
      expect(gateStateToSeverity(state)).toBe(sev);
    }
  });
});

describe("deriveRsCoverage", () => {
  it("counts string and numeric rsScore, skips null/non-numeric", () => {
    const r = deriveRsCoverage([
      { rsScore: "60" },
      { rsScore: 80 },
      { rsScore: null },
      { rsScore: undefined },
      { rsScore: "not-a-number" },
    ]);
    expect(r.total).toBe(5);
    expect(r.withRs).toBe(2);
    expect(r.coveragePct).toBe(40);
    expect(r.avgRsScore).toBe(70);
  });

  it("handles an empty list without dividing by zero", () => {
    const r = deriveRsCoverage([]);
    expect(r.total).toBe(0);
    expect(r.coveragePct).toBe(0);
    expect(r.avgRsScore).toBeNull();
  });
});

describe("latestTimestamp", () => {
  it("returns the most recent parseable timestamp, ignoring blanks", () => {
    expect(
      latestTimestamp([null, "2026-05-10T10:00:00Z", undefined, "2026-05-12T10:00:00Z", ""]),
    ).toBe("2026-05-12T10:00:00Z");
    expect(latestTimestamp([null, undefined, "bad"])).toBeNull();
    expect(latestTimestamp([])).toBeNull();
  });
});

describe("derivePublicFreshness", () => {
  it("returns ONLY public-safe fields (no owner diagnostics can leak)", () => {
    const f = derivePublicFreshness(
      { scanDate: "2026-05-15", intradayTimestamps: ["2026-05-15T12:55:00Z"] },
      NOW,
    );
    expect(Object.keys(f).sort()).toEqual(
      ["label", "lastIntradayRefreshAt", "scanDate", "severity"].sort(),
    );
  });

  it("is Live when intraday refresh is within the threshold", () => {
    const f = derivePublicFreshness(
      { scanDate: "2026-05-15", intradayTimestamps: ["2026-05-15T12:55:00Z"] },
      NOW,
    );
    expect(f.severity).toBe("ok");
    expect(f.label).toBe("Live");
    expect(f.lastIntradayRefreshAt).toBe("2026-05-15T12:55:00Z");
  });

  it("falls back to daily-scan-only when no intraday timestamps exist", () => {
    const f = derivePublicFreshness({ scanDate: "2026-05-15", intradayTimestamps: [] }, NOW);
    expect(f.severity).toBe("disabled");
    expect(f.label).toBe("Daily scan only");
    expect(f.lastIntradayRefreshAt).toBeNull();
  });

  it("reports no scan when both scan date and intraday are absent", () => {
    const f = derivePublicFreshness({ scanDate: null, intradayTimestamps: [] }, NOW);
    expect(f.severity).toBe("fail");
    expect(f.label).toBe("No scan yet");
  });
});
