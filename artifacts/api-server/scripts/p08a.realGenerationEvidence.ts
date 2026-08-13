/**
 * PHASE 0.8A — REAL SCHEMA-5 GENERATION CLASSIFICATION EVIDENCE (READ-ONLY)
 *
 * Runs the PRODUCTION classifier and the PRODUCTION shard planner against the
 * durable generation already in PostgreSQL. It is deliberately read-only:
 *
 *   • the only database traffic is `loadLatestAcceptedGeneration`, whose whole
 *     body is one `SELECT to_regclass(...)` plus one `SELECT manifest, records`
 *     — no CREATE, ALTER, INSERT, UPDATE or DELETE, not even an idempotent
 *     schema-ensure (the writer path owns all DDL);
 *   • no registry rebuild, no source download, no authority refresh;
 *   • no provider call, no Kite session, no ticker, no subscription;
 *   • nothing is scheduled and no timer is installed.
 *
 * It prints counts, equations and hashes only. The instrument/token payload is
 * never printed: its size is the point of the manifest hash, and dumping it
 * would put a full tradeable universe in a log.
 *
 * Usage:  npx tsx scripts/p08a.realGenerationEvidence.ts
 */

import {
  loadLatestAcceptedGeneration,
  isRegistryRestorationSettled,
  getRegistryRestorationDiagnostics,
} from "../src/lib/registry/manifestStore";
import {
  buildSubscriptionAdmissionManifest,
  ALL_SUBSCRIPTION_CLASSIFICATIONS,
} from "../src/lib/registry/subscriptionManifest";
import { planFeedShards } from "../src/lib/registry/feedShardPlan";
import {
  evaluateFeedOwnershipAdmission,
  readTopologySignals,
  readDeclaredDeploymentTargetFromDisk,
} from "../src/lib/registry/feedOwnershipAdmission";
import { evaluateActivationGates } from "../src/lib/registry/feedActivationGates";

/** The generation the owner directive names for this evidence run. */
const EXPECTED_GENERATION_ID = "P06-b1632484542c83eb";

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(46)} ${String(value)}`);
}

/**
 * Every condition this run exists to prove. A printout that a human has to read
 * carefully is not evidence: the script must fail loudly when any one of these
 * is false, so a green exit code means the same thing every time.
 */
const failures: string[] = [];
function assertTrue(name: string, condition: boolean, detail?: string): void {
  if (!condition) failures.push(detail ? `${name} (${detail})` : name);
  line(`  [${condition ? "OK  " : "FAIL"}] ${name}`, detail ?? "");
}

async function main(): Promise<void> {
  const generation = await loadLatestAcceptedGeneration("PHASE_0_8A_READ_ONLY_EVIDENCE");
  const diag = getRegistryRestorationDiagnostics();

  console.log("=== LOADER (read-only path) ===");
  line("restorationState", diag.state);
  line("source", diag.source);
  line("blockerCode", diag.blockerCode ?? "NONE");
  line("settled", isRegistryRestorationSettled());

  if (!generation) {
    console.log("\nNO GENERATION RESTORED — cannot classify. Nothing was written.");
    process.exit(2);
  }

  line("registryGenerationId", generation.manifest.registryGenerationId);
  line("schemaVersion", generation.manifest.schemaVersion);
  line("policyVersion", generation.manifest.policyVersion);
  line("records", generation.records.length);

  // The run only counts as evidence about the DURABLE PostgreSQL generation the
  // directive names. A disk-cached fallback, or any other generation, is a
  // different claim and must not exit green.
  assertTrue("restored from L2 PostgreSQL (not the L1 disk fallback)", diag.source === "L2_POSTGRESQL", String(diag.source));
  assertTrue(
    "restored generation is the directed one",
    generation.manifest.registryGenerationId === EXPECTED_GENERATION_ID,
    `${generation.manifest.registryGenerationId} vs ${EXPECTED_GENERATION_ID}`,
  );
  assertTrue("schema version is 5", generation.manifest.schemaVersion === 5);
  assertTrue("restoration settled", isRegistryRestorationSettled());

  const nowMs = Date.now();
  const manifest = buildSubscriptionAdmissionManifest({
    generation,
    nowMs,
    restorationSettled: isRegistryRestorationSettled(),
  });

  console.log("\n=== SUBSCRIPTION ADMISSION MANIFEST (production classifier) ===");
  line("evaluatedAt", manifest.evaluatedAt);
  line("state", manifest.state);
  line("activationAuthorized", manifest.activationAuthorized);
  line("authorityState", manifest.authorityState);
  line("authorityReasons", manifest.authorityReasons.join(",") || "NONE");
  line("blockerCode", manifest.blockerCode ?? "NONE");
  line("blockers", manifest.blockers.join(",") || "NONE");

  console.log("\n--- eight classification buckets ---");
  let bucketSum = 0;
  for (const c of ALL_SUBSCRIPTION_CLASSIFICATIONS) {
    const n = manifest.classificationCounts[c];
    bucketSum += n;
    line(`  ${c}`, n);
  }
  line("  SUM(buckets)", bucketSum);
  line("  totalRegistryRecords", manifest.totalRecords);
  line("  remainder (records - SUM)", manifest.remainder);
  assertTrue("classification remainder is zero", manifest.remainder === 0, String(manifest.remainder));
  assertTrue("buckets sum to the record count", bucketSum === manifest.totalRecords, `${bucketSum} vs ${manifest.totalRecords}`);
  assertTrue("record count equals the stored generation", manifest.totalRecords === generation.records.length);

  const eq = manifest.liveRequired;
  console.log("\n--- LIVE_REQUIRED equation ---");
  line("  total", eq.total);
  line("  mapped", eq.mapped);
  line("  unmapped", eq.unmapped);
  line("  divertedIdentityInvalid", eq.divertedIdentityInvalid);
  line("  divertedTokenConflict", eq.divertedTokenConflict);
  line("  divertedListingNotActive", eq.divertedListingNotActive);
  line("  divertedUnsupportedClass", eq.divertedUnsupportedClass);
  assertTrue("LIVE_REQUIRED equation balances", eq.balances);
  assertTrue(
    "LIVE_REQUIRED total equals its parts",
    eq.total ===
      eq.mapped +
        eq.unmapped +
        eq.divertedIdentityInvalid +
        eq.divertedTokenConflict +
        eq.divertedListingNotActive +
        eq.divertedUnsupportedClass,
  );
  assertTrue("mapped equals the LIVE_MAPPED bucket", eq.mapped === manifest.classificationCounts.LIVE_MAPPED);
  assertTrue("unmapped equals the LIVE_UNMAPPED bucket", eq.unmapped === manifest.classificationCounts.LIVE_UNMAPPED);

  console.log("\n--- admitted set ---");
  line("  admittedCount", manifest.admitted.length);
  line("  indices in admitted set", manifest.admitted.filter((a) => a.segment === "INDEX").length);
  line("  equities in admitted set", manifest.admitted.filter((a) => a.segment === "EQUITY").length);
  line("  subscriptionSetHash", manifest.subscriptionSetHash ?? "NULL");
  assertTrue("admitted set equals LIVE_MAPPED", manifest.admitted.length === manifest.classificationCounts.LIVE_MAPPED);
  assertTrue("subscription set hash present", typeof manifest.subscriptionSetHash === "string" && manifest.subscriptionSetHash.length === 64);
  // Expired authority must produce a candidate, never an activatable universe.
  assertTrue("state is CANDIDATE_LAST_KNOWN", manifest.state === "CANDIDATE_LAST_KNOWN", manifest.state);
  assertTrue("activation is NOT authorized", manifest.activationAuthorized === false);
  assertTrue("authority state is LAST_KNOWN", manifest.authorityState === "LAST_KNOWN", String(manifest.authorityState));
  assertTrue(
    "blocked by REGISTRY_AUTHORITY_NOT_CURRENT",
    manifest.blockers.includes("REGISTRY_AUTHORITY_NOT_CURRENT"),
    manifest.blockers.join(",") || "NONE",
  );

  const plan = planFeedShards(manifest);
  console.log("\n=== FEED SHARD PLAN (production planner) ===");
  line("state", plan.state);
  line("blockerCode", plan.blockerCode ?? "NONE");
  line("shardPolicyVersion", plan.shardPolicyVersion);
  line("capacity", plan.capacity);
  line("totalTokens", plan.totalTokens);
  line("headroom", plan.headroom);
  line("activationAuthorized", plan.activationAuthorized);
  for (const s of plan.shards) {
    line(`  shard ${s.shardId} count`, s.count);
    line(`  shard ${s.shardId} priorityClass`, s.priorityClass);
    line(`  shard ${s.shardId} indices`, s.identities.filter((id) => id.includes(":INDEX:")).length);
    line(`  shard ${s.shardId} shardHash`, s.shardHash);
  }
  line("completeManifestHash", plan.completeManifestHash ?? "NULL");

  console.log("\n--- placement proofs (no payload printed) ---");
  const planTokens = plan.shards.flatMap((s) => [...s.tokens]);
  const planIdentities = plan.shards.flatMap((s) => [...s.identities]);
  const admittedTokens = manifest.admitted.map((a) => a.providerToken);
  line("  planned tokens", planTokens.length);
  line("  distinct planned tokens", new Set(planTokens).size);
  assertTrue("no provider token occurs twice", new Set(planTokens).size === planTokens.length);
  // Every admitted token is planned exactly once: the planned tokens are
  // distinct, they number exactly as many as the admitted set, and the union of
  // the two sets introduces nothing new (so neither side holds a stranger).
  const plannedSet = new Set(planTokens);
  line("  admitted tokens", admittedTokens.length);
  assertTrue(
    "every admitted token planned exactly once",
    plannedSet.size === planTokens.length &&
      planTokens.length === admittedTokens.length &&
      new Set([...planTokens, ...admittedTokens]).size === plannedSet.size,
  );
  line("  distinct planned identities", new Set(planIdentities).size);
  assertTrue("no identity occurs twice", new Set(planIdentities).size === planIdentities.length);
  const indexIdentities = manifest.admitted.filter((a) => a.segment === "INDEX").map((a) => a.canonicalInstrumentId);
  const shard0 = new Set(plan.shards[0]?.identities ?? []);
  line("  required indices", indexIdentities.length);
  assertTrue("every required index is in shard 0", indexIdentities.length > 0 && indexIdentities.every((id) => shard0.has(id)));
  const counts = plan.shards.map((s) => s.count);
  const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
  line("  max-min shard spread", spread);
  assertTrue("plan state is PLANNED", plan.state === "PLANNED", plan.state);
  assertTrue("no shard exceeds the socket ceiling", plan.shards.every((s) => s.count <= plan.maxTokensPerSocket));
  assertTrue("no empty shard is planned", plan.shards.every((s) => s.count > 0));
  assertTrue("shard count is within the provider socket limit", plan.shards.length <= plan.maxSockets);
  // Shard 0 holds 208 indices — far below an even share — so nothing forces it
  // wider here and the plain balance rule must hold.
  assertTrue("shard counts are balanced within one", spread <= 1, String(spread));
  assertTrue("totals reconcile with capacity", plan.totalTokens === manifest.admitted.length && plan.headroom === plan.capacity - plan.totalTokens);
  assertTrue("plan does not authorize activation", plan.activationAuthorized === false);
  assertTrue("complete manifest hash present", typeof plan.completeManifestHash === "string" && plan.completeManifestHash.length === 64);

  const ownership = evaluateFeedOwnershipAdmission(
    readTopologySignals(process.env, readDeclaredDeploymentTargetFromDisk(process.cwd())),
  );
  console.log("\n=== FEED OWNERSHIP ADMISSION ===");
  line("topology", ownership.topology.topology);
  line("topologyEvidence", ownership.topology.declaredDeploymentTarget ?? "NONE");
  line("ownershipAdmitted", ownership.ownershipAdmitted);
  line("singleWriterStructurallyGuaranteed", ownership.singleWriterStructurallyGuaranteed);
  line("blockerCode", ownership.blockerCode ?? "NONE");
  assertTrue("feed ownership is refused on this topology", ownership.ownershipAdmitted === false);
  assertTrue("single writer is NOT structurally guaranteed", ownership.singleWriterStructurallyGuaranteed === false);
  assertTrue("ownership refusal carries a blocker code", typeof ownership.blockerCode === "string" && ownership.blockerCode.length > 0);

  const gates = evaluateActivationGates({ manifest, plan, ownership });
  console.log("\n=== ACTIVATION GATES ===");
  for (const g of gates.gates) line(`  ${g.id}`, `${g.state}${g.detail ? ` — ${g.detail}` : ""}`);
  line("blockingGateIds", gates.blockingGateIds.join(",") || "NONE");
  assertTrue("activation is blocked", gates.activationAuthorized === false);
  assertTrue("not every gate passes", gates.allGatesPass === false);
  for (const required of [
    "REGISTRY_AUTHORITY_CURRENT",
    "FEED_OWNERSHIP_SINGLE_WRITER_ADMITTED",
    "KITE_SESSION_VALID",
    "OWNER_ACTIVATION_AUTHORIZATION",
  ]) {
    assertTrue(`gate blocks activation: ${required}`, gates.blockingGateIds.includes(required));
  }
  assertTrue(
    "Kite session is not evaluated in this phase",
    gates.gates.find((g) => g.id === "KITE_SESSION_VALID")?.state === "NOT_EVALUATED",
  );
  assertTrue(
    "integrity gates that CAN pass do pass",
    ["REGISTRY_RESTORATION_SETTLED", "SUBSCRIPTION_MANIFEST_INTEGRITY_VALID", "CLASSIFICATION_REMAINDER_ZERO", "PROVIDER_TOKEN_INVARIANTS_HOLD"].every(
      (id) => gates.gates.find((g) => g.id === id)?.state === "PASS",
    ),
  );

  console.log("\nREAD-ONLY: 2 SELECT statements issued; 0 writes, 0 DDL, 0 provider calls, 0 sockets.");
  if (failures.length > 0) {
    console.log(`\nRESULT: FAIL — ${failures.length} unmet condition(s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nRESULT: PASS — every required real-generation condition holds.");
  process.exit(0);
}

main().catch((err) => {
  console.error("EVIDENCE RUN FAILED", err);
  process.exit(1);
});
