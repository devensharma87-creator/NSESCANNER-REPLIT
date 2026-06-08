/**
 * Owner-scoped persistence for custom strategy definitions and the live-engine
 * allow-list. All reads validate the persisted JSONB spec with
 * `CustomStrategySpecSchema` and SKIP (never fabricate) anything malformed.
 */
import { db, strategyDefinitionsTable, strategyEngineStateTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../logger";
import { CustomStrategySpecSchema, type CustomStrategySpec } from "./customSpec";
import { ENGINE_BUILTIN_IDS } from "./catalog";

export const OWNER_KEY = "owner";

/** Load all valid custom strategy specs for an owner (malformed rows skipped). */
export async function listCustomSpecs(ownerKey: string = OWNER_KEY): Promise<CustomStrategySpec[]> {
  const rows = await db
    .select()
    .from(strategyDefinitionsTable)
    .where(eq(strategyDefinitionsTable.ownerKey, ownerKey));
  const out: CustomStrategySpec[] = [];
  for (const r of rows) {
    const parsed = CustomStrategySpecSchema.safeParse(r.spec);
    if (parsed.success) out.push(parsed.data);
    else logger.warn({ id: r.id, issues: parsed.error.issues }, "strategy_definitions: skipping malformed spec");
  }
  return out;
}

export async function getCustomSpec(
  id: string,
  ownerKey: string = OWNER_KEY,
): Promise<CustomStrategySpec | null> {
  const [row] = await db
    .select()
    .from(strategyDefinitionsTable)
    .where(and(eq(strategyDefinitionsTable.ownerKey, ownerKey), eq(strategyDefinitionsTable.id, id)))
    .limit(1);
  if (!row) return null;
  const parsed = CustomStrategySpecSchema.safeParse(row.spec);
  return parsed.success ? parsed.data : null;
}

export async function upsertCustomSpec(
  spec: CustomStrategySpec,
  ownerKey: string = OWNER_KEY,
): Promise<void> {
  await db
    .insert(strategyDefinitionsTable)
    .values({
      ownerKey,
      id: spec.id,
      name: spec.name,
      category: spec.category,
      description: spec.description,
      spec,
    })
    .onConflictDoUpdate({
      target: [strategyDefinitionsTable.ownerKey, strategyDefinitionsTable.id],
      set: {
        name: spec.name,
        category: spec.category,
        description: spec.description,
        spec,
        updatedAt: new Date(),
      },
    });
}

/** Delete a custom spec AND its engine-state row (so a deleted strategy can never linger enabled). */
export async function deleteCustomSpec(id: string, ownerKey: string = OWNER_KEY): Promise<void> {
  await db
    .delete(strategyDefinitionsTable)
    .where(and(eq(strategyDefinitionsTable.ownerKey, ownerKey), eq(strategyDefinitionsTable.id, id)));
  await db
    .delete(strategyEngineStateTable)
    .where(
      and(eq(strategyEngineStateTable.ownerKey, ownerKey), eq(strategyEngineStateTable.strategyId, id)),
    );
}

/** Raw engine-state rows as a map of strategyId → enabled. */
export async function getEngineStateMap(
  ownerKey: string = OWNER_KEY,
): Promise<Map<string, boolean>> {
  const rows = await db
    .select()
    .from(strategyEngineStateTable)
    .where(eq(strategyEngineStateTable.ownerKey, ownerKey));
  const m = new Map<string, boolean>();
  for (const r of rows) m.set(r.strategyId, r.enabledForEngine === 1);
  return m;
}

export async function setEngineState(
  strategyId: string,
  enabled: boolean,
  ownerKey: string = OWNER_KEY,
): Promise<void> {
  await db
    .insert(strategyEngineStateTable)
    .values({ ownerKey, strategyId, enabledForEngine: enabled ? 1 : 0 })
    .onConflictDoUpdate({
      target: [strategyEngineStateTable.ownerKey, strategyEngineStateTable.strategyId],
      set: { enabledForEngine: enabled ? 1 : 0, updatedAt: new Date() },
    });
}

/**
 * Resolve the EFFECTIVE engine-enabled flag for a strategy id given the raw
 * state map. Honest defaults that fail safe:
 *   - builtin engine setups default ENABLED (missing row = enabled).
 *   - everything else (custom) defaults DISABLED (missing row = disabled), so a
 *     freshly-defined strategy never auto-trades before the owner opts in.
 */
export function effectiveEngineEnabled(strategyId: string, state: Map<string, boolean>): boolean {
  const row = state.get(strategyId);
  if (row !== undefined) return row;
  return ENGINE_BUILTIN_IDS.has(strategyId);
}
