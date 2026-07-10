/**
 * GAP 6 — FP-P0-04B: Kite timeout/fail-fast proof.
 *
 * Static source-scan tests proving that:
 * 1. KITE_HTTP_TIMEOUT_MS = 15_000 is defined in kiteAuth.ts.
 * 2. Every `new KiteConnect({` call in kiteAuth.ts includes `timeout: KITE_HTTP_TIMEOUT_MS`.
 * 3. No KiteConnect instantiation in kiteIntraday.ts, kiteOptionChain.ts, or kiteScanner.ts
 *    creates its own KiteConnect directly (all route through getRestClient from kiteAuth.ts).
 * 4. The KITE_HTTP_TIMEOUT_MS constant value is 15_000 (not reduced below 5000).
 *
 * These are structural/static checks — they prove the timeout contract is locked
 * at the library level and cannot be bypassed by individual call sites.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSrc(filename: string): string {
  return readFileSync(join(__dirname, filename), "utf8");
}

describe("GAP-6: Kite timeout fail-fast proof", () => {
  it("Case 1: kiteAuth.ts defines KITE_HTTP_TIMEOUT_MS = 15_000", () => {
    const src = readSrc("kiteAuth.ts");
    expect(src).toMatch(/const\s+KITE_HTTP_TIMEOUT_MS\s*=\s*15[_,]?000/);
  });

  it("Case 2: every new KiteConnect call in kiteAuth.ts includes timeout: KITE_HTTP_TIMEOUT_MS", () => {
    const src = readSrc("kiteAuth.ts");
    const kcCalls = [...src.matchAll(/new\s+KiteConnect\s*\(\s*\{([^}]+)\}/g)].map((m) => m[1] ?? "");
    expect(kcCalls.length).toBeGreaterThan(0);
    for (const callBody of kcCalls) {
      expect(
        callBody,
        `KiteConnect constructor call missing timeout: KITE_HTTP_TIMEOUT_MS — body: ${callBody}`,
      ).toMatch(/timeout\s*:\s*KITE_HTTP_TIMEOUT_MS/);
    }
  });

  it("Case 3: KITE_HTTP_TIMEOUT_MS value is >= 10_000ms (not dangerously low)", () => {
    const src = readSrc("kiteAuth.ts");
    const match = src.match(/const\s+KITE_HTTP_TIMEOUT_MS\s*=\s*([\d_]+)/);
    expect(match, "KITE_HTTP_TIMEOUT_MS constant not found").not.toBeNull();
    const raw = match![1].replace(/_/g, "");
    const ms = parseInt(raw, 10);
    expect(ms).toBeGreaterThanOrEqual(10_000);
  });

  it("Case 4: kiteIntraday.ts does not construct its own KiteConnect — routes through getRestClient", () => {
    const src = readSrc("kiteIntraday.ts");
    const directCalls = [...src.matchAll(/new\s+KiteConnect\s*\(/g)];
    expect(directCalls.length).toBe(0);
    expect(src).toMatch(/getRestClient/);
  });

  it("Case 5: kiteOptionChain.ts does not construct its own KiteConnect — routes through getRestClient", () => {
    const src = readSrc("kiteOptionChain.ts");
    const directCalls = [...src.matchAll(/new\s+KiteConnect\s*\(/g)];
    expect(directCalls.length).toBe(0);
    expect(src).toMatch(/getRestClient/);
  });

  it("Case 6: kiteScanner.ts does not construct its own KiteConnect — routes through getRestClient", () => {
    const src = readSrc("kiteScanner.ts");
    const directCalls = [...src.matchAll(/new\s+KiteConnect\s*\(/g)];
    expect(directCalls.length).toBe(0);
    expect(src).toMatch(/getRestClient/);
  });

  it("Case 7: no Kite caller file bypasses timeout via a hardcoded literal in its own KiteConnect call", () => {
    const filesToCheck = ["kiteIntraday.ts", "kiteOptionChain.ts", "kiteScanner.ts"];
    for (const file of filesToCheck) {
      const src = readSrc(file);
      const rawCalls = [...src.matchAll(/new\s+KiteConnect\s*\(/g)];
      expect(
        rawCalls.length,
        `${file} must not have any direct KiteConnect instantiation — must use getRestClient`,
      ).toBe(0);
    }
  });
});
