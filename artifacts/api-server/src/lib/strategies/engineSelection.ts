/**
 * Per-cycle live-engine strategy selection. Read once per signal cycle and
 * threaded into the engine via the GateContext.
 *
 * Fail-OPEN / safe-default semantics: if the DB read fails or no selection has
 * ever been persisted, we return `enabledBuiltins = null` which the engine
 * treats as "no allow-list" — i.e. it keeps running ALL builtin setups exactly
 * as before, and runs NO custom detectors. The owner's allow-list can only ever
 * NARROW the builtin set or ADD opted-in custom strategies; it can never disable
 * the engine wholesale or bypass any safety gate.
 */
import { logger } from "../logger";
import type { CustomStrategySpec } from "./customSpec";
import { ENGINE_BUILTINS } from "./catalog";
import { getEngineStateMap, listCustomSpecs, effectiveEngineEnabled, OWNER_KEY } from "./store";

export interface EngineStrategySelection {
  /**
   * Builtin setupKeys the engine MAY emit. `null` = no allow-list configured →
   * the engine does not gate builtins at all (legacy behaviour).
   */
  enabledBuiltins: Set<string> | null;
  /** Owner-opted-in custom strategies to run as additional engine detectors. */
  enabledCustomSpecs: CustomStrategySpec[];
}

const NO_SELECTION: EngineStrategySelection = {
  enabledBuiltins: null,
  enabledCustomSpecs: [],
};

export async function loadEngineStrategySelection(
  ownerKey: string = OWNER_KEY,
): Promise<EngineStrategySelection> {
  try {
    const [state, customs] = await Promise.all([getEngineStateMap(ownerKey), listCustomSpecs(ownerKey)]);

    // If nothing has ever been persisted, behave exactly like the legacy engine.
    if (state.size === 0 && customs.length === 0) return NO_SELECTION;

    const enabledBuiltins = new Set<string>();
    for (const b of ENGINE_BUILTINS) {
      if (effectiveEngineEnabled(b.id, state)) enabledBuiltins.add(b.id);
    }

    const enabledCustomSpecs = customs.filter((s) => effectiveEngineEnabled(s.id, state));

    return { enabledBuiltins, enabledCustomSpecs };
  } catch (err) {
    logger.warn({ err }, "loadEngineStrategySelection failed — falling back to no allow-list");
    return NO_SELECTION;
  }
}
