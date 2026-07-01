import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { logger } from "./logger";
import { getSession, getUserById, getEffectiveStatus } from "./userAuth";
import { isPublicAccessEnabled } from "./publicAccess";

const COOKIE_NAME = "scanner_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const isProd = (): boolean => process.env["NODE_ENV"] === "production";

function getPassword(): string | undefined {
  const v = process.env["APP_ACCESS_PASSWORD"];
  return v && v.length > 0 ? v : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function setSessionCookie(res: Response): void {
  res.cookie(COOKIE_NAME, "ok", {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    signed: true,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/", signed: true });
}

/**
 * True if the request carries any valid signed session cookie. The cookie's
 * value distinguishes owner ("ok"/"owner") from subscriber ("u:<id>");
 * downstream middleware in `userAuth.ts` does the role-level gating.
 *
 * For the global gate we only care that the cookie is *some* legitimate
 * session, so we accept any non-empty signed value. Signature integrity is
 * guaranteed by cookie-parser using SESSION_SECRET.
 */
export function isAuthenticated(req: Request): boolean {
  // Public-access mode treats every request as authenticated, so the
  // /auth/status endpoint correctly tells the client to render the app
  // shell instead of the login form.
  if (isPublicAccessEnabled()) return true;
  const v = (req.signedCookies as Record<string, unknown> | undefined)?.[COOKIE_NAME];
  return typeof v === "string" && v.length > 0;
}

export function verifyPassword(supplied: string): boolean {
  const expected = getPassword();
  if (!expected) return false;
  return safeEqual(supplied, expected);
}

export function isPasswordConfigured(): boolean {
  return getPassword() !== undefined;
}

/** Public routes that bypass the cookie gate.
 *  - `path` is matched as a prefix against `req.originalUrl` (sans querystring).
 *  - `methods`, if present, restricts the bypass to those HTTP verbs (others fall
 *    back to requiring a session cookie). Defaults to all methods. */
interface PublicRoute {
  path: string;
  methods?: string[];
}
const PUBLIC_ROUTES: PublicRoute[] = [
  { path: "/api/healthz" },
  { path: "/api/auth/" },
  { path: "/api/kite/callback" },                       // Zerodha redirect (auth = request_token + KITE_API_SECRET)
  { path: "/api/kite/export-session", methods: ["GET"] }, // Cross-env mirror; gated by X-App-Password header inside the route
  { path: "/api/webhooks/tradingview", methods: ["POST"] }, // ONLY POST is public — TradingView S2S with TRADINGVIEW_WEBHOOK_SECRET
  { path: "/api/paper/diagnostics/environment", methods: ["GET"] }, // Env label only (no secrets); powers the dev/prod banner
  { path: "/api/data-health/market", methods: ["GET"] },           // PUBLIC: canonical market-data health (session+feed+market-session, no secrets)
];

function isPublicRoute(url: string, method: string): boolean {
  const path = url.split("?")[0] ?? "";
  for (const r of PUBLIC_ROUTES) {
    const matches = path === r.path || path.startsWith(r.path);
    if (!matches) continue;
    if (!r.methods || r.methods.includes(method.toUpperCase())) return true;
  }
  return false;
}

/**
 * Global gate for /api/*. Order:
 *   1. Public route → pass.
 *   2. No session cookie → 401 AUTH_REQUIRED.
 *   3. Owner cookie → pass (no DB hit).
 *   4. Subscriber cookie → look up user, check effective status:
 *        active → pass; pending/suspended/expired → 403 with the matching
 *        ACCOUNT_<STATE> code; user row missing → 401 USER_GONE.
 *
 * Per-route `requireOwner` further down narrows owner-only endpoints
 * (admin/deepscan/options/system/kite/options-signals/sectors).
 *
 * Async because step 4 needs a DB lookup; for owner sessions the gate stays
 * synchronous.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Owner-toggled public-access mode short-circuits the gate entirely.
  // When ON, every /api/* request passes regardless of cookie. The
  // toggle endpoint itself is in PUBLIC_ROUTES (under /api/auth/) so
  // the owner can always relock by hitting it with the password.
  if (isPublicAccessEnabled()) return next();
  if (isPublicRoute(req.originalUrl, req.method)) return next();
  const sess = getSession(req);
  if (!sess) {
    res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
    return;
  }
  if (sess.role === "owner") return next();
  // sess.role === "subscriber"
  try {
    const user = await getUserById(sess.userId);
    if (!user) {
      res.status(401).json({ error: "user_not_found", code: "USER_GONE" });
      return;
    }
    const eff = getEffectiveStatus(user);
    if (eff !== "active") {
      res.status(403).json({
        error: `account_${eff}`,
        code: `ACCOUNT_${eff.toUpperCase()}`,
      });
      return;
    }
    return next();
  } catch (err) {
    logger.error({ err, url: req.originalUrl }, "requireAuth subscriber lookup failed");
    res.status(500).json({ error: "internal_error" });
  }
}

export function logAuthBootState(): void {
  if (!isPasswordConfigured()) {
    logger.warn(
      "APP_ACCESS_PASSWORD is not set — login endpoint will reject all attempts. " +
        "Set this secret to enable access.",
    );
  } else {
    logger.info("Auth gate enabled (APP_ACCESS_PASSWORD configured)");
  }
  if (isPublicAccessEnabled()) {
    logger.warn(
      "Boot state: PUBLIC ACCESS MODE is ON — auth gate is bypassed for /api/*. " +
        "Disable via the in-app banner (owner password) or " +
        "POST /api/auth/public-mode { enabled: false, password }.",
    );
  }
}
