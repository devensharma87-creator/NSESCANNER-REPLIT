/**
 * PHASE 0.8T — GRACEFUL SHUTDOWN BOUNDARY (targeted)
 *
 * Proves every invariant of the re-entrancy-safe state machine:
 *   UNINSTALLED → INSTALLING (claimed before any external call)
 *             → INSTALLED   (after all listeners succeed)
 *             → UNINSTALLED (on any failure — never stuck in INSTALLING)
 *
 * Test isolation: afterEach resets module state so each test starts with a
 * clean UNINSTALLED baseline and exact listener counts.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_FEED_CLOSE_TIMEOUT_MS,
  MAX_FEED_CLOSE_TIMEOUT_MS,
  MIN_FEED_CLOSE_TIMEOUT_MS,
  NO_OP_FEED_CLOSE_HOOK,
  SHUTDOWN_SIGNALS,
  createShutdownController,
  describeShutdownReadiness,
  getBootId,
  getShutdownInstallationState,
  installShutdownLifecycle,
  isShutdownInstalled,
  _forTesting_resetShutdownLifecycle,
  type SignalTarget,
} from "./gracefulShutdown.js";

// ---------------------------------------------------------------------------
// Global afterEach: unconditionally reset module state after every test.
// ---------------------------------------------------------------------------
afterEach(() => {
  _forTesting_resetShutdownLifecycle();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireOnlyBound(index: 1 | 2): (fn: () => void) => unknown {
  let created = 0;
  return (fn) => {
    created += 1;
    if (created === index) queueMicrotask(fn);
    return created;
  };
}

/** Standard fake target with full on/off/emit/listenerCount support. */
function fakeSignalTarget(): SignalTarget & {
  emit: (signal: string) => void;
  listenerCount: (signal: string) => number;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(signal, listener) {
      const list = listeners.get(signal) ?? [];
      list.push(listener);
      listeners.set(signal, list);
      return this;
    },
    off(signal, listener) {
      listeners.set(signal, (listeners.get(signal) ?? []).filter((l) => l !== listener));
      return this;
    },
    emit(signal) {
      for (const l of listeners.get(signal) ?? []) l();
    },
    listenerCount(signal) {
      return (listeners.get(signal) ?? []).length;
    },
  };
}

/** Target that uses removeListener instead of off. */
function fakeTargetWithRemoveListener(): SignalTarget & {
  listenerCount: (signal: string) => number;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(signal, listener) {
      const list = listeners.get(signal) ?? [];
      list.push(listener);
      listeners.set(signal, list);
      return this;
    },
    // no off — only removeListener
    removeListener(signal, listener) {
      listeners.set(signal, (listeners.get(signal) ?? []).filter((l) => l !== listener));
      return this;
    },
    listenerCount(signal) {
      return (listeners.get(signal) ?? []).length;
    },
  };
}

/** Target whose on() throws on the second call, simulating partial failure. */
function partiallyFailingTarget(): SignalTarget & { listenerCount: (signal: string) => number } {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let callCount = 0;
  return {
    on(signal, listener) {
      callCount += 1;
      if (callCount >= 2) throw new Error(`SIMULATED_ON_FAILURE_FOR_${signal}`);
      const list = listeners.get(signal) ?? [];
      list.push(listener);
      listeners.set(signal, list);
      return this;
    },
    off(signal, listener) {
      listeners.set(signal, (listeners.get(signal) ?? []).filter((l) => l !== listener));
      return this;
    },
    listenerCount(signal) {
      return (listeners.get(signal) ?? []).length;
    },
  };
}

/** Target with no off and no removeListener. */
function noCleanupTarget(): SignalTarget & { listenerCount: () => number } {
  let addedCount = 0;
  return {
    on(_signal, _listener) {
      addedCount += 1;
      return this;
    },
    // off and removeListener intentionally absent
    listenerCount() {
      return addedCount;
    },
  };
}

// ---------------------------------------------------------------------------
// D1–D20 — Atomic installation state machine invariants
// ---------------------------------------------------------------------------

describe("P08T D1-D20 — atomic installation state machine", () => {

  it("D1 initial state is UNINSTALLED and isShutdownInstalled() is false", () => {
    expect(getShutdownInstallationState()).toBe("UNINSTALLED");
    expect(isShutdownInstalled()).toBe(false);
    expect(describeShutdownReadiness().installedAtBoot).toBe(false);
    expect(describeShutdownReadiness().installationState).toBe("UNINSTALLED");
  });

  it("D2 state transitions to INSTALLING before the first target.on() call", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    let observedStateDuringOn: string = "NOT_OBSERVED";
    const observingTarget: SignalTarget = {
      on(_signal, _listener) {
        // Capture state synchronously inside on() — before installShutdownLifecycle returns.
        observedStateDuringOn = getShutdownInstallationState();
        return this;
      },
      off() { return this; },
    };
    installShutdownLifecycle(controller, observingTarget);
    expect(observedStateDuringOn).toBe("INSTALLING");
    // After the call completes, state must be INSTALLED (not INSTALLING).
    expect(getShutdownInstallationState()).toBe("INSTALLED");
  });

  it("D3 re-entrant target.on() cannot install a second listener pair or replace the controller", () => {
    const ctrl1 = createShutdownController({ closeHttp: async () => {} });
    const ctrl2 = createShutdownController({ closeHttp: async () => {} });
    const target2 = fakeSignalTarget();
    let reentrantResult: string = "NOT_CALLED";

    const reentrantTarget: SignalTarget = {
      on(_signal, _listener) {
        // Attempt to install a second pair during the first on() call.
        reentrantResult = installShutdownLifecycle(ctrl2, target2);
        return this;
      },
      off() { return this; },
    };

    installShutdownLifecycle(ctrl1, reentrantTarget);

    // The re-entrant call must be refused.
    expect(reentrantResult).toBe("ALREADY_INSTALLED");
    // target2 must have received zero listeners from the re-entrant attempt.
    expect(target2.listenerCount("SIGTERM")).toBe(0);
    expect(target2.listenerCount("SIGINT")).toBe(0);
    // State is INSTALLED (the outer call completed).
    expect(getShutdownInstallationState()).toBe("INSTALLED");
  });

  it("D4 after successful installation, state is INSTALLED and readiness is true", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = fakeSignalTarget();
    const result = installShutdownLifecycle(controller, target);
    expect(result).toBe("INSTALLED");
    expect(getShutdownInstallationState()).toBe("INSTALLED");
    expect(isShutdownInstalled()).toBe(true);
    expect(describeShutdownReadiness().installedAtBoot).toBe(true);
    expect(describeShutdownReadiness().installationState).toBe("INSTALLED");
  });

  it("D5 exactly one SIGTERM listener and one SIGINT listener after successful installation", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = fakeSignalTarget();
    expect(target.listenerCount("SIGTERM")).toBe(0);
    expect(target.listenerCount("SIGINT")).toBe(0);
    installShutdownLifecycle(controller, target);
    expect(target.listenerCount("SIGTERM")).toBe(1);
    expect(target.listenerCount("SIGINT")).toBe(1);
  });

  it("D6 second normal installation returns ALREADY_INSTALLED and no listener count changes", () => {
    const ctrl1 = createShutdownController({ closeHttp: async () => {} });
    const ctrl2 = createShutdownController({ closeHttp: async () => {} });
    const target1 = fakeSignalTarget();
    const target2 = fakeSignalTarget();

    const first = installShutdownLifecycle(ctrl1, target1);
    const second = installShutdownLifecycle(ctrl2, target2);

    expect(first).toBe("INSTALLED");
    expect(second).toBe("ALREADY_INSTALLED");
    // Original counts unchanged.
    expect(target1.listenerCount("SIGTERM")).toBe(1);
    expect(target1.listenerCount("SIGINT")).toBe(1);
    // Second target was never touched.
    expect(target2.listenerCount("SIGTERM")).toBe(0);
    expect(target2.listenerCount("SIGINT")).toBe(0);
  });

  it("D7 target without off() and without removeListener() is refused before any listener is added", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = noCleanupTarget();

    expect(() => installShutdownLifecycle(controller, target)).toThrow(
      "SHUTDOWN_TARGET_MISSING_CLEANUP_METHOD",
    );
    // No listener was added (the refusal fires before the loop).
    expect(target.listenerCount()).toBe(0);
    // State must be UNINSTALLED — not stuck in INSTALLING.
    expect(getShutdownInstallationState()).toBe("UNINSTALLED");
    expect(isShutdownInstalled()).toBe(false);
  });

  it("D8 target with removeListener() instead of off() installs and rolls back correctly", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = fakeTargetWithRemoveListener();

    const result = installShutdownLifecycle(controller, target);
    expect(result).toBe("INSTALLED");
    expect(target.listenerCount("SIGTERM")).toBe(1);
    expect(target.listenerCount("SIGINT")).toBe(1);
    expect(isShutdownInstalled()).toBe(true);

    // Reset must remove the listeners via removeListener.
    _forTesting_resetShutdownLifecycle();
    expect(target.listenerCount("SIGTERM")).toBe(0);
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(isShutdownInstalled()).toBe(false);
  });

  it("D9 failure on the second listener removes the first listener and restores UNINSTALLED", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = partiallyFailingTarget();

    expect(() => installShutdownLifecycle(controller, target)).toThrow("SIMULATED_ON_FAILURE");
    // The first (SIGTERM) listener must have been removed by rollback.
    expect(target.listenerCount("SIGTERM")).toBe(0);
    // State must be UNINSTALLED.
    expect(getShutdownInstallationState()).toBe("UNINSTALLED");
    expect(isShutdownInstalled()).toBe(false);
  });

  it("D10 reset removes both listeners and restores a clean UNINSTALLED baseline", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = fakeSignalTarget();

    installShutdownLifecycle(controller, target);
    expect(isShutdownInstalled()).toBe(true);
    expect(target.listenerCount("SIGTERM")).toBe(1);
    expect(target.listenerCount("SIGINT")).toBe(1);

    _forTesting_resetShutdownLifecycle();

    expect(getShutdownInstallationState()).toBe("UNINSTALLED");
    expect(isShutdownInstalled()).toBe(false);
    expect(target.listenerCount("SIGTERM")).toBe(0);
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(describeShutdownReadiness().installedAtBoot).toBe(false);
  });

  it("D10b reset is a no-op when state is already UNINSTALLED", () => {
    expect(getShutdownInstallationState()).toBe("UNINSTALLED");
    expect(() => _forTesting_resetShutdownLifecycle()).not.toThrow();
    expect(getShutdownInstallationState()).toBe("UNINSTALLED");
  });

  it("D11 thrown on() callback leaves no partial listener and no stuck INSTALLING state", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const throwingTarget: SignalTarget = {
      on(_signal, _listener) {
        throw new Error("ON_CALL_THREW");
      },
      off() { return this; },
    };

    expect(() => installShutdownLifecycle(controller, throwingTarget)).toThrow("ON_CALL_THREW");
    // State must be UNINSTALLED — not stuck in INSTALLING.
    expect(getShutdownInstallationState()).toBe("UNINSTALLED");
    expect(isShutdownInstalled()).toBe(false);
  });

  it("D16 feed activation remains REFUSED / SHUTDOWN_NOT_INSTALLED when state is not INSTALLED", async () => {
    const { evaluateFeedActivationState } = await import("./feedActivationContract.js");
    const handover = {
      currentDeploymentId: "deploy-test",
      previousDeploymentId: null,
      currentBootId: "boot-test",
      currentProcessId: process.pid,
      currentStartedAt: new Date().toISOString(),
      topologyAttested: false,
      previousDeploymentConfirmedInactive: false,
      confirmationSource: null,
      confirmationBoundToDeploymentId: null,
      confirmationBoundToBootId: null,
      confirmedAt: null,
      feedDisabledAtBoot: true,
      activationAuthorized: false,
    } as const;

    // shutdownInstalled=false (state is UNINSTALLED).
    const refused = evaluateFeedActivationState(handover, false, "RUNNING", false, false);
    expect(refused.state).toBe("REFUSED");
    expect(refused.blockerCode).toBe("SHUTDOWN_NOT_INSTALLED");

    // shutdownInstalled=true (simulates INSTALLED state to a caller).
    const cleared = evaluateFeedActivationState(handover, false, "RUNNING", false, true);
    expect(cleared.blockerCode).not.toBe("SHUTDOWN_NOT_INSTALLED");
    expect(cleared.state).not.toBe("ACTIVE" as string);
  });

  it("D17 all prior topology, authority, handover and owner-auth gates remain unchanged (source audit)", () => {
    // The feedActivationContract source must still contain all accepted gate
    // patterns — verified by string presence (structure not removed).
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/lifecycle/feedActivationContract.ts"),
      "utf8",
    );
    expect(src).toContain("TOPOLOGY_EVIDENCE_PENDING");
    expect(src).toContain("HANDOVER_CLEARANCE_PENDING");
    expect(src).toContain("OWNER_AUTHORIZATION_PENDING");
    expect(src).toContain("READY_FOR_OWNER_ACTIVATION");
    expect(src).toContain("PROOF_MODE_CANNOT_ACTIVATE_FEED");
    expect(src).toContain("DEPLOYMENT_HANDOVER_NOT_CLEARED");
  });

  it("D18 _forTesting_resetShutdownLifecycle and getShutdownInstallationState have zero production callers (source audit)", () => {
    const productionFiles = [
      "src/index.ts",
      "src/app.ts",
      "src/lib/lifecycle/feedActivationContract.ts",
      "src/lib/lifecycle/startupListenerPhase.ts",
      "src/routes/dataHealth.ts",
    ];
    for (const file of productionFiles) {
      let src: string;
      try {
        src = readFileSync(resolve(process.cwd(), file), "utf8");
      } catch {
        continue;
      }
      const code = src
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      expect(code, `${file} must not call _forTesting_resetShutdownLifecycle`).not.toContain(
        "_forTesting_resetShutdownLifecycle",
      );
      // getShutdownInstallationState is test-diagnostic only; no production caller.
      expect(code, `${file} must not call getShutdownInstallationState`).not.toContain(
        "getShutdownInstallationState",
      );
    }
  });

  it("D19 no provider, WebSocket, subscription, scheduler or DB import in gracefulShutdown.ts", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/lifecycle/gracefulShutdown.ts"),
      "utf8",
    );
    const code = src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    for (const forbidden of [
      "new WebSocket",
      "KiteTicker",
      ".subscribe(",
      ".unsubscribe(",
      "kiteconnect",
      "setInterval(",
      "drizzle",
    ]) {
      expect(code.toLowerCase(), `must not contain "${forbidden}"`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("D20 all four frozen safety locks remain false as boolean", () => {
    const lockFiles = [
      "src/lib/candleEvaluationControl.ts",
      "src/lib/v2PaperLocks.ts",
    ];
    const lockPattern = /false\s+as\s+boolean/g;
    let total = 0;
    for (const file of lockFiles) {
      total += (readFileSync(resolve(process.cwd(), file), "utf8").match(lockPattern) ?? []).length;
    }
    expect(total).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// L1–L8 — shutdown controller lifecycle (unaffected by state machine changes)
// ---------------------------------------------------------------------------

describe("P08T L1-L8 — shutdown controller lifecycle", () => {
  it("L1 SIGTERM and SIGINT each invoke shutdown exactly once", async () => {
    for (const signal of SHUTDOWN_SIGNALS) {
      let httpCloses = 0;
      let hookCalls = 0;
      const controller = createShutdownController({
        closeHttp: async () => { httpCloses += 1; },
        closeFeed: async () => { hookCalls += 1; return { closed: true, detail: "CLOSED_IN_TEST" }; },
      });
      const target = fakeSignalTarget();
      installShutdownLifecycle(controller, target);
      expect(target.listenerCount(signal)).toBe(1);

      target.emit(signal);
      const result = await controller.shutdown(signal);

      expect(hookCalls).toBe(1);
      expect(httpCloses).toBe(1);
      expect(result.signal).toBe(signal);
      expect(result.feedClose).toBe("CLOSED");
      expect(result.exitCode).toBe(0);

      // Reset between loop iterations.
      _forTesting_resetShutdownLifecycle();
      expect(target.listenerCount(signal)).toBe(0);
    }
  });

  it("L2 repeated signals do not duplicate cleanup", async () => {
    let httpCloses = 0;
    let hookCalls = 0;
    const controller = createShutdownController({
      closeHttp: async () => { httpCloses += 1; },
      closeFeed: async () => { hookCalls += 1; return { closed: true, detail: "CLOSED_IN_TEST" }; },
    });
    const target = fakeSignalTarget();
    installShutdownLifecycle(controller, target);

    target.emit("SIGTERM");
    target.emit("SIGTERM");
    target.emit("SIGINT");
    const result = await controller.shutdown("SIGTERM");

    expect(hookCalls).toBe(1);
    expect(httpCloses).toBe(1);
    expect(controller.duplicateSignalsIgnored()).toBeGreaterThanOrEqual(3);
    expect(result.phase).toBe("COMPLETE");
  });

  it("L3 feed activation is refused the instant shutdown begins", async () => {
    const hook: { release: (() => void) | null } = { release: null };
    const controller = createShutdownController({
      closeHttp: async () => {},
      closeFeed: async () =>
        new Promise((resolve) => { hook.release = () => resolve({ closed: true, detail: "CLOSED" }); }),
    });

    expect(controller.isFeedActivationPermitted()).toBe(true);
    const pending = controller.shutdown("SIGTERM");
    expect(controller.isFeedActivationPermitted()).toBe(false);
    expect(controller.phase()).toBe("SHUTTING_DOWN");
    hook.release?.();
    await pending;
    expect(controller.phase()).toBe("COMPLETE");
  });

  it("L4 the feed close hook runs before the HTTP listener is closed", async () => {
    const order: string[] = [];
    const controller = createShutdownController({
      closeFeed: async () => { order.push("feed"); return { closed: true, detail: "OK" }; },
      closeHttp: async () => { order.push("http"); },
    });
    await controller.shutdown("SIGTERM");
    expect(order).toEqual(["feed", "http"]);
  });

  it("L5 a hook failure is reported safely and never becomes success", async () => {
    let httpClosed = false;
    const controller = createShutdownController({
      closeFeed: async () => { throw new Error("socket close refused"); },
      closeHttp: async () => { httpClosed = true; },
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("HOOK_FAILED");
    expect(result.exitCode).toBe(1);
    expect(httpClosed).toBe(true);
  });

  it("L6 the wait is bounded and a timeout cannot fabricate a closed feed", async () => {
    const controller = createShutdownController({
      closeFeed: () => new Promise(() => {}),
      closeHttp: async () => {},
      feedCloseTimeoutMs: 1,
      setTimeoutFn: fireOnlyBound(1),
      clearTimeoutFn: () => {},
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("TIMEOUT");
    expect(result.exitCode).toBe(1);

    const clamped: Array<[number | undefined, number]> = [
      [0, MIN_FEED_CLOSE_TIMEOUT_MS],
      [Number.POSITIVE_INFINITY, DEFAULT_FEED_CLOSE_TIMEOUT_MS],
      [Number.NaN, DEFAULT_FEED_CLOSE_TIMEOUT_MS],
      [10 * MAX_FEED_CLOSE_TIMEOUT_MS, MAX_FEED_CLOSE_TIMEOUT_MS],
    ];
    for (const [input, expected] of clamped) {
      const detail = await createShutdownController({
        closeFeed: () => new Promise(() => {}),
        closeHttp: async () => {},
        feedCloseTimeoutMs: input,
        setTimeoutFn: fireOnlyBound(1),
        clearTimeoutFn: () => {},
      }).shutdown("SIGTERM").then((r) => r.feedCloseDetail);
      expect(detail).toBe(`FEED_CLOSE_TIMEOUT_AFTER_${expected}MS`);
    }
  });

  it("L7 the shipped hook owns nothing and says so, and no socket code exists", async () => {
    expect(await NO_OP_FEED_CLOSE_HOOK("SIGTERM")).toEqual({
      closed: false,
      detail: "NO_FEED_OWNED_PHASE_0_8T",
    });
    const result = await createShutdownController({ closeHttp: async () => {} }).shutdown("SIGTERM");
    expect(result.feedClose).toBe("NOT_OWNED");
    expect(result.exitCode).toBe(0);

    const src = readFileSync(resolve(process.cwd(), "src/lib/lifecycle/gracefulShutdown.ts"), "utf8");
    const code = src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    for (const forbidden of ["new WebSocket", "KiteTicker", ".subscribe(", ".unsubscribe(", "kiteconnect"]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    // After global afterEach reset, installedAtBoot must be false.
    const readiness = describeShutdownReadiness();
    expect(readiness.prepared).toBe(true);
    expect(readiness.feedCloseHook).toBe("NO_OP_PHASE_0_8T");
    expect(readiness.signals).toEqual(SHUTDOWN_SIGNALS);
    expect(readiness.feedCloseTimeoutMs).toBe(DEFAULT_FEED_CLOSE_TIMEOUT_MS);
    expect(readiness.installedAtBoot).toBe(false);
    expect(readiness.installationState).toBe("UNINSTALLED");
    expect(getBootId()).toBe(getBootId());
  });

  it("L8 a hanging HTTP close is bounded and reported as not closed", async () => {
    const controller = createShutdownController({
      closeFeed: async () => ({ closed: true, detail: "CLOSED_IN_TEST" }),
      closeHttp: () => new Promise(() => {}),
      httpCloseTimeoutMs: 1,
      setTimeoutFn: fireOnlyBound(2),
      clearTimeoutFn: () => {},
    });
    const result = await controller.shutdown("SIGTERM");
    expect(controller.phase()).toBe("COMPLETE");
    expect(result.feedClose).toBe("CLOSED");
    expect(result.httpClosed).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
