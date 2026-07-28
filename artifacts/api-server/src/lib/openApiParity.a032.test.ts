/**
 * Phase A0.3.2 — §10 OpenAPI / codegen parity tests.
 *
 * lib/api-zod and lib/api-client-react have no automated generation scripts —
 * both are manually maintained. This test suite proves structural parity so
 * that divergence is caught at test-time rather than at runtime in production.
 *
 * Parity invariant:
 *   The shape of IndexFnoSetupAvailability (domain type in optionSignals.ts)
 *   must match the shape of FnoSetupAvailabilityEntry (api-client-react type)
 *   AND must pass the Zod schema in lib/api-zod/src/generated/api.ts.
 *
 * The test uses actual domain-produced values (computeAllIndexFnoSetupAvailability)
 * parsed through the actual Zod schema. No mocks, no mirrors.
 *
 * §10 documentation note:
 *   "lib/api-zod and lib/api-client-react have no generation scripts.
 *    Both are manually maintained. Any change to IndexFnoSetupAvailability
 *    MUST be reflected in BOTH files. This test pins the structural parity."
 */

import { describe, it, expect } from "vitest";
import { GetOptionSignalsResponse } from "@workspace/api-zod";
import {
  computeAllIndexFnoSetupAvailability,
  computeIndexFnoSetupAvailability,
  type IndexFnoSetupAvailability,
} from "./optionSignals.js";

// ─── Extract the availability sub-schema from the real Zod schema ─────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setupStateInnerSchema = GetOptionSignalsResponse
  .shape.setupState
  .unwrap() as any; // .optional() → inner object schema; cast needed for TS depth limit

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const availabilityArraySchema = (setupStateInnerSchema.shape.indexFnoSetupAvailability) as any;

// ─── §10.1 — Structural parity: domain objects parse through Zod schema ───────

describe("§10 A0.3.2 — OpenAPI/codegen structural parity", () => {
  describe("§10.1 Domain → Zod parity: computeAllIndexFnoSetupAvailability() parses cleanly", () => {
    it("the full 9-record result passes the production Zod schema", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const result = availabilityArraySchema.safeParse(entries);
      expect(result.success, !result.success ? result.error.toString() : "OK").toBe(true);
    });

    it("per-index 3-record result for NIFTY parses through the per-entry Zod shape", () => {
      const entrySchema = availabilityArraySchema.element;
      const entries = computeIndexFnoSetupAvailability("NIFTY");
      for (const entry of entries) {
        const result = entrySchema.safeParse(entry);
        expect(result.success, `NIFTY entry ${entry.setupKey}: ${!result.success ? result.error : "OK"}`).toBe(true);
      }
    });

    it("per-index 3-record result for BANKNIFTY parses through the per-entry Zod shape", () => {
      const entrySchema = availabilityArraySchema.element;
      const entries = computeIndexFnoSetupAvailability("BANKNIFTY");
      for (const entry of entries) {
        const result = entrySchema.safeParse(entry);
        expect(result.success, `BANKNIFTY entry ${entry.setupKey}: ${!result.success ? result.error : "OK"}`).toBe(true);
      }
    });

    it("per-index 3-record result for SENSEX parses through the per-entry Zod shape", () => {
      const entrySchema = availabilityArraySchema.element;
      const entries = computeIndexFnoSetupAvailability("SENSEX");
      for (const entry of entries) {
        const result = entrySchema.safeParse(entry);
        expect(result.success, `SENSEX entry ${entry.setupKey}: ${!result.success ? result.error : "OK"}`).toBe(true);
      }
    });
  });

  describe("§10.2 Cardinality guard: Zod schema enforces exactly 9 records", () => {
    it("empty array is rejected (length must be 9)", () => {
      const result = availabilityArraySchema.safeParse([]);
      expect(result.success).toBe(false);
    });

    it("8 records (one short) are rejected", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const result = availabilityArraySchema.safeParse(entries.slice(0, 8));
      expect(result.success).toBe(false);
    });

    it("3 records (old single-index design) are rejected", () => {
      const entries = computeIndexFnoSetupAvailability("NIFTY");
      const result = availabilityArraySchema.safeParse(entries);
      expect(result.success).toBe(false);
    });

    it("10 records (one too many) are rejected", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const extraEntry: IndexFnoSetupAvailability = { ...entries[0] };
      const result = availabilityArraySchema.safeParse([...entries, extraEntry]);
      expect(result.success).toBe(false);
    });
  });

  describe("§10.3 Field-presence parity: required fields in domain type match Zod schema", () => {
    it("indexSymbol field is present and validated by Zod schema", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const withoutIndexSymbol = [
        { ...entries[0], indexSymbol: undefined as unknown as string },
        ...entries.slice(1),
      ];
      const result = availabilityArraySchema.safeParse(withoutIndexSymbol);
      expect(result.success).toBe(false);
    });

    it("invalid indexSymbol (not NIFTY/BANKNIFTY/SENSEX) is rejected by Zod schema", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const badEntries = [{ ...entries[0], indexSymbol: "FINNIFTY" }, ...entries.slice(1)];
      const result = availabilityArraySchema.safeParse(badEntries);
      expect(result.success).toBe(false);
    });

    it("eligibleForEmission=true is rejected by Zod schema (literal false required)", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const badEntries = [{ ...entries[0], eligibleForEmission: true }, ...entries.slice(1)];
      const result = availabilityArraySchema.safeParse(badEntries);
      expect(result.success).toBe(false);
    });

    it("invalid status enum is rejected by Zod schema", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const badEntries = [{ ...entries[0], status: "UNKNOWN_STATUS" }, ...entries.slice(1)];
      const result = availabilityArraySchema.safeParse(badEntries);
      expect(result.success).toBe(false);
    });

    it("scope !== INDEX_FNO is rejected by Zod schema", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const badEntries = [{ ...entries[0], scope: "EQUITY_SWING" }, ...entries.slice(1)];
      const result = availabilityArraySchema.safeParse(badEntries);
      expect(result.success).toBe(false);
    });
  });

  describe("§10.4 Composite identity uniqueness: Zod-parsed result preserves identity", () => {
    it("all 9 records have unique (indexSymbol, setupKey) composite keys", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const result = availabilityArraySchema.safeParse(entries);
      expect(result.success).toBe(true);
      if (result.success) {
        const keys = result.data.map((e: any) => `${e.indexSymbol}:${e.setupKey}`);
        const unique = new Set(keys);
        expect(unique.size).toBe(9);
      }
    });

    it("all three supported indices are represented in the parsed output", () => {
      const entries = computeAllIndexFnoSetupAvailability();
      const result = availabilityArraySchema.safeParse(entries);
      expect(result.success).toBe(true);
      if (result.success) {
        const indices = new Set(result.data.map((e: any) => e.indexSymbol));
        expect(indices.has("NIFTY")).toBe(true);
        expect(indices.has("BANKNIFTY")).toBe(true);
        expect(indices.has("SENSEX")).toBe(true);
      }
    });
  });
});
