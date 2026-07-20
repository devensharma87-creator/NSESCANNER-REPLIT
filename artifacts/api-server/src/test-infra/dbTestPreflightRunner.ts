/**
 * P0.1 — DB Test Preflight Runner
 *
 * This module is the enforcement wrapper that must execute BEFORE any Vitest
 * process is spawned for DB-backed test commands.
 *
 * IMPORTANT: This module imports ONLY the guard module and Node standard-library.
 * It MUST NOT import @workspace/*, drizzle-orm, pg, express, or any application
 * package — if it did, application modules would load before the guard fires,
 * defeating the purpose.
 *
 * Usage (via package.json "test:db" script):
 *   tsx src/test-infra/dbTestPreflightRunner.ts
 *
 * When the guard passes, this spawns:
 *   vitest run --pool=threads
 * with the full test suite (including DB-backed tests).
 *
 * When the guard fails, this prints the failure reason and exits with code 1,
 * preventing Vitest from starting and ensuring no DB-backed test runs against
 * the operational DATABASE_URL.
 */

import { spawn, type SpawnOptions } from "node:child_process";
import { checkDbTestIsolation } from "./dbTestGuard.js";

// ── Spawn function type (injectable for unit testing) ──────────────────────

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => { exitCode: number | null; on: (event: string, cb: (code: number) => void) => void };

// ── Core preflight logic (injectable environment + spawn for testability) ──

/**
 * Validate isolation then spawn Vitest if the guard passes.
 *
 * @param env  Environment to validate (default: process.env).
 * @param spawnFn  Child-process spawn function (default: node:child_process spawn).
 *                 Inject a sentinel in unit tests to verify the guard blocks/passes
 *                 without actually starting Vitest.
 * @returns Promise that resolves to the vitest process exit code, or rejects with
 *          the IsolationFailureCode string when the guard blocks.
 */
export async function runPreflightCheck(
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnFn: SpawnFn = spawn as unknown as SpawnFn,
): Promise<number> {
  const result = checkDbTestIsolation(env);

  if (!result.ok) {
    process.stderr.write(
      `\n[dbTestPreflight] DB-backed test launch BLOCKED\n` +
      `  Code:   ${result.code}\n` +
      `  Reason: ${result.reason}\n\n`,
    );
    return Promise.reject(result.code);
  }

  process.stdout.write(
    `\n[dbTestPreflight] Isolation confirmed\n` +
    `  Target:  ${result.fingerprint}\n` +
    `  Run ID:  ${result.runId}\n` +
    `  Spawning vitest...\n\n`,
  );

  return new Promise((resolve, reject) => {
    const child = spawnFn("vitest", ["run", "--pool=threads"], {
      env: { ...env } as NodeJS.ProcessEnv,
      stdio: "inherit",
      shell: false,
    } as SpawnOptions);

    (child as ReturnType<typeof spawn>).on("close", (code: number | null) => {
      resolve(code ?? 1);
    });

    (child as ReturnType<typeof spawn>).on("error", (err: Error) => {
      reject(err);
    });
  });
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("dbTestPreflightRunner")) {
  runPreflightCheck(process.env)
    .then((code) => process.exit(code))
    .catch((err) => {
      if (typeof err === "string") {
        process.exit(1);
      }
      process.stderr.write(`[dbTestPreflight] Unexpected error: ${String(err)}\n`);
      process.exit(2);
    });
}
