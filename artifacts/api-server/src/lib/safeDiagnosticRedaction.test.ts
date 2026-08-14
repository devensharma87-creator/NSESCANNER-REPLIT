/**
 * Phase 0.8E — structured, key-aware safe-diagnostic redaction.
 *
 * These tests pin the exact behaviours the owner directive requires, and the
 * exact defect they replace: the old `/token/i` substring rule destroyed the
 * SAFE `tokenReconciliation` field while doing NOTHING about credentials that
 * arrive in VALUES. The suite proves both halves are now correct — the safe
 * domain field survives, and credential keys AND credential-shaped values are
 * removed — and that the walk is defensive against adversarial input.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_ARRAY_LENGTH,
  MAX_DEPTH,
  REDACTED_KEY_MARKER,
  REDACTED_VALUE_MARKER,
  TRUNCATED_MARKER,
  redactForOwnerDiagnostics,
} from "./safeDiagnosticRedaction";

describe("redactForOwnerDiagnostics — SAFE domain keys survive", () => {
  it("keeps tokenReconciliation and its nested coded state intact", () => {
    const input = {
      tokenReconciliation: {
        state: "TOKEN_RECONCILIATION_PENDING",
        pendingReconciliationCount: 2,
        tokenReconciliationState: "PENDING",
      },
      instrumentTokenCount: 4213,
      providerInstrumentTokenCount: 4213,
      tokenCount: 7,
    };
    const out = redactForOwnerDiagnostics(input) as typeof input;

    // The whole safe subtree is preserved verbatim — this is the exact field the
    // old substring rule destroyed.
    expect(out.tokenReconciliation).toEqual({
      state: "TOKEN_RECONCILIATION_PENDING",
      pendingReconciliationCount: 2,
      tokenReconciliationState: "PENDING",
    });
    expect(out.instrumentTokenCount).toBe(4213);
    expect(out.providerInstrumentTokenCount).toBe(4213);
    expect(out.tokenCount).toBe(7);
  });
});

describe("redactForOwnerDiagnostics — credential KEYS are removed", () => {
  it("redacts accessToken, api_key, apiSecret and authorization keys", () => {
    const input = {
      accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
      api_key: "AKIA-super-secret-value",
      apiSecret: "shhh",
      authorization: "Bearer whatever",
      safeState: "READY",
    };
    const out = redactForOwnerDiagnostics(input) as Record<string, unknown>;

    expect(out.accessToken).toBe(REDACTED_KEY_MARKER);
    expect(out.api_key).toBe(REDACTED_KEY_MARKER);
    expect(out.apiSecret).toBe(REDACTED_KEY_MARKER);
    expect(out.authorization).toBe(REDACTED_KEY_MARKER);
    // A neighbouring safe field is untouched.
    expect(out.safeState).toBe("READY");
  });

  it("normalises key spelling (camelCase / snake / hyphen / upper) to the deny rule", () => {
    const input = {
      "Access-Token": "x",
      ACCESS_TOKEN: "y",
      accesstoken: "z",
    };
    const out = redactForOwnerDiagnostics(input) as Record<string, unknown>;
    expect(out["Access-Token"]).toBe(REDACTED_KEY_MARKER);
    expect(out.ACCESS_TOKEN).toBe(REDACTED_KEY_MARKER);
    expect(out.accesstoken).toBe(REDACTED_KEY_MARKER);
  });
});

describe("redactForOwnerDiagnostics — credential VALUES are removed regardless of key", () => {
  it("redacts a Bearer authorization VALUE stored under an innocuous key", () => {
    const input = { detail: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature" };
    const out = redactForOwnerDiagnostics(input) as Record<string, unknown>;
    expect(out.detail).toBe(REDACTED_VALUE_MARKER);
  });

  it("strips userinfo credentials from a URL but keeps host and path", () => {
    const input = { source: "https://user:sup3rSecret@nse.example.com/api/v1/scrips" };
    const out = redactForOwnerDiagnostics(input) as Record<string, unknown>;
    const s = out.source as string;
    expect(s).toContain("https://");
    expect(s).toContain("@nse.example.com/api/v1/scrips");
    expect(s).not.toContain("sup3rSecret");
    expect(s).toContain(REDACTED_VALUE_MARKER);
  });

  it("redacts a token= query param VALUE but keeps the rest of the URL", () => {
    const input = {
      source: "https://kite.example.com/instruments?token=SECRET123&exchange=NSE",
    };
    const out = redactForOwnerDiagnostics(input) as Record<string, unknown>;
    const s = out.source as string;
    // Host + path + non-credential params survive so the source stays reportable.
    expect(s).toContain("https://kite.example.com/instruments");
    expect(s).toContain("exchange=NSE");
    expect(s).toContain(`token=${REDACTED_VALUE_MARKER}`);
    expect(s).not.toContain("SECRET123");
  });
});

describe("redactForOwnerDiagnostics — denied array is replaced wholesale", () => {
  it("replaces a denied key's array without leaking any element", () => {
    const input = {
      credentials: ["tokenA-leak", "tokenB-leak", { nested: "tokenC-leak" }],
      instrumentTokenCount: 3,
    };
    const out = redactForOwnerDiagnostics(input) as Record<string, unknown>;
    // Not an array, not element-by-element — a single wholesale marker.
    expect(out.credentials).toBe(REDACTED_KEY_MARKER);
    // Serialised proof carries none of the elements.
    expect(JSON.stringify(out)).not.toContain("leak");
    // The safe count beside it is preserved.
    expect(out.instrumentTokenCount).toBe(3);
  });

  it("replaces a suspect (non-exact) key's array wholesale, no element leakage", () => {
    // `userAccessTokenList` is not an exact deny key but is suspect via the
    // `token` fragment — its array must still collapse, not walk element-wise.
    const input = { userAccessTokenList: ["a-leak", "b-leak"] };
    const out = redactForOwnerDiagnostics(input) as Record<string, unknown>;
    expect(out.userAccessTokenList).toBe(REDACTED_VALUE_MARKER);
    expect(JSON.stringify(out)).not.toContain("leak");
  });
});

describe("redactForOwnerDiagnostics — allow set beats resemblance, deny beats allow", () => {
  it("allow-listed key survives even though it contains the 'token' fragment", () => {
    const out = redactForOwnerDiagnostics({ tokenReconciliation: "OK" }) as Record<
      string,
      unknown
    >;
    expect(out.tokenReconciliation).toBe("OK");
  });

  it("an EXACT deny key is redacted even if it is also allow-shaped (fail-closed)", () => {
    // `sessionToken` is an exact deny key; nothing rescues it.
    const out = redactForOwnerDiagnostics({ sessionToken: "safe-looking" }) as Record<
      string,
      unknown
    >;
    expect(out.sessionToken).toBe(REDACTED_KEY_MARKER);
  });
});

describe("redactForOwnerDiagnostics — defensive bounds and exotic input", () => {
  it("bounds recursion depth and collapses beyond MAX_DEPTH", () => {
    // Build a nest deeper than MAX_DEPTH.
    let deep: Record<string, unknown> = { leaf: "bottom" };
    for (let i = 0; i < MAX_DEPTH + 5; i++) deep = { child: deep };
    const out = redactForOwnerDiagnostics(deep);
    // Descend until we hit the collapse; it must occur (never the raw leaf) and
    // must occur within MAX_DEPTH+1 levels.
    let cur: unknown = out;
    let levels = 0;
    while (cur && typeof cur === "object" && "child" in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>).child;
      levels++;
      if (levels > MAX_DEPTH + 2) break;
    }
    expect(cur).toBe(TRUNCATED_MARKER);
    expect(levels).toBeLessThanOrEqual(MAX_DEPTH + 1);
    // The original safe leaf never made it into the output.
    expect(JSON.stringify(out)).not.toContain("bottom");
  });

  it("bounds array length and collapses an oversized array", () => {
    const huge = new Array(MAX_ARRAY_LENGTH + 1).fill(0);
    const out = redactForOwnerDiagnostics({ items: huge }) as Record<string, unknown>;
    expect(out.items).toBe(TRUNCATED_MARKER);
  });

  it("never throws on a cyclic structure and breaks the cycle", () => {
    const a: Record<string, unknown> = { name: "a", safe: "keep" };
    a.self = a;
    let out: unknown;
    expect(() => {
      out = redactForOwnerDiagnostics(a);
    }).not.toThrow();
    const o = out as Record<string, unknown>;
    expect(o.name).toBe("a");
    expect(o.safe).toBe("keep");
    // The cycle is represented as a marker, not infinite recursion.
    expect(o.self).toBe(TRUNCATED_MARKER);
  });

  it("never throws on exotic input (throwing getter, Date, Map, bigint, undefined)", () => {
    const exotic = {
      when: new Date("2024-01-02T03:04:05.000Z"),
      big: 42n,
      missing: undefined,
      map: new Map([["k", "v"]]),
      get boom(): string {
        throw new Error("hostile getter");
      },
      safe: "keep",
    };
    let out: unknown;
    expect(() => {
      out = redactForOwnerDiagnostics(exotic);
    }).not.toThrow();
    const o = out as Record<string, unknown>;
    expect(o.when).toBe("2024-01-02T03:04:05.000Z");
    expect(o.big).toBe("42n");
    expect(o.missing).toBe(REDACTED_VALUE_MARKER);
    expect(o.map).toBe(TRUNCATED_MARKER);
    expect(o.boom).toBe(REDACTED_VALUE_MARKER);
    expect(o.safe).toBe("keep");
  });

  it("is deterministic and produces stable key ordering", () => {
    const input = { b: 1, a: 2, tokenReconciliation: "OK", accessToken: "x" };
    const first = JSON.stringify(redactForOwnerDiagnostics(input));
    const second = JSON.stringify(redactForOwnerDiagnostics(input));
    expect(first).toBe(second);
    // Keys are sorted deterministically.
    expect(first.indexOf('"a"')).toBeLessThan(first.indexOf('"b"'));
  });
});
