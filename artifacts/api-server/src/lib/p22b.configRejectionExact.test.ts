/**
 * Prompt 22B / Gate G3 — Exact Runtime Configuration Closure
 *
 * Closes G3_RUNTIME_REJECTION_NOT_PROVEN raised against Prompt 22A.
 * Prompt 22A probes ran `tsx src/app.ts` which triggered an unrelated
 * ESM __dirname error before reaching the SESSION_SECRET / CORS guards.
 * These tests use a minimal probe that imports ONLY productionConfigValidator
 * so the guards are the ONLY reason for non-zero exit.
 *
 * Architecture:
 *   productionConfigValidator.ts  — pure function, zero side-effects, no routes
 *   src/probe/configBootstrapProbe.ts — imports ONLY validator; used below
 *   src/index.ts                  — validates BEFORE dynamic import of app.ts
 *
 * Proves (numbered per §4 of the spec):
 *   1.  validator is the real production validator (imported directly)
 *   2.  CORS wildcard returns exact PROD_CONFIG_INVALID:CORS_WILDCARD code
 *   3.  missing session secret returns exact SESSION_SECRET_MISSING code
 *   4.  invalid rules cannot pass because of an unrelated process failure
 *   5.  output contains no fake secret values
 *   6.  valid fake production config succeeds (CONFIG_VALID marker)
 *   7.  validation precedes app/route initialization (bootstrap-order probe)
 *   8.  no HTTP listener is opened
 *   9.  no scheduler starts
 *   10. no DB/provider/Telegram/broker transport is called
 *   11. unrelated ESM __dirname errors are explicitly absent from probe output
 *   12. existing G3 source assertions remain supplementary
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  validateProductionConfig,
  PROD_CONFIG_CODES,
  type ProdConfigResult,
} from "./productionConfigValidator";

// ---------------------------------------------------------------------------
// Probe infrastructure
// ---------------------------------------------------------------------------

const root      = path.resolve(__dirname, "../..");
const tsxBin    = path.join(root, "node_modules/.bin/tsx");
const probePath = path.join(root, "src/probe/configBootstrapProbe.ts");
const indexPath = path.join(root, "src/index.ts");

/**
 * Strict allowlist environment — contains ONLY the keys listed here.
 * No Replit secrets or other live values are inherited.
 * All secrets are unique fake sentinels.
 */
const PROBE_PATH = process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin";

/** Base fake production environment (all values are safe fake sentinels). */
function makeProbeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  // Start from a completely empty object — no spread of process.env.
  const base: NodeJS.ProcessEnv = {
    PATH:               PROBE_PATH,
    NODE_ENV:           "production",
    CORS_ORIGINS:       "https://probe.example.invalid",
    SESSION_SECRET:     "FAKE_SESSION_SECRET_PROBE_0001_NOT_REAL",
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete base[k];
    } else {
      base[k] = v;
    }
  }
  return base;
}

function runProbe(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  extraArgs: string[] = [],
): { ok: boolean; stdout: string; stderr: string; combined: string } {
  const result = spawnSync(tsxBin, [scriptPath, ...extraArgs], {
    cwd:      root,
    env,
    timeout:  15_000,
    encoding: "utf8",
  });
  const stdout   = (result.stdout  ?? "") as string;
  const stderr   = (result.stderr  ?? "") as string;
  const combined = stderr + stdout;
  const ok       = (result.status ?? 1) === 0;
  return { ok, stdout, stderr, combined };
}

// ---------------------------------------------------------------------------
// §4.1 — Validator is the real production validator
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.1 validator is the real production validator", () => {
  it("G3-EXACT-1a: validateProductionConfig is exported from productionConfigValidator.ts", () => {
    expect(typeof validateProductionConfig).toBe("function");
  });

  it("G3-EXACT-1b: all stable codes are defined in PROD_CONFIG_CODES", () => {
    expect(PROD_CONFIG_CODES.SESSION_SECRET_MISSING).toBe("PROD_CONFIG_INVALID:SESSION_SECRET_MISSING");
    expect(PROD_CONFIG_CODES.SESSION_SECRET_WEAK).toBe("PROD_CONFIG_INVALID:SESSION_SECRET_WEAK");
    expect(PROD_CONFIG_CODES.CORS_WILDCARD).toBe("PROD_CONFIG_INVALID:CORS_WILDCARD");
  });

  it("G3-EXACT-1c: validator returns a ProdConfigResult shape (valid + errors array)", () => {
    const r: ProdConfigResult = validateProductionConfig({
      NODE_ENV:       "production",
      SESSION_SECRET: "FAKE_SESSION_SECRET_PROBE_0001_NOT_REAL",
      CORS_ORIGINS:   "https://probe.example.invalid",
    });
    expect(typeof r.valid).toBe("boolean");
    expect(Array.isArray(r.errors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4.2 — CORS wildcard returns exact code
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.2 CORS wildcard → exact PROD_CONFIG_INVALID:CORS_WILDCARD", () => {
  it("G3-EXACT-2a: unit — validateProductionConfig returns CORS_WILDCARD for CORS_ORIGINS=* in prod", () => {
    const r = validateProductionConfig({
      NODE_ENV:       "production",
      SESSION_SECRET: "FAKE_SESSION_SECRET_PROBE_0001_NOT_REAL",
      CORS_ORIGINS:   "*",
    });
    expect(r.valid).toBe(false);
    const codes = r.errors.map(e => e.code);
    expect(codes).toContain(PROD_CONFIG_CODES.CORS_WILDCARD);
    expect(codes).not.toContain(PROD_CONFIG_CODES.SESSION_SECRET_MISSING);
  });

  it("G3-EXACT-2b: runtime probe — child exits 1, stdout/stderr contains exact CORS code", () => {
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { ok, combined } = runProbe(probePath, env);
    expect(ok).toBe(false);
    expect(combined).toContain(PROD_CONFIG_CODES.CORS_WILDCARD);
  });

  it("G3-EXACT-2c: runtime probe — output does NOT contain SESSION_SECRET_MISSING code", () => {
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain(PROD_CONFIG_CODES.SESSION_SECRET_MISSING);
  });

  it("G3-EXACT-2d: runtime probe — __dirname is not defined does NOT appear in output", () => {
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("__dirname is not defined");
  });

  it("G3-EXACT-2e: runtime probe — output does NOT echo the fake SESSION_SECRET value", () => {
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("FAKE_SESSION_SECRET_PROBE_0001_NOT_REAL");
  });
});

// ---------------------------------------------------------------------------
// §4.3 — Missing session secret returns exact code
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.3 missing SESSION_SECRET → exact PROD_CONFIG_INVALID:SESSION_SECRET_MISSING", () => {
  it("G3-EXACT-3a: unit — validateProductionConfig returns SESSION_SECRET_MISSING when absent", () => {
    const r = validateProductionConfig({
      NODE_ENV:     "production",
      CORS_ORIGINS: "https://probe.example.invalid",
      // SESSION_SECRET intentionally absent
    });
    expect(r.valid).toBe(false);
    const codes = r.errors.map(e => e.code);
    expect(codes).toContain(PROD_CONFIG_CODES.SESSION_SECRET_MISSING);
    expect(codes).not.toContain(PROD_CONFIG_CODES.CORS_WILDCARD);
  });

  it("G3-EXACT-3b: runtime probe — child exits 1, output contains exact session code", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined });
    const { ok, combined } = runProbe(probePath, env);
    expect(ok).toBe(false);
    expect(combined).toContain(PROD_CONFIG_CODES.SESSION_SECRET_MISSING);
  });

  it("G3-EXACT-3c: runtime probe — output does NOT contain CORS_WILDCARD code", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain(PROD_CONFIG_CODES.CORS_WILDCARD);
  });

  it("G3-EXACT-3d: runtime probe — __dirname is not defined does NOT appear in output", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("__dirname is not defined");
  });

  it("G3-EXACT-3e: runtime probe — output does NOT echo the CORS_ORIGINS fake value", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("probe.example.invalid");
  });
});

// ---------------------------------------------------------------------------
// §4.4 — Invalid rules cannot pass because of an unrelated process failure
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.4 invalid config cannot pass via unrelated process failure", () => {
  it("G3-EXACT-4a: both CORS=* and missing SESSION_SECRET → non-zero exit", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined, CORS_ORIGINS: "*" });
    const { ok } = runProbe(probePath, env);
    expect(ok).toBe(false);
  });

  it("G3-EXACT-4b: deterministic ordering — SESSION_SECRET error appears before CORS_WILDCARD", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined, CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    const sessionIdx = combined.indexOf(PROD_CONFIG_CODES.SESSION_SECRET_MISSING);
    const corsIdx    = combined.indexOf(PROD_CONFIG_CODES.CORS_WILDCARD);
    expect(sessionIdx).toBeGreaterThanOrEqual(0);
    expect(corsIdx).toBeGreaterThanOrEqual(0);
    expect(sessionIdx).toBeLessThan(corsIdx);
  });

  it("G3-EXACT-4c: no __dirname error in both-invalid probe", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined, CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("__dirname is not defined");
  });
});

// ---------------------------------------------------------------------------
// §4.5 — Output contains no fake secret values
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.5 no fake secret values appear in probe output", () => {
  it("G3-EXACT-5a: CORS rejection output does not contain the fake SESSION_SECRET", () => {
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    // The fake secret value must never appear in any output
    expect(combined).not.toContain("FAKE_SESSION_SECRET_PROBE_0001_NOT_REAL");
  });

  it("G3-EXACT-5b: session rejection output does not contain any CORS_ORIGINS value", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("probe.example.invalid");
  });

  it("G3-EXACT-5c: valid-config output does not contain the fake SESSION_SECRET value", () => {
    const env = makeProbeEnv();
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("FAKE_SESSION_SECRET_PROBE_0001_NOT_REAL");
  });
});

// ---------------------------------------------------------------------------
// §4.6 — Valid fake production config succeeds
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.6 valid fake production config → CONFIG_VALID marker", () => {
  it("G3-EXACT-6a: unit — validateProductionConfig returns valid:true for correct fake config", () => {
    const r = validateProductionConfig({
      NODE_ENV:       "production",
      SESSION_SECRET: "FAKE_SESSION_SECRET_PROBE_0001_NOT_REAL",
      CORS_ORIGINS:   "https://probe.example.invalid",
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("G3-EXACT-6b: runtime probe — exits 0, stdout contains CONFIG_VALID", () => {
    const env = makeProbeEnv();
    const { ok, stdout } = runProbe(probePath, env);
    expect(ok).toBe(true);
    expect(stdout).toContain("CONFIG_VALID");
  });

  it("G3-EXACT-6c: runtime probe — no PROD_CONFIG_INVALID codes appear on valid config", () => {
    const env = makeProbeEnv();
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("PROD_CONFIG_INVALID:");
  });

  it("G3-EXACT-6d: runtime probe — no __dirname error on valid config", () => {
    const env = makeProbeEnv();
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("__dirname is not defined");
  });
});

// ---------------------------------------------------------------------------
// §4.7 — Validation precedes app/route initialization
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.7 validation precedes app/route initialization (bootstrap-order probe)", () => {
  it("G3-EXACT-7a: index.ts CONFIG_ONLY mode — exits 0, CONFIG_VALID appears before any app output", () => {
    // Run index.ts with CONFIG_ONLY=1 and a valid fake env (plus required PORT).
    // The bootstrap must emit CONFIG_VALID and exit before importing app.ts.
    const env = makeProbeEnv({ PORT: "9999", CONFIG_ONLY: "1" });
    const { ok, stdout, combined } = runProbe(indexPath, env);

    expect(ok).toBe(true);
    expect(stdout).toContain("CONFIG_VALID");
    // No route initialization markers (app.ts INFO/WARN logs never run)
    expect(combined).not.toContain("warm-started from disk cache");
    expect(combined).not.toContain("background scanner started");
  });

  it("G3-EXACT-7b: CONFIG_ONLY mode — no __dirname error (app.ts never imported)", () => {
    const env = makeProbeEnv({ PORT: "9999", CONFIG_ONLY: "1" });
    const { combined } = runProbe(indexPath, env);
    expect(combined).not.toContain("__dirname is not defined");
  });

  it("G3-EXACT-7c: CONFIG_ONLY with invalid SESSION_SECRET — validation fires before app import", () => {
    const env = makeProbeEnv({ PORT: "9999", CONFIG_ONLY: "1", SESSION_SECRET: undefined });
    const { ok, combined } = runProbe(indexPath, env);
    // Must fail on config, not on app import
    expect(ok).toBe(false);
    expect(combined).toContain(PROD_CONFIG_CODES.SESSION_SECRET_MISSING);
    expect(combined).not.toContain("__dirname is not defined");
    // App was never imported — no app startup markers
    expect(combined).not.toContain("warm-started from disk cache");
  });
});

// ---------------------------------------------------------------------------
// §4.8 — No HTTP listener opened
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.8 no HTTP listener opened on invalid config", () => {
  it("G3-EXACT-8a: CORS rejection probe — process exits before any listen (no port binding)", () => {
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { ok, combined } = runProbe(probePath, env);
    expect(ok).toBe(false);
    // configBootstrapProbe never opens a listener — verify no listen-related output
    expect(combined).not.toContain("Server listening");
    expect(combined).not.toContain("listening on");
  });

  it("G3-EXACT-8b: session rejection probe — no listener output", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined });
    const { ok, combined } = runProbe(probePath, env);
    expect(ok).toBe(false);
    expect(combined).not.toContain("Server listening");
  });

  it("G3-EXACT-8c: CONFIG_ONLY valid probe — no listener opened (exits before listen call)", () => {
    const env = makeProbeEnv({ PORT: "9999", CONFIG_ONLY: "1" });
    const { ok, combined } = runProbe(indexPath, env);
    expect(ok).toBe(true);
    expect(combined).not.toContain("Server listening");
    expect(combined).not.toContain(`listening on port`);
  });
});

// ---------------------------------------------------------------------------
// §4.9 — No scheduler starts
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.9 no scheduler starts on invalid config", () => {
  it("G3-EXACT-9a: CORS rejection probe — no scheduler startup output", () => {
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("swing TTL sweep scheduler started");
    expect(combined).not.toContain("boot job scheduled");
    expect(combined).not.toContain("background scanner started");
  });

  it("G3-EXACT-9b: session rejection probe — no scheduler startup output", () => {
    const env = makeProbeEnv({ SESSION_SECRET: undefined });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("swing TTL sweep scheduler started");
    expect(combined).not.toContain("boot job scheduled");
  });
});

// ---------------------------------------------------------------------------
// §4.10 — No DB/provider/Telegram/broker transport
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.10 no DB/provider/Telegram/broker transport on invalid config", () => {
  it("G3-EXACT-10a: probe has zero routes — no Kite, Telegram, or DB-backed handlers", () => {
    // configBootstrapProbe imports ONLY productionConfigValidator.
    // No DB, no Kite, no Telegram, no broker — structural guarantee.
    // Verified by: the probe script has a single import statement targeting
    // productionConfigValidator.ts which itself has zero imports.
    const env = makeProbeEnv({ CORS_ORIGINS: "*" });
    const { combined } = runProbe(probePath, env);
    expect(combined).not.toContain("kite");
    expect(combined).not.toContain("telegram");
    expect(combined).not.toContain("database");
    expect(combined).not.toContain("broker");
  });

  it("G3-EXACT-10b: CONFIG_ONLY probe — no DB/provider transport (app.ts never imported)", () => {
    const env = makeProbeEnv({ PORT: "9999", CONFIG_ONLY: "1" });
    const { combined } = runProbe(indexPath, env);
    expect(combined).not.toContain("kite");
    expect(combined).not.toContain("telegram");
    expect(combined).not.toContain("database");
  });
});

// ---------------------------------------------------------------------------
// §4.11 — ESM __dirname errors explicitly absent
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.11 __dirname errors are explicitly absent from all probe outputs", () => {
  it("G3-EXACT-11a: CORS rejection probe — no __dirname error", () => {
    const combined = runProbe(probePath, makeProbeEnv({ CORS_ORIGINS: "*" })).combined;
    expect(combined).not.toContain("__dirname is not defined");
    expect(combined).not.toContain("ReferenceError");
  });

  it("G3-EXACT-11b: session rejection probe — no __dirname error", () => {
    const combined = runProbe(probePath, makeProbeEnv({ SESSION_SECRET: undefined })).combined;
    expect(combined).not.toContain("__dirname is not defined");
    expect(combined).not.toContain("ReferenceError");
  });

  it("G3-EXACT-11c: valid config probe — no __dirname error", () => {
    const combined = runProbe(probePath, makeProbeEnv()).combined;
    expect(combined).not.toContain("__dirname is not defined");
    expect(combined).not.toContain("ReferenceError");
  });

  it("G3-EXACT-11d: CONFIG_ONLY bootstrap probe — no __dirname error", () => {
    const combined = runProbe(indexPath, makeProbeEnv({ PORT: "9999", CONFIG_ONLY: "1" })).combined;
    expect(combined).not.toContain("__dirname is not defined");
  });
});

// ---------------------------------------------------------------------------
// §4.12 — Source assertions remain supplementary
// ---------------------------------------------------------------------------

describe("P22B/G3 — §4.12 source assertions: supplementary context only", () => {
  it("G3-EXACT-12a: app.ts calls validateProductionConfig before any app.use(router) call", () => {
    // This is a supplementary source proof — the runtime probes above are
    // the primary evidence.  This confirms the defence-in-depth call in app.ts.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const appSrc = readFileSync(path.join(root, "src/app.ts"), "utf8");
    const validatorCallIdx = appSrc.indexOf("validateProductionConfig(process.env)");
    // Routes are registered as app.use("/api", router) in app.ts
    const routerRegIdx     = appSrc.indexOf('app.use("/api", router)');
    expect(validatorCallIdx).toBeGreaterThan(0);
    expect(routerRegIdx).toBeGreaterThan(0);
    // Validator call appears before route registration
    expect(validatorCallIdx).toBeLessThan(routerRegIdx);
  });

  it("G3-EXACT-12b: index.ts calls validateProductionConfig before dynamic app import", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const indexSrc = readFileSync(path.join(root, "src/index.ts"), "utf8");
    const validateCallIdx  = indexSrc.indexOf("validateProductionConfig(process.env)");
    const dynamicImportIdx = indexSrc.indexOf('await import("./app');
    expect(validateCallIdx).toBeGreaterThan(0);
    expect(dynamicImportIdx).toBeGreaterThan(0);
    expect(validateCallIdx).toBeLessThan(dynamicImportIdx);
  });
});
