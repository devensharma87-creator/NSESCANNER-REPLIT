/**
 * PHASE 0.8T — GRACEFUL SHUTDOWN BOUNDARY (targeted)
 *
 * The boundary only earns its place if it cannot lie. A hook that never ran, a
 * hook that threw and a hook that hung must each produce a DIFFERENT, visible
 * outcome — never a quiet "closed". And it must run before HTTP goes away,
 * because in Phase 0.8B the sockets are what the successor process is waiting
 * for.
 *
 * Test isolation: every test that touches module-level installation state uses
 * _forTesting_resetShutdownLifecycle(). A global afterEach at file scope calls
 * it unconditionally so even a failing test cannot leak state.
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
  installShutdownLifecycle,
  isShutdownInstalled,
  _forTesting_resetShutdownLifecycle,
  type SignalTarget,
} from "./gracefulShutdown";

// ---------------------------------------------------------------------------
// Global afterEach: unconditionally reset module state after every test so
// a failing test cannot contaminate a later test's baseline assertion.
// ---------------------------------------------------------------------------
afterEach(() => {
  _forTesting_resetShutdownLifecycle();
});

// ---------------------------------------------------------------------------
// Helpers shared across groups
// ---------------------------------------------------------------------------

/**
 * Fire exactly one of the bounds a shutdown creates, immediately, so a test
 * can time out ONE step without waiting on a real clock. Bounds are created in
 * order: 1 = the feed-close bound, 2 = the HTTP-close bound.
 */
function fireOnlyBound(index: 1 | 2): (fn: () => void) => unknown {
  let created = 0;
  return (fn) => {
    created += 1;
    if (created === index) queueMicrotask(fn);
    return created;
  };
}

/** A minimal stand-in for `process` that records what was registered. */
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
      const list = (listeners.get(signal) ?? []).filter((l) => l !== listener);
      listeners.set(signal, list);
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

/**
 * A signal target whose on() throws on the second signal registered, simulating
 * a partial installation failure (SIGTERM succeeds, SIGINT throws).
 */
function partiallyFailingTarget(): SignalTarget & {
  listenerCount: (signal: string) => number;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let callCount = 0;
  return {
    on(signal, listener) {
      callCount += 1;
      if (callCount >= 2) throw new Error(`SIMULATED_ON_FAILURE for ${signal}`);
      const list = listeners.get(signal) ?? [];
      list.push(listener);
      listeners.set(signal, list);
      return this;
    },
    off(signal, listener) {
      const list = (listeners.get(signal) ?? []).filter((l) => l !== listener);
      listeners.set(signal, list);
      return this;
    },
    listenerCount(signal) {
      return (listeners.get(signal) ?? []).length;
    },
  };
}

// ---------------------------------------------------------------------------
// D1–D17 — Atomic installation invariants
// ---------------------------------------------------------------------------

describe("P08T D1-D17 — atomic installation invariants", () => {
  it("D1 clean baseline: isShutdownInstalled() is false before any installation", () => {
    // afterEach resets after every test, so every test starts with a clean slate.
    expect(isShutdownInstalled()).toBe(false);
    const readiness = describeShutdownReadiness();
    expect(readiness.installedAtBoot).toBe(false);
  });

  it("D2 first installation returns INSTALLED and readiness becomes true", () => {
    expect(isShutdownInstalled()).toBe(false);
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = fakeSignalTarget();

    const result = installShutdownLifecycle(controller, target);

    expect(result).toBe("INSTALLED");
    expect(isShutdownInstalled()).toBe(true);
    expect(describeShutdownReadiness().installedAtBoot).toBe(true);
  });

  it("D3 first installation adds exactly one SIGTERM listener and one SIGINT listener", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = fakeSignalTarget();

    expect(target.listenerCount("SIGTERM")).toBe(0);
    expect(target.listenerCount("SIGINT")).toBe(0);

    installShutdownLifecycle(controller, target);

    expect(target.listenerCount("SIGTERM")).toBe(1);
    expect(target.listenerCount("SIGINT")).toBe(1);
  });

  it("D4 second installation returns ALREADY_INSTALLED and listener counts remain unchanged", () => {
    const ctrl1 = createShutdownController({ closeHttp: async () => {} });
    const ctrl2 = createShutdownController({ closeHttp: async () => {} });
    const target1 = fakeSignalTarget();
    const target2 = fakeSignalTarget();

    const first = installShutdownLifecycle(ctrl1, target1);
    const second = installShutdownLifecycle(ctrl2, target2);

    expect(first).toBe("INSTALLED");
    expect(second).toBe("ALREADY_INSTALLED");
    // Original target has its original single listener per signal.
    expect(target1.listenerCount("SIGTERM")).toBe(1);
    expect(target1.listenerCount("SIGINT")).toBe(1);
    // Second target was not touched — ALREADY_INSTALLED has zero side effects.
    expect(target2.listenerCount("SIGTERM")).toBe(0);
    expect(target2.listenerCount("SIGINT")).toBe(0);
  });

  it("D5 second installation does not replace the first controller", () => {
    const ctrl1 = createShutdownController({ closeHttp: async () => {} });
    const ctrl2 = createShutdownController({ closeHttp: async () => {} });
    const target = fakeSignalTarget();

    installShutdownLifecycle(ctrl1, target);
    installShutdownLifecycle(ctrl2, target);

    // The installed controller is still ctrl1; ctrl1 phase governs.
    // Both are RUNNING so we verify by triggering ctrl2.shutdown and confirming
    // that the module-level phase still reflects the first controller.
    const readiness = describeShutdownReadiness();
    expect(readiness.currentPhase).toBe("RUNNING"); // ctrl1 hasn't shut down
    // ctrl2 shutting down must not change installed phase.
    void ctrl2.shutdown("SIGTERM");
    // Phase is still reported from ctrl1 (RUNNING), not ctrl2 (SHUTTING_DOWN).
    expect(describeShutdownReadiness().currentPhase).toBe("RUNNING");
  });

  it("D6 SIGTERM in the startup window is handled exactly once", async () => {
    let hookCalls = 0;
    let httpCloses = 0;
    const controller = createShutdownController({
      closeFeed: async () => { hookCalls += 1; return { closed: true, detail: "CLOSED" }; },
      closeHttp: async () => { httpCloses += 1; },
    });
    const target = fakeSignalTarget();
    installShutdownLifecycle(controller, target);

    // Signal fires in the startup window (before listen callback would fire).
    target.emit("SIGTERM");
    const result = await controller.shutdown("SIGTERM");

    expect(hookCalls).toBe(1);
    expect(httpCloses).toBe(1);
    expect(result.signal).toBe("SIGTERM");
    expect(result.feedClose).toBe("CLOSED");
    expect(result.phase).toBe("COMPLETE");
    // The emit and the direct .shutdown() call both trigger it; controller
    // deduplicates — hook ran once, one duplicate recorded.
    expect(result.duplicateSignalsIgnored).toBe(1);
  });

  it("D7 SIGINT in the startup window is handled exactly once", async () => {
    let hookCalls = 0;
    const controller = createShutdownController({
      closeFeed: async () => { hookCalls += 1; return { closed: true, detail: "CLOSED" }; },
      closeHttp: async () => {},
    });
    const target = fakeSignalTarget();
    installShutdownLifecycle(controller, target);

    target.emit("SIGINT");
    const result = await controller.shutdown("SIGINT");

    expect(hookCalls).toBe(1);
    expect(result.signal).toBe("SIGINT");
    expect(result.phase).toBe("COMPLETE");
    expect(result.duplicateSignalsIgnored).toBe(1);
  });

  it("D8 SIGTERM followed by SIGINT executes shutdown exactly once", async () => {
    let hookCalls = 0;
    let httpCloses = 0;
    const controller = createShutdownController({
      closeFeed: async () => { hookCalls += 1; return { closed: true, detail: "CLOSED" }; },
      closeHttp: async () => { httpCloses += 1; },
    });
    const target = fakeSignalTarget();
    installShutdownLifecycle(controller, target);

    target.emit("SIGTERM");
    target.emit("SIGINT");
    target.emit("SIGTERM");
    const result = await controller.shutdown("SIGTERM");

    expect(hookCalls).toBe(1);
    expect(httpCloses).toBe(1);
    expect(controller.duplicateSignalsIgnored()).toBeGreaterThanOrEqual(3);
    expect(result.phase).toBe("COMPLETE");
  });

  it("D9 partial installation failure removes already-added listeners and leaves readiness false", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = partiallyFailingTarget();

    // SIGTERM registration succeeds, SIGINT throws → rollback expected.
    expect(() => installShutdownLifecycle(controller, target)).toThrow("SIMULATED_ON_FAILURE");

    // isShutdownInstalled must be false: the partial install was rolled back.
    expect(isShutdownInstalled()).toBe(false);
    // SIGTERM listener that was installed must have been removed in rollback.
    expect(target.listenerCount("SIGTERM")).toBe(0);
  });

  it("D10 server.listen is positioned after installShutdownLifecycle in index.ts (source audit)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    // Use the call-site pattern (with opening paren) to skip any comment
    // references. "server.listen(port" is unique to the actual listen call.
    const installIdx = src.indexOf("installShutdownLifecycle(");
    const listenIdx = src.indexOf("server.listen(port");
    expect(installIdx).toBeGreaterThan(0);
    expect(listenIdx).toBeGreaterThan(0);
    // server.listen(port must come after installShutdownLifecycle(.
    expect(listenIdx).toBeGreaterThan(installIdx);
    // A fail-closed check on ALREADY_INSTALLED must appear between them.
    const between = src.slice(installIdx, listenIdx);
    expect(between).toContain("ALREADY_INSTALLED");
    // The fail-closed path must call process.exit before server.listen.
    expect(between).toContain("process.exit");
  });

  it("D11 SHUTDOWN_INSTALLED proof marker is recorded after installation and before server.listen (source audit)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    const installIdx = src.indexOf("installShutdownLifecycle(");
    const listenIdx = src.indexOf("server.listen(port");
    const between = src.slice(installIdx, listenIdx);
    // The proof marker must be between installation and listen.
    expect(between).toContain("SHUTDOWN_INSTALLED");
  });

  it("D12 feed activation before installation returns REFUSED / SHUTDOWN_NOT_INSTALLED", async () => {
    // Dynamically import feedActivationContract so this test stays targeted.
    const { evaluateFeedActivationState } = await import("./feedActivationContract");
    // Minimal handover evidence — feedDisabledAtBoot=true is the Phase 0.8T constant.
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
    // Signature: (handover, topologyReady, shutdownPhase, proofMode, shutdownInstalled)
    const assessment = evaluateFeedActivationState(handover, false, "RUNNING", false, false);
    expect(assessment.state).toBe("REFUSED");
    expect(assessment.blockerCode).toBe("SHUTDOWN_NOT_INSTALLED");
  });

  it("D13 successful lifecycle installation clears only the lifecycle prerequisite; other gates still apply", async () => {
    const { evaluateFeedActivationState } = await import("./feedActivationContract");
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
    // shutdownInstalled=true clears the lifecycle gate; topology is still missing.
    const assessment = evaluateFeedActivationState(handover, false, "RUNNING", false, true);
    // SHUTDOWN_NOT_INSTALLED is no longer the blocker.
    expect(assessment.blockerCode).not.toBe("SHUTDOWN_NOT_INSTALLED");
    // Topology gate now fires instead.
    expect(assessment.state).toBe("TOPOLOGY_EVIDENCE_PENDING");
    // ACTIVE is never reached.
    expect(assessment.state).not.toBe("ACTIVE" as string);
  });

  it("D14 _forTesting_resetShutdownLifecycle restores listener counts and clears module state", () => {
    const controller = createShutdownController({ closeHttp: async () => {} });
    const target = fakeSignalTarget();

    installShutdownLifecycle(controller, target);
    expect(isShutdownInstalled()).toBe(true);
    expect(target.listenerCount("SIGTERM")).toBe(1);
    expect(target.listenerCount("SIGINT")).toBe(1);

    _forTesting_resetShutdownLifecycle();

    expect(isShutdownInstalled()).toBe(false);
    expect(target.listenerCount("SIGTERM")).toBe(0);
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(describeShutdownReadiness().installedAtBoot).toBe(false);
  });

  it("D14b _forTesting_resetShutdownLifecycle is a no-op when nothing is installed", () => {
    expect(isShutdownInstalled()).toBe(false);
    // Must not throw.
    expect(() => _forTesting_resetShutdownLifecycle()).not.toThrow();
    expect(isShutdownInstalled()).toBe(false);
  });

  it("D15 _forTesting_resetShutdownLifecycle has zero production callers (source audit)", () => {
    // Do NOT include gracefulShutdown.ts itself — that is where the function
    // is defined (the name appears as the function declaration). We only scan
    // callers outside the definition file.
    const productionFiles = [
      "src/index.ts",
      "src/app.ts",
      "src/lib/lifecycle/feedActivationContract.ts",
      "src/routes/dataHealth.ts",
    ];
    for (const file of productionFiles) {
      let src: string;
      try {
        src = readFileSync(resolve(process.cwd(), file), "utf8");
      } catch {
        continue; // file absent — skip
      }
      // Remove comments before checking to avoid false positives in docs.
      const code = src
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      expect(code, `${file} must not call _forTesting_resetShutdownLifecycle`).not.toContain(
        "_forTesting_resetShutdownLifecycle",
      );
    }
  });

  it("D16 no provider, WebSocket, subscription, scheduler, or DB import in gracefulShutdown.ts", () => {
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
      // setInterval = module-level recurring timer (banned). setTimeout is used
      // legitimately as the injected default for the bounded-race helper; only
      // direct setInterval calls are banned here.
      "setInterval(",
      "drizzle",
    ]) {
      expect(code.toLowerCase(), `gracefulShutdown.ts must not contain ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("D17 all four frozen safety locks remain false as boolean", () => {
    // The four locks live in candleEvaluationControl.ts (2) and v2PaperLocks.ts (2).
    const lockFiles = [
      "src/lib/candleEvaluationControl.ts",
      "src/lib/v2PaperLocks.ts",
    ];
    const lockPattern = /false\s+as\s+boolean/g;
    let totalMatches = 0;
    for (const file of lockFiles) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      totalMatches += (src.match(lockPattern) ?? []).length;
    }
    // Two per file = four total; none may be removed or flipped to true.
    expect(totalMatches).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// L1–L8 — shutdown controller lifecycle
// ---------------------------------------------------------------------------

describe("P08T L1-L8 — shutdown controller lifecycle", () => {
  it("L1 SIGTERM and SIGINT each invoke shutdown exactly once", async () => {
    for (const signal of SHUTDOWN_SIGNALS) {
      let httpCloses = 0;
      let hookCalls = 0;
      const controller = createShutdownController({
        closeHttp: async () => {
          httpCloses += 1;
        },
        closeFeed: async () => {
          hookCalls += 1;
          return { closed: true, detail: "CLOSED_IN_TEST" };
        },
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

      // Reset between loop iterations so the second signal gets a fresh install.
      _forTesting_resetShutdownLifecycle();
      expect(target.listenerCount(signal)).toBe(0);
    }
  });

  it("L2 repeated signals do not duplicate cleanup", async () => {
    let httpCloses = 0;
    let hookCalls = 0;
    const controller = createShutdownController({
      closeHttp: async () => {
        httpCloses += 1;
      },
      closeFeed: async () => {
        hookCalls += 1;
        return { closed: true, detail: "CLOSED_IN_TEST" };
      },
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
        new Promise((resolve) => {
          hook.release = () => resolve({ closed: true, detail: "CLOSED_IN_TEST" });
        }),
    });

    expect(controller.isFeedActivationPermitted()).toBe(true);
    expect(controller.phase()).toBe("RUNNING");

    const pending = controller.shutdown("SIGTERM");
    expect(controller.isFeedActivationPermitted()).toBe(false);
    expect(controller.phase()).toBe("SHUTTING_DOWN");

    hook.release?.();
    await pending;
    expect(controller.isFeedActivationPermitted()).toBe(false);
    expect(controller.phase()).toBe("COMPLETE");
  });

  it("L4 the feed close hook runs before the HTTP listener is closed", async () => {
    const order: string[] = [];
    const controller = createShutdownController({
      closeFeed: async () => {
        order.push("feed");
        return { closed: true, detail: "CLOSED_IN_TEST" };
      },
      closeHttp: async () => {
        order.push("http");
      },
    });
    await controller.shutdown("SIGTERM");
    expect(order).toEqual(["feed", "http"]);
  });

  it("L5 a hook failure is reported safely and never becomes success", async () => {
    let httpClosed = false;
    const controller = createShutdownController({
      closeFeed: async () => {
        throw new Error("socket close refused");
      },
      closeHttp: async () => {
        httpClosed = true;
      },
    });
    const result = await controller.shutdown("SIGTERM");

    expect(result.feedClose).toBe("HOOK_FAILED");
    expect(result.feedCloseDetail).toContain("FEED_CLOSE_HOOK_FAILED");
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
    expect(result.feedCloseDetail).toContain("FEED_CLOSE_TIMEOUT_AFTER_");
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
      })
        .shutdown("SIGTERM")
        .then((r) => r.feedCloseDetail);
      expect(detail).toBe(`FEED_CLOSE_TIMEOUT_AFTER_${expected}MS`);
    }
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
    expect(result.httpCloseError).toBe(`HTTP_CLOSE_TIMEOUT_AFTER_${MIN_FEED_CLOSE_TIMEOUT_MS}MS`);
    expect(result.exitCode).toBe(1);
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
    const code = src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    for (const forbidden of ["new WebSocket", "KiteTicker", ".subscribe(", ".unsubscribe(", "kiteconnect"]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    // After global afterEach reset, installedAtBoot must be false.
    // We verify that by checking the readiness value immediately — since afterEach
    // already ran before this test (from any prior test), and D14 proves reset works.
    const readiness = describeShutdownReadiness();
    expect(readiness.prepared).toBe(true);
    expect(readiness.feedCloseHook).toBe("NO_OP_PHASE_0_8T");
    expect(readiness.signals).toEqual(SHUTDOWN_SIGNALS);
    expect(readiness.feedCloseTimeoutMs).toBe(DEFAULT_FEED_CLOSE_TIMEOUT_MS);
    // installedAtBoot is false because afterEach reset module state after the
    // previous test, and this test has not called installShutdownLifecycle.
    expect(readiness.installedAtBoot).toBe(false);
    expect(typeof readiness.currentPhase).toBe("string");
    expect(getBootId()).toBe(getBootId());
  });
});
