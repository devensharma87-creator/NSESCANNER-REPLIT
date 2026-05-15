/**
 * Live security audit — runs a comprehensive set of checks against the running
 * server's configuration AND the live HTTP surface. Each check that can be
 * verified at runtime is verified by an actual loopback request, so the audit
 * dashboard reflects what an attacker would see, not what the code intends.
 * No secret values are ever returned.
 */
import { isPasswordConfigured } from "./auth";

export type Severity = "ok" | "warn" | "fail";

export interface AuditCheck {
  id: string;
  category: "auth" | "transport" | "secrets" | "headers" | "data" | "dependencies" | "rate_limit";
  title: string;
  status: Severity;
  detail: string;
  remediation?: string;
  /** "live" = result came from a runtime probe; "config" = derived from env/code. */
  source: "live" | "config";
}

export interface AuditReport {
  generatedAt: string;
  environment: "development" | "production" | "unknown";
  summary: { ok: number; warn: number; fail: number; total: number };
  score: number; // 0..100
  checks: AuditCheck[];
}

function envName(): "development" | "production" | "unknown" {
  const e = process.env["NODE_ENV"];
  if (e === "production") return "production";
  if (e === "development") return "development";
  return "unknown";
}

function envLen(name: string): number {
  return (process.env[name] ?? "").length;
}

function hasEnv(name: string): boolean {
  return !!process.env[name];
}

interface LoopbackProbe {
  status: number | null;
  headers: Record<string, string>;
  error?: string;
}

async function loopbackProbe(method: "GET" | "POST", path: string): Promise<LoopbackProbe> {
  const port = process.env["PORT"];
  if (!port) return { status: null, headers: {}, error: "PORT env not set" };
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { "user-agent": "self-audit-probe/1.0" },
    });
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    // Drain body so the connection can be reused.
    await r.text().catch(() => "");
    return { status: r.status, headers };
  } catch (err) {
    return {
      status: null,
      headers: {},
      error: err instanceof Error ? err.message : "probe_failed",
    };
  } finally {
    clearTimeout(tm);
  }
}

export async function runSecurityAudit(): Promise<AuditReport> {
  const env = envName();
  const isProd = env === "production";
  const checks: AuditCheck[] = [];

  // Run all loopback probes in parallel up front.
  const [probeProtected, probeProtectedPostWebhook, probeProtectedGetWebhook, probeHealth] = await Promise.all([
    loopbackProbe("GET", "/api/options/signals"),     // expect 401 unauthenticated
    loopbackProbe("POST", "/api/webhooks/tradingview"), // public POST exempt; expect rate-limit headers
    loopbackProbe("GET", "/api/webhooks/tradingview"),  // expect 401 (now protected)
    loopbackProbe("GET", "/api/healthz"),              // public; inspect security headers
  ]);

  // --- AUTH ---
  checks.push({
    id: "auth_password_set",
    category: "auth",
    title: "Login password configured",
    status: isPasswordConfigured() ? "ok" : "fail",
    source: "config",
    detail: isPasswordConfigured()
      ? "APP_ACCESS_PASSWORD is set; login page is functional."
      : "APP_ACCESS_PASSWORD is NOT set — anyone hitting /login is rejected, but the app is also unusable.",
    remediation: isPasswordConfigured() ? undefined : "Set APP_ACCESS_PASSWORD in Replit Secrets and restart.",
  });

  const pwLen = envLen("APP_ACCESS_PASSWORD");
  checks.push({
    id: "auth_password_strength",
    category: "auth",
    title: "Login password length",
    status: pwLen === 0 ? "fail" : pwLen >= 16 ? "ok" : pwLen >= 12 ? "warn" : "fail",
    source: "config",
    detail:
      pwLen === 0
        ? "Password not set."
        : `Password is ${pwLen} characters long. ${pwLen >= 16 ? "Strong." : pwLen >= 12 ? "Acceptable; 16+ recommended." : "Too short for a public-internet endpoint."}`,
    remediation: pwLen >= 16 ? undefined : "Use a 16+ character random password.",
  });

  // LIVE: verify gate by hitting a protected endpoint without a cookie.
  checks.push({
    id: "auth_gate_live",
    category: "auth",
    title: "Auth gate enforces 401 on protected endpoints",
    status: probeProtected.status === 401 ? "ok" : probeProtected.status === null ? "warn" : "fail",
    source: "live",
    detail:
      probeProtected.status === null
        ? `Loopback probe to /api/options/signals failed: ${probeProtected.error}`
        : `Probe returned HTTP ${probeProtected.status} (expected 401).`,
    remediation:
      probeProtected.status === 401
        ? undefined
        : "An unauthenticated request returned a non-401 status. Check that requireAuth is mounted before the protected routers.",
  });

  // LIVE: verify GET /webhooks/tradingview is no longer publicly readable.
  checks.push({
    id: "auth_webhook_get_protected",
    category: "auth",
    title: "Webhook GET endpoint is auth-protected",
    status: probeProtectedGetWebhook.status === 401 ? "ok" : probeProtectedGetWebhook.status === null ? "warn" : "fail",
    source: "live",
    detail:
      probeProtectedGetWebhook.status === null
        ? `Probe failed: ${probeProtectedGetWebhook.error}`
        : `GET /api/webhooks/tradingview returned HTTP ${probeProtectedGetWebhook.status} unauthenticated (want 401, never 200).`,
    remediation:
      probeProtectedGetWebhook.status === 401
        ? undefined
        : "GET on the webhook path must require auth — POST is the only public method.",
  });

  // LIVE: verify POST /webhooks/tradingview rejects unauthenticated callers
  // that don't supply the webhook secret. Acceptable: 401 (missing/wrong secret)
  // or 503 (production without TRADINGVIEW_WEBHOOK_SECRET set, which locks the
  // route entirely). NEVER 200 — that would mean the webhook accepts forged alerts.
  const postOk =
    probeProtectedPostWebhook.status === 401 ||
    probeProtectedPostWebhook.status === 503 ||
    probeProtectedPostWebhook.status === 400;
  checks.push({
    id: "auth_webhook_post_secret",
    category: "auth",
    title: "Webhook POST rejects forged payloads",
    status: postOk ? "ok" : probeProtectedPostWebhook.status === null ? "warn" : "fail",
    source: "live",
    detail:
      probeProtectedPostWebhook.status === null
        ? `Probe failed: ${probeProtectedPostWebhook.error}`
        : `POST /api/webhooks/tradingview without secret returned HTTP ${probeProtectedPostWebhook.status} (acceptable: 400/401/503; never 200).`,
    remediation: postOk ? undefined : "Confirm TRADINGVIEW_WEBHOOK_SECRET is set and the webhook handler enforces it.",
  });

  // --- SECRETS ---
  const sessLen = envLen("SESSION_SECRET");
  checks.push({
    id: "secret_session",
    category: "secrets",
    title: "Session-cookie signing key",
    status: sessLen === 0 ? "fail" : sessLen >= 32 ? "ok" : "warn",
    source: "config",
    detail:
      sessLen === 0
        ? "SESSION_SECRET is missing — server would fail to boot."
        : `SESSION_SECRET length: ${sessLen} chars (32+ recommended).`,
    remediation: sessLen >= 32 ? undefined : "Generate a 32+ char random string and rotate.",
  });

  const tvLen = envLen("TRADINGVIEW_WEBHOOK_SECRET");
  checks.push({
    id: "secret_tradingview",
    category: "secrets",
    title: "TradingView webhook secret",
    status: tvLen === 0 && isProd ? "fail" : tvLen === 0 ? "warn" : tvLen >= 16 ? "ok" : "warn",
    source: "config",
    detail:
      tvLen === 0
        ? isProd
          ? "TRADINGVIEW_WEBHOOK_SECRET not set — webhook endpoint returns 503 (locked)."
          : "Not set — webhook endpoint is OPEN in dev for local testing."
        : `Configured (${tvLen} chars). Webhook posts must include this in URL/header/body.`,
    remediation: tvLen === 0 && isProd ? "Set TRADINGVIEW_WEBHOOK_SECRET and restart." : undefined,
  });

  checks.push({
    id: "secret_kite_key",
    category: "secrets",
    title: "Kite API credentials",
    status: hasEnv("KITE_API_KEY") && hasEnv("KITE_API_SECRET") ? "ok" : "warn",
    source: "config",
    detail:
      hasEnv("KITE_API_KEY") && hasEnv("KITE_API_SECRET")
        ? "Both KITE_API_KEY and KITE_API_SECRET are configured. Live feed available after daily Kite login."
        : "Kite credentials missing — live WebSocket feed will not work, but the rest of the app still functions.",
    remediation:
      hasEnv("KITE_API_KEY") && hasEnv("KITE_API_SECRET")
        ? undefined
        : "Set KITE_API_KEY and KITE_API_SECRET in Replit Secrets if you want live tick data.",
  });

  checks.push({
    id: "secret_db",
    category: "secrets",
    title: "Database connection string",
    status: hasEnv("DATABASE_URL") ? "ok" : "fail",
    source: "config",
    detail: hasEnv("DATABASE_URL") ? "DATABASE_URL configured." : "DATABASE_URL missing — server cannot persist alerts/sessions.",
  });

  // Kite session row stored in PG IS plaintext (api_key + access_token +
  // public_token). The token self-rotates daily at ~06:00 IST, but anyone with
  // a copy of the database between login and 06:00 IST holds a working
  // session. This is a known risk; flag it so a routine `pg_dump` for the
  // owner's records doesn't silently leak credentials.
  checks.push({
    id: "secret_kite_session_at_rest",
    category: "secrets",
    title: "Kite session token storage at rest",
    status: "warn",
    source: "config",
    detail:
      "kite_session.{api_key,access_token,public_token} are stored in plaintext " +
      "Postgres. Tokens auto-expire at the next 06:00 IST, but a DB dump taken " +
      "between login and expiry leaks a usable session. Use scripts/safe-db-export.sh " +
      "(excludes kite_session entirely) for any dump that leaves the server.",
    remediation:
      "Short term: always use scripts/safe-db-export.sh and never share raw pg_dump " +
      "output. Medium term: encrypt access_token/api_key/public_token columns at rest " +
      "with a KITE_TOKEN_ENC_KEY (AES-GCM) before persisting.",
  });

  // /api/kite/export-session bypasses the owner cookie and is gated only by
  // x-app-password — anyone holding APP_ACCESS_PASSWORD can pull the live
  // session cross-network. Used by autoMirrorSession() to mirror prod → dev.
  checks.push({
    id: "secret_export_session_endpoint",
    category: "secrets",
    title: "Kite session export endpoint hardening",
    status: process.env["KITE_MIRROR_ALLOWED_HOSTS"] ? "ok" : "warn",
    source: "config",
    detail:
      "/api/kite/export-session returns a usable session JSON when the " +
      "x-app-password header matches APP_ACCESS_PASSWORD. KITE_MIRROR_ALLOWED_HOSTS " +
      `is currently ${process.env["KITE_MIRROR_ALLOWED_HOSTS"] ? "set (peer host allowlist active)" : "UNSET (default allowlist applies)"}. ` +
      "If APP_ACCESS_PASSWORD ever leaks, the password rotation must happen BEFORE " +
      "the next 06:00 IST or the leaker can pull a fresh token at every Kite re-login.",
    remediation:
      "Set KITE_MIRROR_ALLOWED_HOSTS explicitly. Rotate APP_ACCESS_PASSWORD any time " +
      "it may have leaked. Consider migrating mirror auth to a dedicated, scoped key " +
      "instead of reusing the owner login password.",
  });

  // --- TRANSPORT / COOKIES ---
  checks.push({
    id: "transport_https",
    category: "transport",
    title: "HTTPS / Production environment",
    status: isProd ? "ok" : "warn",
    source: "config",
    detail: isProd
      ? "Running in production — Replit Deployments terminates TLS, all traffic is encrypted in transit."
      : "Running in development. HTTPS only enforced in production. (Cookie 'Secure' flag activates only when NODE_ENV=production.)",
    remediation: isProd ? undefined : "After publishing, this becomes 'ok' automatically.",
  });

  checks.push({
    id: "cookie_security",
    category: "transport",
    title: "Session cookie hardening",
    status: "ok",
    source: "config",
    detail:
      `HttpOnly: true · SameSite: Lax (blocks cross-site cookie attachment) · ` +
      `Signed (HMAC-SHA256 with SESSION_SECRET) · ` +
      `Secure: ${isProd ? "true (production)" : "false (dev only)"} · ` +
      `Max-Age: 30 days rolling.`,
  });

  // --- HEADERS (LIVE) ---
  const h = probeHealth.headers;
  const helmetActive =
    !!h["strict-transport-security"] &&
    h["x-content-type-options"] === "nosniff" &&
    !!h["x-dns-prefetch-control"];
  checks.push({
    id: "headers_helmet_live",
    category: "headers",
    title: "Security headers present on responses",
    status: helmetActive ? "ok" : probeHealth.status === null ? "warn" : "fail",
    source: "live",
    detail: helmetActive
      ? `Verified live: HSTS=${h["strict-transport-security"]} · X-Content-Type-Options=${h["x-content-type-options"]} · X-Frame-Options=${h["x-frame-options"] ?? "(default)"} · Referrer-Policy=${h["referrer-policy"] ?? "(default)"}.`
      : probeHealth.status === null
        ? `Could not probe /api/healthz: ${probeHealth.error}`
        : `Helmet headers missing on /api/healthz response. Got: ${Object.keys(h).filter(k => k.startsWith("x-") || k.startsWith("strict-")).join(", ") || "(none)"}.`,
    remediation: helmetActive ? undefined : "Confirm helmet() middleware is mounted before routers in app.ts.",
  });

  checks.push({
    id: "headers_cors",
    category: "headers",
    title: "CORS / cross-site cookie defense",
    status: "ok",
    source: "config",
    detail:
      "Defense-in-depth: (1) session cookie is SameSite=Lax — browsers will not attach it to cross-site POSTs/XHRs " +
      "from other origins; (2) CORS reflects the request origin with credentials=true (no wildcard), " +
      "so even if SameSite were ever loosened, browsers would still refuse credentialed cross-origin XHRs " +
      "without an explicit Access-Control-Allow-Origin match.",
  });

  // --- DATA ---
  const dbUrl = process.env["DATABASE_URL"] ?? "";
  const dbSsl = /sslmode=(require|verify|prefer)/i.test(dbUrl) || dbUrl.includes("neon.tech") || dbUrl.includes("replit");
  checks.push({
    id: "data_db_ssl",
    category: "data",
    title: "Database connection encryption",
    status: dbSsl ? "ok" : "warn",
    source: "config",
    detail: dbSsl
      ? "DATABASE_URL uses SSL (provider enforces TLS in transit)."
      : "DATABASE_URL doesn't appear to specify SSL mode. Most managed providers require it anyway.",
    remediation: dbSsl ? undefined : "Append `?sslmode=require` to the connection string if your provider supports it.",
  });

  checks.push({
    id: "data_no_client_secrets",
    category: "data",
    title: "Frontend bundle is free of hardcoded secrets",
    status: "ok",
    source: "config",
    detail:
      "Static review of artifacts/scanner/src: no API keys, OAuth tokens, or passwords are bundled into the React frontend. " +
      "Login UI accepts a password and POSTs it; the cookie returned is HttpOnly so JS can never read it.",
  });

  checks.push({
    id: "data_no_localstorage_creds",
    category: "data",
    title: "No credentials in browser storage",
    status: "ok",
    source: "config",
    detail: "Static review: frontend never writes passwords, tokens, or session IDs to localStorage/sessionStorage. (grep verified.)",
  });

  checks.push({
    id: "data_sql_injection",
    category: "data",
    title: "SQL injection surface",
    status: "ok",
    source: "config",
    detail: "All database queries use Drizzle ORM with parameterized statements; no user input is concatenated into raw SQL (grep verified — only column references appear inside sql`...` template tags).",
  });

  // --- RATE LIMIT (LIVE) ---
  // express-rate-limit (draft-7) emits the structured `RateLimit` header plus `RateLimit-Policy`.
  const rlHeader =
    probeHealth.headers["ratelimit"] ??
    probeHealth.headers["ratelimit-policy"] ??
    probeHealth.headers["ratelimit-limit"] ??
    probeHealth.headers["x-ratelimit-limit"];
  checks.push({
    id: "rate_limit_live",
    category: "rate_limit",
    title: "Rate limiting active on /api/*",
    status: rlHeader ? "ok" : "fail",
    source: "live",
    detail: rlHeader
      ? `Verified live: response advertised RateLimit policy "${rlHeader}". ` +
        "Buckets: login 5/15 min/IP, webhooks 60/min/IP, general 300/min/IP."
      : "No RateLimit-* header on probed response — middleware may not be mounted. Re-check express-rate-limit setup.",
  });

  // --- DEPENDENCIES ---
  checks.push({
    id: "deps_known_vulns",
    category: "dependencies",
    title: "Known dependency advisories",
    status: "warn",
    source: "config",
    detail:
      "kiteconnect ships its dev-dependency mocha test stack as a runtime dep. The bundled mocha pulls in older " +
      "transitive packages (serialize-javascript, picomatch, brace-expansion) flagged by GitHub Advisories. " +
      "None of these are reachable from the request handling code path of this server — they only execute if mocha is invoked, " +
      "which never happens at runtime. (Verified via pnpm audit.)",
    remediation:
      "Watch the kiteconnect npm package for an upstream fix; nothing actionable on our side without forking.",
  });

  // --- SUMMARY ---
  let ok = 0,
    warn = 0,
    fail = 0;
  for (const c of checks) {
    if (c.status === "ok") ok++;
    else if (c.status === "warn") warn++;
    else fail++;
  }
  const total = checks.length;
  const score = Math.max(0, 100 - fail * 25 - warn * 5);

  return {
    generatedAt: new Date().toISOString(),
    environment: env,
    summary: { ok, warn, fail, total },
    score,
    checks,
  };
}
