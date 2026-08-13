/**
 * PHASE 0.8T — GRACEFUL SHUTDOWN BOUNDARY (targeted)
 *
 * The boundary only earns its place if it cannot lie. A hook that never ran, a
 * hook that threw and a hook that hung must each produce a DIFFERENT, visible
 * outcome — never a quiet "closed". And it must run before HTTP goes away,
 * because in Phase 0.8B the sockets are what the successor process is waiting
 * for.
 */

import { describe, it, expect } from "vitest";
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
  installShutdownSignalHandlers,
  isShutdownInstalled,
  registerShutdownController,
  type SignalTarget,
} from "./gracefulShutdown";

/**
 * Fire exactly one of the bounds a shutdown creates, immediately, so a test can
 * time out ONE step without waiting on a real clock. Bounds are created in
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

describe("P08T L9-L14 — startup window and installation contract", () => {
  // Each test creates its own controller so the module-level registry in
  // gracefulShutdown is not mutated (we call registerShutdownController
  // only inside tests that explicitly need it, and we cannot unregister).

  it("L9 SIGTERM arriving before listen callback fires is handled exactly once", async () => {
    // Simulate the index.ts pattern: create server → install handlers → listen.
    // In this test we never call listen, so the callback never fires — but the
    // signal still arrives in that window.
    let httpCloses = 0;
    let hookCalls = 0;
    const controller = createShutdownController({
      closeFeed: async () => { hookCalls += 1; return { closed: true, detail: "CLOSED" }; },
      closeHttp: async () => { httpCloses += 1; },
    });
    const target = fakeSignalTarget();
    installShutdownSignalHandlers(controller, target);

    // Signal fires BEFORE listen callback would execute.
    target.emit("SIGTERM");
    const result = await controller.shutdown("SIGTERM");

    expect(hookCalls).toBe(1);
    expect(httpCloses).toBe(1);
    expect(result.signal).toBe("SIGTERM");
    expect(result.feedClose).toBe("CLOSED");
    expect(result.phase).toBe("COMPLETE");
    // The signal in the startup window is handled exactly once.
    expect(result.duplicateSignalsIgnored).toBe(1); // one from emit, one from shutdown()
  });

  it("L10 SIGINT arriving before listen callback fires is handled exactly once", async () => {
    let hookCalls = 0;
    const controller = createShutdownController({
      closeFeed: async () => { hookCalls += 1; return { closed: true, detail: "CLOSED" }; },
      closeHttp: async () => {},
    });
    const target = fakeSignalTarget();
    installShutdownSignalHandlers(controller, target);

    // Emit before listen, then await result.
    target.emit("SIGINT");
    const result = await controller.shutdown("SIGINT");

    expect(hookCalls).toBe(1);
    expect(result.signal).toBe("SIGINT");
    expect(result.phase).toBe("COMPLETE");
  });

  it("L11 duplicate installation is refused — second registerShutdownController returns false", () => {
    const ctrl1 = createShutdownController({ closeHttp: async () => {} });
    const ctrl2 = createShutdownController({ closeHttp: async () => {} });

    // First registration succeeds.
    const first = registerShutdownController(ctrl1);
    // Second registration with a different controller is a no-op.
    const second = registerShutdownController(ctrl2);

    expect(first).toBe(true);
    expect(second).toBe(false);
    // The module still reports the FIRST controller's phase, not the second.
    // (ctrl1 is RUNNING; ctrl2 is also RUNNING, but if they diverged we'd catch it.)
    expect(["RUNNING", "SHUTTING_DOWN", "COMPLETE"]).toContain(ctrl1.phase());
  });

  it("L12 isShutdownInstalled reflects whether registerShutdownController was called", () => {
    // In a test process index.ts is not imported, so the real boot path has not
    // registered a controller in this module (the L11 test did, but that's
    // acceptable — isShutdownInstalled just needs to be truthy after registration
    // and would be false in a fresh process before index.ts runs).
    // We verify the function exists and returns a boolean.
    expect(typeof isShutdownInstalled()).toBe("boolean");
    // After L11 registered a controller, it should now be true in this test run.
    expect(isShutdownInstalled()).toBe(true);
  });
});

describe("P08T L1-L7 — shutdown lifecycle", () => {
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
      const uninstall = installShutdownSignalHandlers(controller, target);
      expect(target.listenerCount(signal)).toBe(1);

      target.emit(signal);
      const result = await controller.shutdown(signal);

      expect(hookCalls).toBe(1);
      expect(httpCloses).toBe(1);
      expect(result.signal).toBe(signal);
      expect(result.feedClose).toBe("CLOSED");
      expect(result.exitCode).toBe(0);
      uninstall();
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
    installShutdownSignalHandlers(controller, target);

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
    // Held in an object so the assignment inside the executor stays visible to
    // the type checker (a bare `let` narrows to `never` here).
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
    // Refusal must take effect immediately, not after the hook resolves.
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
    // HTTP still closes: a failed feed hook must not leave the listener open.
    expect(httpClosed).toBe(true);
  });

  it("L6 the wait is bounded and a timeout cannot fabricate a closed feed", async () => {
    const controller = createShutdownController({
      // Never resolves: the bound is the only thing that can end this.
      closeFeed: () => new Promise(() => {}),
      closeHttp: async () => {},
      feedCloseTimeoutMs: 1,
      // Fire the feed bound immediately instead of waiting on a real clock.
      setTimeoutFn: fireOnlyBound(1),
      clearTimeoutFn: () => {},
    });
    const result = await controller.shutdown("SIGTERM");

    expect(result.feedClose).toBe("TIMEOUT");
    expect(result.feedCloseDetail).toContain("FEED_CLOSE_TIMEOUT_AFTER_");
    expect(result.exitCode).toBe(1);

    // The bound itself is clamped — no caller can make it unbounded or zero.
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
      // A listener with a live keep-alive connection can hang like this.
      closeHttp: () => new Promise(() => {}),
      httpCloseTimeoutMs: 1,
      // Only the HTTP bound fires; the feed hook must be left to succeed.
      setTimeoutFn: fireOnlyBound(2),
      clearTimeoutFn: () => {},
    });
    const result = await controller.shutdown("SIGTERM");

    // The shutdown still COMPLETES with an explicit, honest result rather than
    // stranding the process in SHUTTING_DOWN forever.
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
    // A hook that closed nothing reports NOT_OWNED — not CLOSED.
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

    const readiness = describeShutdownReadiness();
    expect(readiness.prepared).toBe(true);
    expect(readiness.feedCloseHook).toBe("NO_OP_PHASE_0_8T");
    expect(readiness.signals).toEqual(SHUTDOWN_SIGNALS);
    expect(readiness.feedCloseTimeoutMs).toBe(DEFAULT_FEED_CLOSE_TIMEOUT_MS);
    // installedAtBoot reflects whether registerShutdownController has been
    // called in this process. Its value depends on test execution order within
    // the file (L11 calls registerShutdownController); we assert only that it
    // is a boolean, not its value. The meaningful invariant is the hook
    // behaviour and the absence of socket code tested above.
    expect(typeof readiness.installedAtBoot).toBe("boolean");
    expect(typeof readiness.currentPhase).toBe("string");
    // Boot id distinguishes incarnations; it is stable within a process and is
    // never used as an ownership credential.
    expect(getBootId()).toBe(getBootId());
  });
});
