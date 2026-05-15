#!/usr/bin/env tsx
/**
 * Rotate KITE_TOKEN_ENC_KEY without exposing token plaintext or key bytes.
 *
 * What it does:
 *   1. Reads OLD and NEW key material from env (`KITE_TOKEN_ENC_KEY_OLD`,
 *      `KITE_TOKEN_ENC_KEY_NEW`). Both must decode to exactly 32 bytes.
 *   2. Loads the single `kite_session` row (id="active") if present.
 *   3. For every encrypted token column (`api_key`, `access_token`,
 *      `public_token`), decrypts with OLD then re-encrypts with NEW.
 *   4. In dry-run mode (default) prints only counts/status. With
 *      `--apply` writes the re-encrypted values back inside a
 *      transaction.
 *
 * Safety guarantees (every guarantee enforced by the pure helpers in
 * `kiteCrypto.ts` and verified by the test in `rotateKiteTokenEncKey.test.ts`):
 *   - Never logs token plaintext.
 *   - Never logs OLD or NEW key bytes (only their lengths/fingerprints).
 *   - Fail-closed: a single decrypt or re-encrypt failure aborts the
 *     run; in apply mode the transaction is rolled back so the row
 *     stays on the OLD key (recoverable).
 *   - Dry-run is the default. The script must be invoked with `--apply`
 *     to write.
 *   - Refuses to run if OLD === NEW (no-op rotation is a misconfiguration).
 *   - Plaintext / NULL columns are passed through unchanged — they are
 *     reported in the per-column status line so the operator can decide
 *     whether to trigger a fresh Kite login first (which seals every
 *     column under the currently-configured key).
 *   - "Already encrypted under NEW" is not a distinct state the script
 *     can detect — a wrong-key decrypt simply throws and aborts before
 *     any write, which covers both "wrong OLD" and "already on NEW".
 *
 * Usage:
 *
 *   # 1. Generate a new key (do this in a private shell, never committed):
 *   #    node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
 *
 *   # 2. Set both env vars in your shell session:
 *   export KITE_TOKEN_ENC_KEY_OLD="<current key from Replit Secrets>"
 *   export KITE_TOKEN_ENC_KEY_NEW="<freshly generated 32-byte key>"
 *
 *   # 3. Dry-run (no DB writes):
 *   pnpm --filter @workspace/api-server run rotate:kite-key
 *
 *   # 4. Apply for real:
 *   pnpm --filter @workspace/api-server run rotate:kite-key -- --apply
 *
 *   # 5. Update KITE_TOKEN_ENC_KEY in Replit Secrets to the NEW value.
 *   #    Restart the api-server workflow. Verify via
 *   #    GET /api/security/audit (owner-only).
 *
 * If anything looks wrong, the safest recovery is always:
 *
 *   psql "$DATABASE_URL" -c "DELETE FROM kite_session;"
 *
 * The next 06:00 IST Kite re-login will recreate the row with whatever
 * key is currently in `KITE_TOKEN_ENC_KEY`.
 */

import { db, kiteSessionTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  parseKeyMaterial,
  encryptWithKey,
  decryptWithKey,
  isEncrypted,
} from "../lib/kiteCrypto";

// --------------------------------------------------------------------------
// Pure helpers (exported for unit tests). No DB / process / env reads.
// --------------------------------------------------------------------------

/** Short, non-reversible fingerprint of a key (first 8 hex chars of
 *  SHA-256). Safe to log: leaks nothing useful about the key bytes. */
export function keyFingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export type ColumnState =
  | { kind: "NULL" }
  | { kind: "PLAINTEXT" }
  | { kind: "ENCRYPTED" };

export function classifyColumn(value: string | null | undefined): ColumnState {
  if (value == null || value === "") return { kind: "NULL" };
  if (isEncrypted(value)) return { kind: "ENCRYPTED" };
  return { kind: "PLAINTEXT" };
}

export interface RotationInputRow {
  apiKey: string;
  accessToken: string;
  publicToken: string | null;
}

export interface RotationOutputRow {
  apiKey: string;
  accessToken: string;
  publicToken: string | null;
}

export interface RotationReport {
  columns: {
    apiKey: ColumnState;
    accessToken: ColumnState;
    publicToken: ColumnState;
  };
  encryptedColumnCount: number;
  rotated: boolean;
}

/**
 * Pure rotation: decrypt every encrypted column with `oldKey`, re-encrypt
 * with `newKey`. Throws on the first decrypt or re-encrypt failure
 * (fail-closed). Plaintext / NULL columns are passed through unchanged
 * — the caller decides whether that is acceptable.
 */
export function rotateRow(
  row: RotationInputRow,
  oldKey: Buffer,
  newKey: Buffer,
): { next: RotationOutputRow; report: RotationReport } {
  const apiKeyState = classifyColumn(row.apiKey);
  const accessTokenState = classifyColumn(row.accessToken);
  const publicTokenState = classifyColumn(row.publicToken);

  const reencrypt = (value: string): string => {
    const plain = decryptWithKey(value, oldKey);
    return encryptWithKey(plain, newKey);
  };

  const next: RotationOutputRow = {
    apiKey: apiKeyState.kind === "ENCRYPTED" ? reencrypt(row.apiKey) : row.apiKey,
    accessToken:
      accessTokenState.kind === "ENCRYPTED" ? reencrypt(row.accessToken) : row.accessToken,
    publicToken:
      publicTokenState.kind === "ENCRYPTED" ? reencrypt(row.publicToken!) : row.publicToken,
  };

  const encryptedColumnCount =
    (apiKeyState.kind === "ENCRYPTED" ? 1 : 0) +
    (accessTokenState.kind === "ENCRYPTED" ? 1 : 0) +
    (publicTokenState.kind === "ENCRYPTED" ? 1 : 0);

  return {
    next,
    report: {
      columns: {
        apiKey: apiKeyState,
        accessToken: accessTokenState,
        publicToken: publicTokenState,
      },
      encryptedColumnCount,
      rotated: encryptedColumnCount > 0,
    },
  };
}

// --------------------------------------------------------------------------
// CLI driver. Pure helpers above; this section talks to env / DB / stdout.
// --------------------------------------------------------------------------

interface CliFlags {
  apply: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { apply: false, help: false };
  for (const a of argv) {
    if (a === "--apply" || a === "--commit") flags.apply = true;
    else if (a === "-h" || a === "--help") flags.help = true;
  }
  return flags;
}

const HELP = `\
Rotate KITE_TOKEN_ENC_KEY for the kite_session row.

Required env:
  KITE_TOKEN_ENC_KEY_OLD   Current encryption key (32 bytes, base64 or 64 hex chars)
  KITE_TOKEN_ENC_KEY_NEW   New encryption key (32 bytes, base64 or 64 hex chars)
  DATABASE_URL             Postgres connection string

Flags:
  --apply, --commit        Actually write changes (default is dry-run)
  -h, --help               Show this help

Output is intentionally minimal: counts and status only. No token or
key bytes are ever printed.
`;

export async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  // 1. Validate env. Both keys mandatory.
  const oldRaw = process.env["KITE_TOKEN_ENC_KEY_OLD"] ?? "";
  const newRaw = process.env["KITE_TOKEN_ENC_KEY_NEW"] ?? "";
  if (!oldRaw) {
    process.stderr.write("ERROR: KITE_TOKEN_ENC_KEY_OLD is not set.\n");
    return 2;
  }
  if (!newRaw) {
    process.stderr.write("ERROR: KITE_TOKEN_ENC_KEY_NEW is not set.\n");
    return 2;
  }

  let oldKey: Buffer;
  let newKey: Buffer;
  try {
    oldKey = parseKeyMaterial(oldRaw);
  } catch (err) {
    process.stderr.write(`ERROR: KITE_TOKEN_ENC_KEY_OLD invalid — ${(err as Error).message}\n`);
    return 2;
  }
  try {
    newKey = parseKeyMaterial(newRaw);
  } catch (err) {
    process.stderr.write(`ERROR: KITE_TOKEN_ENC_KEY_NEW invalid — ${(err as Error).message}\n`);
    return 2;
  }

  if (oldKey.equals(newKey)) {
    process.stderr.write("ERROR: KITE_TOKEN_ENC_KEY_OLD and KITE_TOKEN_ENC_KEY_NEW are identical — nothing to rotate.\n");
    return 2;
  }

  const oldFp = keyFingerprint(oldKey);
  const newFp = keyFingerprint(newKey);
  process.stdout.write(`mode=${flags.apply ? "APPLY" : "DRY-RUN"} oldKeyFp=${oldFp} newKeyFp=${newFp}\n`);

  // 2. Read the single active row.
  const rows = await db
    .select()
    .from(kiteSessionTable)
    .where(eq(kiteSessionTable.id, "active"))
    .limit(1);

  if (rows.length === 0) {
    process.stdout.write("status=NO_ROW (kite_session is empty — nothing to rotate; new key will take effect on next login)\n");
    return 0;
  }
  const row = rows[0]!;

  // 3. Rotate (pure). Aborts on any decrypt failure.
  let nextRow: RotationOutputRow;
  let report: RotationReport;
  try {
    const result = rotateRow(
      { apiKey: row.apiKey, accessToken: row.accessToken, publicToken: row.publicToken },
      oldKey,
      newKey,
    );
    nextRow = result.next;
    report = result.report;
  } catch (err) {
    // Pure helpers throw with non-token messages.
    process.stderr.write(`ERROR: decrypt/re-encrypt failed — ${(err as Error).message}\n`);
    process.stderr.write("hint: confirm KITE_TOKEN_ENC_KEY_OLD matches the key used by the running app. Aborting; no changes written.\n");
    return 1;
  }

  process.stdout.write(
    `columns api_key=${report.columns.apiKey.kind} access_token=${report.columns.accessToken.kind} public_token=${report.columns.publicToken.kind}\n`,
  );
  process.stdout.write(`encryptedColumnCount=${report.encryptedColumnCount}\n`);

  if (report.encryptedColumnCount === 0) {
    process.stdout.write("status=NOTHING_TO_ROTATE (row exists but no encrypted columns; rows in plaintext will be sealed lazily on next login)\n");
    return 0;
  }

  if (!flags.apply) {
    process.stdout.write("status=DRY_RUN_OK (verified all encrypted columns decrypt with OLD and re-encrypt with NEW; no rows written)\n");
    return 0;
  }

  // 4. Apply. Single UPDATE inside a TX so a partial write can't leave
  //    the row in a mixed-key state.
  await db.transaction(async (tx) => {
    await tx
      .update(kiteSessionTable)
      .set({
        apiKey: nextRow.apiKey,
        accessToken: nextRow.accessToken,
        publicToken: nextRow.publicToken,
      })
      .where(eq(kiteSessionTable.id, "active"));
  });
  process.stdout.write("status=APPLIED (kite_session re-encrypted under NEW key)\n");
  process.stdout.write("next-step: update KITE_TOKEN_ENC_KEY in Replit Secrets to the NEW value, then restart api-server.\n");
  return 0;
}

// Only run when invoked as a script (not when imported by tests).
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("rotateKiteTokenEncKey.ts") ||
  process.argv[1]?.endsWith("rotateKiteTokenEncKey.mjs");

if (isDirectRun) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`FATAL: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
