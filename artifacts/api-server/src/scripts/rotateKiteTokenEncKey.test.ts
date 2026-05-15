/**
 * Tests for the KITE_TOKEN_ENC_KEY rotation tool.
 *
 * Test-only file. Exercises the pure helpers exported from
 * `rotateKiteTokenEncKey.ts` plus the additive crypto helpers in
 * `kiteCrypto.ts`. No DB writes, no live trading paths touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

// Mock the DB before importing the script. The CLI tests below assert
// the dry-run path performs zero update / transaction calls; the
// fixtures track every db call so we can prove the boundary.
const dbCalls: string[] = [];
const dbSelectRow: { row: { apiKey: string; accessToken: string; publicToken: string | null } | null } = { row: null };

vi.mock("@workspace/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          dbCalls.push("select");
          return dbSelectRow.row ? [dbSelectRow.row] : [];
        }),
      })),
    })),
  }));
  const update = vi.fn(() => {
    dbCalls.push("update");
    return {
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    };
  });
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    dbCalls.push("transaction");
    return cb({ update });
  });
  return {
    db: { select, update, transaction },
    kiteSessionTable: { id: { name: "id" } },
  };
});

import {
  parseKeyMaterial,
  encryptWithKey,
  decryptWithKey,
  isEncrypted,
} from "../lib/kiteCrypto";
import {
  classifyColumn,
  keyFingerprint,
  parseArgs,
  rotateRow,
  main,
} from "./rotateKiteTokenEncKey";

const SAMPLE_API_KEY = "sample-api-key-not-real-1234567890";
const SAMPLE_ACCESS_TOKEN = "sample-access-token-not-real-abcdef";
const SAMPLE_PUBLIC_TOKEN = "sample-public-token-not-real-zyxwvu";

describe("kiteCrypto: parseKeyMaterial / encryptWithKey / decryptWithKey", () => {
  it("parseKeyMaterial accepts a 64-char hex string", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("hex"));
    expect(k.length).toBe(32);
  });
  it("parseKeyMaterial accepts a base64-encoded 32-byte key", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("base64"));
    expect(k.length).toBe(32);
  });
  it("parseKeyMaterial accepts base64url (no padding)", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"));
    expect(k.length).toBe(32);
  });
  it("parseKeyMaterial rejects empty input", () => {
    expect(() => parseKeyMaterial("")).toThrow(/empty/);
    expect(() => parseKeyMaterial("   ")).toThrow(/empty/);
  });
  it("parseKeyMaterial rejects a too-short string", () => {
    expect(() => parseKeyMaterial("too-short")).toThrow(/32 bytes/);
  });
  it("parseKeyMaterial rejects a 31-byte payload", () => {
    expect(() => parseKeyMaterial(randomBytes(31).toString("base64"))).toThrow(/32 bytes/);
  });
  it("parseKeyMaterial rejects a 33-byte payload", () => {
    expect(() => parseKeyMaterial(randomBytes(33).toString("base64"))).toThrow(/32 bytes/);
  });

  it("encryptWithKey + decryptWithKey round-trip", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("base64"));
    const ct = encryptWithKey(SAMPLE_ACCESS_TOKEN, k);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain(SAMPLE_ACCESS_TOKEN);
    expect(decryptWithKey(ct, k)).toBe(SAMPLE_ACCESS_TOKEN);
  });
  it("decryptWithKey FAILS with the wrong key", () => {
    const k1 = parseKeyMaterial(randomBytes(32).toString("base64"));
    const k2 = parseKeyMaterial(randomBytes(32).toString("base64"));
    const ct = encryptWithKey(SAMPLE_ACCESS_TOKEN, k1);
    expect(() => decryptWithKey(ct, k2)).toThrow();
  });
  it("encryptWithKey refuses to double-wrap a v1 envelope", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("base64"));
    const ct = encryptWithKey(SAMPLE_ACCESS_TOKEN, k);
    expect(() => encryptWithKey(ct, k)).toThrow(/double-wrap/);
  });
  it("decryptWithKey refuses legacy plaintext input", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("base64"));
    expect(() => decryptWithKey("not-an-envelope", k)).toThrow(/v1 envelope/);
  });
  it("encryptWithKey rejects empty plaintext", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("base64"));
    expect(() => encryptWithKey("", k)).toThrow();
  });
  it("encryptWithKey rejects a wrong-length key", () => {
    expect(() => encryptWithKey("x", Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe("rotateKiteTokenEncKey: classifyColumn", () => {
  it("classifies null/empty as NULL", () => {
    expect(classifyColumn(null).kind).toBe("NULL");
    expect(classifyColumn(undefined).kind).toBe("NULL");
    expect(classifyColumn("").kind).toBe("NULL");
  });
  it("classifies legacy plaintext as PLAINTEXT", () => {
    expect(classifyColumn("legacy-token").kind).toBe("PLAINTEXT");
  });
  it("classifies v1 envelope as ENCRYPTED", () => {
    expect(classifyColumn("v1:a:b:c").kind).toBe("ENCRYPTED");
  });
});

describe("rotateKiteTokenEncKey: keyFingerprint", () => {
  it("is 8 hex chars", () => {
    const k = parseKeyMaterial(randomBytes(32).toString("base64"));
    const fp = keyFingerprint(k);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is deterministic for the same key", () => {
    const raw = randomBytes(32).toString("base64");
    expect(keyFingerprint(parseKeyMaterial(raw))).toBe(keyFingerprint(parseKeyMaterial(raw)));
  });
  it("differs for different keys", () => {
    const a = keyFingerprint(parseKeyMaterial(randomBytes(32).toString("base64")));
    const b = keyFingerprint(parseKeyMaterial(randomBytes(32).toString("base64")));
    expect(a).not.toBe(b);
  });
});

describe("rotateKiteTokenEncKey: parseArgs", () => {
  it("dry-run by default", () => {
    expect(parseArgs([])).toEqual({ apply: false, help: false });
  });
  it("--apply flips apply=true", () => {
    expect(parseArgs(["--apply"]).apply).toBe(true);
  });
  it("--commit also flips apply=true (alias)", () => {
    expect(parseArgs(["--commit"]).apply).toBe(true);
  });
  it("-h / --help", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("rotateKiteTokenEncKey: rotateRow (happy path)", () => {
  const oldKey = parseKeyMaterial(randomBytes(32).toString("base64"));
  const newKey = parseKeyMaterial(randomBytes(32).toString("base64"));
  const inputRow = {
    apiKey: encryptWithKey(SAMPLE_API_KEY, oldKey),
    accessToken: encryptWithKey(SAMPLE_ACCESS_TOKEN, oldKey),
    publicToken: encryptWithKey(SAMPLE_PUBLIC_TOKEN, oldKey),
  };

  it("re-encrypts every column with the NEW key", () => {
    const { next, report } = rotateRow(inputRow, oldKey, newKey);
    expect(report.encryptedColumnCount).toBe(3);
    expect(report.rotated).toBe(true);
    // New ciphertexts decrypt with NEW key only.
    expect(decryptWithKey(next.apiKey, newKey)).toBe(SAMPLE_API_KEY);
    expect(decryptWithKey(next.accessToken, newKey)).toBe(SAMPLE_ACCESS_TOKEN);
    expect(decryptWithKey(next.publicToken!, newKey)).toBe(SAMPLE_PUBLIC_TOKEN);
  });

  it("output ciphertexts no longer decrypt with OLD key", () => {
    const { next } = rotateRow(inputRow, oldKey, newKey);
    expect(() => decryptWithKey(next.apiKey, oldKey)).toThrow();
    expect(() => decryptWithKey(next.accessToken, oldKey)).toThrow();
    expect(() => decryptWithKey(next.publicToken!, oldKey)).toThrow();
  });

  it("output ciphertexts NEVER contain the plaintext token", () => {
    const { next } = rotateRow(inputRow, oldKey, newKey);
    expect(next.apiKey).not.toContain(SAMPLE_API_KEY);
    expect(next.accessToken).not.toContain(SAMPLE_ACCESS_TOKEN);
    expect(next.publicToken).not.toContain(SAMPLE_PUBLIC_TOKEN);
  });

  it("output ciphertexts differ from input ciphertexts (fresh IVs)", () => {
    const { next } = rotateRow(inputRow, oldKey, newKey);
    expect(next.apiKey).not.toBe(inputRow.apiKey);
    expect(next.accessToken).not.toBe(inputRow.accessToken);
    expect(next.publicToken).not.toBe(inputRow.publicToken);
  });

  it("handles a NULL public_token without erroring", () => {
    const r = rotateRow({ ...inputRow, publicToken: null }, oldKey, newKey);
    expect(r.report.encryptedColumnCount).toBe(2);
    expect(r.report.columns.publicToken.kind).toBe("NULL");
    expect(r.next.publicToken).toBeNull();
  });
});

describe("rotateKiteTokenEncKey: rotateRow (failure paths — fail-closed)", () => {
  it("throws when OLD key is wrong (real ciphertext from a different key)", () => {
    const realKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const wrongOldKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const newKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const inputRow = {
      apiKey: encryptWithKey(SAMPLE_API_KEY, realKey),
      accessToken: encryptWithKey(SAMPLE_ACCESS_TOKEN, realKey),
      publicToken: null,
    };
    expect(() => rotateRow(inputRow, wrongOldKey, newKey)).toThrow();
  });

  it("throws when error message contains NEITHER plaintext NOR raw key bytes", () => {
    const realKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const wrongOldKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const newKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const inputRow = {
      apiKey: encryptWithKey(SAMPLE_API_KEY, realKey),
      accessToken: encryptWithKey(SAMPLE_ACCESS_TOKEN, realKey),
      publicToken: null,
    };
    let caughtMsg = "";
    try { rotateRow(inputRow, wrongOldKey, newKey); } catch (e) { caughtMsg = (e as Error).message; }
    expect(caughtMsg).not.toContain(SAMPLE_API_KEY);
    expect(caughtMsg).not.toContain(SAMPLE_ACCESS_TOKEN);
    // base64 of either key should never appear in the error.
    expect(caughtMsg).not.toContain(realKey.toString("base64"));
    expect(caughtMsg).not.toContain(wrongOldKey.toString("base64"));
    expect(caughtMsg).not.toContain(newKey.toString("base64"));
  });

  it("passes plaintext columns through unchanged (operator decides)", () => {
    const oldKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const newKey = parseKeyMaterial(randomBytes(32).toString("base64"));
    const inputRow = {
      apiKey: "legacy-plaintext-not-real",
      accessToken: encryptWithKey(SAMPLE_ACCESS_TOKEN, oldKey),
      publicToken: null,
    };
    const { next, report } = rotateRow(inputRow, oldKey, newKey);
    expect(report.columns.apiKey.kind).toBe("PLAINTEXT");
    expect(report.encryptedColumnCount).toBe(1);
    expect(next.apiKey).toBe("legacy-plaintext-not-real");
    expect(decryptWithKey(next.accessToken, newKey)).toBe(SAMPLE_ACCESS_TOKEN);
  });
});

// --------------------------------------------------------------------------
// CLI integration tests — env validation + dry-run-no-write boundary.
// --------------------------------------------------------------------------

describe("rotateKiteTokenEncKey: CLI env validation (fail-closed before any DB call)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const origArgv = process.argv;
  const origOld = process.env["KITE_TOKEN_ENC_KEY_OLD"];
  const origNew = process.env["KITE_TOKEN_ENC_KEY_NEW"];

  beforeEach(() => {
    dbCalls.length = 0;
    dbSelectRow.row = null;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.argv = ["node", "rotateKiteTokenEncKey.ts"];
    delete process.env["KITE_TOKEN_ENC_KEY_OLD"];
    delete process.env["KITE_TOKEN_ENC_KEY_NEW"];
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.argv = origArgv;
    if (origOld === undefined) delete process.env["KITE_TOKEN_ENC_KEY_OLD"];
    else process.env["KITE_TOKEN_ENC_KEY_OLD"] = origOld;
    if (origNew === undefined) delete process.env["KITE_TOKEN_ENC_KEY_NEW"];
    else process.env["KITE_TOKEN_ENC_KEY_NEW"] = origNew;
  });

  function lastStderr(): string {
    return stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
  }

  it("exits 2 when KITE_TOKEN_ENC_KEY_OLD is missing — no DB calls", async () => {
    process.env["KITE_TOKEN_ENC_KEY_NEW"] = randomBytes(32).toString("base64");
    const code = await main();
    expect(code).toBe(2);
    expect(lastStderr()).toContain("KITE_TOKEN_ENC_KEY_OLD is not set");
    expect(dbCalls).toEqual([]);
  });

  it("exits 2 when KITE_TOKEN_ENC_KEY_NEW is missing — no DB calls", async () => {
    process.env["KITE_TOKEN_ENC_KEY_OLD"] = randomBytes(32).toString("base64");
    const code = await main();
    expect(code).toBe(2);
    expect(lastStderr()).toContain("KITE_TOKEN_ENC_KEY_NEW is not set");
    expect(dbCalls).toEqual([]);
  });

  it("exits 2 when KITE_TOKEN_ENC_KEY_OLD is malformed — no DB calls", async () => {
    process.env["KITE_TOKEN_ENC_KEY_OLD"] = "too-short";
    process.env["KITE_TOKEN_ENC_KEY_NEW"] = randomBytes(32).toString("base64");
    const code = await main();
    expect(code).toBe(2);
    expect(lastStderr()).toContain("KITE_TOKEN_ENC_KEY_OLD invalid");
    expect(dbCalls).toEqual([]);
  });

  it("exits 2 when KITE_TOKEN_ENC_KEY_NEW is malformed — no DB calls", async () => {
    process.env["KITE_TOKEN_ENC_KEY_OLD"] = randomBytes(32).toString("base64");
    process.env["KITE_TOKEN_ENC_KEY_NEW"] = "garbage!!";
    const code = await main();
    expect(code).toBe(2);
    expect(lastStderr()).toContain("KITE_TOKEN_ENC_KEY_NEW invalid");
    expect(dbCalls).toEqual([]);
  });

  it("exits 2 when OLD === NEW — no DB calls", async () => {
    const k = randomBytes(32).toString("base64");
    process.env["KITE_TOKEN_ENC_KEY_OLD"] = k;
    process.env["KITE_TOKEN_ENC_KEY_NEW"] = k;
    const code = await main();
    expect(code).toBe(2);
    expect(lastStderr()).toContain("identical");
    expect(dbCalls).toEqual([]);
  });
});

describe("rotateKiteTokenEncKey: CLI dry-run vs apply boundary (DB write proof)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const origArgv = process.argv;
  const origOld = process.env["KITE_TOKEN_ENC_KEY_OLD"];
  const origNew = process.env["KITE_TOKEN_ENC_KEY_NEW"];

  beforeEach(() => {
    dbCalls.length = 0;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const oldRaw = randomBytes(32).toString("base64");
    process.env["KITE_TOKEN_ENC_KEY_OLD"] = oldRaw;
    process.env["KITE_TOKEN_ENC_KEY_NEW"] = randomBytes(32).toString("base64");
    const oldKey = parseKeyMaterial(oldRaw);
    dbSelectRow.row = {
      apiKey: encryptWithKey(SAMPLE_API_KEY, oldKey),
      accessToken: encryptWithKey(SAMPLE_ACCESS_TOKEN, oldKey),
      publicToken: encryptWithKey(SAMPLE_PUBLIC_TOKEN, oldKey),
    };
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.argv = origArgv;
    dbSelectRow.row = null;
    if (origOld === undefined) delete process.env["KITE_TOKEN_ENC_KEY_OLD"];
    else process.env["KITE_TOKEN_ENC_KEY_OLD"] = origOld;
    if (origNew === undefined) delete process.env["KITE_TOKEN_ENC_KEY_NEW"];
    else process.env["KITE_TOKEN_ENC_KEY_NEW"] = origNew;
  });

  function lastStdout(): string {
    return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
  }

  it("DRY-RUN: reads but never updates / opens a transaction", async () => {
    process.argv = ["node", "rotateKiteTokenEncKey.ts"];
    const code = await main();
    expect(code).toBe(0);
    expect(dbCalls).toContain("select");
    expect(dbCalls).not.toContain("update");
    expect(dbCalls).not.toContain("transaction");
    const out = lastStdout();
    expect(out).toContain("mode=DRY-RUN");
    expect(out).toContain("status=DRY_RUN_OK");
    expect(out).toContain("encryptedColumnCount=3");
  });

  it("APPLY: opens a transaction and issues the update", async () => {
    process.argv = ["node", "rotateKiteTokenEncKey.ts", "--apply"];
    const code = await main();
    expect(code).toBe(0);
    expect(dbCalls).toContain("select");
    expect(dbCalls).toContain("transaction");
    expect(dbCalls).toContain("update");
    const out = lastStdout();
    expect(out).toContain("mode=APPLY");
    expect(out).toContain("status=APPLIED");
  });

  it("DRY-RUN with wrong OLD key: aborts before any update / transaction", async () => {
    // Replace OLD env with a key that doesn't match the row.
    process.env["KITE_TOKEN_ENC_KEY_OLD"] = randomBytes(32).toString("base64");
    process.argv = ["node", "rotateKiteTokenEncKey.ts", "--apply"];
    const code = await main();
    expect(code).toBe(1);
    expect(dbCalls).toContain("select");
    expect(dbCalls).not.toContain("update");
    expect(dbCalls).not.toContain("transaction");
    const err = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(err).toContain("decrypt/re-encrypt failed");
    expect(err).not.toContain(SAMPLE_API_KEY);
    expect(err).not.toContain(SAMPLE_ACCESS_TOKEN);
  });

  it("Stdout never contains plaintext tokens or full key material", async () => {
    process.argv = ["node", "rotateKiteTokenEncKey.ts", "--apply"];
    await main();
    const out = lastStdout();
    expect(out).not.toContain(SAMPLE_API_KEY);
    expect(out).not.toContain(SAMPLE_ACCESS_TOKEN);
    expect(out).not.toContain(SAMPLE_PUBLIC_TOKEN);
    expect(out).not.toContain(process.env["KITE_TOKEN_ENC_KEY_OLD"]!);
    expect(out).not.toContain(process.env["KITE_TOKEN_ENC_KEY_NEW"]!);
  });
});
