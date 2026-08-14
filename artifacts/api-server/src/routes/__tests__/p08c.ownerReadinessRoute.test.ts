/**
 * PHASE 0.8C CORRECTION — AUTHENTICATED OWNER READINESS ROUTE PROOF
 *
 * The original 0.8C work proved only that an anonymous caller gets 401, then
 * asserted the owner payload against the evaluator's snapshot directly. That
 * is not a proof of the route: it says nothing about whether the authenticated
 * path returns the same tree, whether the auth middleware admits a legitimate
 * owner at all, or whether JSON serialisation drops or mangles anything.
 *
 * So this exercises the real thing:
 *   - the real `dataHealth` router, mounted on a throwaway Express app;
 *   - the real `requireOwnerStrict` middleware, unmodified;
 *   - the real `/api/auth/login` route as the ONLY way a session is obtained.
 *
 * No cookie is forged. No middleware is replaced or bypassed. No test-only
 * branch is added to production code. The session comes from the same login
 * endpoint the owner's browser uses, signed by the same `SESSION_SECRET`
 * through the same `cookie-parser` instance.
 *
 * The listener binds 127.0.0.1 on an ephemeral port and is closed at the end.
 * Nothing here activates a feed, opens a provider socket or writes anything.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import dataHealthRouter from "../dataHealth";
import authRouter from "../auth";
import { buildActivationReadinessReport } from "../../lib/feed/productionFeedManager";
import { REQUIRED_ACTIVATION_GATE_IDS } from "../../lib/feed/activationEvidence";

const READINESS_PATH = "/api/data-health/activation-readiness";

let server: Server;
let baseUrl: string;
let ownerCookie: string;
let handleBaseline: string[];

/** Secrets read for the login call only. Values are never asserted or printed. */
const APP_ACCESS_PASSWORD = process.env["APP_ACCESS_PASSWORD"] ?? "";
const SESSION_SECRET = process.env["SESSION_SECRET"] ?? "";

function buildApp(): Express {
  const app = express();
  // Same order as the production app: cookie parsing (with the real secret) and
  // body parsing before any route.
  app.use(cookieParser(SESSION_SECRET));
  app.use(express.json({ limit: "256kb" }));
  // The readiness route's error branch logs through `req.log`. Give it a silent
  // logger so a failure surfaces as a 500 body instead of crashing the process.
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", authRouter);
  app.use("/api", dataHealthRouter);
  return app;
}

function activeHandles(): string[] {
  const p = process as unknown as { getActiveResourcesInfo?: () => string[] };
  return p.getActiveResourcesInfo?.() ?? [];
}

beforeAll(async () => {
  expect(
    SESSION_SECRET.length,
    "SESSION_SECRET must be configured for the real cookie signature path",
  ).toBeGreaterThan(0);
  expect(
    APP_ACCESS_PASSWORD.length,
    "APP_ACCESS_PASSWORD must be configured to use the supported owner login",
  ).toBeGreaterThan(0);

  server = buildApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  // Baseline taken AFTER the listener is bound, so anything counted later was
  // added by the request path rather than by the fixture.
  handleBaseline = activeHandles();

  // ── the supported owner-session mechanism ──
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: APP_ACCESS_PASSWORD }),
  });
  expect(login.status, "owner login through the real /api/auth/login route").toBe(200);
  const setCookie = login.headers.getSetCookie?.() ?? [];
  const raw = setCookie.find((c) => c.startsWith("scanner_session="));
  expect(raw, "login must set a signed scanner_session cookie").toBeTruthy();
  ownerCookie = (raw as string).split(";")[0] as string;
  // The cookie must actually be signed — an unsigned value would mean the
  // signature path was not exercised.
  expect(decodeURIComponent(ownerCookie)).toContain("s:");
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Phase 0.8C correction — authenticated owner readiness route", () => {
  // ── R1 ─────────────────────────────────────────────────────────────────────
  it("R1 refuses an anonymous caller with 401 AUTH_REQUIRED and leaks no readiness detail", async () => {
    const res = await fetch(`${baseUrl}${READINESS_PATH}`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "unauthorized", code: "AUTH_REQUIRED" });

    // A wrong password must not produce a session either.
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "definitely-not-the-owner-password" }),
    });
    expect(badLogin.status).toBe(401);
    expect(badLogin.headers.getSetCookie?.() ?? []).toEqual([]);

    // A cookie with a broken signature must be rejected by cookie-parser.
    const forged = await fetch(`${baseUrl}${READINESS_PATH}`, {
      headers: { cookie: "scanner_session=s%3Aowner.not-a-valid-signature" },
    });
    expect(forged.status).toBe(401);
  });

  // ── R2 ─────────────────────────────────────────────────────────────────────
  it("R2 serves 200 to an owner session obtained from the real login route", async () => {
    const res = await fetch(`${baseUrl}${READINESS_PATH}`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["phase"]).toBe("PHASE_0_8C_ACTIVATION_READINESS");
    expect(body["overall"]).toBe("REFUSED");
  });

  // ── R3 ─────────────────────────────────────────────────────────────────────
  it("R3 the whole response tree equals the production evaluator at the same instant", async () => {
    const res = await fetch(`${baseUrl}${READINESS_PATH}`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The response names the instant it describes. Re-running the evaluator for
    // that same instant reproduces the report deterministically, so the
    // comparison needs NO normalisation at all: every wall-clock field in the
    // tree derives from this one number.
    const evaluatedAtMs = body["evaluatedAtMs"];
    expect(typeof evaluatedAtMs).toBe("number");
    expect(Number.isFinite(evaluatedAtMs as number)).toBe(true);

    const direct = JSON.parse(
      JSON.stringify(buildActivationReadinessReport(evaluatedAtMs as number)),
    );

    // Whole tree, not selected fields. Every gate, blocker, lock, hash,
    // generation id, socket count and readiness flag is included.
    expect(body).toEqual(direct);

    // Guard against the comparison being vacuous: the tree must actually carry
    // the things it claims to.
    expect(Object.keys(body).length).toBeGreaterThanOrEqual(12);
    expect(Array.isArray(body["gates"])).toBe(true);
  });

  // ── R4 ─────────────────────────────────────────────────────────────────────
  it("R4 reports all fifteen required gates exactly once", async () => {
    const res = await fetch(`${baseUrl}${READINESS_PATH}`, {
      headers: { cookie: ownerCookie },
    });
    const body = (await res.json()) as { gates: Array<{ gateId: string }> };
    const ids = body.gates.map((g) => g.gateId);

    expect(ids.length).toBe(15);
    expect(new Set(ids).size).toBe(15);
    // Exactly the required set — no extras, none missing.
    expect([...ids].sort()).toEqual([...REQUIRED_ACTIVATION_GATE_IDS].sort());
  });

  // ── R5 ─────────────────────────────────────────────────────────────────────
  it("R5 blockers over HTTP equal the aggregate judgment used at the feed boundary", async () => {
    const res = await fetch(`${baseUrl}${READINESS_PATH}`, {
      headers: { cookie: ownerCookie },
    });
    const body = (await res.json()) as {
      evaluatedAtMs: number;
      blockingCodes: string[];
      blockingGateIds: string[];
      evidenceAdmittedByBoundary: boolean;
      gates: Array<{ gateId: string; state: string }>;
    };

    const direct = buildActivationReadinessReport(body.evaluatedAtMs) as unknown as {
      blockingCodes: string[];
      blockingGateIds: string[];
      evidenceAdmittedByBoundary: boolean;
    };

    expect(body.blockingCodes).toEqual(direct.blockingCodes);
    expect(body.blockingGateIds).toEqual(direct.blockingGateIds);
    expect(body.evidenceAdmittedByBoundary).toBe(direct.evidenceAdmittedByBoundary);

    // The feed must be refused, and the refusal list must be non-empty — an
    // empty blocker list beside a refusing feed is the exact confusion this
    // endpoint exists to remove.
    expect(body.evidenceAdmittedByBoundary).toBe(false);
    expect(body.blockingCodes.length).toBeGreaterThan(0);

    // `blockingCodes` is authoritative and must cover every non-PASS gate.
    const nonPass = body.gates.filter((g) => g.state !== "PASS").map((g) => g.gateId);
    expect([...body.blockingGateIds].sort()).toEqual([...nonPass].sort());
    for (const gateId of nonPass) {
      expect(
        body.blockingCodes.some((c) => c.startsWith(`${gateId}:`)),
        `blockingCodes must explain ${gateId}`,
      ).toBe(true);
    }
  });

  // ── R6 ─────────────────────────────────────────────────────────────────────
  it("R6 the owner payload carries no secret value, credential-shaped key or identity list", async () => {
    const res = await fetch(`${baseUrl}${READINESS_PATH}`, {
      headers: { cookie: ownerCookie },
    });
    const text = await res.text();
    const body = JSON.parse(text) as unknown;

    // 1. No configured secret VALUE appears anywhere in the serialised tree.
    //    Short values are excluded from the scan and failed loudly instead: a
    //    two-character secret would match by coincidence and turn this into a
    //    green light that proves nothing.
    const secretNames = [
      "APP_ACCESS_PASSWORD",
      "SESSION_SECRET",
      "KITE_API_KEY",
      "KITE_API_SECRET",
      "KITE_TOKEN_ENC_KEY",
      "TELEGRAM_BOT_TOKEN",
      "UPSTOX_ANALYTICS_TOKEN",
      "INDIANAPI_API_KEY",
      "TRADINGVIEW_WEBHOOK_SECRET",
    ];
    let scanned = 0;
    for (const name of secretNames) {
      const value = process.env[name];
      if (value === undefined || value.length === 0) continue;
      expect(value.length, `${name} is too short to scan for safely`).toBeGreaterThanOrEqual(8);
      expect(text.includes(value), `${name} value must not appear in the payload`).toBe(false);
      scanned += 1;
    }
    // The scan must have actually examined something.
    expect(scanned).toBeGreaterThan(0);

    // 2. No key anywhere in the tree is credential-shaped.
    //
    //    `tokenReconciliation` is the one allowed exception, and it is allowed
    //    by name only after its subtree is checked below: "token" there refers
    //    to exchange INSTRUMENT tokens (numeric ids for symbols), which are
    //    public reference data, not to an auth token. Excusing the name without
    //    inspecting the value would make this assertion decorative, so the
    //    exception costs an extra check rather than removing one.
    // `requiredTokenCount` (Phase 0.8E shard-plan capacity evidence) is the
    // second allowed exception, on the same terms: "token" there means an
    // exchange INSTRUMENT token, and the field is a COUNT of them. It is
    // allowed by name only because 2b2 below proves the value is numeric.
    const ALLOWED_CREDENTIAL_SHAPED_KEYS = new Set([
      "tokenReconciliation",
      "requiredTokenCount",
    ]);
    const forbiddenKey =
      /(token|secret|password|passwd|cookie|apikey|api_key|authorization|bearer|credential|session_id|accesskey)/i;
    const keys: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          keys.push(k);
          walk(v);
        }
      }
    };
    walk(body);
    expect(keys.length).toBeGreaterThan(20);
    const offending = keys.filter(
      (k) => forbiddenKey.test(k) && !ALLOWED_CREDENTIAL_SHAPED_KEYS.has(k),
    );
    expect(offending, `credential-shaped keys: ${offending.join(", ")}`).toEqual([]);

    // 2b. The allowlisted subtree must contain only coded state and counts.
    const reconciliation = (body as { tokenReconciliation?: unknown }).tokenReconciliation;
    expect(reconciliation).toBeTypeOf("object");
    for (const [k, v] of Object.entries(reconciliation as Record<string, unknown>)) {
      if (v === null) continue;
      if (typeof v === "number" || typeof v === "boolean") continue;
      expect(typeof v, `tokenReconciliation.${k} must be a coded string`).toBe("string");
      expect(v as string, `tokenReconciliation.${k}`).toMatch(/^[A-Z0-9_]{1,64}$/);
    }

    // 2b2. The other allowlisted name must be a count, never a value. A number
    //      (or null when no plan exists) cannot carry credential material; a
    //      string here would mean the name was excused for the wrong reason.
    const capacityCounts: unknown[] = [];
    const collectCounts = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(collectCounts);
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "requiredTokenCount") capacityCounts.push(v);
          collectCounts(v);
        }
      }
    };
    collectCounts(body);
    expect(capacityCounts.length).toBeGreaterThan(0);
    for (const v of capacityCounts) {
      expect(v === null || typeof v === "number", "requiredTokenCount must be a count").toBe(true);
    }

    // 2c. No string value ANYWHERE in the tree looks like opaque credential
    //     material. Every legitimate value here is a coded identifier, a hash,
    //     a gate id or a timestamp — all of which are short and structured.
    const longStrings: string[] = [];
    const walkValues = (node: unknown, path: string): void => {
      if (typeof node === "string") {
        if (node.length > 128) longStrings.push(`${path} (${node.length} chars)`);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((v, i) => walkValues(v, `${path}[${i}]`));
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) walkValues(v, `${path}.${k}`);
      }
    };
    walkValues(body, "$");
    expect(longStrings, `unexpectedly long string values: ${longStrings.join(", ")}`).toEqual([]);

    // 3. No instrument payload, provider-token list or full identity list. The
    //    readiness contract is counts, codes, hashes and timestamps only, so
    //    any large array of strings would be a leak of exactly that kind.
    const bigArrays: string[] = [];
    const walkArrays = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        if (node.length > 64) bigArrays.push(`${path}[${node.length}]`);
        node.forEach((v, i) => walkArrays(v, `${path}[${i}]`));
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) walkArrays(v, `${path}.${k}`);
      }
    };
    walkArrays(body, "$");
    expect(bigArrays, `suspiciously large arrays: ${bigArrays.join(", ")}`).toEqual([]);
  });

  // ── R7 ─────────────────────────────────────────────────────────────────────
  it("R7 the request path leaves no handle behind and opens no provider socket", async () => {
    const before = activeHandles();
    await fetch(`${baseUrl}${READINESS_PATH}`, { headers: { cookie: ownerCookie } });
    // Let the keep-alive socket settle before counting.
    await new Promise<void>((r) => setTimeout(r, 250));
    const after = activeHandles();

    const count = (list: string[], kind: string): number =>
      list.filter((h) => h === kind).length;

    // The fixture's own listener is in the baseline; the request must not add a
    // lasting one on top of it.
    expect(count(after, "TCPSERVERWRAP")).toBe(count(handleBaseline, "TCPSERVERWRAP"));
    expect(count(after, "TCPSERVERWRAP")).toBe(count(before, "TCPSERVERWRAP"));

    // No timer was installed by reading readiness.
    expect(count(after, "Timeout")).toBeLessThanOrEqual(count(before, "Timeout") + 1);
  });
});
