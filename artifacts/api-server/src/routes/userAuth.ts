/**
 * Subscriber-facing routes:
 *   POST /auth/signup           — public, creates pending account
 *   POST /auth/user-login       — public, sets subscriber session cookie
 *   GET  /auth/me               — owner OR subscriber, returns identity + plan
 *   GET  /personal-watchlist    — owner OR active subscriber, list symbols
 *   POST /personal-watchlist    — add a symbol (idempotent)
 *   DELETE /personal-watchlist/:symbol — remove a symbol
 *
 * Watchlist storage uses an opaque `ownerKey` ("owner" or "u:<id>") so the
 * site owner can also keep a personal list without needing a user row.
 */

import { Router, type IRouter, type Request } from "express";
import { eq, and, asc } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { personalWatchlistTable, ALLOWED_TAB_KEYS } from "@workspace/db/schema";
import {
  createSubscriber,
  getUserByEmail,
  getUserById,
  verifyUserPassword,
  isValidEmail,
  isValidPhone,
  normaliseEmail,
  getEffectiveStatus,
  getSession,
  requireSubscriberOrOwner,
} from "../lib/userAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const COOKIE_NAME = "scanner_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const isProd = (): boolean => process.env["NODE_ENV"] === "production";

function setSubscriberCookie(res: import("express").Response, userId: number): void {
  res.cookie(COOKIE_NAME, `u:${userId}`, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    signed: true,
    path: "/",
  });
}

function ownerKeyFor(req: Request): string | null {
  const s = getSession(req);
  if (!s) return null;
  return s.role === "owner" ? "owner" : `u:${s.userId}`;
}

// ----- public auth endpoints -----

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,                  // max 5 signups per IP per hour
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_signups" },
});

const userLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Count successful logins too — otherwise an attacker with a valid
  // credential can hammer the endpoint to enumerate/verify other accounts
  // without triggering the limiter.
  message: { error: "too_many_login_attempts" },
});

router.post("/auth/signup", signupLimiter, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = typeof body["email"] === "string" ? body["email"] : "";
  const password = typeof body["password"] === "string" ? body["password"] : "";
  const fullName = typeof body["fullName"] === "string" ? body["fullName"] : "";
  const phone = typeof body["phone"] === "string" && body["phone"] ? body["phone"] : null;

  if (!isValidEmail(email)) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "password_too_short", message: "Password must be at least 8 characters" });
    return;
  }
  if (fullName.trim().length < 2) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  if (phone && !isValidPhone(phone)) {
    res.status(400).json({ error: "invalid_phone" });
    return;
  }

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "email_taken", message: "An account with this email already exists" });
      return;
    }
    const user = await createSubscriber({ email, password, fullName, phone });
    setSubscriberCookie(res, user.id);
    logger.info({ userId: user.id, email: normaliseEmail(email) }, "New subscriber signed up");
    res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        status: getEffectiveStatus(user),
      },
    });
  } catch (err) {
    logger.error({ err }, "signup failed");
    res.status(500).json({ error: "signup_failed" });
  }
});

router.post("/auth/user-login", userLoginLimiter, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = typeof body["email"] === "string" ? body["email"] : "";
  const password = typeof body["password"] === "string" ? body["password"] : "";
  if (!email || !password) {
    res.status(400).json({ error: "email_and_password_required" });
    return;
  }
  try {
    const user = await getUserByEmail(email);
    if (!user || !verifyUserPassword(password, user.passwordHash)) {
      logger.warn({ ip: req.ip, email: normaliseEmail(email) }, "subscriber login rejected");
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    setSubscriberCookie(res, user.id);
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        status: getEffectiveStatus(user),
        allowedTabs: user.allowedTabs,
      },
    });
  } catch (err) {
    logger.error({ err }, "user-login failed");
    res.status(500).json({ error: "login_failed" });
  }
});

// /auth/me — ALL of /api/auth/* is in PUBLIC_ROUTES so we have to do our own
// gate here. Returns 200 with `{authenticated:false}` rather than 401 so the
// frontend can render the LoginGate without treating it as an error.
router.get("/auth/me", async (req, res) => {
  const s = getSession(req);
  if (!s) {
    res.json({ authenticated: false });
    return;
  }
  if (s.role === "owner") {
    res.json({
      authenticated: true,
      role: "owner",
      // Owner has access to every tab (UI uses this to skip filtering).
      allowedTabs: [...ALLOWED_TAB_KEYS],
    });
    return;
  }
  const user = await getUserById(s.userId);
  if (!user) {
    res.json({ authenticated: false, error: "user_not_found" });
    return;
  }
  const eff = getEffectiveStatus(user);
  res.json({
    authenticated: true,
    role: "subscriber",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: eff,
      allowedTabs: user.allowedTabs,
      subscriptionStartedAt: user.subscriptionStartedAt?.toISOString() ?? null,
      subscriptionExpiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
      amountPaise: user.amountPaise ?? null,
    },
  });
});

// ----- personal watchlist (owner OR active subscriber) -----

const SYMBOL_RE = /^[A-Z0-9.\-_&^]{1,32}$/;

router.get("/personal-watchlist", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const rows = await db
    .select()
    .from(personalWatchlistTable)
    .where(eq(personalWatchlistTable.ownerKey, owner))
    .orderBy(asc(personalWatchlistTable.addedAt));
  res.json({
    items: rows.map(r => ({
      symbol: r.symbol,
      addedAt: r.addedAt.toISOString(),
      notes: r.notes,
    })),
  });
});

router.post("/personal-watchlist", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const symbolRaw = typeof body["symbol"] === "string" ? body["symbol"] : "";
  const notes = typeof body["notes"] === "string" ? body["notes"] : null;
  const symbol = symbolRaw.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: "invalid_symbol" });
    return;
  }
  // Idempotent: ON CONFLICT DO UPDATE on notes only (no duplicate row error).
  await db
    .insert(personalWatchlistTable)
    .values({ ownerKey: owner, symbol, notes })
    .onConflictDoUpdate({
      target: [personalWatchlistTable.ownerKey, personalWatchlistTable.symbol],
      set: { notes },
    });
  res.status(201).json({ ok: true, symbol });
});

router.delete("/personal-watchlist/:symbol", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const raw = req.params["symbol"];
  const symbol = (typeof raw === "string" ? raw : "").trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: "invalid_symbol" });
    return;
  }
  await db
    .delete(personalWatchlistTable)
    .where(
      and(
        eq(personalWatchlistTable.ownerKey, owner),
        eq(personalWatchlistTable.symbol, symbol),
      ),
    );
  res.json({ ok: true });
});

export default router;
