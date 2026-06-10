/**
 * Forward premium-path watermark SQL-shape regression (P5, 2026-06-10).
 *
 * `premiumPathWatermarkSet` builds the set-fragment the MTM sweep uses to
 * record the option premium's high/low watermark after entry. These tests pin
 * the rendered SQL so a future edit can't silently break the three invariants
 * the cockpit's TRUE premium-path MFE/MAE will depend on:
 *   1. monotone — highest uses GREATEST, lowest uses LEAST (never resets the
 *      wrong way);
 *   2. seeded — COALESCE makes the FIRST observation set the watermark from
 *      NULL rather than comparing against NULL;
 *   3. timestamp advances ONLY when a strictly new watermark is set (CASE …
 *      THEN now() ELSE <existing> END), so the instant reflects the real high/
 *      low, not the latest tick.
 *
 * The fragment is pure (no DB), so we render it with the Pg dialect and assert
 * on text + bound params — no live database required.
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { premiumPathWatermarkSet } from "./paperTradingFO";

const dialect = new PgDialect();
const render = (frag: SQL) => dialect.sqlToQuery(frag);

describe("premiumPathWatermarkSet — SQL shape", () => {
  const set = premiumPathWatermarkSet(123.45);

  it("rounds the ltp to 2dp and binds it as a numeric-cast param", () => {
    const { sql: text, params } = render(set.highestPremiumAfterEntry as SQL);
    expect(text).toMatch(/::numeric/);
    expect(params).toContain("123.45");
  });

  it("highest watermark is monotone (GREATEST) and seeded (COALESCE)", () => {
    const { sql: text } = render(set.highestPremiumAfterEntry as SQL);
    expect(text).toMatch(/GREATEST\(/i);
    expect(text).toMatch(/COALESCE\(/i);
    expect(text).toMatch(/highest_premium_after_entry/);
  });

  it("lowest watermark is monotone (LEAST) and seeded (COALESCE)", () => {
    const { sql: text } = render(set.lowestPremiumAfterEntry as SQL);
    expect(text).toMatch(/LEAST\(/i);
    expect(text).toMatch(/COALESCE\(/i);
    expect(text).toMatch(/lowest_premium_after_entry/);
  });

  it("highest timestamp advances only on a strictly greater premium", () => {
    const { sql: text } = render(set.highestPremiumAt as SQL);
    expect(text).toMatch(/CASE WHEN/i);
    expect(text).toMatch(/IS NULL OR/i);
    expect(text).toMatch(/>/);
    expect(text).toMatch(/now\(\)/i);
    // Falls back to the existing watermark instant when not a new high.
    expect(text).toMatch(/ELSE .*highest_premium_at.* END/i);
  });

  it("lowest timestamp advances only on a strictly lower premium", () => {
    const { sql: text } = render(set.lowestPremiumAt as SQL);
    expect(text).toMatch(/CASE WHEN/i);
    expect(text).toMatch(/IS NULL OR/i);
    expect(text).toMatch(/</);
    expect(text).toMatch(/now\(\)/i);
    expect(text).toMatch(/ELSE .*lowest_premium_at.* END/i);
  });

  it("a non-finite ltp degrades to the safe '0' param (never NaN in SQL)", () => {
    const bad = premiumPathWatermarkSet(Number.NaN);
    const { params } = render(bad.highestPremiumAfterEntry as SQL);
    expect(params).toContain("0");
  });
});
