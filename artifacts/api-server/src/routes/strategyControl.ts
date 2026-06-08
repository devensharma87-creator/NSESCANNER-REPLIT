/**
 * Owner-only strategy-control surface (Task #105).
 *
 * One unified catalog drives BOTH the live F&O auto-engine allow-list AND the
 * Backtest Lab selectable list, and the owner can define new config/parameter
 * driven custom strategies that appear on both. Everything here is:
 *   - owner-only (router-level `requireOwner`),
 *   - persisted (DB-backed via `lib/strategies/store`),
 *   - honest / fail-closed (a freshly-defined custom strategy is engine-DISABLED
 *     until the owner opts in; builtin engine setups default ENABLED so the
 *     out-of-the-box behaviour is unchanged).
 *
 * This surface NEVER bypasses a safety gate or the dev/prod paper-trading
 * isolation — it only narrows which setups the engine is allowed to emit. The
 * allow-list is consumed downstream in `optionSignals.ts` AFTER every existing
 * P1/P2/P3 gate.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireOwner } from "../lib/userAuth";
import {
  listStrategies,
} from "../lib/backtest/strategies/registry";
import { customStrategyModule } from "../lib/backtest/strategies/custom";
import {
  buildCatalog,
  ENGINE_BUILTIN_IDS,
  type CatalogEntry,
} from "../lib/strategies/catalog";
import {
  CustomStrategyInputSchema,
  specFromInput,
} from "../lib/strategies/customSpec";
import {
  listCustomSpecs,
  getEngineStateMap,
  setEngineState,
  effectiveEngineEnabled,
  upsertCustomSpec,
  deleteCustomSpec,
} from "../lib/strategies/store";

const router: IRouter = Router();

function ownerKeyFor(_req: Request): string {
  // Routes are router-level `requireOwner`, so the owner session is guaranteed;
  // the owner's storage key is the literal "owner" (matches store OWNER_KEY).
  return "owner";
}

function paramId(req: Request): string {
  const v = req.params["id"];
  return typeof v === "string" ? v : "";
}

/** Whether the entry lives on the engine surface (builtin engine OR custom). */
function isEngineSurface(e: CatalogEntry): boolean {
  return e.surfaces.includes("engine");
}

interface CatalogEntryOut extends CatalogEntry {
  /** Whether this strategy is selectable for the live engine allow-list. */
  engineSelectable: boolean;
  /** Effective live-engine enabled state (default: builtins ON, custom OFF). */
  engineEnabled: boolean;
}

async function buildCatalogResponse(
  ownerKey: string,
): Promise<{ entries: CatalogEntryOut[]; engineGatingActive: boolean }> {
  const backtestMetas = listStrategies().map((m) => m.meta);
  const customSpecs = await listCustomSpecs(ownerKey);
  const stateMap = await getEngineStateMap(ownerKey);
  const entries = buildCatalog(backtestMetas, customSpecs).map((e): CatalogEntryOut => {
    const engineSelectable = isEngineSurface(e);
    return {
      ...e,
      engineSelectable,
      engineEnabled: engineSelectable ? effectiveEngineEnabled(e.id, stateMap) : false,
    };
  });
  // The allow-list is "active" (narrowing the engine) only once the owner has
  // disabled at least one builtin OR enabled at least one custom strategy. With
  // no explicit state, every builtin is on and no custom runs = legacy behaviour.
  const engineGatingActive = entries.some(
    (e) =>
      e.engineSelectable &&
      ((ENGINE_BUILTIN_IDS.has(e.id) && !e.engineEnabled) ||
        (!ENGINE_BUILTIN_IDS.has(e.id) && e.engineEnabled)),
  );
  return { entries, engineGatingActive };
}

const engineUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        strategyId: z.string().min(1).max(80),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(64),
});

router.use(requireOwner);

/** GET /strategy-control/catalog — the unified catalog + engine-enabled flags. */
router.get("/strategy-control/catalog", async (req: Request, res: Response) => {
  const ownerKey = ownerKeyFor(req);
  const out = await buildCatalogResponse(ownerKey);
  return res.json(out);
});

/**
 * PUT /strategy-control/engine — bulk-set the live-engine allow-list.
 * Only ids that are engine-selectable (builtin engine setups or custom specs)
 * are accepted; anything else is rejected so the owner can't toggle a
 * backtest-only research strategy onto the live engine.
 */
router.put("/strategy-control/engine", async (req: Request, res: Response) => {
  const parsed = engineUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_BODY", detail: parsed.error.flatten() });
  }
  const ownerKey = ownerKeyFor(req);
  const customSpecs = await listCustomSpecs(ownerKey);
  const selectable = new Set<string>([
    ...ENGINE_BUILTIN_IDS,
    ...customSpecs.map((s) => s.id),
  ]);
  const unknown = parsed.data.items.filter((i) => !selectable.has(i.strategyId));
  if (unknown.length > 0) {
    return res.status(400).json({
      error: "NOT_ENGINE_SELECTABLE",
      detail: unknown.map((u) => u.strategyId),
    });
  }
  for (const i of parsed.data.items) {
    await setEngineState(i.strategyId, i.enabled, ownerKey);
  }
  const out = await buildCatalogResponse(ownerKey);
  return res.json(out);
});

/**
 * POST /strategy-control/custom — create or update a custom strategy.
 * Persisted as a JSONB spec; appears on BOTH the engine and backtest surfaces.
 * Engine-disabled by default (the owner must opt in via PUT /engine).
 */
router.post("/strategy-control/custom", async (req: Request, res: Response) => {
  const parsed = CustomStrategyInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_BODY", detail: parsed.error.flatten() });
  }
  const ownerKey = ownerKeyFor(req);
  const spec = specFromInput(parsed.data);
  await upsertCustomSpec(spec, ownerKey);
  const out = await buildCatalogResponse(ownerKey);
  return res.status(201).json({ id: spec.id, catalog: out });
});

/**
 * DELETE /strategy-control/custom/:id — remove a custom strategy entirely.
 * Only `CUSTOM_*` ids are accepted (defense-in-depth: this endpoint must never
 * touch a builtin's engine-state row). `deleteCustomSpec` already removes the
 * spec AND its engine-state row in one go, so a deleted strategy can never
 * linger enabled.
 */
router.delete("/strategy-control/custom/:id", async (req: Request, res: Response) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: "MISSING_ID" });
  if (!id.startsWith("CUSTOM_")) {
    return res.status(400).json({ error: "NOT_A_CUSTOM_STRATEGY", id });
  }
  const ownerKey = ownerKeyFor(req);
  await deleteCustomSpec(id, ownerKey);
  const out = await buildCatalogResponse(ownerKey);
  return res.json({ ok: true, id, catalog: out });
});

export default router;
