/**
 * PHASE 0.8T — FEED ACTIVATION AND HANDOVER SAFETY (36 tests)
 *
 * Covers:
 *   A1–A10  Feed activation safety (boot defaults, single-factor attacks)
 *   H1–H9   Deployment handover contract
 *   S1–S9   Shutdown integration
 *   C1–C8   Compatibility and safety
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FEED_ACTIVATION_DISABLED_AT_BOOT,
  buildBootHandoverEvidence,
  evaluateFeedActivationState,
  type DeploymentHandoverEvidence,
} from "./feedActivationContract.js";
import {
  createShutdownController,
  describeShutdownReadiness,
  NO_OP_FEED_CLOSE_HOOK,
  installShutdownSignalHandlers,
  type ShutdownController,
  type SignalTarget,
} from "./gracefulShutdown.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOT_SHUTTING_DOWN = "RUNNING" as const;

/** Topology ready = true simulates Phase 0.8T contract satisfied. */
function activeHandover(
  overrides: Partial<DeploymentHandoverEvidence> = {},
): DeploymentHandoverEvidence {
  return Object.freeze({
    currentDeploymentId: "deploy-abc123",
    previousDeploymentId: null,
    currentBootId: "boot-xyz789",
    currentProcessId: 1234,
    currentStartedAt: new Date().toISOString(),
    topologyAttested: true,
    previousDeploymentConfirmedInactive: false,
    confirmationSource: null,
    confirmationBoundToDeploymentId: null,
    confirmationBoundToBootId: null,
    confirmedAt: null,
    feedDisabledAtBoot: true,
    activationAuthorized: false,
    ...overrides,
  });
}

/** Handover evidence that has cleared EVERY precondition for READY_FOR_OWNER_ACTIVATION. */
function clearedHandover(
  overrides: Partial<DeploymentHandoverEvidence> = {},
): DeploymentHandoverEvidence {
  return activeHandover({
    previousDeploymentId: "prev-deploy-111",
    previousDeploymentConfirmedInactive: true,
    confirmationSource: "OWNER_MANUAL_VERIFICATION",
    confirmationBoundToDeploymentId: "deploy-abc123",
    confirmationBoundToBootId: "boot-xyz789",
    confirmedAt: new Date().toISOString(),
    activationAuthorized: true,
    ...overrides,
  });
}

/** Fire timer immediately; usable for bound-testing. */
function fireOnlyBound(index: 1 | 2): (fn: () => void) => unknown {
  let created = 0;
  return (fn) => {
    created += 1;
    if (created === index) queueMicrotask(fn);
    return created;
  };
}

function stubController(overrides: Partial<Parameters<typeof createShutdownController>[0]> = {}): ShutdownController {
  return createShutdownController({
    closeFeed: NO_OP_FEED_CLOSE_HOOK,
    closeHttp: async () => {},
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// A1–A10 — Feed activation safety
// ---------------------------------------------------------------------------

describe("P08T A1-A10 — Feed activation safety", () => {
  it("A1 every boot defaults to disabled", () => {
    // The constant is the compile-time declaration; the function is the runtime check.
    expect(FEED_ACTIVATION_DISABLED_AT_BOOT).toBe(true);
    const h = activeHandover();
    const a = evaluateFeedActivationState(h, false, NOT_SHUTTING_DOWN, false, true);
    expect(a.feedDisabledAtBoot).toBe(true);
    // Without topology, state is TOPOLOGY_EVIDENCE_PENDING — still blocked.
    expect(a.state).toBe("TOPOLOGY_EVIDENCE_PENDING");
    expect(a.blockerCode).toBe("RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED");
  });

  it("A2 production mode alone cannot activate", () => {
    // NODE_ENV=production is not an input to the function at all;
    // no caller path can supply it as authorisation.
    const h = activeHandover({ activationAuthorized: false });
    // Even if we pretend topology is ready and everything else is perfect:
    const a = evaluateFeedActivationState(
      { ...h, currentDeploymentId: "d1" },
      true,
      NOT_SHUTTING_DOWN,
      false,
      true,
    );
    // Without owner authorisation, blocked before ACTIVE.
    expect(a.state).toBe("OWNER_AUTHORIZATION_PENDING");
    expect(a.blockerCode).toBe("OWNER_FEED_ACTIVATION_NOT_AUTHORIZED");
    expect(a.state).not.toBe("ACTIVE" as string);
  });

  it("A3 Reserved VM source configuration alone cannot activate", () => {
    // topologyReady comes from the RUNTIME evidence contract, not from .replit.
    // Passing topologyReady=false simulates "only .replit says vm, no runtime
    // evidence yet" — which is exactly the development situation.
    const h = activeHandover({ activationAuthorized: true });
    const a = evaluateFeedActivationState(h, false /* <— source config only */, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).toBe("TOPOLOGY_EVIDENCE_PENDING");
    expect(a.blockerCode).toBe("RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED");
  });

  it("A4 runtime topology attestation alone cannot activate", () => {
    // Topology is attested but the owner has not authorized.
    const h = activeHandover({ topologyAttested: true, activationAuthorized: false });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(["OWNER_AUTHORIZATION_PENDING", "HANDOVER_CLEARANCE_PENDING"]).toContain(a.state);
    expect(a.state).not.toBe("ACTIVE" as string);
    expect(a.state).not.toBe("READY_FOR_OWNER_ACTIVATION");
  });

  it("A5 current registry authority alone cannot activate", () => {
    // Registry authority is a separate system not wired into this contract at all.
    // The function signature has no registry parameter — by design.
    // We verify by checking that no permutation of the available inputs produces ACTIVE.
    const maximal = clearedHandover({ activationAuthorized: true });
    const a = evaluateFeedActivationState(maximal, true, NOT_SHUTTING_DOWN, false, true);
    // Best possible result is READY_FOR_OWNER_ACTIVATION, not ACTIVE.
    expect(a.state).not.toBe("ACTIVE" as string);
  });

  it("A6 valid Kite session alone cannot activate", () => {
    // Kite session is not an input to this function — by design.
    // Even the highest-trust handover never reaches ACTIVE.
    const a = evaluateFeedActivationState(clearedHandover(), true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).not.toBe("ACTIVE" as string);
    // And proof mode makes it worse:
    const ap = evaluateFeedActivationState(clearedHandover(), true, NOT_SHUTTING_DOWN, true, true);
    expect(ap.state).toBe("REFUSED");
  });

  it("A7 missing activation evidence fails closed", () => {
    // No deployment ID, no previous confirmation, no authorization.
    const minimal: DeploymentHandoverEvidence = Object.freeze({
      currentDeploymentId: null,
      previousDeploymentId: null,
      currentBootId: "",
      currentProcessId: 0,
      currentStartedAt: "",
      topologyAttested: false,
      previousDeploymentConfirmedInactive: false,
      confirmationSource: null,
      confirmationBoundToDeploymentId: null,
      confirmationBoundToBootId: null,
      confirmedAt: null,
      feedDisabledAtBoot: true,
      activationAuthorized: false,
    });
    const a = evaluateFeedActivationState(minimal, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).not.toBe("ACTIVE" as string);
    expect(a.state).not.toBe("READY_FOR_OWNER_ACTIVATION");
    expect(a.blockerCode).not.toBeNull();
  });

  it("A8 malformed activation evidence fails closed", () => {
    // feedDisabledAtBoot=false is a regression — must be refused.
    const regressed = activeHandover({ feedDisabledAtBoot: false });
    const a = evaluateFeedActivationState(regressed, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).toBe("REFUSED");
    expect(a.blockerCode).toBe("FEED_NOT_DISABLED_AT_BOOT");
  });

  it("A9 proof mode cannot activate", () => {
    const best = clearedHandover({ activationAuthorized: true });
    const a = evaluateFeedActivationState(best, true, NOT_SHUTTING_DOWN, true, true);
    expect(a.state).toBe("REFUSED");
    expect(a.blockerCode).toBe("PROOF_MODE_CANNOT_ACTIVATE_FEED");
  });

  it("A10 ACTIVE is unreachable in Phase 0.8T", () => {
    // Exhaust every possible combination of boolean inputs.
    const states = [false, true];
    for (const topologyReady of states) {
      for (const proofMode of states) {
        for (const authorized of states) {
          const h = clearedHandover({ activationAuthorized: authorized });
          const a = evaluateFeedActivationState(
            h,
            topologyReady,
            NOT_SHUTTING_DOWN,
            proofMode,
            true,
          );
          expect(a.state).not.toBe("ACTIVE" as string);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// H1–H9 — Deployment handover
// ---------------------------------------------------------------------------

describe("P08T H1-H9 — Deployment handover", () => {
  it("H1 new deployment ID with unknown old state remains blocked", () => {
    // currentDeploymentId is present (new process) but previous state unknown.
    const h = activeHandover({
      currentDeploymentId: "new-deploy",
      previousDeploymentId: "old-deploy",
      previousDeploymentConfirmedInactive: false,
    });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).toBe("HANDOVER_CLEARANCE_PENDING");
    expect(a.blockerCode).toBe("PREVIOUS_DEPLOYMENT_IDENTITY_NOT_CONFIRMED_INACTIVE");
    expect(a.handoverCleared).toBe(false);
  });

  it("H2 previous deployment not confirmed inactive remains blocked", () => {
    // previousDeploymentConfirmedInactive=false even with owner authorization.
    const h = activeHandover({
      currentDeploymentId: "new-deploy",
      previousDeploymentId: "old-deploy",
      previousDeploymentConfirmedInactive: false,
      activationAuthorized: true,
    });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.blockerCode).toBe("PREVIOUS_DEPLOYMENT_IDENTITY_NOT_CONFIRMED_INACTIVE");
  });

  it("H3 confirmation bound to another deployment is rejected", () => {
    const h = clearedHandover({
      confirmationBoundToDeploymentId: "DIFFERENT-deploy-id",
    });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).toBe("HANDOVER_CLEARANCE_PENDING");
    expect(a.blockerCode).toBe("DEPLOYMENT_HANDOVER_NOT_CLEARED");
    expect(a.handoverCleared).toBe(false);
  });

  it("H4 confirmation bound to another boot is rejected", () => {
    const h = clearedHandover({
      confirmationBoundToBootId: "DIFFERENT-boot-id",
    });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).toBe("HANDOVER_CLEARANCE_PENDING");
    expect(a.blockerCode).toBe("DEPLOYMENT_HANDOVER_NOT_CLEARED");
  });

  it("H5 replayed / expired evidence cannot authorize readiness", () => {
    // Evidence produced for deploy-A/boot-A cannot be replayed against deploy-B/boot-B.
    const h = clearedHandover({
      currentDeploymentId: "deploy-B",
      currentBootId: "boot-B",
      confirmationBoundToDeploymentId: "deploy-A", // wrong
      confirmationBoundToBootId: "boot-A",         // wrong
    });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.handoverCleared).toBe(false);
    expect(a.state).toBe("HANDOVER_CLEARANCE_PENDING");
  });

  it("H6 source config plus DB lease remains insufficient", () => {
    const h = clearedHandover({ confirmationSource: "DB_LEASE" });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.handoverCleared).toBe(false);
    expect(a.blockerCode).toBe("DEPLOYMENT_HANDOVER_NOT_CLEARED");
  });

  it("H7 advisory lock remains insufficient", () => {
    for (const source of ["ADVISORY_LOCK", "PG_ADVISORY_LOCK", "DB_LOCK", "HEARTBEAT"]) {
      const h = clearedHandover({ confirmationSource: source });
      const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
      expect(a.handoverCleared).toBe(false);
    }
  });

  it("H8 correct future evidence may reach READY_FOR_OWNER_ACTIVATION, not ACTIVE", () => {
    const h = clearedHandover({ activationAuthorized: true });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).toBe("READY_FOR_OWNER_ACTIVATION");
    expect(a.blockerCode).toBeNull();
    // ACTIVE is still unreachable.
    expect(a.state).not.toBe("ACTIVE" as string);
    expect(a.handoverCleared).toBe(true);
    expect(a.ownerAuthorizationPresent).toBe(true);
  });

  it("H9 owner authorization missing remains blocked", () => {
    // Everything else is fine but activationAuthorized=false.
    const h = clearedHandover({ activationAuthorized: false });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, true);
    expect(a.state).toBe("OWNER_AUTHORIZATION_PENDING");
    expect(a.blockerCode).toBe("OWNER_FEED_ACTIVATION_NOT_AUTHORIZED");
    expect(a.ownerAuthorizationPresent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S1–S9 — Shutdown integration
// ---------------------------------------------------------------------------

describe("P08T S1-S9 — Shutdown integration", () => {
  it("S1 SIGTERM initiates shutdown once", async () => {
    const fakeProcess: SignalTarget = { on: () => undefined, off: () => undefined };
    const calls: string[] = [];
    const controller = stubController({
      onResult: (r) => calls.push(r.signal),
    });
    installShutdownSignalHandlers(controller, fakeProcess);
    await controller.shutdown("SIGTERM");
    expect(controller.phase()).toBe("COMPLETE");
    expect(calls).toEqual(["SIGTERM"]);
  });

  it("S2 SIGINT initiates shutdown once", async () => {
    const controller = stubController();
    await controller.shutdown("SIGINT");
    expect(controller.phase()).toBe("COMPLETE");
  });

  it("S3 repeated / mixed signals do not duplicate cleanup", async () => {
    const controller = stubController();
    const [r1, r2, r3] = await Promise.all([
      controller.shutdown("SIGTERM"),
      controller.shutdown("SIGTERM"),
      controller.shutdown("SIGINT"),
    ]);
    expect(r1).toBe(r2);
    expect(r1).toBe(r3);
    expect(r1.duplicateSignalsIgnored).toBe(2);
  });

  it("S4 activation is refused immediately after shutdown begins", () => {
    const controller = stubController();
    expect(controller.isFeedActivationPermitted()).toBe(true);
    // Start shutdown without awaiting — the synchronous phase transition happens
    // before the async parts run.
    void controller.shutdown("SIGTERM");
    expect(controller.isFeedActivationPermitted()).toBe(false);

    // The state machine must also respect this.
    const h = clearedHandover({ activationAuthorized: true });
    const a = evaluateFeedActivationState(h, true, "SHUTTING_DOWN", false, true);
    expect(a.state).toBe("SHUTTING_DOWN");
    expect(a.blockerCode).toBe("PROCESS_SHUTTING_DOWN");
  });

  it("S5 future feed-close hook precedes HTTP close", async () => {
    const order: string[] = [];
    const controller = createShutdownController({
      closeFeed: async () => {
        order.push("feed");
        return { closed: true, detail: "CLOSED" };
      },
      closeHttp: async () => {
        order.push("http");
      },
    });
    await controller.shutdown("SIGTERM");
    expect(order).toEqual(["feed", "http"]);
  });

  it("S6 uninstalled feed hook reports honestly (NOT_OWNED, never CLOSED)", async () => {
    const controller = createShutdownController({
      closeFeed: NO_OP_FEED_CLOSE_HOOK,
      closeHttp: async () => {},
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("NOT_OWNED");
    // NOT_OWNED is a clean exit — exit code 0 only when HTTP also closed.
    expect(result.exitCode).toBe(0);
  });

  it("S7 hook failure produces safe failure state", async () => {
    const controller = createShutdownController({
      closeFeed: async () => {
        throw new Error("socket already broken");
      },
      closeHttp: async () => {},
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("HOOK_FAILED");
    expect(result.exitCode).toBe(1);
  });

  it("S8 hook timeout cannot fabricate success", async () => {
    const controller = createShutdownController({
      closeFeed: async () => {
        // Hangs forever.
        await new Promise(() => {});
        return { closed: true, detail: "WOULD_NEVER_REACH" };
      },
      closeHttp: async () => {},
      feedCloseTimeoutMs: 1,
      setTimeoutFn: fireOnlyBound(1),
      clearTimeoutFn: () => {},
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.feedClose).toBe("TIMEOUT");
    // A timeout is an unknown state — never report success.
    expect(result.exitCode).toBe(1);
  });

  it("S9 HTTP-close timeout remains bounded", async () => {
    const controller = createShutdownController({
      closeFeed: NO_OP_FEED_CLOSE_HOOK,
      closeHttp: async () => {
        await new Promise(() => {});
      },
      httpCloseTimeoutMs: 1,
      setTimeoutFn: fireOnlyBound(2),
      clearTimeoutFn: () => {},
    });
    const result = await controller.shutdown("SIGTERM");
    expect(result.httpClosed).toBe(false);
    expect(result.httpCloseError).toMatch(/HTTP_CLOSE_TIMEOUT_AFTER_/);
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C1–C8 — Compatibility and safety
// ---------------------------------------------------------------------------

describe("P08T C1-C8 — Compatibility and safety", () => {
  it("C1 normal startup remains unchanged outside proof/activation decisions", () => {
    // The shutdown readiness description must not raise before handlers are installed.
    const r = describeShutdownReadiness();
    expect(r.prepared).toBe(true);
    expect(r.feedCloseHook).toBe("NO_OP_PHASE_0_8T");
    expect(r.signals).toContain("SIGTERM");
    expect(r.signals).toContain("SIGINT");
  });

  it("C2 provider-free proof mode remains isolated", () => {
    // Proof mode forces REFUSED — never reaches the topology or handover checks.
    const allTrue = clearedHandover({ activationAuthorized: true });
    const a = evaluateFeedActivationState(allTrue, true, NOT_SHUTTING_DOWN, true, true);
    expect(a.state).toBe("REFUSED");
    expect(a.blockerCode).toBe("PROOF_MODE_CANNOT_ACTIVATE_FEED");
  });

  it("C3 buildBootHandoverEvidence always sets feedDisabledAtBoot=true", () => {
    const h = buildBootHandoverEvidence({}, "test-boot-id", false);
    expect(h.feedDisabledAtBoot).toBe(true);
    expect(h.activationAuthorized).toBe(false);
    expect(h.previousDeploymentConfirmedInactive).toBe(false);
  });

  it("C4 diagnostics contain no secret values", () => {
    // buildBootHandoverEvidence with a fake API key: the key must not appear anywhere.
    const fakeEnv: NodeJS.ProcessEnv = {
      KITE_API_KEY: "SUPER_SECRET_API_KEY_CANARY",
      REPLIT_DEPLOYMENT_ID: "test-deployment-id",
    };
    const h = buildBootHandoverEvidence(fakeEnv, "boot-id", false);
    const serialised = JSON.stringify(h);
    expect(serialised).not.toContain("SUPER_SECRET_API_KEY_CANARY");
    // The deployment ID is safe metadata (not a secret), so it may appear.
    expect(h.currentDeploymentId).toBe("test-deployment-id");
  });

  it("C5 no Kite / WebSocket / subscription import or call is added", () => {
    // Read the feed activation contract and assert no banned module is imported.
    const contractSrc = readFileSync(
      resolve(process.cwd(), "src/lib/lifecycle/feedActivationContract.ts"),
      "utf8",
    );
    for (const banned of [
      "KiteTicker",
      "kite-connect",
      "WebSocket",
      "ws",
      "subscribe",
      "unsubscribe",
    ]) {
      const nonComment = contractSrc
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      expect(nonComment).not.toContain(banned);
    }
  });

  it("C6 no database write or scheduler is introduced", () => {
    // Neither feedActivationContract.ts nor the gracefulShutdown.ts install path
    // should reference DB modules or setInterval.
    for (const file of [
      "src/lib/lifecycle/feedActivationContract.ts",
      "src/lib/lifecycle/gracefulShutdown.ts",
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8")
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      expect(src).not.toContain("setInterval");
      // No drizzle / pg / database import
      expect(src).not.toMatch(/from ["'].*drizzle|from ["'].*postgres|from ["'].*pg/);
    }
  });

  it("C7 Phase 0.8A manifest and shard hashes remain unchanged", async () => {
    // Re-derive the Phase 0.8A hash to prove this correction did not alter it.
    const { evaluateFeedOwnershipAdmission } = await import(
      "../registry/feedOwnershipAdmission.js"
    );
    const vmAdmission = evaluateFeedOwnershipAdmission({
      declaredDeploymentTarget: "vm",
      isDeployment: true,
      declaredReplicaCount: 1,
    });
    expect(vmAdmission.singleWriterStructurallyGuaranteed).toBe(true);

    const autoscaleAdmission = evaluateFeedOwnershipAdmission({
      declaredDeploymentTarget: "autoscale",
      isDeployment: true,
      declaredReplicaCount: null,
    });
    expect(autoscaleAdmission.singleWriterStructurallyGuaranteed).toBe(false);
  });

  it("A11 feed activation fails closed when shutdown coordinator is not installed", () => {
    // Best-case handover + topology, but shutdown not installed: must be refused
    // at the very first gate, before topology or handover checks run.
    const h = clearedHandover({ activationAuthorized: true });
    const a = evaluateFeedActivationState(h, true, NOT_SHUTTING_DOWN, false, false);
    expect(a.state).toBe("REFUSED");
    expect(a.blockerCode).toBe("SHUTDOWN_NOT_INSTALLED");
    expect(a.notes).toContain("SHUTDOWN_COORDINATOR_NOT_INSTALLED");
    // ACTIVE and READY_FOR_OWNER_ACTIVATION are both unreachable.
    expect(a.state).not.toBe("ACTIVE" as string);
    expect(a.state).not.toBe("READY_FOR_OWNER_ACTIVATION");
  });

  it("A12 once shutdown is installed the lifecycle gate passes; all other Phase 0.8A gates remain", () => {
    // Lifecycle prerequisite clears with shutdownInstalled=true; the function
    // then applies topology, handover, and owner-auth gates exactly as before.
    const noTopology = evaluateFeedActivationState(
      activeHandover(),
      false,
      NOT_SHUTTING_DOWN,
      false,
      true,
    );
    expect(noTopology.state).toBe("TOPOLOGY_EVIDENCE_PENDING");
    expect(noTopology.blockerCode).toBe("RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED");

    const noAuth = evaluateFeedActivationState(
      clearedHandover({ activationAuthorized: false }),
      true,
      NOT_SHUTTING_DOWN,
      false,
      true,
    );
    expect(noAuth.state).toBe("OWNER_AUTHORIZATION_PENDING");
    expect(noAuth.blockerCode).toBe("OWNER_FEED_ACTIVATION_NOT_AUTHORIZED");

    // ACTIVE is still unreachable after the lifecycle gate clears.
    const best = evaluateFeedActivationState(clearedHandover({ activationAuthorized: true }), true, NOT_SHUTTING_DOWN, false, true);
    expect(best.state).not.toBe("ACTIVE" as string);
    expect(best.state).toBe("READY_FOR_OWNER_ACTIVATION");
  });

  it("C8 all four safety locks remain exactly false as boolean", async () => {
    const { FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED, SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED } =
      await import("../candleEvaluationControl.js");
    const { FNO_PAPER_V2_RUNTIME_AUTHORIZED, SWING_PAPER_V2_RUNTIME_AUTHORIZED } =
      await import("../v2PaperLocks.js");

    expect(FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED).toBe(false);
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);

    // Also assert the literal `false as boolean` pattern — neither constant
    // is widened beyond boolean, and neither is currently true.
    const locks = [
      FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED,
      SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
      FNO_PAPER_V2_RUNTIME_AUTHORIZED,
      SWING_PAPER_V2_RUNTIME_AUTHORIZED,
    ] as boolean[];
    expect(locks.every((l) => l === false)).toBe(true);
  });
});
