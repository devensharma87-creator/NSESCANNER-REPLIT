/**
 * Paper-trading COMBO routes (Tier C, Phase 1).
 *
 * Owner-only, mounted under `/api/paper/combos`. Strict OpenAPI/Zod
 * validation on every body — only the fields listed in the spec are
 * accepted; client-supplied premium / Greeks / margin / P&L are rejected
 * by the schema and stripped again in `sanitizeLegSpec` for defense in
 * depth.
 */
import { Router, type IRouter } from "express";
import { requireOwner } from "../lib/userAuth";
import {
  openCombo,
  listCombos,
  getCombo,
  closeCombo,
} from "../lib/paperTradingCombo";
import {
  OpenPaperComboBody as PostPaperComboBody,
  ClosePaperComboBody as PostPaperComboCloseBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/paper/combos", requireOwner);

// ── POST /paper/combos — open a new combo ────────────────────────────────
router.post("/paper/combos", async (req, res, next) => {
  try {
    const parsed = PostPaperComboBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path?.join(".") || "body";
      res.status(400).json({ error: `Invalid request: ${path}: ${first?.message ?? "invalid"}` });
      return;
    }
    const body = parsed.data;
    const result = await openCombo({
      underlying: body.underlying,
      expiry: body.expiry,
      legs: body.legs.map((l: { strike: number; optionType: "CE" | "PE"; action: "BUY" | "SELL"; lots: number }) => ({
        strike: l.strike,
        optionType: l.optionType,
        action: l.action,
        lots: l.lots,
      })),
      strategyName: body.strategyName ?? null,
      journal: body.journal ?? null,
    });
    if (!result.ok) {
      const status = result.error.code === "TOO_MANY_OPEN" || result.error.code === "DEBIT_TOO_LARGE" ? 409 : 400;
      res.status(status).json({ error: result.error.message, code: result.error.code });
      return;
    }
    res.status(201).json({ combo: result.combo });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "POST /paper/combos crashed");
    next(err);
  }
});

// ── GET /paper/combos — list ─────────────────────────────────────────────
router.get("/paper/combos", async (req, res, next) => {
  try {
    const status =
      req.query.status === "OPEN" || req.query.status === "CLOSED"
        ? (req.query.status as "OPEN" | "CLOSED")
        : undefined;
    const combos = await listCombos({ status, limit: 200 });
    res.json({ combos });
  } catch (err) {
    next(err);
  }
});

// ── GET /paper/combos/:id — detail ───────────────────────────────────────
router.get("/paper/combos/:id", async (req, res, next) => {
  try {
    const combo = await getCombo(req.params.id);
    if (!combo) {
      res.status(404).json({ error: "Combo not found." });
      return;
    }
    res.json({ combo });
  } catch (err) {
    next(err);
  }
});

// ── POST /paper/combos/:id/close — manual close ──────────────────────────
router.post("/paper/combos/:id/close", async (req, res, next) => {
  try {
    const parsed = PostPaperComboCloseBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path?.join(".") || "body";
      res.status(400).json({ error: `Invalid request: ${path}: ${first?.message ?? "invalid"}` });
      return;
    }
    const result = await closeCombo(req.params.id, {
      reason: "MANUAL",
      journal: parsed.data.journal ?? null,
    });
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ combo: result.combo });
  } catch (err) {
    logger.error({ err: (err as Error).message, id: req.params.id }, "POST /paper/combos/:id/close crashed");
    next(err);
  }
});

export default router;
