/**
 * Owner-only admin endpoints. Protected by `requireOwner` at router level.
 *   GET    /admin/users          — list every account, newest first
 *   PATCH  /admin/users/:id      — approve / suspend / extend / re-grant tabs
 *   DELETE /admin/users/:id      — hard delete (cascades personal watchlist via ownerKey)
 */

import { Router, type IRouter } from "express";
import {
  requireOwner,
  listAllUsers,
  getUserById,
  adminUpdateUser,
  deleteUser,
  getEffectiveStatus,
  type AdminUpdateInput,
} from "../lib/userAuth";
import { db } from "@workspace/db";
import { personalWatchlistTable, ALLOWED_TAB_KEYS, type AllowedTabKey, type UserStatus, USER_STATUSES } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Path-scoped to /admin/* — without the prefix this would intercept
// every request that flows through the parent router and 401 anonymous
// callers before public routes (e.g. /auth/me) can be reached.
router.use("/admin", requireOwner);

function serialiseUser(u: Awaited<ReturnType<typeof listAllUsers>>[number]) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role,
    status: u.status,                              // owner-set status
    effectiveStatus: getEffectiveStatus(u),        // computed (auto-expire)
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    subscriptionStartedAt: u.subscriptionStartedAt?.toISOString() ?? null,
    subscriptionExpiresAt: u.subscriptionExpiresAt?.toISOString() ?? null,
    amountPaise: u.amountPaise ?? null,
    paidAt: u.paidAt?.toISOString() ?? null,
    paymentRef: u.paymentRef,
    notes: u.notes,
    allowedTabs: u.allowedTabs,
  };
}

router.get("/admin/users", async (_req, res) => {
  const users = await listAllUsers();
  res.json({ users: users.map(serialiseUser) });
});

router.get("/admin/users/:id", async (req, res) => {
  const id = Number.parseInt(req.params["id"] ?? "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const user = await getUserById(id);
  if (!user) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ user: serialiseUser(user) });
});

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function parseAmountPaise(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return undefined;
  return Math.round(n);
}

router.patch("/admin/users/:id", async (req, res) => {
  const id = Number.parseInt(req.params["id"] ?? "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: AdminUpdateInput = {};

  if (typeof body["status"] === "string") {
    const s = body["status"] as UserStatus;
    if (!(USER_STATUSES as readonly string[]).includes(s)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    patch.status = s;
  }
  if (typeof body["fullName"] === "string") patch.fullName = body["fullName"];
  if ("phone" in body) patch.phone = typeof body["phone"] === "string" ? body["phone"] : null;
  if ("subscriptionStartedAt" in body) {
    const d = parseDate(body["subscriptionStartedAt"]);
    if (d === undefined) { res.status(400).json({ error: "invalid_started_at" }); return; }
    patch.subscriptionStartedAt = d;
  }
  if ("subscriptionExpiresAt" in body) {
    const d = parseDate(body["subscriptionExpiresAt"]);
    if (d === undefined) { res.status(400).json({ error: "invalid_expires_at" }); return; }
    patch.subscriptionExpiresAt = d;
  }
  if ("amountPaise" in body) {
    const a = parseAmountPaise(body["amountPaise"]);
    if (a === undefined) { res.status(400).json({ error: "invalid_amount" }); return; }
    patch.amountPaise = a;
  }
  if ("paidAt" in body) {
    const d = parseDate(body["paidAt"]);
    if (d === undefined) { res.status(400).json({ error: "invalid_paid_at" }); return; }
    patch.paidAt = d;
  }
  if ("paymentRef" in body) patch.paymentRef = typeof body["paymentRef"] === "string" ? body["paymentRef"] : null;
  if ("notes" in body) patch.notes = typeof body["notes"] === "string" ? body["notes"] : null;

  if ("allowedTabs" in body) {
    const arr = body["allowedTabs"];
    if (!Array.isArray(arr) || !arr.every((x): x is string => typeof x === "string")) {
      res.status(400).json({ error: "invalid_allowed_tabs" });
      return;
    }
    const allowed = ALLOWED_TAB_KEYS as readonly string[];
    const invalid = arr.filter(t => !allowed.includes(t));
    if (invalid.length > 0) {
      // Reject the whole request rather than silently dropping bad keys —
      // otherwise a typo in the admin UI looks like the checkbox didn't save.
      res.status(400).json({ error: "invalid_tab_keys", invalid, allowed: ALLOWED_TAB_KEYS });
      return;
    }
    patch.allowedTabs = arr as AllowedTabKey[];
  }

  try {
    const updated = await adminUpdateUser(id, patch);
    logger.info({ userId: id, patch: Object.keys(patch) }, "admin updated user");
    res.json({ user: serialiseUser(updated) });
  } catch (err) {
    logger.error({ err, id }, "admin update failed");
    res.status(500).json({ error: "update_failed" });
  }
});

router.delete("/admin/users/:id", async (req, res) => {
  const id = Number.parseInt(req.params["id"] ?? "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    // Personal watchlist has no FK; clean it up explicitly so deleted users
    // don't leave orphaned rows under "u:<id>".
    await db.delete(personalWatchlistTable).where(eq(personalWatchlistTable.ownerKey, `u:${id}`));
    await deleteUser(id);
    logger.info({ userId: id }, "admin deleted user");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin delete failed");
    res.status(500).json({ error: "delete_failed" });
  }
});

export default router;
