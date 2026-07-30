import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { HEAT_SQL_EQ, HEAT_SQL_FNO, parseHeatRow } from "./paperAccount";

// Prevent pg.Pool creation: @workspace/db is imported transitively via
// ./paperAccount. We only need SQL template literals (pure drizzle-orm)
// from that module — the mock prevents Pool construction without affecting
// the sql`` template exports used by these tests.
vi.mock("@workspace/db", () => ({}));

/**
 * Regression tests for the heat-cap SQL fragments in paperAccount.ts.
 * Pure text-shape tests — no live DB required.
 */

const dialect = new PgDialect();

function renderSql(fragment: ReturnType<typeof sql>): string {
  return dialect.sqlToQuery(fragment).sql;
}

describe("HEAT_SQL_EQ — text shape (catches column-name drift at typecheck-equivalent)", () => {
  const text = renderSql(HEAT_SQL_EQ);

  it("references the actual schema columns entry_price + stop_price", () => {
    expect(text).toMatch(/\bentry_price\b/);
    expect(text).toMatch(/\bstop_price\b/);
  });

  it("does NOT reference the legacy / typo columns entry / stop_loss", () => {
    expect(text).not.toMatch(/\bentry\b(?!_price)/);
    expect(text).not.toMatch(/\bstop_loss\b/);
  });

  it("scopes the heat to OPEN equity rows only", () => {
    expect(text).toMatch(/FROM\s+paper_trade_eq/i);
    expect(text).toMatch(/status\s*=\s*'OPEN'/i);
  });

  it("uses GREATEST(entry-stop, 0) so an inverted stop can't subtract from heat", () => {
    expect(text).toMatch(/GREATEST\s*\(\s*entry_price\s*-\s*stop_price\s*,\s*0\s*\)/i);
  });
});

describe("HEAT_SQL_FNO — text shape (companion fragment, pinned for parity)", () => {
  const text = renderSql(HEAT_SQL_FNO);

  it("references the actual schema columns entry_premium + stop_premium", () => {
    expect(text).toMatch(/\bentry_premium\b/);
    expect(text).toMatch(/\bstop_premium\b/);
    expect(text).toMatch(/\blots\b/);
    expect(text).toMatch(/\blot_size\b/);
  });
});
