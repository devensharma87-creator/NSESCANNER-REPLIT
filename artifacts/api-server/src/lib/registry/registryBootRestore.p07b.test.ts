/**
 * PHASE 0.7B — BOOT-TIME SCHEMA-5 REGISTRY RESTORATION CONTRACT.
 *
 * These tests exercise the PRODUCTION restore path (`loadLatestAcceptedGeneration`
 * and the shared verification it delegates to), never a re-implementation of it.
 * The database is faked at module scope, so:
 *
 *   - no connection is ever opened,
 *   - every statement the loader issues is captured verbatim and asserted to be
 *     read-only,
 *   - and each rejection scenario is produced by feeding the loader a payload,
 *     exactly as a corrupt row would.
 *
 * The two questions kept apart everywhere below:
 *   INTEGRITY — do the stored bytes describe the generation they claim? Immutable.
 *   AUTHORITY — may that generation speak for NOW? Re-evaluated at boot instant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Boot-ordering source guard ──────────────────────────────────────────────

/**
 * Remove comments while preserving string literals.
 *
 * index.ts DOCUMENTS the accepted ordering in prose, so its comments mention
 * `server.listen()` twice. A scan that did not strip comments would find those
 * mentions and conclude the entry point opens a listener it does not open.
 */
function stripCommentsKeepStrings(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * The accepted boot ordering, as two linked facts:
 *
 *   index.ts    restoration is AWAITED and SETTLES, then control passes to the
 *               startup seam. The entry point never opens a listener itself.
 *   the seam    shutdown protection is installed, marked, and only then is the
 *               listener opened.
 *
 * Split this way because the listener call physically moved out of index.ts
 * into `startupListenerPhase.ts`. Asserting only "index.ts contains no
 * listen()" would be satisfied by deleting the listener entirely, so the seam's
 * real call is located and ordered too.
 *
 * Both inputs must already be comment-stripped.
 */
function bootOrderingViolations(entry: string, seam: string): string[] {
  const v: string[] = [];

  if (/\b(?:app|server)\.listen\s*\(/.test(entry)) v.push("ENTRY_OPENS_LISTENER_DIRECTLY");

  const restoreAt = entry.indexOf('await loadLatestAcceptedGeneration("STARTUP_L2_RESTORE")');
  if (restoreAt < 0) v.push("RESTORATION_NOT_AWAITED");

  const settledAt = entry.indexOf('proofMark("RESTORATION_SETTLED")');
  if (settledAt < 0) v.push("RESTORATION_NEVER_MARKED_SETTLED");
  else if (restoreAt >= 0 && settledAt < restoreAt) v.push("SETTLED_MARKED_BEFORE_RESTORE");

  const phaseAt = entry.indexOf("runStartupListenerPhase({");
  if (phaseAt < 0) v.push("ENTRY_DOES_NOT_DELEGATE_TO_STARTUP_SEAM");
  else if (settledAt >= 0 && phaseAt < settledAt) v.push("STARTUP_PHASE_BEFORE_RESTORATION_SETTLED");

  const installAt = seam.indexOf("opts.installLifecycle()");
  const markAt = seam.indexOf('opts.proofMark("SHUTDOWN_INSTALLED")');
  const listenAt = seam.indexOf("opts.server.listen(");
  if (listenAt < 0) v.push("SEAM_HAS_NO_LISTENER_CALL");
  if (installAt < 0) v.push("SEAM_DOES_NOT_INSTALL_LIFECYCLE");
  if (markAt < 0) v.push("SEAM_DOES_NOT_MARK_SHUTDOWN_INSTALLED");
  if (installAt >= 0 && listenAt >= 0 && listenAt < installAt) {
    v.push("LISTEN_BEFORE_LIFECYCLE_INSTALL");
  }
  if (markAt >= 0 && listenAt >= 0 && listenAt < markAt) {
    v.push("LISTEN_BEFORE_SHUTDOWN_INSTALLED");
  }
  return v;
}

// ── Fake durable store ──────────────────────────────────────────────────────

interface Issued {
  text: string;
}

const fakeDb = {
  /** Every statement issued by the module under test, in order. */
  issued: [] as Issued[],
  /** to_regclass answer: the table exists unless a test says otherwise. */
  tablePresent: true,
  /** Row returned by the manifest SELECT (undefined = no compatible row). */
  row: undefined as { manifest: unknown; records: unknown } | undefined,
  /** When set, db.execute throws — models an unreachable durable store. */
  throwOnQuery: false,
};

function readQuery(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
  let text = "";
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown }).value;
    if (Array.isArray(value)) text += value.join("");
  }
  return text.replace(/\s+/g, " ").trim();
}

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async (query: unknown) => {
      const text = readQuery(query);
      fakeDb.issued.push({ text });
      if (fakeDb.throwOnQuery) throw new Error("simulated durable store outage");
      if (/to_regclass/i.test(text)) {
        return { rows: [{ reg: fakeDb.tablePresent ? "instrument_universe_manifests" : null }] };
      }
      return { rows: fakeDb.row ? [fakeDb.row] : [] };
    }),
    transaction: vi.fn(async () => {
      throw new Error("the restore path must never open a write transaction");
    }),
  },
}));

// ── Fake L1 disk layer ──────────────────────────────────────────────────────

const fakeDisk = { blob: null as { payload: unknown } | null, throws: false };

vi.mock("../diskCache", () => ({
  loadBlob: vi.fn(() => {
    if (fakeDisk.throws) throw new Error("simulated disk failure");
    return fakeDisk.blob;
  }),
  saveBlob: vi.fn(() => {
    throw new Error("the restore path must never write the disk cache");
  }),
}));

import {
  loadLatestAcceptedGeneration,
  evaluateLoadedGeneration,
  getActiveGeneration,
  getActiveGenerationAuthority,
  getSettledActiveGeneration,
  getRegistryRestorationDiagnostics,
  isRegistryRestorationSettled,
  _resetRestorationStateForTest,
  _resetAuthorityMemoForTest,
  _setActiveGenerationForTest,
  MIN_RECORDS_FOR_COMMIT,
  type RegistryGeneration,
} from "./manifestStore";
import {
  buildUniverseManifest,
  computeManifestChecksum,
  MANIFEST_SCHEMA_VERSION,
  CLASSIFICATION_POLICY_VERSION,
  REQUIRED_SOURCE_IDS,
  type BuildManifestInput,
  type InstrumentUniverseManifest,
} from "./universeManifest";
import { AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED } from "../marketData/aggregateCoverage";
import { toAuthoritativeCoverageManifest, __resetCalendarAuthorityMemo } from "./coverageBridge";
import type { TradingCalendarCommitment } from "./exchangeCalendar";
import type { RegistryRecord } from "./instrumentRegistry";
import {
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
} from "./p06TestFixtures";

/**
 * The fixture calendar's committed BSE reconciliation is bound to the session
 * completed at GENERATED_AT. Evaluated at that instant it is current; evaluated
 * days later a newer session has completed and it is only last-known.
 */
const CURRENT_INSTANT = Date.parse(GENERATED_AT);
const LATER_INSTANT = Date.parse("2026-08-20T09:30:00.000Z");
const NEXT_YEAR_INSTANT = Date.parse("2027-03-04T09:30:00.000Z");

function buildInput(
  records: readonly RegistryRecord[],
  overrides: Partial<BuildManifestInput> = {},
): BuildManifestInput {
  return {
    build: makeBuildResult(records),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId: GEN_ID,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    bseAuthority: makeCurrentAuthoritativeBse(),
    tradingCalendar: makeCalendarCommitment(),
    ...overrides,
  };
}

/** A valid Schema-5 generation at the durability floor. */
function makeValidGeneration(overrides: Partial<BuildManifestInput> = {}): RegistryGeneration {
  const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
  return { manifest: buildUniverseManifest(buildInput(records, overrides)), records };
}

/**
 * Swap in a tampered calendar commitment and RECOMPUTE the manifest checksum
 * over the tampered bytes — the hand-edited-row scenario. Without recomputing,
 * the manifest checksum gate fires first and the calendar gate is never
 * reached; rebuilding through `buildUniverseManifest` instead produces a
 * REJECTED manifest, which is a different refusal again. Only this shape
 * actually asks "does the loader re-verify the embedded calendar itself?".
 */
function withCalendar(patch: Partial<TradingCalendarCommitment>): RegistryGeneration {
  const base = makeValidGeneration();
  const { manifestChecksum: _drop, ...rest } = base.manifest;
  const swapped = {
    ...rest,
    tradingCalendar: { ...base.manifest.tradingCalendar, ...patch },
  };
  return {
    manifest: { ...swapped, manifestChecksum: computeManifestChecksum(swapped) },
    records: base.records,
  };
}

/** Present a generation as the durable row the loader will read. */
function asRow(gen: RegistryGeneration): { manifest: unknown; records: unknown } {
  return { manifest: gen.manifest, records: gen.records };
}

function tamper(
  m: InstrumentUniverseManifest,
  patch: Partial<InstrumentUniverseManifest>,
): InstrumentUniverseManifest {
  return { ...m, ...patch };
}

beforeEach(() => {
  fakeDb.issued = [];
  fakeDb.tablePresent = true;
  fakeDb.row = undefined;
  fakeDb.throwOnQuery = false;
  fakeDisk.blob = null;
  fakeDisk.throws = false;
  _setActiveGenerationForTest(null);
  _resetRestorationStateForTest();
  _resetAuthorityMemoForTest();
  __resetCalendarAuthorityMemo();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CURRENT_INSTANT);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── G1–G4 · a valid Schema-5 generation restores, unchanged, as current ─────

describe("P07B valid restoration", () => {
  it("T1 restores the latest compatible Schema-5 generation from PostgreSQL", async () => {
    const gen = makeValidGeneration();
    fakeDb.row = asRow(gen);

    const restored = await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(restored).not.toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("RESTORED_CURRENT");
    expect(d.source).toBe("L2_POSTGRESQL");
    expect(d.settled).toBe(true);
    expect(d.blockerCode).toBeNull();
  });

  it("T2 restores the generation identity unchanged", async () => {
    fakeDb.row = asRow(makeValidGeneration());
    const restored = await loadLatestAcceptedGeneration("TEST_BOOT");
    expect(restored?.manifest.registryGenerationId).toBe(GEN_ID);
    expect(restored?.manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(restored?.manifest.policyVersion).toBe(CLASSIFICATION_POLICY_VERSION);
    expect(getRegistryRestorationDiagnostics().registryGenerationId).toBe(GEN_ID);
  });

  it("T3 restores the full record set, matching the manifest's own count", async () => {
    const gen = makeValidGeneration();
    fakeDb.row = asRow(gen);
    const restored = await loadLatestAcceptedGeneration("TEST_BOOT");
    expect(restored?.records.length).toBe(MIN_RECORDS_FOR_COMMIT);
    expect(restored?.records.length).toBe(
      gen.manifest.totalOfficialRecords + gen.manifest.indexCount,
    );
    expect(getRegistryRestorationDiagnostics().recordCount).toBe(MIN_RECORDS_FOR_COMMIT);
  });

  it("T4 a calendar that still covers the boot instant restores as CURRENT and may authorize", async () => {
    fakeDb.row = asRow(makeValidGeneration());
    await loadLatestAcceptedGeneration("TEST_BOOT");
    expect(getRegistryRestorationDiagnostics().authorityState).toBe("CURRENT_AUTHORITATIVE");
    expect(getActiveGenerationAuthority().mayAuthorize).toBe(true);
  });
});

// ── G5–G6 · expired authority is separated from integrity ───────────────────

describe("P07B integrity and current authority are separate facts", () => {
  it("T5 an intact generation whose BSE session has been overtaken restores as LAST KNOWN", async () => {
    vi.setSystemTime(LATER_INSTANT);
    fakeDb.row = asRow(makeValidGeneration());

    const restored = await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(restored).not.toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("RESTORED_LAST_KNOWN");
    expect(d.blockerCode).toBe("AUTHORITY_EXPIRED");
    expect(d.authorityState).toBe("LAST_KNOWN");
  });

  it("T6 expired authority fails closed: the generation may not authorize a denominator", async () => {
    vi.setSystemTime(LATER_INSTANT);
    fakeDb.row = asRow(makeValidGeneration());
    await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(getActiveGenerationAuthority(LATER_INSTANT).mayAuthorize).toBe(false);
    expect(toAuthoritativeCoverageManifest(getSettledActiveGeneration(), LATER_INSTANT)).toBe(
      AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    );
  });

  it("T7 a boot instant in a year the committed calendar does not cover cannot authorize", async () => {
    vi.setSystemTime(NEXT_YEAR_INSTANT);
    fakeDb.row = asRow(makeValidGeneration());

    await loadLatestAcceptedGeneration("TEST_BOOT");

    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("RESTORED_LAST_KNOWN");
    expect(d.authorityState).toBe("LAST_KNOWN");
    expect(getActiveGenerationAuthority(NEXT_YEAR_INSTANT).mayAuthorize).toBe(false);
    expect(toAuthoritativeCoverageManifest(getSettledActiveGeneration(), NEXT_YEAR_INSTANT)).toBe(
      AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    );
  });

  it("T8 restoring does NOT rewrite the stored calendar figures when authority has expired", async () => {
    const gen = makeValidGeneration();
    const committed = JSON.parse(JSON.stringify(gen.manifest.tradingCalendar));
    vi.setSystemTime(LATER_INSTANT);
    fakeDb.row = asRow(gen);

    const restored = await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(restored?.manifest.tradingCalendar).toEqual(committed);
  });
});

// ── G7–G8 · incompatible schema / policy ────────────────────────────────────

/**
 * The SELECT filters the schema_version / policy_version COLUMNS, but those are
 * row metadata written by the writer — they are not the payload. These tests
 * feed a row whose columns satisfied the query while its stored manifest says
 * something else, which is precisely the disagreement the loader must catch.
 */
describe("P07B incompatible generations are refused", () => {
  for (const schemaVersion of [1, 2, 3, 4]) {
    it(`T9.${schemaVersion} a schema-${schemaVersion} generation is refused, not upgraded`, async () => {
      const gen = makeValidGeneration();
      fakeDb.row = asRow({ manifest: tamper(gen.manifest, { schemaVersion }), records: gen.records });

      const restored = await loadLatestAcceptedGeneration("TEST_BOOT");

      expect(restored).toBeNull();
      expect(getActiveGeneration()).toBeNull();
      const d = getRegistryRestorationDiagnostics();
      expect(d.state).toBe("INCOMPATIBLE_SCHEMA");
      expect(d.blockerCode).toBe("SCHEMA_VERSION_UNSUPPORTED");
      expect(d.settled).toBe(true);
    });
  }

  it("T10 an unsupported classification-policy version is refused", async () => {
    const gen = makeValidGeneration();
    fakeDb.row = asRow({
      manifest: tamper(gen.manifest, { policyVersion: CLASSIFICATION_POLICY_VERSION + 1 }),
      records: gen.records,
    });

    const restored = await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(restored).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("INCOMPATIBLE_SCHEMA");
    expect(d.blockerCode).toBe("POLICY_VERSION_UNSUPPORTED");
  });
});

// ── G9–G11 · payload integrity ──────────────────────────────────────────────

describe("P07B payload integrity", () => {
  it("T11 a tampered manifest payload is refused on its checksum", async () => {
    const gen = makeValidGeneration();
    fakeDb.row = asRow({
      manifest: tamper(gen.manifest, { totalOfficialRecords: gen.manifest.totalOfficialRecords + 1 }),
      records: gen.records,
    });

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("CHECKSUM_MISMATCH");
    expect(d.blockerCode).toBe("MANIFEST_CHECKSUM_MISMATCH");
  });

  it("T12 a mutated record set is refused on its record-set commitment", async () => {
    const gen = makeValidGeneration();
    const mutated = gen.records.map((r, i) =>
      i === 0 ? { ...r, listingStatus: "SUSPENDED" as const } : r,
    );
    fakeDb.row = asRow({ manifest: gen.manifest, records: mutated });

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("CHECKSUM_MISMATCH");
    expect(d.blockerCode).toBe("RECORD_SET_HASH_MISMATCH");
  });

  it("T13 a truncated record set is refused — the record count is bound by the commitment", async () => {
    const gen = makeValidGeneration();
    fakeDb.row = asRow({ manifest: gen.manifest, records: gen.records.slice(0, -1) });

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("CHECKSUM_MISMATCH");
    // The record-set hash commits the COUNT as well as the rows, so truncation
    // is caught there before the arithmetic count gate is reached. Both refuse.
    expect(["ELIGIBLE_LIVE_SET_HASH_MISMATCH", "RECORD_SET_HASH_MISMATCH", "RECORD_COUNT_MISMATCH"]).toContain(d.blockerCode);
  });

  it("T14 the arithmetic record-count gate refuses a manifest that miscounts its own records", async () => {
    // Every hash still matches the rows; only the manifest's own arithmetic is
    // wrong, and its checksum has been recomputed so the earlier gates pass.
    // This is the one shape that isolates the count backstop.
    const base = makeValidGeneration();
    const { manifestChecksum: _drop, ...rest } = base.manifest;
    const miscounted = { ...rest, totalOfficialRecords: base.manifest.totalOfficialRecords - 1 };
    fakeDb.row = asRow({
      manifest: { ...miscounted, manifestChecksum: computeManifestChecksum(miscounted) },
      records: base.records,
    });

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("CHECKSUM_MISMATCH");
    expect(d.blockerCode).toBe("RECORD_COUNT_MISMATCH");
  });
});

// ── G12–G13 · calendar commitment integrity ─────────────────────────────────

describe("P07B embedded calendar commitment", () => {
  it("T15 a calendar whose checksum does not match its own contents is refused", async () => {
    fakeDb.row = asRow(withCalendar({ calendarChecksum: "0".repeat(64) }));

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    expect(getActiveGeneration()).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("CALENDAR_COMMITMENT_INVALID");
    expect(d.blockerCode).toBe("CALENDAR_COMMITMENT_UNVERIFIABLE");
  });

  it("T16 a fabricated latest-completed-session claim is refused, not believed", async () => {
    const real = makeCalendarCommitment();
    fakeDb.row = asRow(
      withCalendar({
        latestCompletedSession: { ...real.latestCompletedSession, BSE: "2026-08-07" },
      }),
    );

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    expect(getActiveGeneration()).toBeNull();
    expect(getRegistryRestorationDiagnostics().state).toBe("CALENDAR_COMMITMENT_INVALID");
  });
});

// ── G14–G15 · store-level failures ──────────────────────────────────────────

describe("P07B durable-store failures", () => {
  it("T17 an unreachable durable store reports DATABASE_UNAVAILABLE, not an empty universe", async () => {
    fakeDb.throwOnQuery = true;

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("DATABASE_UNAVAILABLE");
    expect(d.blockerCode).toBe("DURABLE_STORE_QUERY_FAILED");
    expect(d.settled).toBe(true);
    expect(getSettledActiveGeneration()).toBeNull();
  });

  it("T17b an outage is not silently substituted by a valid disk generation", async () => {
    fakeDisk.blob = { payload: makeValidGeneration() };
    fakeDb.throwOnQuery = true;

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("DATABASE_UNAVAILABLE");
    expect(d.source).toBeNull();
    expect(getActiveGeneration()).toBeNull();
    expect(getSettledActiveGeneration()).toBeNull();
  });

  it("T17c the disk layer still answers when the store cleanly has nothing", async () => {
    fakeDisk.blob = { payload: makeValidGeneration() };
    fakeDb.row = undefined;

    const restored = await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(restored).not.toBeNull();
    expect(getRegistryRestorationDiagnostics().source).toBe("L1_DISK");
    expect(getRegistryRestorationDiagnostics().state).toBe("RESTORED_CURRENT");
  });

  it("T18 no compatible row reports NOT_CONFIGURED", async () => {
    fakeDb.row = undefined;

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    const d = getRegistryRestorationDiagnostics();
    expect(d.state).toBe("NOT_CONFIGURED");
    expect(d.blockerCode).toBe("NO_COMPATIBLE_GENERATION");
  });

  it("T19 an absent table reports NOT_CONFIGURED and issues no DDL to create it", async () => {
    fakeDb.tablePresent = false;

    expect(await loadLatestAcceptedGeneration("TEST_BOOT")).toBeNull();
    expect(getRegistryRestorationDiagnostics().state).toBe("NOT_CONFIGURED");
    expect(fakeDb.issued.every((s) => /^SELECT\b/i.test(s.text))).toBe(true);
  });
});

// ── G16–G17 · consumers cannot outrun restoration ───────────────────────────

describe("P07B consumers cannot claim coverage before restoration settles", () => {
  it("T20 before restoration runs, the settled accessor withholds even a loaded generation", () => {
    _setActiveGenerationForTest(makeValidGeneration());

    expect(isRegistryRestorationSettled()).toBe(false);
    expect(getSettledActiveGeneration()).toBeNull();
    expect(toAuthoritativeCoverageManifest(getSettledActiveGeneration(), CURRENT_INSTANT)).toBe(
      AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    );
  });

  it("T21 a refused restoration yields a not-configured denominator, never an empty authoritative one", async () => {
    fakeDb.row = asRow(withCalendar({ calendarChecksum: "0".repeat(64) }));
    await loadLatestAcceptedGeneration("TEST_BOOT");

    const manifest = toAuthoritativeCoverageManifest(getSettledActiveGeneration(), CURRENT_INSTANT);
    expect(manifest).toBe(AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED);
    expect(manifest.coverageAuthority).toBe("UNIVERSE_NOT_CONFIGURED");
    expect(manifest.requiredInstrumentIds.length).toBe(0);
  });

  it("T21b a refusal REVOKES a universe an earlier restoration had installed", async () => {
    fakeDb.row = asRow(makeValidGeneration());
    await loadLatestAcceptedGeneration("TEST_BOOT");
    expect(getSettledActiveGeneration()).not.toBeNull();

    // Second boot-time attempt: the store now answers with a corrupt row.
    const gen = makeValidGeneration();
    fakeDb.row = asRow({ manifest: tamper(gen.manifest, { schemaVersion: 4 }), records: gen.records });
    await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(getRegistryRestorationDiagnostics().state).toBe("INCOMPATIBLE_SCHEMA");
    expect(getActiveGeneration()).toBeNull();
    expect(getSettledActiveGeneration()).toBeNull();
    expect(getActiveGenerationAuthority().mayAuthorize).toBe(false);
    expect(toAuthoritativeCoverageManifest(getSettledActiveGeneration(), CURRENT_INSTANT)).toBe(
      AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    );
  });

  it("T22 a settled successful restoration does supply an authoritative denominator", async () => {
    fakeDb.row = asRow(makeValidGeneration());
    await loadLatestAcceptedGeneration("TEST_BOOT");

    const manifest = toAuthoritativeCoverageManifest(getSettledActiveGeneration(), CURRENT_INSTANT);
    expect(manifest.coverageAuthority).not.toBe("UNIVERSE_NOT_CONFIGURED");
    expect(manifest.requiredInstrumentIds.length).toBeGreaterThan(0);
  });
});

// ── G18–G20 · the restore path is read-only, provider-free and deterministic ─

describe("P07B restore path side-effect contract", () => {
  const MUTATING = /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|COPY)\b/i;

  it("T23 a successful restoration issues SELECT statements only", async () => {
    fakeDb.row = asRow(makeValidGeneration());
    await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(fakeDb.issued.length).toBeGreaterThan(0);
    for (const s of fakeDb.issued) {
      expect(s.text).toMatch(/^SELECT\b/i);
      expect(s.text).not.toMatch(MUTATING);
    }
  });

  it("T24 every refusal path is read-only too", async () => {
    const scenarios: Array<() => void> = [
      () => {
        fakeDb.tablePresent = false;
      },
      () => {
        fakeDb.row = undefined;
      },
      () => {
        fakeDb.row = asRow(withCalendar({ calendarChecksum: "0".repeat(64) }));
      },
      () => {
        const gen = makeValidGeneration();
        fakeDb.row = asRow({ manifest: tamper(gen.manifest, { schemaVersion: 4 }), records: gen.records });
      },
    ];
    for (const setup of scenarios) {
      fakeDb.issued = [];
      fakeDb.tablePresent = true;
      fakeDb.row = undefined;
      _resetRestorationStateForTest();
      setup();
      await loadLatestAcceptedGeneration("TEST_BOOT");
      for (const s of fakeDb.issued) {
        expect(s.text).toMatch(/^SELECT\b/i);
        expect(s.text).not.toMatch(MUTATING);
      }
    }
  });

  it("T25 the loader never opens a write transaction", async () => {
    fakeDb.row = asRow(makeValidGeneration());
    // db.transaction throws in the fake, so reaching it would fail this test.
    await expect(loadLatestAcceptedGeneration("TEST_BOOT")).resolves.not.toBeNull();
  });

  it("T26 the restore path imports no market-data provider and opens no subscription", () => {
    const store = readFileSync(new URL("./manifestStore.ts", import.meta.url), "utf8");
    const imports = store.match(/^import[\s\S]*?from\s+"[^"]+";/gm) ?? [];
    const joined = imports.join("\n");
    for (const forbidden of ["kite", "upstox", "yahoo", "indianapi", "binance", "ticker", "websocket"]) {
      expect(joined.toLowerCase()).not.toContain(forbidden);
    }
    expect(store).not.toMatch(/\bsubscribe\s*\(/);

    const entry = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
    const restoreBlock = entry.slice(entry.indexOf("Step 5"));
    expect(restoreBlock).toContain("loadLatestAcceptedGeneration");
    expect(restoreBlock.toLowerCase()).not.toContain("kite");
  });

  it("T27 restoration settles and shutdown protection installs BEFORE the listener opens", () => {
    const entry = stripCommentsKeepStrings(
      readFileSync(new URL("../../index.ts", import.meta.url), "utf8"),
    );
    const seam = stripCommentsKeepStrings(
      readFileSync(new URL("../lifecycle/startupListenerPhase.ts", import.meta.url), "utf8"),
    );
    expect(bootOrderingViolations(entry, seam)).toEqual([]);
  });

  /**
   * NON-VACUITY. The guard above is a source scan, so it must be shown to FAIL
   * when the ordering it protects is broken — otherwise a future refactor could
   * rename the listener call and the check would pass by finding nothing.
   */
  it("T27b the boot-ordering guard rejects each defect it protects against", () => {
    const entry = stripCommentsKeepStrings(
      readFileSync(new URL("../../index.ts", import.meta.url), "utf8"),
    );
    const seam = stripCommentsKeepStrings(
      readFileSync(new URL("../lifecycle/startupListenerPhase.ts", import.meta.url), "utf8"),
    );

    // A listener opened directly from the entry point, bypassing the seam that
    // guarantees shutdown protection is installed first.
    expect(bootOrderingViolations(`${entry}\napp.listen(port);\n`, seam)).toContain(
      "ENTRY_OPENS_LISTENER_DIRECTLY",
    );
    expect(bootOrderingViolations(`${entry}\nserver.listen(port);\n`, seam)).toContain(
      "ENTRY_OPENS_LISTENER_DIRECTLY",
    );

    // Restoration no longer awaited before the startup phase is handed control.
    expect(
      bootOrderingViolations(
        entry.replace('await loadLatestAcceptedGeneration("STARTUP_L2_RESTORE")', "void 0"),
        seam,
      ),
    ).toContain("RESTORATION_NOT_AWAITED");

    // Listener opened before shutdown protection is installed.
    // Move the marker from before the listen call into the listen callback, so
    // it is only reached once the port is already open.
    const reordered = seam
      .replace('opts.proofMark("SHUTDOWN_INSTALLED");', "")
      .replace('opts.proofMark("LISTENING");', 'opts.proofMark("SHUTDOWN_INSTALLED");');
    expect(bootOrderingViolations(entry, reordered)).toContain("LISTEN_BEFORE_SHUTDOWN_INSTALLED");

    // A listener call that exists only in a COMMENT must not satisfy the guard,
    // and must not be mistaken for a real one either. index.ts genuinely
    // mentions `server.listen()` in its ordering comments.
    expect(bootOrderingViolations(entry, seam.replace("opts.server.listen(", "// opts.listen("))).toContain(
      "SEAM_HAS_NO_LISTENER_CALL",
    );
  });

  it("T28 repeating the restoration is deterministic and creates nothing", async () => {
    fakeDb.row = asRow(makeValidGeneration());

    const first = await loadLatestAcceptedGeneration("TEST_BOOT");
    const firstStatements = fakeDb.issued.length;
    const second = await loadLatestAcceptedGeneration("TEST_BOOT");

    expect(second?.manifest.registryGenerationId).toBe(first?.manifest.registryGenerationId);
    expect(second?.records.length).toBe(first?.records.length);
    expect(getRegistryRestorationDiagnostics().state).toBe("RESTORED_CURRENT");
    expect(fakeDb.issued.length).toBe(firstStatements * 2);
    for (const s of fakeDb.issued) expect(s.text).not.toMatch(MUTATING);
  });
});

// ── G21 · safety locks untouched ────────────────────────────────────────────

describe("P07B safety locks remain disabled", () => {
  it("T29 all four runtime authorization locks are still false", () => {
    const candle = readFileSync(new URL("../candleEvaluationControl.ts", import.meta.url), "utf8");
    const paper = readFileSync(new URL("../v2PaperLocks.ts", import.meta.url), "utf8");
    expect(candle).toContain("const FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean");
    expect(candle).toContain("const SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean");
    expect(paper).toContain("const FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean");
    expect(paper).toContain("const SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean");
  });
});
