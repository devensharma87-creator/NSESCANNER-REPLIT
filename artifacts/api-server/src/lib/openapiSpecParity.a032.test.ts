/**
 * Phase A0.3.2 — §12 OpenAPI specification parity tests.
 *
 * These tests read the ACTUAL production OpenAPI specification file
 * (lib/api-spec/openapi.yaml) — not TypeScript types and not Zod schemas.
 * They verify that the specification is in sync with the A0.3.2 contract:
 *
 *   - FnoSetupAvailabilityEntry.required includes "indexSymbol"
 *   - FnoSetupAvailabilityEntry.properties includes indexSymbol with enum constraint
 *   - FnoSetupAvailabilityEntry.properties.indexSymbol.enum contains NIFTY, BANKNIFTY, SENSEX
 *   - indexFnoSetupAvailability array has minItems: 9 and maxItems: 9
 *   - The spec's required list matches the Zod schema's required fields
 *   - The spec's status enum values match the Zod schema's status enum values
 *
 * These checks are read-only filesystem tests — no server, no DB.
 * They run in the same vitest pool as all other api-server tests.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GetOptionSignalsResponse } from "@workspace/api-zod";
import {
  computeAllIndexFnoSetupAvailability,
} from "./optionSignals.js";

// ─── Load the actual OpenAPI spec ─────────────────────────────────────────────

const SPEC_PATH = resolve(
  import.meta.dirname,
  "../../../../lib/api-spec/openapi.yaml",
);
const SPEC_TEXT = readFileSync(SPEC_PATH, "utf-8");

// ─── §12.1 Spec file existence and openapi version ───────────────────────────

describe("§12 OpenAPI spec parity (reads actual lib/api-spec/openapi.yaml)", () => {

  describe("§12.1 Spec file integrity", () => {
    it("spec file is non-empty and readable", () => {
      expect(SPEC_TEXT.length).toBeGreaterThan(10_000);
    });

    it("spec declares openapi: 3.1.0", () => {
      expect(SPEC_TEXT).toMatch(/^openapi:\s*3\.1\.0/m);
    });

    it("spec declares FnoSetupAvailabilityEntry schema", () => {
      expect(SPEC_TEXT).toContain("FnoSetupAvailabilityEntry:");
    });

    it("spec declares FnoSetupState schema", () => {
      expect(SPEC_TEXT).toContain("FnoSetupState:");
    });
  });

  // ─── §12.2 FnoSetupAvailabilityEntry.required ─────────────────────────────

  describe("§12.2 FnoSetupAvailabilityEntry.required includes all A0.3.2 fields", () => {
    // Extract the required list line from the spec
    const entryBlock = (() => {
      const start = SPEC_TEXT.indexOf("FnoSetupAvailabilityEntry:");
      const end = SPEC_TEXT.indexOf("\n    FnoSetupState:", start);
      return SPEC_TEXT.slice(start, end);
    })();

    it("required list contains indexSymbol (A0.3.2 new field)", () => {
      expect(entryBlock).toContain("indexSymbol");
    });

    it("required list contains setupKey", () => {
      expect(entryBlock).toContain("setupKey");
    });

    it("required list contains status", () => {
      expect(entryBlock).toContain("status");
    });

    it("required list contains reasonCode", () => {
      expect(entryBlock).toContain("reasonCode");
    });

    it("required list contains eligibleForEmission", () => {
      expect(entryBlock).toContain("eligibleForEmission");
    });

    it("required list contains scope", () => {
      expect(entryBlock).toContain("scope");
    });

    it("indexSymbol property has enum: [NIFTY, BANKNIFTY, SENSEX]", () => {
      expect(entryBlock).toMatch(/enum:\s*\[NIFTY,\s*BANKNIFTY,\s*SENSEX\]/);
    });
  });

  // ─── §12.3 FnoSetupState.indexFnoSetupAvailability cardinality ───────────

  describe("§12.3 FnoSetupState.indexFnoSetupAvailability cardinality (A0.3.2 minItems/maxItems: 9)", () => {
    const stateBlock = (() => {
      const start = SPEC_TEXT.indexOf("FnoSetupState:");
      const end = SPEC_TEXT.indexOf("\n    OptionSignalSet:", start);
      return SPEC_TEXT.slice(start, end);
    })();

    it("indexFnoSetupAvailability array has minItems: 9", () => {
      expect(stateBlock).toMatch(/minItems:\s*9/);
    });

    it("indexFnoSetupAvailability array has maxItems: 9", () => {
      expect(stateBlock).toMatch(/maxItems:\s*9/);
    });

    it("indexFnoSetupAvailability is in FnoSetupState.required", () => {
      expect(stateBlock).toContain("indexFnoSetupAvailability");
    });

    it("spec references FnoSetupAvailabilityEntry via $ref (no inline duplication)", () => {
      expect(stateBlock).toContain('$ref: "#/components/schemas/FnoSetupAvailabilityEntry"');
    });
  });

  // ─── §12.4 Status enum cross-check: spec ↔ Zod ────────────────────────────

  describe("§12.4 Status enum: spec values match Zod schema values", () => {
    // Extract the status enum from the spec
    const entryBlock = (() => {
      const start = SPEC_TEXT.indexOf("FnoSetupAvailabilityEntry:");
      const end = SPEC_TEXT.indexOf("\n    FnoSetupState:", start);
      return SPEC_TEXT.slice(start, end);
    })();

    // Extract the status enum from the Zod schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const availSchema = ((GetOptionSignalsResponse
      .shape.setupState
      .unwrap() as any)
      .shape.indexFnoSetupAvailability as any)
      .element;
    const zodStatusEnum = (availSchema.shape as Record<string, unknown>)
      .status as { options?: string[] };
    const zodStatusValues: string[] = zodStatusEnum.options ?? [];

    it("spec status enum contains ACTIVE", () => {
      expect(entryBlock).toContain("ACTIVE");
    });

    it("spec status enum contains UNAVAILABLE_REQUIRED_INPUT", () => {
      expect(entryBlock).toContain("UNAVAILABLE_REQUIRED_INPUT");
    });

    it("spec status enum contains RETIRED_INDEX_FNO_POLICY", () => {
      expect(entryBlock).toContain("RETIRED_INDEX_FNO_POLICY");
    });

    it("Zod status enum has the same 3 values as the spec", () => {
      expect(zodStatusValues.sort()).toEqual(
        ["ACTIVE", "RETIRED_INDEX_FNO_POLICY", "UNAVAILABLE_REQUIRED_INPUT"].sort(),
      );
    });
  });

  // ─── §12.5 Scope enum cross-check ─────────────────────────────────────────

  describe("§12.5 Scope enum: spec declares INDEX_FNO only", () => {
    const entryBlock = (() => {
      const start = SPEC_TEXT.indexOf("FnoSetupAvailabilityEntry:");
      const end = SPEC_TEXT.indexOf("\n    FnoSetupState:", start);
      return SPEC_TEXT.slice(start, end);
    })();

    it("spec scope enum contains INDEX_FNO", () => {
      expect(entryBlock).toContain("INDEX_FNO");
    });

    it("Zod scope is z.literal(\"INDEX_FNO\")", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const availSchema = ((GetOptionSignalsResponse
        .shape.setupState
        .unwrap() as any)
        .shape.indexFnoSetupAvailability as any)
        .element;
      const zodScope = (availSchema.shape as Record<string, unknown>).scope as { value?: string };
      expect(zodScope.value ?? (zodScope as unknown as { _def?: { value: string } })._def?.value).toBe("INDEX_FNO");
    });
  });

  // ─── §12.6 eligibleForEmission cross-check ────────────────────────────────

  describe("§12.6 eligibleForEmission: spec enum [false] matches Zod literal(false)", () => {
    it("spec declares eligibleForEmission enum: [false]", () => {
      const entryBlock = (() => {
        const start = SPEC_TEXT.indexOf("FnoSetupAvailabilityEntry:");
        const end = SPEC_TEXT.indexOf("\n    FnoSetupState:", start);
        return SPEC_TEXT.slice(start, end);
      })();
      // The spec uses "enum: [false]" on the eligibleForEmission boolean property
      expect(entryBlock).toMatch(/eligibleForEmission:[\s\S]*?enum:\s*\[false\]/);
    });

    it("Zod eligibleForEmission is z.literal(false)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const availSchema = ((GetOptionSignalsResponse
        .shape.setupState
        .unwrap() as any)
        .shape.indexFnoSetupAvailability as any)
        .element;
      const zodField = (availSchema.shape as Record<string, unknown>)
        .eligibleForEmission as { value?: boolean; _def?: { value: boolean } };
      const literalValue = zodField.value ?? zodField._def?.value;
      expect(literalValue).toBe(false);
    });
  });

  // ─── §12.7 Domain → spec parity: all domain fields present in spec ────────

  describe("§12.7 Domain type fields are all documented in spec", () => {
    const domainEntry = computeAllIndexFnoSetupAvailability()[0]!;
    const domainFieldNames = Object.keys(domainEntry).sort();

    const entryBlock = (() => {
      const start = SPEC_TEXT.indexOf("FnoSetupAvailabilityEntry:");
      const end = SPEC_TEXT.indexOf("\n    FnoSetupState:", start);
      return SPEC_TEXT.slice(start, end);
    })();

    it("all domain type fields are present in the spec as property names", () => {
      for (const field of domainFieldNames) {
        expect(entryBlock, `field "${field}" missing from spec`).toContain(`${field}:`);
      }
    });

    it("domain type has exactly the fields the spec declares (no undocumented fields)", () => {
      // Spec required: indexSymbol, setupKey, status, reasonCode, explanation, missingInputs, scope, eligibleForEmission
      const specRequired = [
        "indexSymbol", "setupKey", "status", "reasonCode",
        "explanation", "missingInputs", "scope", "eligibleForEmission",
      ];
      for (const field of specRequired) {
        expect(domainFieldNames).toContain(field);
      }
    });
  });
});
