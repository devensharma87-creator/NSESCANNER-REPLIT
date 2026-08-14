/**
 * PHASE 0.8A — FEED OWNERSHIP ADMISSION (9 targeted tests)
 *
 * The question is not "can we take a lock" — it is "can exactly one writer be
 * guaranteed by the deployment topology at all". These tests hold the module to
 * refusing rather than inventing a workaround, and confirm the real workspace
 * topology is inspected read-only.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  REJECTED_OWNERSHIP_MECHANISMS,
  classifyDeploymentTopology,
  evaluateFeedOwnershipAdmission,
  parseDeclaredDeploymentTarget,
  readDeclaredDeploymentTargetFromDisk,
  readTopologySignals,
  type DeploymentTopologySignals,
} from "./feedOwnershipAdmission";

const WORKSPACE_REPLIT = resolve(process.cwd(), "../../.replit");

function signals(overrides: Partial<DeploymentTopologySignals> = {}): DeploymentTopologySignals {
  return {
    declaredDeploymentTarget: "autoscale",
    isDeployment: true,
    declaredReplicaCount: null,
    ...overrides,
  };
}

describe("P08A O1-O5 — topology classification", () => {
  it("O1 an autoscale deployment is MULTI_REPLICA_POSSIBLE and is refused ownership", () => {
    const admission = evaluateFeedOwnershipAdmission(signals());
    expect(admission.topology.topology).toBe("MULTI_REPLICA_POSSIBLE");
    expect(admission.topology.multiReplicaPossible).toBe(true);
    expect(admission.topology.scaleToZeroPossible).toBe(true);
    expect(admission.ownershipAdmitted).toBe(false);
    expect(admission.singleWriterStructurallyGuaranteed).toBe(false);
    expect(admission.blockerCode).toBe("FEED_OWNERSHIP_MULTI_REPLICA_TOPOLOGY");
  });

  it("O2 a single always-on machine is a structural singleton — still not admitted in this phase", () => {
    const admission = evaluateFeedOwnershipAdmission(signals({ declaredDeploymentTarget: "vm" }));
    expect(admission.topology.topology).toBe("STRUCTURAL_SINGLETON");
    expect(admission.singleWriterStructurallyGuaranteed).toBe(true);
    // Admission-only phase: topology permitting a writer is not the same as
    // granting one.
    expect(admission.ownershipAdmitted).toBe(false);
    expect(admission.blockerCode).toBe("FEED_OWNERSHIP_ACTIVATION_NOT_AUTHORIZED_IN_PHASE_0_8A");
    expect(admission.phase).toBe("PHASE_0_8A_ADMISSION_ONLY");
  });

  it("O3 an unestablished topology is treated as unsafe, never as a singleton", () => {
    const unknown = evaluateFeedOwnershipAdmission(signals({ declaredDeploymentTarget: null }));
    expect(unknown.topology.topology).toBe("TOPOLOGY_UNKNOWN");
    expect(unknown.singleWriterStructurallyGuaranteed).toBe(false);
    expect(unknown.ownershipAdmitted).toBe(false);
    expect(unknown.blockerCode).toBe("FEED_OWNERSHIP_TOPOLOGY_UNKNOWN");
    expect(unknown.topology.evidence).toContain("NO_DECLARED_DEPLOYMENT_TARGET_FOUND");

    const unrecognised = evaluateFeedOwnershipAdmission(
      signals({ declaredDeploymentTarget: "some-future-target" }),
    );
    expect(unrecognised.topology.topology).toBe("TOPOLOGY_UNKNOWN");
    expect(unrecognised.ownershipAdmitted).toBe(false);
  });

  it("O4 a scheduled target is SCALE_TO_ZERO_POSSIBLE", () => {
    const admission = evaluateFeedOwnershipAdmission(signals({ declaredDeploymentTarget: "scheduled" }));
    expect(admission.topology.topology).toBe("SCALE_TO_ZERO_POSSIBLE");
    expect(admission.topology.scaleToZeroPossible).toBe(true);
    expect(admission.topology.multiReplicaPossible).toBe(false);
    expect(admission.blockerCode).toBe("FEED_OWNERSHIP_SCALE_TO_ZERO_TOPOLOGY");
  });

  it("O5 a declared replica count above one overrides an otherwise singleton target", () => {
    const admission = evaluateFeedOwnershipAdmission(
      signals({ declaredDeploymentTarget: "vm", declaredReplicaCount: 2 }),
    );
    expect(admission.topology.topology).toBe("MULTI_REPLICA_POSSIBLE");
    expect(admission.topology.evidence).toContain("DECLARED_REPLICA_COUNT=2");
    expect(admission.ownershipAdmitted).toBe(false);
  });
});

describe("P08A O6-O9 — insufficiency, parsing, real topology, safety of evidence", () => {
  it("O6 every coordination primitive is enumerated as insufficient, with a reason", () => {
    const names = REJECTED_OWNERSHIP_MECHANISMS.map((m) => m.mechanism);
    expect(names).toEqual([
      "PROCESS_LOCAL_LOCK",
      "POSTGRES_ADVISORY_LOCK",
      "DB_LEASE_ROW",
      "LEADER_ELECTION",
    ]);
    for (const m of REJECTED_OWNERSHIP_MECHANISMS) {
      expect(m.whyInsufficient.length).toBeGreaterThan(40);
    }
    // None of them is offered as a path to admission.
    expect(evaluateFeedOwnershipAdmission(signals()).ownershipAdmitted).toBe(false);
  });

  it("O7 the deployment target is read only from the [deployment] table", () => {
    const body = [
      'deploymentTarget = "vm"',
      "[other]",
      'deploymentTarget = "static"',
      "[deployment]",
      "router = \"application\"",
      'deploymentTarget = "autoscale"',
    ].join("\n");
    expect(parseDeclaredDeploymentTarget(body)).toBe("autoscale");
    expect(parseDeclaredDeploymentTarget("[deployment]\n")).toBeNull();
    expect(parseDeclaredDeploymentTarget("")).toBeNull();
  });

  it("O8a autoscale fixture classifies as MULTI_REPLICA_POSSIBLE and is refused ownership", () => {
    const body = '[deployment]\ndeploymentTarget = "autoscale"\n';
    const declared = parseDeclaredDeploymentTarget(body);
    expect(declared).toBe("autoscale");
    const assessment = classifyDeploymentTopology(readTopologySignals({} as NodeJS.ProcessEnv, declared));
    expect(assessment.topology).toBe("MULTI_REPLICA_POSSIBLE");
    expect(assessment.multiReplicaPossible).toBe(true);
    const admission = evaluateFeedOwnershipAdmission(readTopologySignals({} as NodeJS.ProcessEnv, declared));
    expect(admission.ownershipAdmitted).toBe(false);
    expect(admission.blockerCode).toBe("FEED_OWNERSHIP_MULTI_REPLICA_TOPOLOGY");
  });

  it("O8b vm fixture is STRUCTURAL_SINGLETON but still does not grant runtime ownership", () => {
    // A `vm` declaration says the deployment *topology* allows a singleton.
    // Runtime ownership is a separate gate (0.8A phase lock) — topology alone
    // must never be read as permission to hold the feed.
    const body = '[deployment]\ndeploymentTarget = "vm"\n';
    const declared = parseDeclaredDeploymentTarget(body);
    expect(declared).toBe("vm");
    const assessment = classifyDeploymentTopology(readTopologySignals({} as NodeJS.ProcessEnv, declared));
    expect(assessment.topology).toBe("STRUCTURAL_SINGLETON");
    expect(assessment.multiReplicaPossible).toBe(false);
    const admission = evaluateFeedOwnershipAdmission(readTopologySignals({} as NodeJS.ProcessEnv, declared));
    expect(admission.singleWriterStructurallyGuaranteed).toBe(true);
    expect(admission.ownershipAdmitted).toBe(false);
    expect(admission.blockerCode).toBe("FEED_OWNERSHIP_ACTIVATION_NOT_AUTHORIZED_IN_PHASE_0_8A");
  });

  it("O8c missing or malformed deployment table fails closed as TOPOLOGY_UNKNOWN", () => {
    // No [deployment] table.
    expect(parseDeclaredDeploymentTarget("")).toBeNull();
    expect(parseDeclaredDeploymentTarget('deploymentTarget = "vm"\n')).toBeNull();

    // [deployment] table present but no deploymentTarget key.
    expect(parseDeclaredDeploymentTarget("[deployment]\n")).toBeNull();

    // Malformed value (no quotes).
    expect(parseDeclaredDeploymentTarget("[deployment]\ndeploymentTarget = vm\n")).toBeNull();

    for (const body of [
      "",
      "[deployment]\n",
      'deploymentTarget = "vm"\n',
      "[deployment]\ndeploymentTarget = vm\n",
    ]) {
      const declared = parseDeclaredDeploymentTarget(body);
      const admission = evaluateFeedOwnershipAdmission(
        readTopologySignals({} as NodeJS.ProcessEnv, declared),
      );
      expect(admission.ownershipAdmitted).toBe(false);
      expect(admission.topology.topology).not.toBe("STRUCTURAL_SINGLETON");
    }
  });

  it("O8d real workspace .replit is read-only and currently declares the committed vm target", () => {
    // This assertion tracks what is actually committed, not a hardcoded
    // expectation of what the workspace used to say. If the deployment target
    // is legitimately changed, this test must be updated to match — it must
    // never silently diverge from reality.
    const before = statSync(WORKSPACE_REPLIT);
    const declared = readDeclaredDeploymentTargetFromDisk(process.cwd());
    // Phase 0.8T committed `deploymentTarget = "vm"` in .replit (commit e9c51849).
    expect(declared).toBe("vm");
    const assessment = classifyDeploymentTopology(readTopologySignals(process.env, declared));
    // vm = STRUCTURAL_SINGLETON topology, but NOT runtime ownership.
    expect(assessment.topology).toBe("STRUCTURAL_SINGLETON");
    const admission = evaluateFeedOwnershipAdmission(readTopologySignals(process.env, declared));
    expect(admission.ownershipAdmitted).toBe(false);
    // Read-only: the inspected file must be untouched.
    const after = statSync(WORKSPACE_REPLIT);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    expect(readFileSync(WORKSPACE_REPLIT, "utf8")).toContain("deploymentTarget");
  });

  it("O9 evidence carries no environment values or credentials", () => {
    const dev = classifyDeploymentTopology(signals({ isDeployment: false }));
    expect(dev.runtimeEnvironment).toBe("DEVELOPMENT_WORKSPACE");
    expect(dev.evidence).toContain("DEVELOPMENT_WORKSPACE_MAY_RUN_CONCURRENTLY_WITH_DEPLOYMENT");
    const blob = JSON.stringify(evaluateFeedOwnershipAdmission(signals({ isDeployment: false })));
    // No credential VALUES and no credential-bearing key names. ("fencing token"
    // appears in prose explaining why leader election is insufficient, which is
    // an argument, not a value — so the scan targets the key spellings.)
    for (const forbidden of [
      "SESSION_SECRET",
      "accessToken",
      "access_token",
      "apiKey",
      "api_secret",
      "PASSWORD",
      "postgres://",
      "Bearer ",
    ]) {
      expect(blob).not.toContain(forbidden);
    }
    // Evidence is a closed vocabulary of declared facts — an upper-snake code,
    // optionally with a short declared value — so no opaque high-entropy string
    // can ride along inside it.
    for (const e of dev.evidence) expect(e).toMatch(/^[A-Z0-9_]+(=[A-Za-z0-9_-]{1,32})?$/);
    expect(blob).not.toMatch(/[a-z0-9]{24,}/);
    // Signals are derived from declared facts only — never from a hostname.
    const parsed = readTopologySignals({ REPLIT_DEPLOYMENT: "1" } as NodeJS.ProcessEnv, "autoscale");
    expect(parsed).toEqual({
      declaredDeploymentTarget: "autoscale",
      isDeployment: true,
      declaredReplicaCount: null,
    });
  });
});
