/**
 * P0.3 — Schema Preflight Verifier: pure unit tests
 *
 * Tests verifyEvidenceColumnDefs() — the pure function inside
 * assertPaperEqEvidenceColumnsPresent() that checks information_schema rows
 * against the P0.3 evidence-column contract. No database connection.
 *
 * Coverage:
 *  - all definitions correct
 *  - missing column
 *  - wrong data_type
 *  - wrong is_nullable
 *  - wrong numeric_precision
 *  - wrong numeric_scale
 *  - column in wrong schema
 *  - unexpected column_default
 *  - empty row set
 *  - verifyEvidenceColumnDefs has no ALTER/CREATE/DROP capability
 *  - EVIDENCE_COLUMN_SPECS covers exactly 7 columns
 *  - assertPaperEqEvidenceColumnsPresent source is read-only
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  verifyEvidenceColumnDefs,
  EVIDENCE_COLUMN_SPECS,
  type EvidenceSchemaRow,
} from "./paperTradingEq";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fully-correct schema row for a given column using EVIDENCE_COLUMN_SPECS. */
function correctRow(colName: string): EvidenceSchemaRow {
  const spec = EVIDENCE_COLUMN_SPECS[colName];
  if (!spec) throw new Error(`Unknown evidence column: ${colName}`);
  return {
    column_name: colName,
    data_type: spec.dataType,
    is_nullable: "YES",
    numeric_precision: spec.numericPrecision,
    numeric_scale: spec.numericScale,
    column_default: null,
    table_schema: "public",
  };
}

/** All seven correct rows. */
function allCorrectRows(): EvidenceSchemaRow[] {
  return Object.keys(EVIDENCE_COLUMN_SPECS).map(correctRow);
}

// ─── Group A — happy path ─────────────────────────────────────────────────────

describe("verifyEvidenceColumnDefs — happy path", () => {
  it("1. all seven correct definitions → ok: true", () => {
    const result = verifyEvidenceColumnDefs(allCorrectRows());
    expect(result.ok).toBe(true);
  });

  it("2. EVIDENCE_COLUMN_SPECS covers exactly 7 columns", () => {
    expect(Object.keys(EVIDENCE_COLUMN_SPECS)).toHaveLength(7);
    expect(Object.keys(EVIDENCE_COLUMN_SPECS).sort()).toEqual(
      [
        "fill_computed_age_sec",
        "fill_decision_time",
        "fill_evidence_version",
        "fill_policy_id",
        "fill_policy_max_age_sec",
        "fill_provider",
        "fill_provider_ts",
      ].sort(),
    );
  });

  it("3. extra columns in the row set are ignored (only the 7 are verified)", () => {
    const rows = allCorrectRows();
    rows.push({
      column_name: "unrelated_column",
      data_type: "text",
      is_nullable: "YES",
      numeric_precision: null,
      numeric_scale: null,
      column_default: null,
      table_schema: "public",
    });
    expect(verifyEvidenceColumnDefs(rows).ok).toBe(true);
  });

  it("4. result is { ok: true } — no 'errors' property on success", () => {
    const result = verifyEvidenceColumnDefs(allCorrectRows());
    expect(result.ok).toBe(true);
    expect("errors" in result).toBe(false);
  });
});

// ─── Group B — missing column ─────────────────────────────────────────────────

describe("verifyEvidenceColumnDefs — missing column", () => {
  it("5. one column absent → ok: false, error contains column name and [MISSING] tag", () => {
    const rows = allCorrectRows().filter((r) => r.column_name !== "fill_provider");
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.includes("[MISSING]") && e.includes("fill_provider"))).toBe(true);
  });

  it("6. empty row set → ok: false, all 7 columns reported missing", () => {
    const result = verifyEvidenceColumnDefs([]);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.filter((e) => e.includes("[MISSING]"))).toHaveLength(7);
  });

  it("7. missing numeric column → [MISSING] tag, not a type or precision error", () => {
    const rows = allCorrectRows().filter((r) => r.column_name !== "fill_computed_age_sec");
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[MISSING]") && e.includes("fill_computed_age_sec"))).toBe(true);
    expect(errors.some((e) => e.includes("[WRONG_PRECISION]"))).toBe(false);
  });
});

// ─── Group C — wrong data type ────────────────────────────────────────────────

describe("verifyEvidenceColumnDefs — wrong data_type", () => {
  it("8. fill_provider with data_type='character varying' → [WRONG_TYPE] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_provider" ? { ...r, data_type: "character varying" } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[WRONG_TYPE]") && e.includes("fill_provider"))).toBe(true);
    expect(errors.some((e) => e.includes("character varying"))).toBe(true);
  });

  it("9. fill_provider_ts with data_type='timestamp without time zone' → [WRONG_TYPE] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_provider_ts"
        ? { ...r, data_type: "timestamp without time zone" }
        : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[WRONG_TYPE]") && e.includes("fill_provider_ts"))).toBe(true);
  });

  it("10. fill_computed_age_sec with data_type='double precision' → [WRONG_TYPE] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_computed_age_sec"
        ? { ...r, data_type: "double precision" }
        : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[WRONG_TYPE]") && e.includes("fill_computed_age_sec"))).toBe(true);
  });
});

// ─── Group D — wrong nullability ──────────────────────────────────────────────

describe("verifyEvidenceColumnDefs — wrong is_nullable", () => {
  it("11. fill_provider with is_nullable='NO' → [NOT_NULLABLE] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_provider" ? { ...r, is_nullable: "NO" } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[NOT_NULLABLE]") && e.includes("fill_provider"))).toBe(true);
  });

  it("12. fill_evidence_version with is_nullable='NO' → [NOT_NULLABLE] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_evidence_version" ? { ...r, is_nullable: "NO" } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[NOT_NULLABLE]"))).toBe(true);
  });
});

// ─── Group E — wrong numeric precision / scale ────────────────────────────────

describe("verifyEvidenceColumnDefs — wrong numeric precision/scale", () => {
  it("13. fill_computed_age_sec with numeric_precision=8 → [WRONG_PRECISION] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_computed_age_sec" ? { ...r, numeric_precision: 8 } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[WRONG_PRECISION]") && e.includes("fill_computed_age_sec"))).toBe(true);
    expect(errors.some((e) => e.includes("10"))).toBe(true);
  });

  it("14. fill_policy_max_age_sec with numeric_scale=2 → [WRONG_SCALE] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_policy_max_age_sec" ? { ...r, numeric_scale: 2 } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[WRONG_SCALE]") && e.includes("fill_policy_max_age_sec"))).toBe(true);
    expect(errors.some((e) => e.includes("3"))).toBe(true);
  });

  it("15. both numeric evidence columns have precision=10 and scale=3 in the spec", () => {
    const numericCols = Object.entries(EVIDENCE_COLUMN_SPECS).filter(
      ([, spec]) => spec.dataType === "numeric",
    );
    expect(numericCols).toHaveLength(2);
    for (const [name, spec] of numericCols) {
      expect(spec.numericPrecision).toBe(10);
      expect(spec.numericScale).toBe(3);
      expect(name).toMatch(/fill_computed_age_sec|fill_policy_max_age_sec/);
    }
  });
});

// ─── Group F — wrong schema ───────────────────────────────────────────────────

describe("verifyEvidenceColumnDefs — wrong table schema", () => {
  it("16. column in schema 'private' → [WRONG_SCHEMA] error — rejects same-named table in wrong schema", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_provider" ? { ...r, table_schema: "private" } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[WRONG_SCHEMA]") && e.includes("fill_provider"))).toBe(true);
    expect(errors.some((e) => e.includes("'private'"))).toBe(true);
  });

  it("17. all columns with table_schema='staging' → 7 [WRONG_SCHEMA] errors", () => {
    const rows = allCorrectRows().map((r) => ({ ...r, table_schema: "staging" }));
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.filter((e) => e.includes("[WRONG_SCHEMA]"))).toHaveLength(7);
  });
});

// ─── Group G — unexpected default ────────────────────────────────────────────

describe("verifyEvidenceColumnDefs — unexpected column_default", () => {
  it("18. fill_evidence_version with column_default='v1' → [UNEXPECTED_DEFAULT] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_evidence_version" ? { ...r, column_default: "'v1'::text" } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[UNEXPECTED_DEFAULT]") && e.includes("fill_evidence_version"))).toBe(true);
  });

  it("19. fill_computed_age_sec with column_default='0' → [UNEXPECTED_DEFAULT] error", () => {
    const rows = allCorrectRows().map((r) =>
      r.column_name === "fill_computed_age_sec" ? { ...r, column_default: "0" } : r,
    );
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("[UNEXPECTED_DEFAULT]"))).toBe(true);
  });
});

// ─── Group H — zero DDL capability ───────────────────────────────────────────

describe("Schema preflight — zero ALTER/CREATE/DROP capability", () => {
  it("20. verifyEvidenceColumnDefs source contains no ALTER, CREATE, DROP, INSERT, UPDATE", () => {
    const srcPath = path.resolve(__dirname, "./paperTradingEq.ts");
    const src = fs.readFileSync(srcPath, "utf8");

    // Extract only the verifyEvidenceColumnDefs function body for surgical check
    const fnMatch = src.match(
      /export function verifyEvidenceColumnDefs[\s\S]*?^}/m,
    );
    // If extraction fails, fall back to checking the full file is DDL-free for evidence columns
    const target = fnMatch ? fnMatch[0] : src;

    expect(/\bALTER\s+TABLE\b/i.test(target)).toBe(false);
    expect(/\bCREATE\s+TABLE\b/i.test(target)).toBe(false);
    expect(/\bDROP\s+COLUMN\b/i.test(target)).toBe(false);
    expect(/\bINSERT\s+INTO\b/i.test(target)).toBe(false);
    expect(/\bUPDATE\b.*\bSET\b/i.test(target)).toBe(false);
  });

  it("21. assertPaperEqEvidenceColumnsPresent SQL template contains only SELECT — no DDL", () => {
    const srcPath = path.resolve(__dirname, "./paperTradingEq.ts");
    const src = fs.readFileSync(srcPath, "utf8");

    // The function must be present
    expect(/export async function assertPaperEqEvidenceColumnsPresent/m.test(src)).toBe(true);

    // Extract the sql`` template literal content from inside the preflight function.
    // The function's SQL template is the only sql`...` block between
    // assertPaperEqEvidenceColumnsPresent and the next export — we check the
    // raw SQL text, not the surrounding JS which can contain comment prose.
    const fnStart = src.indexOf("export async function assertPaperEqEvidenceColumnsPresent");
    expect(fnStart).toBeGreaterThan(-1);

    // Find the sql` template tag opening within the function
    const sqlTagPos = src.indexOf("db.execute<EvidenceSchemaRow>(sql`", fnStart);
    expect(sqlTagPos).toBeGreaterThan(fnStart);

    // Extract the SQL template body (between backticks)
    const sqlOpen = src.indexOf("`", sqlTagPos + "db.execute<EvidenceSchemaRow>(sql".length);
    const sqlClose = src.indexOf("`", sqlOpen + 1);
    const sqlContent = src.slice(sqlOpen + 1, sqlClose);

    // The SQL must contain SELECT and no DDL keywords
    expect(/\bSELECT\b/.test(sqlContent)).toBe(true);
    expect(/\bALTER\b/i.test(sqlContent)).toBe(false);
    expect(/\bCREATE\b/i.test(sqlContent)).toBe(false);
    expect(/\bDROP\b/i.test(sqlContent)).toBe(false);
    expect(/\bINSERT\b/i.test(sqlContent)).toBe(false);
    expect(/\bUPDATE\b/i.test(sqlContent)).toBe(false);
    // Must query information_schema — read-only system catalog
    expect(sqlContent).toContain("information_schema.columns");
  });

  it("22. verifyEvidenceColumnDefs is a pure function — it does not mutate its input array", () => {
    const rows = allCorrectRows();
    const originalLength = rows.length;
    const originalFirstName = rows[0].column_name;
    verifyEvidenceColumnDefs(rows);
    expect(rows).toHaveLength(originalLength);
    expect(rows[0].column_name).toBe(originalFirstName);
  });

  it("23. verifyEvidenceColumnDefs is deterministic — two calls with the same input return identical results", () => {
    const rows = allCorrectRows();
    const r1 = verifyEvidenceColumnDefs(rows);
    const r2 = verifyEvidenceColumnDefs(rows);
    expect(r1).toStrictEqual(r2);
  });
});

// ─── Group I — multiple errors reported together ──────────────────────────────

describe("verifyEvidenceColumnDefs — multiple simultaneous errors", () => {
  it("24. two bad columns → both appear in errors array", () => {
    const rows = allCorrectRows().map((r) => {
      if (r.column_name === "fill_provider") return { ...r, data_type: "integer" };
      if (r.column_name === "fill_computed_age_sec") return { ...r, is_nullable: "NO" };
      return r;
    });
    const result = verifyEvidenceColumnDefs(rows);
    expect(result.ok).toBe(false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    expect(errors.some((e) => e.includes("fill_provider"))).toBe(true);
    expect(errors.some((e) => e.includes("fill_computed_age_sec"))).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
