/**
 * PHASE 0.8T — STARTUP LISTENER PHASE (behavioural targeted tests)
 *
 * Proves behaviourally (not by source-position scanning) that:
 *   - server.listen is called zero times when lifecycle installation throws.
 *   - server.listen is called zero times when installation is refused.
 *   - On success the exact call order is:
 *       installLifecycle → proofMark("SHUTDOWN_INSTALLED") → server.listen
 *                        → (inside callback) proofMark("LISTENING")
 *   - The listen callback cannot run before isShutdownInstalled() is true.
 *   - No provider, feed, scheduler, or database import is reachable through
 *     the startup seam.
 *
 * Uses runStartupListenerPhase — the SAME function called by index.ts.
 * No logic is reproduced in the test.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runStartupListenerPhase } from "./startupListenerPhase.js";
import {
  createShutdownController,
  installShutdownLifecycle,
  isShutdownInstalled,
  _forTesting_resetShutdownLifecycle,
  type SignalTarget,
} from "./gracefulShutdown.js";

afterEach(() => {
  _forTesting_resetShutdownLifecycle();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakePlainTarget(): SignalTarget {
  return {
    on() { return this; },
    off() { return this; },
  };
}

function makeController() {
  return createShutdownController({ closeHttp: async () => {} });
}

/**
 * A fake server that records listen calls synchronously — the listen callback
 * fires immediately inside listen() so tests can observe ordering without
 * async scheduling.
 */
function fakeSyncServer(): {
  server: { listen(port: number, cb: (err?: Error) => void): void };
  listenCallCount: () => number;
  listenPorts: () => number[];
} {
  const ports: number[] = [];
  return {
    server: {
      listen(port, cb) {
        ports.push(port);
        cb(); // fire callback synchronously
      },
    },
    listenCallCount: () => ports.length,
    listenPorts: () => [...ports],
  };
}

// ---------------------------------------------------------------------------
// D12 — installation throw → listen zero times
// ---------------------------------------------------------------------------

describe("P08T D12 — installation throw → listen never called", () => {
  it("D12 when installLifecycle throws, server.listen is called zero times", () => {
    const fake = fakeSyncServer();
    const errors: string[] = [];
    const events: string[] = [];

    runStartupListenerPhase({
      installLifecycle: () => { throw new Error("SIMULATED_INSTALL_FAILURE"); },
      proofMark: (event) => events.push(event),
      server: fake.server,
      port: 9999,
      onStartupError: (msg) => errors.push(msg),
    });

    expect(fake.listenCallCount()).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("SIMULATED_INSTALL_FAILURE");
    // proofMark must never have fired — installation did not succeed.
    expect(events).toHaveLength(0);
  });

  it("D12b error message is forwarded verbatim to onStartupError", () => {
    const errors: string[] = [];
    runStartupListenerPhase({
      installLifecycle: () => { throw new Error("SPECIFIC_ERROR_TEXT"); },
      proofMark: () => {},
      server: fakeSyncServer().server,
      port: 1,
      onStartupError: (msg) => errors.push(msg),
    });
    expect(errors[0]).toContain("SPECIFIC_ERROR_TEXT");
    expect(errors[0]).toContain("SHUTDOWN_LIFECYCLE_INSTALLATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// D13 — ALREADY_INSTALLED refusal → listen zero times
// ---------------------------------------------------------------------------

describe("P08T D13 — ALREADY_INSTALLED → listen never called", () => {
  it("D13 when installLifecycle returns ALREADY_INSTALLED, server.listen is called zero times", () => {
    const fake = fakeSyncServer();
    const errors: string[] = [];
    const events: string[] = [];

    runStartupListenerPhase({
      installLifecycle: () => "ALREADY_INSTALLED",
      proofMark: (event) => events.push(event),
      server: fake.server,
      port: 9999,
      onStartupError: (msg) => errors.push(msg),
    });

    expect(fake.listenCallCount()).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ALREADY_INSTALLED");
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D14 — success → exact call order observed
// ---------------------------------------------------------------------------

describe("P08T D14 — successful install → observed call order", () => {
  it("D14 call order: installLifecycle → SHUTDOWN_INSTALLED → server.listen → LISTENING", () => {
    const events: string[] = [];
    const errors: string[] = [];
    const controller = makeController();
    const target = fakePlainTarget();

    runStartupListenerPhase({
      installLifecycle: () => {
        events.push("installLifecycle");
        return installShutdownLifecycle(controller, target);
      },
      proofMark: (event) => events.push(`proofMark:${event}`),
      server: {
        listen(_port, cb) {
          events.push("server.listen");
          cb(); // synchronous — fires the callback immediately
        },
      },
      port: 3000,
      onStartupError: (msg) => errors.push(msg),
    });

    expect(errors).toHaveLength(0);
    expect(events).toEqual([
      "installLifecycle",
      "proofMark:SHUTDOWN_INSTALLED",
      "server.listen",
      "proofMark:LISTENING",
    ]);
  });

  it("D14b the proof marker SHUTDOWN_INSTALLED fires before server.listen is called", () => {
    const order: string[] = [];
    const controller = makeController();
    const target = fakePlainTarget();
    let markedBeforeListen = false;

    runStartupListenerPhase({
      installLifecycle: () => installShutdownLifecycle(controller, target),
      proofMark: (event) => {
        if (event === "SHUTDOWN_INSTALLED") order.push("marker");
      },
      server: {
        listen(_port, cb) {
          markedBeforeListen = order.includes("marker");
          cb();
        },
      },
      port: 3000,
      onStartupError: () => {},
    });

    expect(markedBeforeListen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D15 — listening callback cannot run before isShutdownInstalled() is true
// ---------------------------------------------------------------------------

describe("P08T D15 — lifecycle readiness true before listen callback fires", () => {
  it("D15 isShutdownInstalled() is true inside the server.listen callback", () => {
    let readinessDuringCallback: boolean | null = null;
    const controller = makeController();
    const target = fakePlainTarget();

    runStartupListenerPhase({
      installLifecycle: () => installShutdownLifecycle(controller, target),
      proofMark: () => {},
      server: {
        listen(_port, cb) {
          // The listen callback fires here; installation must already be complete.
          readinessDuringCallback = isShutdownInstalled();
          cb();
        },
      },
      port: 3000,
      onStartupError: () => {},
    });

    expect(readinessDuringCallback).toBe(true);
  });

  it("D15b isShutdownInstalled() is false when installation was refused (listen never fires)", () => {
    let callbackFired = false;
    runStartupListenerPhase({
      installLifecycle: () => "ALREADY_INSTALLED",
      proofMark: () => {},
      server: {
        listen(_port, cb) {
          callbackFired = true;
          cb();
        },
      },
      port: 3000,
      onStartupError: () => {},
    });
    // listen was never called, so callback never fired.
    expect(callbackFired).toBe(false);
    // isShutdownInstalled is false (no controller was actually installed by the refused call).
    expect(isShutdownInstalled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Startup seam purity — no provider/feed/scheduler/DB dependency
// ---------------------------------------------------------------------------

describe("P08T startup seam purity", () => {
  it("startupListenerPhase.ts imports only lifecycle types — no provider, feed or DB", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/lifecycle/startupListenerPhase.ts"),
      "utf8",
    );
    // Extract import lines only.
    const importLines = src
      .split(/\r?\n/)
      .filter((l) => /^\s*import/.test(l))
      .join("\n")
      .toLowerCase();

    for (const forbidden of [
      "kiteconnect",
      "kiteticker",
      "websocket",
      "drizzle",
      "pg",
      "database",
      "scheduler",
      "feed",
      "candle",
      "indicator",
      "instrument",
      "registry",
      "deployment",
    ]) {
      expect(importLines, `startupListenerPhase.ts must not import "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
    // Must import from gracefulShutdown for the lifecycle type.
    expect(src).toContain("gracefulShutdown");
  });

  it("index.ts calls runStartupListenerPhase — the same function the tests use", () => {
    const src = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    expect(src).toContain("runStartupListenerPhase");
    expect(src).toContain("startupListenerPhase");
    // Old inline try/catch is gone; direct installShutdownLifecycle call in index is gone.
    expect(src).not.toContain("ALREADY_INSTALLED_BEFORE_BOOT");
  });
});
