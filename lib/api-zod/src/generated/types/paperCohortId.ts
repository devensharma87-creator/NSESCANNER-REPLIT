/**
 * Canonical PaperCohortId type — Pack 32.
 *
 * Single source of truth for the cohort enum in the API surface.
 * Do NOT duplicate this in other packages. Import from:
 *   @workspace/api-zod → type PaperCohortId
 *
 * Server-side canonical implementation: artifacts/api-server/src/lib/paperCohort.ts
 */

import { z } from "zod";

export const PAPER_COHORT_ID_VALUES = [
  "FNO_PAPER_LEGACY",
  "SWING_PAPER_LEGACY",
  "FNO_PAPER_V2",
  "SWING_PAPER_V2",
] as const;

export const paperCohortIdSchema = z.enum(PAPER_COHORT_ID_VALUES);

export type PaperCohortId = z.infer<typeof paperCohortIdSchema>;

// ───────────── V2 lock status (returned by /paper/cohort-status) ─────────────

export const v2LockStatusSchema = z.object({
  fnoV2Authorized: z.boolean(),
  swingV2Authorized: z.boolean(),
  fnoV2DisabledReason: z.string(),
  swingV2DisabledReason: z.string(),
  fnoV2DisabledCode: z.literal("FNO_PAPER_V2_DISABLED"),
  swingV2DisabledCode: z.literal("SWING_PAPER_V2_DISABLED"),
});

export type V2LockStatus = z.infer<typeof v2LockStatusSchema>;

// ───────────── Cohort metadata (returned in API responses) ──────────────────

export const cohortMetadataSchema = z.object({
  cohortId: paperCohortIdSchema,
  assetFamily: z.enum(["FNO", "SWING_CASH"]),
  generation: z.enum(["LEGACY", "V2"]),
  status: z.enum(["ACTIVE_LEGACY", "DISABLED_PENDING_QUALIFICATION"]),
  tradingImpact: z.literal("PAPER_ONLY"),
  activationState: z.enum(["ACTIVE", "DISABLED"]),
  disabledReason: z.string().nullable(),
  mayAdmitNewTrades: z.boolean(),
  mayAppearInCombinedInformationalViews: z.boolean(),
});

export type CohortMetadata = z.infer<typeof cohortMetadataSchema>;

// ───────────── V2 NOT_ACTIVATED response ────────────────────────────────────

export const v2NotActivatedResponseSchema = z.object({
  cohortId: paperCohortIdSchema,
  activationState: z.literal("DISABLED"),
  status: z.literal("NOT_ACTIVATED"),
  disabledReason: z.string(),
  trades: z.array(z.never()),
  balance: z.null(),
  realizedPnl: z.null(),
  charges: z.null(),
  openPositions: z.array(z.never()),
});

export type V2NotActivatedResponse = z.infer<typeof v2NotActivatedResponseSchema>;
