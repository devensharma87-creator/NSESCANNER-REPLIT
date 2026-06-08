/**
 * Regression tests for the live-engine strategy selection loader (Task #109).
 *
 * `loadEngineStrategySelection` is the ONE place the owner's Strategy-Control
 * allow-list is read into the signal cycle. Its safety contract is that the
 * allow-list can only ever NARROW the builtin set or ADD opted-in custom
 * detectors — it can never disable the engine wholesale, and any failure (or
 * an empty/unconfigured DB) must reproduce the legacy behaviour EXACTLY:
 *   - `enabledBuiltins = null`  → engine does not gate builtins (all on),
 *   - `enabledCustomSpecs = []` → no custom detectors run.
 *
 * The store layer (getEngineStateMap / listCustomSpecs) is mocked so these are
 * pure, DB-free unit tests; `effectiveEngineEnabled` (the real default logic:
 * builtins default ON, customs default OFF) is exercised verbatim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CustomStrategySpec } from "./customSpec";
import { ENGINE_BUILTIN_IDS } from "./catalog";

const getEngineStateMap = vi.fn<() => Promise<Map<string, boolean>>>();
const listCustomSpecs = vi.fn<() => Promise<CustomStrategySpec[]>>();

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    getEngineStateMap: () => getEngineStateMap(),
    listCustomSpecs: () => listCustomSpecs(),
  };
});

vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { loadEngineStrategySelection } = await import("./engineSelection");

function customSpec(id: string): CustomStrategySpec {
  return {
    id,
    name: id,
    category: "Test",
    description: "",
    bull: [{ left: "close", op: "gt", right: { type: "value", value: 1 } }],
    bear: [],
    params: { stopAtrMult: 1.5, target1R: 1, target2R: 2 },
    baseConfidence: 60,
  };
}

beforeEach(() => {
  getEngineStateMap.mockReset();
  listCustomSpecs.mockReset();
});

describe("loadEngineStrategySelection — legacy / safe defaults", () => {
  it("nothing persisted → NO_SELECTION (null builtins = legacy, no custom)", async () => {
    getEngineStateMap.mockResolvedValue(new Map());
    listCustomSpecs.mockResolvedValue([]);
    const sel = await loadEngineStrategySelection();
    expect(sel.enabledBuiltins).toBeNull();
    expect(sel.enabledCustomSpecs).toEqual([]);
  });

  it("a DB failure fails OPEN → NO_SELECTION (engine keeps running all builtins)", async () => {
    getEngineStateMap.mockRejectedValue(new Error("db down"));
    listCustomSpecs.mockResolvedValue([]);
    const sel = await loadEngineStrategySelection();
    expect(sel.enabledBuiltins).toBeNull();
    expect(sel.enabledCustomSpecs).toEqual([]);
  });

  it("a custom-spec read failure also fails OPEN → NO_SELECTION", async () => {
    getEngineStateMap.mockResolvedValue(new Map());
    listCustomSpecs.mockRejectedValue(new Error("spec read failed"));
    const sel = await loadEngineStrategySelection();
    expect(sel.enabledBuiltins).toBeNull();
    expect(sel.enabledCustomSpecs).toEqual([]);
  });
});

describe("loadEngineStrategySelection — allow-list only NARROWS builtins", () => {
  it("disabling ONE builtin keeps every OTHER builtin on, never escapes the builtin set", async () => {
    const disabled = "VWAP_RECLAIM";
    getEngineStateMap.mockResolvedValue(new Map([[disabled, false]]));
    listCustomSpecs.mockResolvedValue([]);

    const sel = await loadEngineStrategySelection();
    expect(sel.enabledBuiltins).not.toBeNull();
    const enabled = sel.enabledBuiltins!;

    // The disabled builtin is excluded...
    expect(enabled.has(disabled)).toBe(false);
    // ...every other builtin is still on (default-ON for missing rows)...
    for (const id of ENGINE_BUILTIN_IDS) {
      if (id !== disabled) expect(enabled.has(id)).toBe(true);
    }
    // ...and the allow-list NEVER contains a non-builtin id.
    for (const id of enabled) {
      expect(ENGINE_BUILTIN_IDS.has(id)).toBe(true);
    }
    // No custom opted in.
    expect(sel.enabledCustomSpecs).toEqual([]);
  });

  it("enabling a custom strategy adds it WITHOUT disabling any builtin", async () => {
    const spec = customSpec("CUSTOM_my_edge");
    getEngineStateMap.mockResolvedValue(new Map([[spec.id, true]]));
    listCustomSpecs.mockResolvedValue([spec]);

    const sel = await loadEngineStrategySelection();
    // Every builtin remains enabled (defaults ON; none were disabled).
    expect(sel.enabledBuiltins).not.toBeNull();
    for (const id of ENGINE_BUILTIN_IDS) {
      expect(sel.enabledBuiltins!.has(id)).toBe(true);
    }
    // The opted-in custom is the only added detector.
    expect(sel.enabledCustomSpecs.map((s) => s.id)).toEqual([spec.id]);
  });

  it("a custom strategy that exists but is NOT opted in does not run (default OFF)", async () => {
    const spec = customSpec("CUSTOM_not_enabled");
    // Some state exists (so we're past the NO_SELECTION short-circuit) but the
    // custom has no enabling row → effectiveEngineEnabled defaults it OFF.
    getEngineStateMap.mockResolvedValue(new Map([["VWAP_RECLAIM", false]]));
    listCustomSpecs.mockResolvedValue([spec]);

    const sel = await loadEngineStrategySelection();
    expect(sel.enabledCustomSpecs).toEqual([]);
  });

  it("explicitly DISABLING a custom keeps it off even with state present", async () => {
    const spec = customSpec("CUSTOM_explicitly_off");
    getEngineStateMap.mockResolvedValue(new Map([[spec.id, false]]));
    listCustomSpecs.mockResolvedValue([spec]);

    const sel = await loadEngineStrategySelection();
    expect(sel.enabledCustomSpecs).toEqual([]);
    // Builtins still all on (none disabled).
    for (const id of ENGINE_BUILTIN_IDS) {
      expect(sel.enabledBuiltins!.has(id)).toBe(true);
    }
  });
});
