/**
 * PHASE 0.8T — TOPOLOGY EVIDENCE, OWNERSHIP CONTRACT AND SAFETY (targeted)
 *
 * The danger this phase introduces is a sentence in a config file: `.replit`
 * will say "vm", and it would be very easy for a later change to read that
 * sentence and conclude the running process is the one true feed owner. These
 * tests exist to make that impossible — source configuration, development
 * environments and proof mode must all fail closed, and the Phase 0.8A hashes
 * must be untouched by anything added here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  ENTRYPOINT_CHILD_PROCESS_AUDIT,
  VERIFIED_PLATFORM_ATTESTATION_KEYS,
  classifyRunCommandProcessTopology,
  deriveApiKeyOwnerId,
  evaluatePhase08tOwnership,
  parseProductionRunArgs,
  readRuntimeTopologyEvidence,
  validateRuntimeTopologyEvidence,
  type RuntimeTopologyEvidence,
} from "./runtimeTopologyEvidence";
import {
  REJECTED_OWNERSHIP_MECHANISMS,
  parseDeclaredDeploymentTarget,
} from "./feedOwnershipAdmission";
import { buildSubscriptionAdmissionManifest } from "./subscriptionManifest";
import { planFeedShards, SHARD_POLICY_VERSION } from "./feedShardPlan";
import { buildUniverseManifest, REQUIRED_SOURCE_IDS } from "./universeManifest";
import { MIN_RECORDS_FOR_COMMIT } from "./manifestStore";
import {
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
} from "./p06TestFixtures";

const WORKSPACE_ROOT = resolve(process.cwd(), "../..");
const ARTIFACT_TOML = resolve(process.cwd(), ".replit-artifact/artifact.toml");
const REGISTRY_DIR = resolve(process.cwd(), "src/lib/registry");

/** A fully satisfied Reserved VM runtime fixture; individual tests break one clause. */
function reservedVmEvidence(
  overrides: Partial<RuntimeTopologyEvidence> = {},
): RuntimeTopologyEvidence {
  return {
    declaredDeploymentTarget: "vm",
    observedRuntimeTarget: "vm",
    isDeployment: true,
    deploymentIdentity: "deployment-abc123",
    observedReplicaCount: 1,
    runCommandArgs: ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
    // The future state: an attestation key confirmed against a real deployment.
    // No such key exists yet, so only a fixture can reach this.
    attestationSource: "VERIFIED_PLATFORM_ATTESTATION",
    entrypointAudit: "NO_CHILD_PROCESS_SPAWN_VERIFIED",
    proofMode: false,
    apiKeyOwnerId: "kite-0123456789ab",
    ...overrides,
  };
}

describe("P08T C1-C12 — configuration and topology evidence", () => {
  it("C1 an autoscale runtime is MULTI_REPLICA_POSSIBLE and refuses ownership", () => {
    const a = validateRuntimeTopologyEvidence(
      reservedVmEvidence({ declaredDeploymentTarget: "autoscale", observedRuntimeTarget: "autoscale" }),
    );
    expect(a.topologyState).toBe("MULTI_REPLICA_POSSIBLE");
    expect(a.singletonGuaranteed).toBe(false);
    expect(a.ownershipContractSatisfied).toBe(false);
    expect(a.blockerCode).toBe("FEED_OWNERSHIP_MULTI_REPLICA_TOPOLOGY");
  });

  it("C2 a scale-to-zero runtime blocks admission even with one instance", () => {
    const a = validateRuntimeTopologyEvidence(
      reservedVmEvidence({ observedRuntimeTarget: "scheduled", observedReplicaCount: 1 }),
    );
    expect(a.topologyState).toBe("SCALE_TO_ZERO_POSSIBLE");
    expect(a.persistentProcessGuaranteed).toBe(false);
    expect(a.ownershipContractSatisfied).toBe(false);
    expect(a.blockerCode).toBe("FEED_OWNERSHIP_SCALE_TO_ZERO_TOPOLOGY");
  });

  it("C3 a verified Reserved VM runtime classifies STRUCTURAL_SINGLETON", () => {
    const a = validateRuntimeTopologyEvidence(reservedVmEvidence());
    expect(a.topologyState).toBe("STRUCTURAL_SINGLETON");
    expect(a.evidenceSource).toBe("RUNTIME_OBSERVED");
    expect(a.singletonGuaranteed).toBe(true);
    expect(a.persistentProcessGuaranteed).toBe(true);
    expect(a.blockerCode).toBeNull();
    expect(a.ownershipContractSatisfied).toBe(true);
  });

  it("C4 an unrecognised runtime target fails closed as TOPOLOGY_UNKNOWN", () => {
    const a = validateRuntimeTopologyEvidence(
      reservedVmEvidence({ observedRuntimeTarget: "reserved-vm-preview-beta" }),
    );
    expect(a.topologyState).toBe("TOPOLOGY_UNKNOWN");
    expect(a.singletonGuaranteed).toBe(false);
    expect(a.blockerCode).toBe("FEED_OWNERSHIP_TOPOLOGY_UNKNOWN");
  });

  it("C5 a deployment that reports no topology at all fails closed", () => {
    const a = validateRuntimeTopologyEvidence(
      reservedVmEvidence({ observedRuntimeTarget: null }),
    );
    expect(a.evidenceSource).toBe("SOURCE_CONFIGURATION_ONLY");
    expect(a.singletonGuaranteed).toBe(false);
    expect(a.blockerCode).toBe("RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED");
  });

  it("C6 the .replit declaration alone can never authorize ownership", () => {
    // The real workspace file now declares "vm" — that must change nothing.
    const declared = parseDeclaredDeploymentTarget(
      readFileSync(resolve(WORKSPACE_ROOT, ".replit"), "utf8"),
    );
    expect(declared).toBe("vm");

    const assessment = evaluatePhase08tOwnership({
      declaredDeploymentTarget: declared,
      evidence: reservedVmEvidence({
        declaredDeploymentTarget: declared,
        observedRuntimeTarget: null,
        isDeployment: false,
        deploymentIdentity: null,
      }),
    });
    expect(assessment.ownershipAdmitted).toBe(false);
    expect(assessment.topologyReady).toBe(false);
    expect(assessment.blockerCode).toBe("RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED");
    expect(assessment.runtime.evidenceSource).toBe("SOURCE_CONFIGURATION_ONLY");
  });

  it("C7 boot-proof mode can never authorize ownership, however good the evidence", () => {
    const a = validateRuntimeTopologyEvidence(reservedVmEvidence({ proofMode: true }));
    expect(a.ownershipContractSatisfied).toBe(false);
    expect(a.blockerCode).toBe("FEED_OWNERSHIP_PROOF_MODE_NEVER_AUTHORIZES");
  });

  it("C8 a development workspace cannot impersonate a production singleton", () => {
    const a = validateRuntimeTopologyEvidence(
      reservedVmEvidence({ isDeployment: false, observedRuntimeTarget: "vm" }),
    );
    expect(a.topologyState).toBe("TOPOLOGY_UNKNOWN");
    expect(a.singletonGuaranteed).toBe(false);
    expect(a.blockerCode).toBe("RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED");
  });

  it("C9 a missing runtime deployment identity blocks admission", () => {
    const a = validateRuntimeTopologyEvidence(reservedVmEvidence({ deploymentIdentity: null }));
    expect(a.topologyState).toBe("STRUCTURAL_SINGLETON");
    expect(a.deploymentIdentityPresent).toBe(false);
    expect(a.ownershipContractSatisfied).toBe(false);
    expect(a.blockerCode).toBe("FEED_OWNERSHIP_DEPLOYMENT_IDENTITY_MISSING");
  });

  it("C10 malformed topology evidence blocks admission and is never rounded down to one", () => {
    const negative = readRuntimeTopologyEvidence(
      { REPLIT_DEPLOYMENT: "1", REPLIT_DEPLOYMENT_TARGET: "vm", REPLICA_COUNT: "-4" },
      { declaredDeploymentTarget: "vm", runCommandArgs: ["node", "dist/index.mjs"], proofMode: false },
    );
    expect(negative.observedReplicaCount).toBeNull();

    const garbage = readRuntimeTopologyEvidence(
      { REPLIT_DEPLOYMENT: "1", REPLIT_DEPLOYMENT_TARGET: "   ", REPLICA_COUNT: "many" },
      { declaredDeploymentTarget: "vm", runCommandArgs: null, proofMode: false },
    );
    expect(garbage.observedRuntimeTarget).toBeNull();
    expect(validateRuntimeTopologyEvidence(garbage).blockerCode).toBe(
      "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED",
    );

    const multi = validateRuntimeTopologyEvidence(reservedVmEvidence({ observedReplicaCount: 2 }));
    expect(multi.topologyState).toBe("MULTI_REPLICA_POSSIBLE");
    expect(multi.ownershipContractSatisfied).toBe(false);
  });

  it("C11 the real production run command starts exactly one process", () => {
    const args = parseProductionRunArgs(readFileSync(ARTIFACT_TOML, "utf8"));
    expect(args).not.toBeNull();
    expect(args?.[0]).toBe("node");
    expect(classifyRunCommandProcessTopology(args)).toBe("SINGLE_ENTRYPOINT_ARGV");

    const a = validateRuntimeTopologyEvidence(reservedVmEvidence({ runCommandArgs: args }));
    expect(a.processTopology).toBe("SINGLE_ENTRYPOINT_ARGV");
    expect(a.ownershipContractSatisfied).toBe(true);
  });

  it("C12 cluster, supervisor and backgrounded run commands block admission", () => {
    const cases: Array<readonly string[]> = [
      ["pm2-runtime", "dist/index.mjs"],
      ["node", "cluster.mjs"],
      ["npx", "concurrently", "node dist/index.mjs", "node worker.mjs"],
      ["sh", "-c", "node dist/index.mjs & node worker.mjs & wait"],
      ["node", "dist/index.mjs", "--instances", "3"],
    ];
    for (const args of cases) {
      expect(classifyRunCommandProcessTopology(args)).not.toBe("SINGLE_ENTRYPOINT_ARGV");
      const a = validateRuntimeTopologyEvidence(reservedVmEvidence({ runCommandArgs: args }));
      expect(a.ownershipContractSatisfied).toBe(false);
      expect(a.blockerCode).toBe("FEED_OWNERSHIP_MULTI_PROCESS_RUN_COMMAND");
    }
    // Nothing at all is not "one".
    expect(classifyRunCommandProcessTopology(null)).toBe("PROCESS_TOPOLOGY_UNKNOWN");
    expect(classifyRunCommandProcessTopology([])).toBe("PROCESS_TOPOLOGY_UNKNOWN");
  });

  it("C13 a spoofed development environment cannot satisfy the contract", () => {
    // Everything a real deployment would supply, typed by hand in a shell.
    const spoofed = readRuntimeTopologyEvidence(
      {
        REPLIT_DEPLOYMENT: "1",
        REPLIT_DEPLOYMENT_TARGET: "vm",
        REPLIT_DEPLOYMENT_ID: "totally-real-deployment",
        REPLIT_DEPLOYMENT_REPLICAS: "1",
        KITE_API_KEY: "spoofed-key",
      },
      {
        declaredDeploymentTarget: "vm",
        runCommandArgs: ["node", "dist/index.mjs"],
        proofMode: false,
      },
    );
    expect(spoofed.attestationSource).toBe("UNVERIFIED_ENVIRONMENT_CLAIM");

    const a = validateRuntimeTopologyEvidence(spoofed);
    expect(a.evidenceSource).toBe("UNVERIFIED_RUNTIME_CLAIM");
    expect(a.singletonGuaranteed).toBe(false);
    expect(a.ownershipContractSatisfied).toBe(false);
    expect(a.blockerCode).toBe("PLATFORM_ATTESTATION_CONTRACT_NOT_VERIFIED");

    // The reason it cannot be satisfied: no attestation key has been confirmed
    // against a real deployment yet, so nothing read from env can be trusted.
    expect(VERIFIED_PLATFORM_ATTESTATION_KEYS).toHaveLength(0);
  });

  it("C14 an opaque or unaudited entrypoint blocks admission", () => {
    // An argv can show ONE executable; it cannot show what that executable forks.
    for (const args of [
      ["node", "-e", "require('node:child_process').fork('worker.mjs')"],
      ["node", "--eval", "spawnFeedWorkers()"],
      ["node", "-r", "./preload.js", "dist/index.mjs"],
    ]) {
      expect(classifyRunCommandProcessTopology(args)).toBe("PROCESS_TOPOLOGY_UNKNOWN");
    }

    const unaudited = validateRuntimeTopologyEvidence(
      reservedVmEvidence({ entrypointAudit: "NOT_AUDITED" }),
    );
    expect(unaudited.processTopology).toBe("SINGLE_ENTRYPOINT_ARGV");
    expect(unaudited.singletonGuaranteed).toBe(false);
    expect(unaudited.ownershipContractSatisfied).toBe(false);
    expect(unaudited.blockerCode).toBe("FEED_OWNERSHIP_ENTRYPOINT_CHILD_PROCESS_NOT_AUDITED");
  });

  it("C15 the entrypoint audit constant still matches the shipped runtime source", () => {
    // Re-derive the audit rather than trusting it: if any runtime module gains
    // a child process, the constant must be flipped to NOT_AUDITED and the gate
    // closes. Test infrastructure is excluded — it never ships in dist.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "test-infra" || entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (/\.test\.ts$|TestFixtures\.ts$/.test(entry.name)) continue;
        const code = readFileSync(full, "utf8")
          .split(/\r?\n/)
          .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
          .join("\n");
        if (/node:child_process|require\("child_process"\)|node:cluster|worker_threads/.test(code)) {
          offenders.push(full);
        }
      }
    };
    walk(resolve(process.cwd(), "src"));

    expect(offenders).toEqual([]);
    expect(ENTRYPOINT_CHILD_PROCESS_AUDIT).toBe("NO_CHILD_PROCESS_SPAWN_VERIFIED");
  });
});

describe("P08T O1-O4 — ownership contract", () => {
  it("O1 a structural singleton with persistent runtime reaches topology-ready, not ownership", () => {
    const assessment = evaluatePhase08tOwnership({
      declaredDeploymentTarget: "vm",
      evidence: reservedVmEvidence(),
    });
    expect(assessment.topologyReady).toBe(true);
    expect(assessment.blockerCode).toBeNull();
    // Topology-ready is a precondition. Ownership is still not granted, and the
    // type system makes granting it here impossible.
    expect(assessment.ownershipAdmitted).toBe(false);
    expect(assessment.phase).toBe("PHASE_0_8T_TOPOLOGY_PREPARATION");
  });

  it("O2 advisory locks, process mutexes and DB leases remain insufficient and unused", () => {
    const mechanisms = REJECTED_OWNERSHIP_MECHANISMS.map((m) => m.mechanism);
    expect(mechanisms).toContain("PROCESS_LOCAL_LOCK");
    expect(mechanisms).toContain("POSTGRES_ADVISORY_LOCK");
    expect(mechanisms).toContain("DB_LEASE_ROW");
    expect(mechanisms).toContain("LEADER_ELECTION");

    const src = readFileSync(resolve(REGISTRY_DIR, "runtimeTopologyEvidence.ts"), "utf8");
    const code = src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n")
      .toLowerCase();
    for (const forbidden of ["advisory_lock", "advisorylock", "lease", "heartbeat", "mutex"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("O3 the ownership assessment carries no secret and no raw provider key", () => {
    const key = "test-kite-api-key-value";
    const derived = deriveApiKeyOwnerId(key);
    expect(derived).not.toBeNull();
    expect(derived).not.toContain(key);
    expect(derived).toMatch(/^kite-[0-9a-f]{12}$/);
    expect(deriveApiKeyOwnerId("")).toBeNull();
    expect(deriveApiKeyOwnerId(undefined)).toBeNull();

    const assessment = evaluatePhase08tOwnership({
      declaredDeploymentTarget: "vm",
      evidence: reservedVmEvidence({ apiKeyOwnerId: derived }),
    });
    const body = JSON.stringify(assessment);

    // No credential-shaped key names, and no real environment VALUE of any
    // meaningful length may appear in the payload.
    for (const name of ["KITE_API_KEY", "KITE_API_SECRET", "SESSION_SECRET", "TELEGRAM_BOT_TOKEN"]) {
      expect(body).not.toContain(name);
      const value = process.env[name];
      if (typeof value === "string" && value.length >= 8) expect(body).not.toContain(value);
    }
    for (const [, value] of Object.entries(process.env)) {
      if (typeof value === "string" && value.length >= 12 && body.includes(value)) {
        throw new Error("environment value leaked into ownership assessment");
      }
    }
  });

  it("O4 Phase 0.8A manifest and shard hashing is untouched by this phase", () => {
    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
    const universe = buildUniverseManifest({
      build: makeBuildResult(records),
      sources: makeAcceptedSources(),
      manifestVersion: 1,
      registryGenerationId: GEN_ID,
      generatedAt: GENERATED_AT,
      effectiveDate: EFFECTIVE_DATE,
      requiredSourceIds: REQUIRED_SOURCE_IDS,
      bseAuthority: makeCurrentAuthoritativeBse(),
      tradingCalendar: makeCalendarCommitment(),
    });
    const nowMs = Date.parse(GENERATED_AT) + 600_000;
    const before = planFeedShards(
      buildSubscriptionAdmissionManifest({
        generation: { manifest: universe, records },
        nowMs,
        restorationSettled: true,
      }),
    );

    // Evaluate the entire Phase 0.8T stack in between: it must not be able to
    // influence a single hash input.
    evaluatePhase08tOwnership({ declaredDeploymentTarget: "vm", evidence: reservedVmEvidence() });

    const after = planFeedShards(
      buildSubscriptionAdmissionManifest({
        generation: { manifest: universe, records },
        nowMs,
        restorationSettled: true,
      }),
    );

    expect(SHARD_POLICY_VERSION).toBe(2);
    expect(after.completeManifestHash).toBe(before.completeManifestHash);
    expect(after.shards.map((s) => s.shardHash)).toEqual(before.shards.map((s) => s.shardHash));

    // And the hash-bearing Phase 0.8A modules do not import anything from 0.8T.
    for (const file of ["subscriptionManifest.ts", "feedShardPlan.ts"]) {
      const src = readFileSync(resolve(REGISTRY_DIR, file), "utf8");
      expect(src).not.toContain("runtimeTopologyEvidence");
      expect(src).not.toContain("gracefulShutdown");
    }
  });
});

describe("P08T S1-S5 — safety and compatibility", () => {
  const NEW_SOURCES = [
    resolve(REGISTRY_DIR, "runtimeTopologyEvidence.ts"),
    resolve(process.cwd(), "src/lib/lifecycle/gracefulShutdown.ts"),
  ];

  function codeOf(file: string): string {
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
  }

  it("S1 a normal boot is unchanged — nothing from this phase is installed at boot", () => {
    const index = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/app.ts"), "utf8");
    for (const src of [index, app]) {
      expect(src).not.toContain("gracefulShutdown");
      expect(src).not.toContain("installShutdownSignalHandlers");
      expect(src).not.toContain("runtimeTopologyEvidence");
    }
    // The boundary is prepared, and it says so honestly.
    expect(codeOf(NEW_SOURCES[1])).toContain("installedAtBoot: false");
  });

  it("S2 the new modules reach no provider, socket, database or scheduler", () => {
    for (const file of NEW_SOURCES) {
      const code = codeOf(file);
      const lowered = code.toLowerCase();
      for (const forbidden of [
        "kiteconnect",
        "kiteticker",
        "websocket",
        "socket.io",
        "axios",
        "drizzle",
        "pg.pool",
        "insert into",
        "update ",
        "delete from",
        "setinterval(",
        "fetch(",
      ]) {
        expect(lowered).not.toContain(forbidden);
      }
      expect(code).not.toContain(".subscribe(");
      expect(code).not.toContain(".unsubscribe(");
      expect(code).not.toContain("process.exit(");
    }
  });

  it("S3 the owner diagnostics route is owner-only and exposes no secret", () => {
    const route = readFileSync(resolve(process.cwd(), "src/routes/dataHealth.ts"), "utf8");
    expect(route).toContain('router.get("/data-health/topology", requireOwnerStrict,');
    const handler = route.slice(route.indexOf('"/data-health/topology"'));
    for (const forbidden of ["KITE_API_KEY", "KITE_API_SECRET", "process.env.KITE", "accessToken"]) {
      expect(handler).not.toContain(forbidden);
    }
    // Public health surfaces are untouched by this phase.
    expect(route).toContain('router.get("/data-health/market"');
  });

  it("S4 the prepared configuration declares Reserved VM without activating it", () => {
    const replit = readFileSync(resolve(WORKSPACE_ROOT, ".replit"), "utf8");
    expect(parseDeclaredDeploymentTarget(replit)).toBe("vm");
    // Existing deployment contract preserved: build/run/port/health untouched.
    const artifact = readFileSync(ARTIFACT_TOML, "utf8");
    expect(artifact).toContain('path = "/api/healthz"');
    expect(artifact).toContain('PORT = "8080"');
    expect(parseProductionRunArgs(artifact)?.[0]).toBe("node");
  });

  it("S5 all four owner safety locks remain false", () => {
    const candle = readFileSync(resolve(process.cwd(), "src/lib/candleEvaluationControl.ts"), "utf8");
    const v2 = readFileSync(resolve(process.cwd(), "src/lib/v2PaperLocks.ts"), "utf8");
    expect(candle).toContain("FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean");
    expect(candle).toContain("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean");
    expect(v2).toContain("FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean");
    expect(v2).toContain("SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean");
  });
});
