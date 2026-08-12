/**
 * PHASE 0.6A — RETENTION TRANSACTION CONTRACT.
 *
 * Retention is not a sweep and not a property of "some write happened". It is
 * paid for by an insert that actually created a row. These tests pin that
 * deterministically, with a fake transaction, so no database proof is needed:
 *
 *   insert created one row      → retention runs once, in that transaction
 *   ON CONFLICT DO NOTHING      → retention does not run at all
 *   validation failed           → no transaction, no insert, no retention
 *   insert threw                → no retention
 *   retention threw             → the new row goes down with it
 *
 * The fake transaction models PostgreSQL's atomicity honestly: statements are
 * staged and applied to the fake table only when the callback returns, and are
 * discarded when it throws — which is exactly what a rollback does.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Fake database ───────────────────────────────────────────────────────────

interface StoredRow {
  id: string;
  generated_at: string;
  registry_generation_id: string;
}

/** Statement text + bound parameters, as the module actually issued them. */
interface Issued {
  text: string;
  params: unknown[];
}

interface FakeDb {
  /** Rows that survived committed transactions. */
  table: StoredRow[];
  /** Statements issued inside the most recent transaction. */
  issued: Issued[];
  /** Rows the INSERT should RETURN (empty models ON CONFLICT DO NOTHING). */
  insertReturns: Array<{ id: string; saved_at: string }>;
  /** Throw when an issued statement matches this. */
  throwOn: RegExp | null;
  transactionCount: number;
}

const fake: FakeDb = {
  table: [],
  issued: [],
  insertReturns: [],
  throwOn: null,
  transactionCount: 0,
};

/** Flatten a drizzle SQL object into its literal text and bound parameters. */
function readQuery(query: unknown): Issued {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
  let text = "";
  const params: unknown[] = [];
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown }).value;
    // StringChunk carries the literal text; everything else is a bound value,
    // which drizzle keeps either as a primitive or inside a Param wrapper.
    if (Array.isArray(value)) text += value.join("");
    else if (value !== undefined) params.push(value);
    else params.push(chunk);
  }
  return { text: text.replace(/\s+/g, " ").trim(), params };
}

vi.mock("@workspace/db", () => ({
  db: {
    // ensureRegistrySchema() runs its DDL outside the transaction.
    execute: vi.fn(async () => ({ rows: [] })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      fake.transactionCount++;
      fake.issued = [];
      const staged: StoredRow[] = [...fake.table];
      const tx = {
        execute: async (query: unknown) => {
          const issued = readQuery(query);
          fake.issued.push(issued);
          if (fake.throwOn && fake.throwOn.test(issued.text)) {
            throw new Error(`simulated failure: ${issued.text.slice(0, 40)}`);
          }
          if (/^INSERT INTO instrument_universe_manifests/i.test(issued.text)) {
            for (const row of fake.insertReturns) {
              staged.push({
                id: row.id,
                generated_at: new Date().toISOString(),
                registry_generation_id: String(issued.params[0]),
              });
            }
            return { rows: fake.insertReturns };
          }
          if (/^DELETE FROM instrument_universe_manifests/i.test(issued.text)) {
            const keep = Number(issued.params[issued.params.length - 1]);
            const survivors = [...staged]
              .sort((a, b) =>
                a.generated_at === b.generated_at
                  ? b.id.localeCompare(a.id)
                  : b.generated_at.localeCompare(a.generated_at),
              )
              .slice(0, keep);
            staged.length = 0;
            staged.push(...survivors);
            return { rows: [] };
          }
          return { rows: [] };
        },
      };
      const result = await callback(tx);
      // Reached only when the callback did not throw: this is the commit.
      fake.table = staged;
      return result;
    }),
  },
}));

import { saveRegistryGeneration, acceptLoadedGeneration, MIN_RECORDS_FOR_COMMIT } from "./manifestStore";
import { buildUniverseManifest, REQUIRED_SOURCE_IDS, MANIFEST_SCHEMA_VERSION } from "./universeManifest";
import {
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
} from "./p06TestFixtures";

const STORE_SRC = readFileSync(new URL("./manifestStore.ts", import.meta.url), "utf8");
const NOW_MS = Date.parse(GENERATED_AT) + 60_000;

function makeGeneration(registryGenerationId = GEN_ID) {
  const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
  const manifest = buildUniverseManifest({
    build: makeBuildResult(records),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    bseAuthority: makeCurrentAuthoritativeBse(),
    tradingCalendar: makeCalendarCommitment(),
  });
  return { manifest, records };
}

function seedTable(count: number): StoredRow[] {
  const rows: StoredRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      // Two rows deliberately share a timestamp, so retention ordering has to
      // be deterministic rather than whatever the planner returns.
      generated_at: i <= 1 ? "2026-08-01T00:00:00.000Z" : `2026-08-0${i + 1}T00:00:00.000Z`,
      registry_generation_id: `OLD-${i}`,
    });
  }
  return rows;
}

const deletes = () => fake.issued.filter((s) => /^DELETE/i.test(s.text));

beforeEach(() => {
  fake.table = seedTable(5);
  fake.issued = [];
  fake.insertReturns = [];
  fake.throwOn = null;
  fake.transactionCount = 0;
});

describe("P06A retention runs only after an actual insert", () => {
  it("T69 a successful new insert invokes retention exactly once, in the same transaction", async () => {
    fake.insertReturns = [{ id: "new-1", saved_at: "2026-08-12T12:00:00.000Z" }];
    const result = await saveRegistryGeneration(makeGeneration());

    expect(result.ok).toBe(true);
    expect(result.durablyCommitted).toBe(true);
    expect(fake.transactionCount).toBe(1);
    expect(deletes()).toHaveLength(1);
    // Ordering matters: the DELETE is issued after the INSERT, never before.
    const order = fake.issued.map((s) => s.text.slice(0, 6));
    expect(order.indexOf("DELETE")).toBeGreaterThan(order.indexOf("INSERT"));
  });

  it("T70 a duplicate (ON CONFLICT DO NOTHING) insert invokes retention zero times", async () => {
    fake.insertReturns = [];
    const result = await saveRegistryGeneration(makeGeneration());

    expect(result.ok).toBe(true);
    expect(result.durablyCommitted).toBe(false);
    expect(fake.issued.some((s) => /^INSERT/i.test(s.text))).toBe(true);
    expect(deletes()).toHaveLength(0);
  });

  it("T71 a validation failure opens no transaction and invokes retention zero times", async () => {
    const gen = makeGeneration();
    const tooFew = { manifest: gen.manifest, records: gen.records.slice(0, 10) };
    const result = await saveRegistryGeneration(tooFew);

    expect(result.ok).toBe(false);
    expect(result.durablyCommitted).toBe(false);
    expect((result as { reasonCode: string }).reasonCode).toBe("VALIDATION_GATES_FAILED");
    expect(fake.transactionCount).toBe(0);
    expect(deletes()).toHaveLength(0);
  });

  it("T72 an insert failure invokes retention zero times and preserves history", async () => {
    fake.insertReturns = [{ id: "new-1", saved_at: "2026-08-12T12:00:00.000Z" }];
    fake.throwOn = /^INSERT/i;
    const before = fake.table.map((r) => r.id);

    const result = await saveRegistryGeneration(makeGeneration());

    expect(result.ok).toBe(false);
    expect((result as { reasonCode: string }).reasonCode).toBe("DB_WRITE_FAILED");
    expect(deletes()).toHaveLength(0);
    expect(fake.table.map((r) => r.id)).toEqual(before);
  });

  it("T73 a retention failure rolls the new insert back", async () => {
    fake.insertReturns = [{ id: "new-1", saved_at: "2026-08-12T12:00:00.000Z" }];
    fake.throwOn = /^DELETE/i;
    const before = fake.table.map((r) => r.id);

    const result = await saveRegistryGeneration(makeGeneration());

    expect(result.ok).toBe(false);
    expect(result.durablyCommitted).toBe(false);
    expect(deletes()).toHaveLength(1);
    // The DELETE was attempted and threw, so nothing from this transaction
    // survives — including the row the INSERT had just created.
    expect(fake.table.map((r) => r.id)).toEqual(before);
    expect(fake.table.some((r) => r.id === "new-1")).toBe(false);
  });

  it("T74 a duplicate generation preserves every existing row id and the row count", async () => {
    fake.insertReturns = [];
    const before = fake.table.map((r) => r.id);
    expect(before.length).toBeGreaterThan(3);

    await saveRegistryGeneration(makeGeneration());

    expect(fake.table.map((r) => r.id)).toEqual(before);
    expect(fake.table).toHaveLength(before.length);
  });

  it("T75 retention touches only the registry manifest table", async () => {
    fake.insertReturns = [{ id: "new-1", saved_at: "2026-08-12T12:00:00.000Z" }];
    await saveRegistryGeneration(makeGeneration());

    const del = deletes()[0]!;
    expect(del.text).toContain("instrument_universe_manifests");
    // No other table may appear in the statement at all.
    const tables = [...del.text.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)].map(
      (m) => m[1],
    );
    expect(new Set(tables)).toEqual(new Set(["instrument_universe_manifests"]));
    // And no mutating statement anywhere in the module names another table.
    const mutations = [
      ...STORE_SRC.matchAll(/(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|UPDATE)\s+([a-z_][a-z0-9_]*)/gi),
    ].map((m) => m[1]);
    expect(new Set(mutations)).toEqual(new Set(["instrument_universe_manifests"]));
  });

  it("T76 retention keeps the configured newest N rows deterministically", async () => {
    fake.insertReturns = [{ id: "new-1", saved_at: "2026-08-12T12:00:00.000Z" }];
    await saveRegistryGeneration(makeGeneration());

    const del = deletes()[0]!;
    // A bare timestamp ordering is not deterministic when two generations share
    // a generated_at, so the tie-break must be part of the statement.
    expect(del.text).toMatch(/ORDER BY generated_at DESC, id DESC/i);
    expect(del.text).toMatch(/LIMIT/i);
    const keep = Number(del.params[del.params.length - 1]);
    expect(Number.isInteger(keep)).toBe(true);
    expect(keep).toBeGreaterThan(0);
    expect(fake.table).toHaveLength(keep);
    // The retained set is the newest N, and the new row is one of them.
    expect(fake.table.some((r) => r.id === "new-1")).toBe(true);
  });

  it("T77 the persistence result distinguishes an inserted row from an existing one", async () => {
    fake.insertReturns = [{ id: "new-1", saved_at: "2026-08-12T12:00:00.000Z" }];
    const inserted = await saveRegistryGeneration(makeGeneration());
    expect(inserted).toMatchObject({
      ok: true,
      durablyCommitted: true,
      durableStore: "POSTGRESQL",
      snapshotId: "new-1",
    });

    fake.table = seedTable(5);
    fake.insertReturns = [];
    const existing = await saveRegistryGeneration(makeGeneration());
    expect(existing).toMatchObject({
      ok: true,
      durablyCommitted: false,
      skippedReason: "DUPLICATE_GENERATION_ID",
    });
    // An already-existing generation never claims a snapshot id or a commit time.
    expect(existing).not.toHaveProperty("snapshotId");
    expect(existing).not.toHaveProperty("committedAt");
  });

  it("T78 schema-5 load and checksum behaviour is unchanged", async () => {
    const gen = makeGeneration();
    expect(gen.manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(MANIFEST_SCHEMA_VERSION).toBe(5);

    expect(acceptLoadedGeneration(gen, "L2_POSTGRESQL", NOW_MS)).not.toBeNull();

    const tampered = {
      manifest: { ...gen.manifest, totalOfficialRecords: gen.manifest.totalOfficialRecords + 1 },
      records: gen.records,
    };
    expect(acceptLoadedGeneration(tampered, "L2_POSTGRESQL", NOW_MS)).toBeNull();
  });
});
