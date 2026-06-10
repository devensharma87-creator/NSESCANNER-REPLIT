/**
 * Subscriber account + subscription business logic.
 *
 * Owner is identified by a "scanner_session" cookie value of "ok" (legacy)
 * or "owner" — set by APP_ACCESS_PASSWORD login. Subscribers get
 * "u:<userId>". `getSession(req)` resolves the cookie into a typed
 * `{ role: 'owner' } | { role: 'subscriber', userId }` discriminated union.
 *
 * Password storage: `scrypt:<saltHex>:<hashHex>` using node:crypto.scryptSync
 * with N=16384 default cost. No external dep needed.
 *
 * Subscription state machine (denormalised on `users`):
 *   pending  → freshly signed up, owner has not approved
 *   active   → owner approved, payment recorded, expiresAt > now
 *   expired  → expiresAt <= now (computed at read time, not stored)
 *   suspended → owner manually disabled, ignored regardless of expiresAt
 *
 * `getEffectiveStatus()` returns the live status (auto-flips active→expired
 * when expiry passes). The DB `status` column is the OWNER-CONTROLLED state;
 * never written by request handlers other than admin endpoints.
 */

import type { Request, Response, NextFunction } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  ALLOWED_TAB_KEYS,
  type AllowedTabKey,
  type UserRow,
  type UserStatus,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { isPublicAccessEnabled } from "./publicAccess";

// ---------- password hashing ----------

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("password must be at least 8 characters");
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyUserPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1] ?? "", "hex");
    expected = Buffer.from(parts[2] ?? "", "hex");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

// ---------- user CRUD ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-()]{7,20}$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s) && s.length <= 255;
}

export function isValidPhone(s: string): boolean {
  return PHONE_RE.test(s);
}

export async function createSubscriber(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
}): Promise<UserRow> {
  const email = normaliseEmail(input.email);
  const passwordHash = hashPassword(input.password);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      fullName: input.fullName.trim(),
      phone: input.phone?.trim() ?? null,
      role: "subscriber",
      status: "pending",
      allowedTabs: [],
    })
    .returning();
  if (!row) throw new Error("user insert returned no row");
  return row;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normaliseEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listAllUsers(): Promise<UserRow[]> {
  return db.select().from(usersTable).orderBy(sql`created_at DESC`);
}

/** Owner edits any subset of subscription/profile fields. */
export interface AdminUpdateInput {
  status?: UserStatus;
  fullName?: string;
  phone?: string | null;
  subscriptionStartedAt?: Date | null;
  subscriptionExpiresAt?: Date | null;
  amountPaise?: number | null;
  paidAt?: Date | null;
  paymentRef?: string | null;
  notes?: string | null;
  allowedTabs?: AllowedTabKey[];
}

export async function adminUpdateUser(id: number, patch: AdminUpdateInput): Promise<UserRow> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) update["status"] = patch.status;
  if (patch.fullName !== undefined) update["fullName"] = patch.fullName.trim();
  if (patch.phone !== undefined) update["phone"] = patch.phone?.trim() ?? null;
  if (patch.subscriptionStartedAt !== undefined) update["subscriptionStartedAt"] = patch.subscriptionStartedAt;
  if (patch.subscriptionExpiresAt !== undefined) update["subscriptionExpiresAt"] = patch.subscriptionExpiresAt;
  if (patch.amountPaise !== undefined) update["amountPaise"] = patch.amountPaise;
  if (patch.paidAt !== undefined) update["paidAt"] = patch.paidAt;
  if (patch.paymentRef !== undefined) update["paymentRef"] = patch.paymentRef;
  if (patch.notes !== undefined) update["notes"] = patch.notes;
  if (patch.allowedTabs !== undefined) {
    const cleaned = patch.allowedTabs.filter((t): t is AllowedTabKey =>
      (ALLOWED_TAB_KEYS as readonly string[]).includes(t),
    );
    update["allowedTabs"] = cleaned;
  }
  const [row] = await db.update(usersTable).set(update).where(eq(usersTable.id, id)).returning();
  if (!row) throw new Error("user not found");
  return row;
}

export async function deleteUser(id: number): Promise<void> {
  await db.delete(usersTable).where(eq(usersTable.id, id));
}

// ---------- subscription helpers ----------

/**
 * Returns the live status taking expiry into account. The DB column is the
 * owner-set state; this read-time check auto-flips active→expired so we never
 * serve data to someone whose paid window has lapsed.
 */
export function getEffectiveStatus(u: UserRow, now: Date = new Date()): UserStatus {
  if (u.status === "suspended" || u.status === "pending") return u.status;
  if (u.status === "expired") return "expired";
  // status === "active"
  if (u.subscriptionExpiresAt && u.subscriptionExpiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function isSubscriberAllowed(u: UserRow, tab: AllowedTabKey): boolean {
  if (getEffectiveStatus(u) !== "active") return false;
  return u.allowedTabs.includes(tab);
}

// ---------- session helpers (cookie-based) ----------

export type Session = { role: "owner" } | { role: "subscriber"; userId: number };

const COOKIE_NAME = "scanner_session";

/** Decode the signed session cookie into a typed identity. */
export function getSession(req: Request): Session | null {
  const v = (req.signedCookies as Record<string, unknown> | undefined)?.[COOKIE_NAME];
  if (typeof v !== "string" || v.length === 0) return null;
  if (v === "owner" || v === "ok") return { role: "owner" };
  if (v.startsWith("u:")) {
    const id = Number.parseInt(v.slice(2), 10);
    if (Number.isFinite(id) && id > 0) return { role: "subscriber", userId: id };
  }
  return null;
}

export function isOwner(req: Request): boolean {
  return getSession(req)?.role === "owner";
}

// ---------- middleware ----------

/**
 * Allow only the site owner. Blocks subscribers with 403.
 *
 * Public-access mode: bypasses GET requests (so visitors can browse
 * owner-only data tabs like paper trading positions/reports during a
 * shared-site audit), but still requires a real owner cookie for any
 * write method (POST/PUT/PATCH/DELETE). This protects admin user CRUD
 * (`/admin/users*`), Kite session writes (`/kite/*`), paper-trade
 * close/journal mutations, and any other state-changing endpoint —
 * even on a publicly-shared link, anonymous visitors can only LOOK,
 * never MUTATE.
 */
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (isPublicAccessEnabled()) {
    if (req.method === "GET" || req.method === "HEAD") return next();
    // Writes still require a real owner cookie even in public mode.
    const s = getSession(req);
    if (s?.role === "owner") return next();
    res.status(403).json({
      error: "owner_only_write",
      code: "PUBLIC_MODE_READ_ONLY",
      message: "Writes are disabled while public-access mode is on. Sign in as owner.",
    });
    return;
  }
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
    return;
  }
  if (s.role !== "owner") {
    res.status(403).json({ error: "owner_only", code: "OWNER_ONLY" });
    return;
  }
  next();
}

/**
 * Strict owner gate that does NOT bypass GET/HEAD in public-access mode.
 *
 * Use for owner-only surfaces whose READ responses must never be exposed on a
 * shared public link — e.g. secret/token status metadata. Unlike `requireOwner`
 * (which lets anonymous visitors browse owner-only data tabs read-only during a
 * shared-site audit), this requires a real owner cookie for every method.
 */
export function requireOwnerStrict(req: Request, res: Response, next: NextFunction): void {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
    return;
  }
  if (s.role !== "owner") {
    res.status(403).json({ error: "owner_only", code: "OWNER_ONLY" });
    return;
  }
  next();
}

/**
 * Allow owner OR active subscriber. Subscribers must additionally have at
 * least one of the supplied tabs in their allowedTabs list.
 *
 * Pass no `tabs` arg to mean "any active subscriber regardless of which tabs
 * they have" — used for /api/auth/me and /api/personal-watchlist.
 */
export function requireSubscriberOrOwner(...tabs: AllowedTabKey[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Public-access mode: every visitor is treated as having full
    // owner-equivalent access for tab-gated reads (DEEP_SCAN, FNO,
    // STRATEGIES, SECTORS, etc.). Writes that USE this gate (e.g.
    // personal-watchlist mutations) are handled inside the route — they
    // bail out cleanly when there's no real session identity to attach
    // a row to. This is safe because every callsite of this middleware
    // is either a read or a per-user-state mutation that already needs
    // a real session to be meaningful.
    if (isPublicAccessEnabled()) return next();
    const s = getSession(req);
    if (!s) {
      res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
      return;
    }
    if (s.role === "owner") return next();
    try {
      const user = await getUserById(s.userId);
      if (!user) {
        res.status(401).json({ error: "user_not_found", code: "USER_GONE" });
        return;
      }
      const eff = getEffectiveStatus(user);
      if (eff !== "active") {
        res.status(403).json({ error: `account_${eff}`, code: `ACCOUNT_${eff.toUpperCase()}` });
        return;
      }
      if (tabs.length > 0 && !tabs.some(t => user.allowedTabs.includes(t))) {
        res.status(403).json({ error: "tab_not_in_plan", code: "TAB_FORBIDDEN", requiredTabs: tabs });
        return;
      }
      next();
    } catch (err) {
      logger.error({ err }, "requireSubscriberOrOwner middleware failed");
      res.status(500).json({ error: "internal_error" });
    }
  };
}
