/**
 * Release integrity build markers.
 *
 * These constants are replaced at Vite build time by the `define` block in
 * vite.config.ts (injecting real commit/timestamp values). In dev they carry
 * placeholder strings. Either way, they are ALWAYS present and searchable in
 * the built bundle — allowing the release-verification script to confirm the
 * correct frontend version is deployed without parsing minified source.
 *
 * No secrets, tokens, or private env values. Read-only, zero side-effects.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
function readViteDefine(name: string, fallback: string): string {
  try {
    const g = globalThis as any;
    const v = g[name];
    return typeof v === "string" && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Injected at Vite build time. Searchable in the production bundle. */
export const APP_BUILD_ID: string = readViteDefine(
  "__APP_BUILD_ID__",
  "APP_BUILD_ID_DEV"
);

export const FRONTEND_BUILD_TIME: string = readViteDefine(
  "__FRONTEND_BUILD_TIME__",
  "FRONTEND_BUILD_TIME_DEV"
);

/** Compile-time marker — confirms Checkpoint 3 Data Parity UI is compiled in. */
export const CHECKPOINT_3_DATA_PARITY_UI = "CHECKPOINT_3_DATA_PARITY_UI_ENABLED" as const;

/** Compile-time marker — confirms Data Parity Infra Health section is compiled in. */
export const DATA_PARITY_INFRA_HEALTH = "DATA_PARITY_INFRA_HEALTH_ENABLED" as const;

/** Compile-time marker — confirms release integrity system is compiled in. */
export const RELEASE_INTEGRITY_ENABLED = "RELEASE_INTEGRITY_ENABLED" as const;

/** Aggregate export — all markers in one object for easy inspection. */
export const BUILD_MARKERS = {
  APP_BUILD_ID,
  FRONTEND_BUILD_TIME,
  CHECKPOINT_3_DATA_PARITY_UI,
  DATA_PARITY_INFRA_HEALTH,
  RELEASE_INTEGRITY_ENABLED,
} as const;
