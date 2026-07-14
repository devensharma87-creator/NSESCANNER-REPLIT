/**
 * Release Verification Script — P0 Build Proof Gate
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify:release [base-url]
 *
 * Defaults to https://marketscannerbydev.in if no arg provided.
 *
 * Checks (per the P0 spec):
 *  1. /api/build-info returns 200
 *  2. build-info exposes no secrets
 *  3. production boot time exists
 *  4. frontend bundle filename detected
 *  5. frontend bundle contains release markers
 *  6. frontend bundle contains Data Parity markers
 *  7. Data Parity API routes are owner-protected (anonymous 401)
 *  8. /api/healthz works
 *  9. /api/data-health/global works
 * 10. frontend/backend build status reported
 * 11. no stale known bundle served
 *
 * Does NOT send Telegram, does NOT place orders, does NOT enable broker.
 * Does NOT require owner/admin password (checks anonymous and build-info only).
 *
 * Exit code 0 = all checks pass; 1 = one or more checks failed.
 */

const PROD_URL = process.argv[2]?.replace(/\/$/, "") ?? "https://marketscannerbydev.in";

const STALE_BUNDLES = ["index-DfdVFWMB.js"];

const SECRET_KEYS = [
  "password", "token", "secret", "api_key", "apikey", "private",
  "bearer", "auth_token", "session", "DATABASE_URL", "TELEGRAM",
  "APP_ACCESS_PASSWORD", "SESSION_SECRET", "TRADINGVIEW_WEBHOOK",
];

const RELEASE_MARKERS = [
  "CHECKPOINT_3_DATA_PARITY_UI_ENABLED",
  "DATA_PARITY_INFRA_HEALTH_ENABLED",
  "RELEASE_INTEGRITY_ENABLED",
];

const DATA_PARITY_MARKERS = [
  "section-data-parity",
  "data-parity/check",
];

interface Row {
  check: string;
  result: "PASS" | "FAIL" | "WARN" | "INFO";
  evidence: string;
}

const rows: Row[] = [];

function pass(check: string, evidence: string): void {
  rows.push({ check, result: "PASS", evidence });
}
function fail(check: string, evidence: string): void {
  rows.push({ check, result: "FAIL", evidence });
}
function warn(check: string, evidence: string): void {
  rows.push({ check, result: "WARN", evidence });
}
function info(check: string, evidence: string): void {
  rows.push({ check, result: "INFO", evidence });
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    let body: unknown;
    try { body = await r.json(); } catch { body = null; }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null };
  }
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = r.ok ? await r.text() : "";
    return { ok: r.ok, status: r.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

function checkForSecrets(obj: unknown): string[] {
  const json = JSON.stringify(obj ?? {}).toLowerCase();
  return SECRET_KEYS.filter((k) => json.includes(k.toLowerCase()));
}

async function run(): Promise<void> {
  console.log(`\nRelease Verification — target: ${PROD_URL}\n`);

  // ── Check 1: /api/healthz ───────────────────────────────────────────────
  const healthz = await fetchJson(`${PROD_URL}/api/healthz`);
  if (healthz.ok && (healthz.body as any)?.status === "ok") {
    pass("1. /api/healthz", `HTTP ${healthz.status} → {"status":"ok"}`);
  } else {
    fail("1. /api/healthz", `HTTP ${healthz.status} — server not responding`);
  }

  // ── Check 2: /api/data-health/global ───────────────────────────────────
  const dataHealth = await fetchJson(`${PROD_URL}/api/data-health/global`);
  if (dataHealth.ok) {
    const session = (dataHealth.body as any)?.marketSession ?? "unknown";
    pass("2. /api/data-health/global", `HTTP ${dataHealth.status} — session=${session}`);
  } else {
    fail("2. /api/data-health/global", `HTTP ${dataHealth.status}`);
  }

  // ── Check 3: /api/build-info returns 200 ───────────────────────────────
  const bi = await fetchJson(`${PROD_URL}/api/build-info`);
  if (!bi.ok) {
    fail("3. /api/build-info HTTP 200", `HTTP ${bi.status} — endpoint not live`);
  } else {
    pass("3. /api/build-info HTTP 200", `HTTP ${bi.status}`);
  }

  const info_ = bi.body as Record<string, unknown> | null;

  // ── Check 4: no secrets in build-info ─────────────────────────────────
  const leakedKeys = checkForSecrets(info_);
  if (leakedKeys.length === 0) {
    pass("4. build-info: no secrets", "Zero secret-pattern keys found in response");
  } else {
    fail("4. build-info: no secrets", `Found sensitive keys: ${leakedKeys.join(", ")}`);
  }

  // ── Check 5: boot time exists ──────────────────────────────────────────
  const bootTime = info_?.bootTime as string | undefined;
  if (bootTime && bootTime !== "unknown") {
    pass("5. boot time exists", `bootTime=${bootTime}`);
  } else {
    fail("5. boot time exists", `bootTime=${bootTime ?? "missing"}`);
  }

  // ── Check 6: checkpoint markers ────────────────────────────────────────
  const markers = info_?.checkpointMarkers as Record<string, boolean> | undefined;
  const expectedMarkers = [
    "checkpoint1", "checkpoint2", "checkpoint2_5", "checkpoint3",
    "dataParityApi", "reportGradeFacade", "providerImportCompat",
  ];
  const missingMarkers = expectedMarkers.filter((m) => markers?.[m] !== true);
  if (missingMarkers.length === 0) {
    pass("6. checkpoint markers", `All ${expectedMarkers.length} markers = true`);
  } else {
    fail("6. checkpoint markers", `Missing/false: ${missingMarkers.join(", ")}`);
  }

  // ── Check 7: fetch frontend bundle filename from homepage ───────────────
  const homepage = await fetchText(PROD_URL);
  const bundleMatch = homepage.text.match(/src="([^"]*\/assets\/index[^"]+\.js)"/);
  const bundleRelPath = bundleMatch?.[1] ?? null;
  const bundleFile = bundleRelPath?.split("/").pop() ?? null;

  if (bundleFile) {
    pass("7. frontend bundle detected", `bundle=${bundleFile}`);
  } else {
    fail("7. frontend bundle detected", "Could not find /assets/index-*.js in homepage HTML");
  }

  // ── Check 8: no stale known bundle ────────────────────────────────────
  if (bundleFile && STALE_BUNDLES.includes(bundleFile)) {
    fail("8. not a stale known bundle", `Stale bundle detected: ${bundleFile}`);
  } else if (bundleFile) {
    pass("8. not a stale known bundle", `${bundleFile} is not in stale list`);
  } else {
    warn("8. not a stale known bundle", "Bundle filename unknown — cannot check");
  }

  // ── Check 9: frontend bundle release markers ───────────────────────────
  let bundleText = "";
  if (bundleRelPath) {
    const bundleUrl = bundleRelPath.startsWith("http")
      ? bundleRelPath
      : `${PROD_URL}${bundleRelPath}`;
    const bundleResp = await fetchText(bundleUrl);
    bundleText = bundleResp.text;
  }

  const missingRelease = RELEASE_MARKERS.filter((m) => !bundleText.includes(m));
  if (bundleText && missingRelease.length === 0) {
    pass("9. frontend: release markers", `All ${RELEASE_MARKERS.length} markers present`);
  } else if (bundleText) {
    fail("9. frontend: release markers", `Missing: ${missingRelease.join(", ")}`);
  } else {
    warn("9. frontend: release markers", "Bundle not fetched — cannot verify");
  }

  // ── Check 10: frontend bundle Data Parity markers ─────────────────────
  const missingParity = DATA_PARITY_MARKERS.filter((m) => !bundleText.includes(m));
  if (bundleText && missingParity.length === 0) {
    pass("10. frontend: Data Parity markers", `All ${DATA_PARITY_MARKERS.length} markers present`);
  } else if (bundleText) {
    fail("10. frontend: Data Parity markers", `Missing: ${missingParity.join(", ")}`);
  } else {
    warn("10. frontend: Data Parity markers", "Bundle not fetched — cannot verify");
  }

  // ── Check 11: Data Parity API routes owner-protected ──────────────────
  const dpSymbols = ["NIFTY", "RELIANCE"];
  let dpAllGated = true;
  for (const sym of dpSymbols) {
    const r = await fetchJson(`${PROD_URL}/api/data-parity/symbol/${sym}`);
    if (r.status !== 401) { dpAllGated = false; }
  }
  const dpBatch = await fetchJson(`${PROD_URL}/api/data-parity/check`);
  if (dpBatch.status !== 401) { dpAllGated = false; }

  if (dpAllGated) {
    pass("11. Data Parity API: owner-protected", "anonymous → 401 on all endpoints");
  } else {
    fail("11. Data Parity API: owner-protected", "Some endpoint returned non-401 for anonymous");
  }

  // ── Check 12: frontend/backend build status ────────────────────────────
  const commitShort = info_?.commitShort as string | undefined;
  const frontendBuildId = info_?.frontendBuildId as string | undefined;
  const apiEnv = info_?.environment as string | undefined;

  let buildStatus = "UNKNOWN";
  if (commitShort && commitShort !== "unknown") {
    buildStatus = frontendBuildId && frontendBuildId !== "unknown"
      ? "MATCH_ATTEMPTED"
      : "API_KNOWN_FRONTEND_UNKNOWN";
  }
  info("12. frontend/backend build status", `FRONTEND_BACKEND_BUILD_STATUS=${buildStatus} commitShort=${commitShort ?? "unknown"} environment=${apiEnv ?? "unknown"}`);

  // ── Render table ───────────────────────────────────────────────────────
  const col1 = Math.max(40, ...rows.map((r) => r.check.length)) + 2;
  const col2 = 8;
  const col3 = Math.max(30, ...rows.map((r) => r.evidence.length)) + 2;

  const sep = `|${"-".repeat(col1)}|${"-".repeat(col2)}|${"-".repeat(col3)}|`;
  const header = `| ${"Check".padEnd(col1 - 2)} | ${"Result".padEnd(col2 - 2)} | ${"Evidence".padEnd(col3 - 2)} |`;

  console.log(sep);
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    const icon = r.result === "PASS" ? "✓" : r.result === "FAIL" ? "✗" : r.result === "WARN" ? "⚠" : "ℹ";
    console.log(`| ${r.check.padEnd(col1 - 2)} | ${(icon + " " + r.result).padEnd(col2 - 2)} | ${r.evidence.padEnd(col3 - 2)} |`);
  }
  console.log(sep);

  const passed = rows.filter((r) => r.result === "PASS").length;
  const failed = rows.filter((r) => r.result === "FAIL").length;
  const warned = rows.filter((r) => r.result === "WARN").length;
  console.log(`\nSummary: ${passed} PASS | ${warned} WARN | ${failed} FAIL\n`);

  if (failed > 0) {
    console.error("❌ Release verification FAILED — see FAIL rows above.");
    process.exit(1);
  } else if (warned > 0) {
    console.log("⚠ Release verification PASSED with warnings.");
  } else {
    console.log("✓ Release verification PASSED — all checks green.");
  }
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
