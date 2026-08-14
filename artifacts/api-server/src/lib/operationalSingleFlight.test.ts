/**
 * SINGLE-FLIGHT GUARD — PHASE 0.8D
 *
 * The guard makes one promise that the controlled operations depend on
 * completely: it never wedges. A leaked slot would not surface as a crash — it
 * would surface as an operation that reports "already running" forever, with no
 * timer anywhere to clear it, requiring a process restart to recover. So the
 * release paths are tested individually rather than only through the two
 * adapters, where a leak would be masked by each test constructing a fresh
 * guard.
 */

import { describe, it, expect } from "vitest";
import { SingleFlightGuard } from "./operationalSingleFlight";

const T0 = 1_700_000_000_000;

function deferred() {
  let resolveFn!: () => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

describe("SingleFlightGuard — coalescing", () => {
  it("invokes the operation exactly once for overlapping callers", async () => {
    const guard = new SingleFlightGuard<string>();
    const gate = deferred();
    let invocations = 0;

    const op = async () => {
      invocations++;
      await gate.promise;
      return "done";
    };

    const a = guard.run(T0, op);
    const b = guard.run(T0 + 5, op);
    gate.resolve();
    const [ra, rb] = await Promise.all([a, b]);

    expect(invocations).toBe(1);
    expect(ra.result).toBe("done");
    expect(rb.result).toBe("done");
    expect(ra.coalesced).toBe(false);
    expect(rb.coalesced).toBe(true);
  });

  it("reports RUNNING while in flight and IDLE once settled", async () => {
    const guard = new SingleFlightGuard<number>();
    const gate = deferred();

    expect(guard.state).toBe("IDLE");
    expect(guard.startedAt).toBeNull();

    const run = guard.run(T0, async () => {
      await gate.promise;
      return 1;
    });

    expect(guard.state).toBe("RUNNING");
    expect(guard.startedAt).toBe(T0);

    gate.resolve();
    await run;

    expect(guard.state).toBe("IDLE");
    expect(guard.startedAt).toBeNull();
  });

  it("does not coalesce runs that do not overlap", async () => {
    const guard = new SingleFlightGuard<number>();
    let invocations = 0;
    const op = async () => ++invocations;

    const first = await guard.run(T0, op);
    const second = await guard.run(T0 + 1000, op);

    expect(invocations).toBe(2);
    expect(first.coalesced).toBe(false);
    expect(second.coalesced).toBe(false);
  });
});

describe("SingleFlightGuard — the slot is released on every failure path", () => {
  it("releases after an async rejection", async () => {
    const guard = new SingleFlightGuard<number>();

    await expect(
      guard.run(T0, async () => {
        throw new Error("async failure");
      }),
    ).rejects.toThrow("async failure");

    expect(guard.state).toBe("IDLE");
    expect(guard.startedAt).toBeNull();

    // The guard is reusable, not wedged.
    const after = await guard.run(T0 + 1, async () => 42);
    expect(after.result).toBe(42);
    expect(after.coalesced).toBe(false);
  });

  it("releases after a SYNCHRONOUS throw from the operation", async () => {
    const guard = new SingleFlightGuard<number>();

    // A synchronous throw is the dangerous case: without wrapping the call in
    // an async IIFE, it would escape `run` before `finally` was ever attached,
    // leaving `inflight` set to a promise that will never settle.
    await expect(
      guard.run(T0, (): Promise<number> => {
        throw new Error("synchronous failure");
      }),
    ).rejects.toThrow("synchronous failure");

    expect(guard.state).toBe("IDLE");
    expect(guard.startedAt).toBeNull();

    const after = await guard.run(T0 + 1, async () => 7);
    expect(after.result).toBe(7);
    expect(after.coalesced).toBe(false);
  });

  it("gives a coalesced caller the same rejection as the leader, then releases", async () => {
    const guard = new SingleFlightGuard<number>();
    const gate = deferred();

    const op = async () => {
      await gate.promise;
      return 1;
    };

    const a = guard.run(T0, op);
    const b = guard.run(T0 + 1, op);
    gate.reject(new Error("shared failure"));

    // Both callers asked for that operation's outcome, so both get its failure.
    await expect(a).rejects.toThrow("shared failure");
    await expect(b).rejects.toThrow("shared failure");

    expect(guard.state).toBe("IDLE");
    const after = await guard.run(T0 + 2, async () => 99);
    expect(after.result).toBe(99);
  });

  it("survives a repeated failure without accumulating state", async () => {
    const guard = new SingleFlightGuard<number>();
    for (let i = 0; i < 5; i++) {
      await expect(
        guard.run(T0 + i, async () => {
          throw new Error(`failure ${i}`);
        }),
      ).rejects.toThrow(`failure ${i}`);
      expect(guard.state).toBe("IDLE");
    }
    const after = await guard.run(T0 + 10, async () => 5);
    expect(after.coalesced).toBe(false);
    expect(after.result).toBe(5);
  });
});

describe("SingleFlightGuard — test-only reset", () => {
  it("clears a stuck slot", async () => {
    const guard = new SingleFlightGuard<number>();
    const gate = deferred();
    const run = guard.run(T0, async () => {
      await gate.promise;
      return 1;
    });

    expect(guard.state).toBe("RUNNING");
    guard.__resetForTests();
    expect(guard.state).toBe("IDLE");
    expect(guard.startedAt).toBeNull();

    gate.resolve();
    await run;
  });
});
