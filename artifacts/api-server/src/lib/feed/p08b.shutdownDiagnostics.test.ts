/**
 * PHASE 0.8B — GATE F: SHUTDOWN AND DIAGNOSTICS
 *
 * The close hook must be idempotent, safe when nothing is owned, and — the
 * point of the whole exercise — DISHONEST NEVER. A process that failed to
 * release provider sockets must not exit zero.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFeedManagerForTesting } from "./feedManager";
import { createShutdownController } from "../lifecycle/gracefulShutdown";
import {
  getProductionFeedManager,
  productionFeedCloseHook,
  _forTesting_resetProductionFeedManager,
} from "./productionFeedManager";
import {
  makeFakeClientHarness,
  makePlan,
  makeAllPassDecision,
  TEST_GENERATION_ID,
} from "./testing/p08bFixtures";
import type { FakeClientBehavior } from "./testing/p08bFixtures";

const FEED_DIR = path.dirname(fileURLToPath(import.meta.url));

function build(behavior: FakeClientBehavior = {}) {
  const h = makeFakeClientHarness(behavior);
  const dec = makeAllPassDecision(makePlan([2, 2, 2]));
  const m = createFeedManagerForTesting({
    clientFactory: h.factory,
    getActivation: () => dec,
    getCurrentGenerationId: () => TEST_GENERATION_ID,
  });
  return { h, m };
}

beforeEach(() => {
  _forTesting_resetProductionFeedManager();
});

describe("P0.8B Gate F — closing when nothing is owned", () => {
  it("F1: closing a DISABLED manager reports NOT_OWNED without throwing", async () => {
    const { m } = build();
    const res = await m.close("SIGTERM");
    expect(res.closed).toBe(false);
    expect(res.detail).toContain("NO_FEED_OWNED");
  });

  it("F2: close is idempotent", async () => {
    const { h, m } = build();
    await m.start();
    const first = await m.close("SIGTERM");
    const second = await m.close("SIGTERM");
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    // No socket was closed twice.
    expect(h.callsOfKind("CLOSE")).toHaveLength(3);
  });

  it("F3: close after a failed start is safe and owns nothing", async () => {
    const { m } = build({ connectFailsOn: new Set([1]) });
    await m.start();
    const res = await m.close("SIGTERM");
    expect(res.closed).toBe(false);
  });
});

describe("P0.8B Gate F — closing when sockets are held", () => {
  it("F4: every socket is released and the manager reaches STOPPED", async () => {
    const { h, m } = build();
    await m.start();
    const res = await m.close("SIGTERM");
    expect(res.closed).toBe(true);
    expect(m.state()).toBe("STOPPED");
    expect(h.liveCount()).toBe(0);
    expect(m.diagnostics().clientsHeld).toBe(0);
  });

  it("F5: one refusing socket does not prevent the others being released", async () => {
    const { h, m } = build({ closeFailsOn: new Set([0]) });
    await m.start();
    await expect(m.close("SIGTERM")).rejects.toThrow(/FEED_CLOSE_INCOMPLETE/);
    // Shards 1 and 2 were still asked to close.
    expect(h.callsOfKind("CLOSE").map((c) => c.shardId).sort()).toEqual([0, 1, 2]);
  });

  it("F6: a socket that cannot be released makes the hook THROW", async () => {
    const { m } = build({ closeThrowsOn: new Set([2]) });
    await m.start();
    await expect(m.close("SIGTERM")).rejects.toThrow(/FEED_CLOSE_INCOMPLETE/);
  });
});

describe("P0.8B Gate F — a socket that could not be released is never forgotten", () => {
  it("F21: a rollback that fails to close a socket records it as unreleased", async () => {
    const { m } = build({ connectFailsOn: new Set([2]), closeFailsOn: new Set([0]) });
    await m.start();
    const diag = m.diagnostics();
    expect(diag.clientsHeld).toBe(0);
    // The socket is gone from the slots but NOT forgotten.
    expect(diag.unreleasedSockets).toBe(1);
  });

  it("F22: close() after an incomplete rollback THROWS instead of claiming nothing was owned", async () => {
    const { m } = build({ connectFailsOn: new Set([2]), closeThrowsOn: new Set([0]) });
    await m.start();
    expect(m.diagnostics().unreleasedSockets).toBe(1);
    await expect(m.close("SIGTERM")).rejects.toThrow(/FEED_CLOSE_INCOMPLETE/);
  });

  it("F23: an abandoned socket forces a NON-ZERO exit, not a false clean shutdown", async () => {
    const { m } = build({ connectFailsOn: new Set([2]), closeThrowsOn: new Set([0]) });
    await m.start();
    const controller = createShutdownController({
      closeFeed: (signal) => m.close(signal),
      closeHttp: async () => undefined,
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("HOOK_FAILED");
    expect(result.exitCode).toBe(1);
  });

  it("F24: a retried close that succeeds clears the unreleased ledger", async () => {
    const h = makeFakeClientHarness();
    const decF24 = makeAllPassDecision(makePlan([2, 2, 2]));
    let refuseClose = true;
    const m = createFeedManagerForTesting({
      clientFactory: async (spec) => {
        const client = await h.factory(spec);
        return {
          ...client,
          close: async () =>
            refuseClose && spec.shardId === 0
              ? { ok: false, detail: "TEMPORARILY_REFUSED" }
              : client.close(),
        };
      },
      getActivation: () => decF24,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });

    await m.start();
    await expect(m.close("SIGTERM")).rejects.toThrow(/FEED_CLOSE_INCOMPLETE/);
    expect(m.diagnostics().unreleasedSockets).toBe(1);

    refuseClose = false;
    const res = await m.close("SIGTERM");
    expect(res.closed).toBe(true);
    expect(m.diagnostics().unreleasedSockets).toBe(0);
  });
});

describe("P0.8B Gate F — shutdown coordinator integration", () => {
  it("F7: a nothing-owned close yields a clean exit code 0", async () => {
    const { m } = build();
    const controller = createShutdownController({
      closeFeed: (signal) => m.close(signal),
      closeHttp: async () => undefined,
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("NOT_OWNED");
    expect(result.exitCode).toBe(0);
  });

  it("F8: a successful real close yields CLOSED and exit code 0", async () => {
    const { m } = build();
    await m.start();
    const controller = createShutdownController({
      closeFeed: (signal) => m.close(signal),
      closeHttp: async () => undefined,
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("CLOSED");
    expect(result.exitCode).toBe(0);
  });

  it("F9: an unreleasable socket yields HOOK_FAILED and a NON-ZERO exit code", async () => {
    const { m } = build({ closeThrowsOn: new Set([1]) });
    await m.start();
    const controller = createShutdownController({
      closeFeed: (signal) => m.close(signal),
      closeHttp: async () => undefined,
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("HOOK_FAILED");
    expect(result.exitCode).toBe(1);
  });
});

describe("P0.8B Gate F — the production instance", () => {
  it("F10: the production manager starts DISABLED and owns nothing", () => {
    const diag = getProductionFeedManager().diagnostics();
    expect(diag.state).toBe("DISABLED");
    expect(diag.clientsHeld).toBe(0);
    expect(diag.activationAuthorizedConstant).toBe(false);
  });

  it("F11: the production close hook reports NOT_OWNED and does not throw", async () => {
    const res = await productionFeedCloseHook("SIGTERM");
    expect(res.closed).toBe(false);
    expect(res.detail).toContain("NO_FEED_OWNED");
  });

  it("F12: starting the production manager cannot construct a provider client", async () => {
    const out = await getProductionFeedManager().start();
    expect(out.started).toBe(false);
    expect(out.blocker).toBe("FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED");
  });

  it("F13: productionFeedManager never calls the test-only factory", () => {
    const src = readFileSync(path.join(FEED_DIR, "productionFeedManager.ts"), "utf8");
    expect(src).not.toContain("createFeedManagerForTesting");
  });

  it("F14: no production feed module imports the test fixtures", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(FEED_DIR)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const src = readFileSync(path.join(FEED_DIR, file), "utf8");
      if (src.includes("testing/p08bFixtures")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("F15: the provider SDK is never imported at module scope in the adapter", () => {
    const src = readFileSync(path.join(FEED_DIR, "kiteFeedClientAdapter.ts"), "utf8");
    // A top-level `import ... from "kiteconnect"` would execute the SDK on load.
    expect(src).not.toMatch(/^\s*import\s+[^;]*from\s+["']kiteconnect["']/m);
    // The only permitted form is the deferred dynamic import.
    expect(src).toContain('await import("kiteconnect")');
  });

  /**
   * The SDK is confined to explicitly named boundary modules.
   *
   * Phase 0.8D added a SECOND legitimate consumer: the Kite session-validation
   * production composition, whose entire purpose is to bind `getProfile()` to
   * the real SDK. It is the same kind of module as the feed client adapter — a
   * named provider boundary — so it joins the set rather than defeating it.
   *
   * The set is asserted exactly, so a third module cannot quietly appear.
   */
  const SDK_BOUNDARY_MODULES = [
    "kiteFeedClientAdapter.ts",
    "kiteSessionValidationProductionComposition.ts",
  ];

  it("F16: no feed module outside the named SDK boundary IMPORTS the provider SDK", () => {
    // Deliberately matches import/require syntax rather than the bare word:
    // the port's doc comment names the SDK precisely to explain that it must
    // never depend on it, and failing that comment would punish the documentation.
    const importsSdk = /(?:from\s*["']kiteconnect["'])|(?:import\s*\(\s*["']kiteconnect["']\s*\))|(?:require\s*\(\s*["']kiteconnect["']\s*\))/;
    const offenders: string[] = [];
    for (const file of readdirSync(FEED_DIR)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      if (SDK_BOUNDARY_MODULES.includes(file)) continue;
      const src = readFileSync(path.join(FEED_DIR, file), "utf8");
      if (importsSdk.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("F16b: every SDK boundary module exists and defers the import", () => {
    // Without this, widening the allowlist above would be a way to smuggle in a
    // module-scope `import ... from "kiteconnect"` that executes on load.
    for (const file of SDK_BOUNDARY_MODULES) {
      const full = path.join(FEED_DIR, file);
      expect(existsSync(full), `${file} is allowlisted but does not exist`).toBe(true);
      const src = readFileSync(full, "utf8");
      expect(src, `${file} must not import the SDK at module scope`).not.toMatch(
        /^\s*import\s+[^;]*from\s+["']kiteconnect["']/m,
      );
      expect(src, `${file} must use the deferred dynamic import`).toContain(
        'await import("kiteconnect")',
      );
    }
  });

  it("F16c: the SDK boundary set is exactly the approved modules", () => {
    const importsSdk = /(?:from\s*["']kiteconnect["'])|(?:import\s*\(\s*["']kiteconnect["']\s*\))|(?:require\s*\(\s*["']kiteconnect["']\s*\))/;
    const actual = readdirSync(FEED_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => importsSdk.test(readFileSync(path.join(FEED_DIR, f), "utf8")))
      .sort();
    expect(actual).toEqual([...SDK_BOUNDARY_MODULES].sort());
  });
});

describe("P0.8B Gate F — diagnostics safety", () => {
  it("F17: diagnostics expose counts but never tokens or identities", async () => {
    const { m } = build();
    await m.start();
    const serialised = JSON.stringify(m.diagnostics());
    // Fixture tokens start at 1000; identities look like NSE:EQUITY:SYM1000.
    expect(serialised).not.toContain("NSE:EQUITY:SYM");
    expect(serialised).not.toContain("1000");
    expect(m.diagnostics().shards[0]?.expectedTokens).toBe(2);
  });

  it("F18: diagnostics report the lost shards and held count truthfully", async () => {
    const { m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    const diag = m.diagnostics();
    expect(diag.state).toBe("DEGRADED");
    expect(diag.lostShardIds).toEqual([1]);
    expect(diag.clientsHeld).toBe(3);
  });

  it("F19: a tick delivered on a live socket for an unsubscribed token is counted as rejected", async () => {
    const { h, m } = build();
    await m.start();
    expect(m.diagnostics().rejectedTickCount).toBe(0);

    // Push a tick through the real client event path, for a token no shard owns.
    const spec = h.specFor(0);
    expect(spec).toBeDefined();
    spec!.events.onTicks([{ providerToken: 424242, ltp: 10, receivedTimestamp: 1_700_000_000_000 }]);

    const diag = m.diagnostics();
    expect(diag.rejectedTickCount).toBe(1);
    expect(diag.acceptedTickCount).toBe(0);
  });

  it("F20: ticks arriving while the manager is not accepting are rejected, not stored", async () => {
    const { h, m } = build();
    await m.start();
    const spec = h.specFor(0);
    const token = spec!.tokens[0]!;
    await m.close("SIGTERM");
    expect(m.state()).toBe("STOPPED");

    spec!.events.onTicks([{ providerToken: token, ltp: 10, receivedTimestamp: 1_700_000_000_000 }]);
    const diag = m.diagnostics();
    expect(diag.acceptedTickCount).toBe(0);
    expect(diag.rejectedTickCount).toBeGreaterThan(0);
  });
});
