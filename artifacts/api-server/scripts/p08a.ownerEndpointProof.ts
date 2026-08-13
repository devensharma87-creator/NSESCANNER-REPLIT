/**
 * PHASE 0.8A — OWNER-ONLY DIAGNOSTIC ENDPOINT PROOF (ISOLATED, READ-ONLY)
 *
 * The cheapest isolated way to exercise the real route with the real auth
 * middleware: mount ONLY the data-health router on a throwaway express app,
 * bind an ephemeral port on loopback, make two requests, and shut down.
 *
 * No build, no browser, no workflow restart. Boot-proof mode is on, so no
 * provider bootstrap, ticker, subscription, scheduler or ingestor can start.
 * The only database traffic is the read-only registry restore (two SELECTs).
 *
 * Proves, in one run:
 *   1. anonymous request  → 401
 *   2. owner-cookie request → 200
 *   3. the response metadata equals the direct in-process classifier output
 *   4. no secret, credential or instrument/token payload appears in the body
 *   5. no socket/timer handles are left behind by the request path
 *
 * Usage:
 *   DATA_FOUNDATION_BOOT_PROOF=1 npx tsx scripts/p08a.ownerEndpointProof.ts
 */

import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";

import dataHealthRouter from "../src/routes/dataHealth";
import {
  loadLatestAcceptedGeneration,
  isRegistryRestorationSettled,
  getActiveGeneration,
} from "../src/lib/registry/manifestStore";
import { buildSubscriptionAdmissionManifest } from "../src/lib/registry/subscriptionManifest";
import { planFeedShards } from "../src/lib/registry/feedShardPlan";
import {
  evaluateFeedOwnershipAdmission,
  readTopologySignals,
  readDeclaredDeploymentTargetFromDisk,
} from "../src/lib/registry/feedOwnershipAdmission";
import { evaluateActivationGates } from "../src/lib/registry/feedActivationGates";

const COOKIE_NAME = "scanner_session";

/** cookie-signature wire format: s:<value>.<base64 hmac, padding stripped>. */
function signedOwnerCookie(secret: string): string {
  const sig = createHmac("sha256", secret).update("owner").digest("base64").replace(/=+$/, "");
  return `${COOKIE_NAME}=${encodeURIComponent(`s:owner.${sig}`)}`;
}

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(46)} ${String(value)}`);
}

async function main(): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("SESSION_SECRET is not set in this environment — cannot mint an owner cookie.");
    process.exit(2);
  }

  // Read-only restore so the route has the same generation the direct
  // classifier run used. Two SELECTs; no DDL, no write.
  await loadLatestAcceptedGeneration("PHASE_0_8A_ENDPOINT_PROOF");

  const app = express();
  app.use(cookieParser(secret));
  // The route's error branch logs through req.log; give it a no-op logger so a
  // failure surfaces as a 500 body rather than a crash.
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", dataHealthRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/data-health/subscription-admission`;

  // Handle baseline taken AFTER the read-only restore and AFTER the listener is
  // bound, so anything counted later was added by the request path itself.
  const baselineHandles = (process as unknown as { getActiveResourcesInfo?: () => string[] })
    .getActiveResourcesInfo?.() ?? [];

  const anon = await fetch(url);
  console.log("=== 1. ANONYMOUS REQUEST ===");
  line("status", anon.status);
  const anonBody = await anon.text();
  line("body", anonBody.slice(0, 120));

  const owner = await fetch(url, { headers: { cookie: signedOwnerCookie(secret) } });
  console.log("\n=== 2. OWNER REQUEST ===");
  line("status", owner.status);
  const bodyText = await owner.text();
  const body = JSON.parse(bodyText) as Record<string, any>;
  line("phase", body.phase);
  line("manifest.state", body.manifest?.state);
  line("manifest.registryGenerationId", body.manifest?.registryGenerationId);
  line("manifest.activationAuthorized", body.manifest?.activationAuthorized);
  line("manifest.totalRecords", body.manifest?.totalRecords);
  line("manifest.remainder", body.manifest?.remainder);
  line("manifest.admittedCount", body.manifest?.admittedCount);
  line("manifest.subscriptionSetHash", body.manifest?.subscriptionSetHash);
  line("manifest.blockers", (body.manifest?.blockers ?? []).join(",") || "NONE");
  line("shardPlan.state", body.shardPlan?.state);
  line("shardPlan.shardPolicyVersion", body.shardPlan?.shardPolicyVersion ?? "(not exposed)");
  line("shardPlan.totalTokens", body.shardPlan?.totalTokens);
  line("shardPlan.headroom", body.shardPlan?.headroom);
  line("shardPlan.shard counts", (body.shardPlan?.shards ?? []).map((s: any) => s.count).join(","));
  line("shardPlan.completeManifestHash", body.shardPlan?.completeManifestHash);
  line("feedOwnership.ownershipAdmitted", body.feedOwnership?.ownershipAdmitted);
  line("feedOwnership.blockerCode", body.feedOwnership?.blockerCode);
  line("activationGates.activationAuthorized", body.activationGates?.activationAuthorized);
  line("activationGates.blockingGateIds", (body.activationGates?.blockingGateIds ?? []).join(","));

  // 3. The endpoint must agree with the direct classifier, field for field on
  //    every number and hash that matters.
  const generation = getActiveGeneration();
  const direct = buildSubscriptionAdmissionManifest({
    generation,
    nowMs: Date.now(),
    restorationSettled: isRegistryRestorationSettled(),
  });
  const directPlan = planFeedShards(direct);
  const directOwnership = evaluateFeedOwnershipAdmission(
    readTopologySignals(process.env, readDeclaredDeploymentTargetFromDisk(process.cwd())),
  );
  const directGates = evaluateActivationGates({
    manifest: direct,
    plan: directPlan,
    ownership: directOwnership,
  });

  // The whole response is rebuilt from the direct evaluation and compared as a
  // TREE, not field by field. Deep equality is the only comparison that also
  // catches what a checklist cannot: an extra field, a nested object that
  // started serialising identities, a dropped blocker. Only wall-clock stamps
  // are normalised, because the two evaluations happen milliseconds apart.
  const expectedBody = {
    phase: "PHASE_0_8A",
    evaluatedAt: direct.evaluatedAt,
    manifest: {
      state: direct.state,
      activationAuthorized: direct.activationAuthorized,
      policyVersion: direct.policyVersion,
      registryGenerationId: direct.registryGenerationId,
      registryGeneratedAt: direct.registryGeneratedAt,
      schemaVersion: direct.schemaVersion,
      manifestPolicyVersion: direct.manifestPolicyVersion,
      authorityState: direct.authorityState,
      authorityReasons: direct.authorityReasons,
      totalRecords: direct.totalRecords,
      classificationCounts: direct.classificationCounts,
      remainder: direct.remainder,
      liveRequired: direct.liveRequired,
      admittedCount: direct.admitted.length,
      subscriptionSetHash: direct.subscriptionSetHash,
      blockers: direct.blockers,
      blockerCode: direct.blockerCode,
    },
    shardPlan: {
      state: directPlan.state,
      blockerCode: directPlan.blockerCode,
      capacity: directPlan.capacity,
      maxSockets: directPlan.maxSockets,
      maxTokensPerSocket: directPlan.maxTokensPerSocket,
      totalTokens: directPlan.totalTokens,
      headroom: directPlan.headroom,
      completeManifestHash: directPlan.completeManifestHash,
      activationAuthorized: directPlan.activationAuthorized,
      shards: directPlan.shards.map((s) => ({
        shardId: s.shardId,
        priorityClass: s.priorityClass,
        count: s.count,
        shardHash: s.shardHash,
      })),
    },
    feedOwnership: {
      ownershipAdmitted: directOwnership.ownershipAdmitted,
      singleWriterStructurallyGuaranteed: directOwnership.singleWriterStructurallyGuaranteed,
      blockerCode: directOwnership.blockerCode,
      rationale: directOwnership.rationale,
      phase: directOwnership.phase,
      topology: directOwnership.topology,
      rejectedMechanisms: directOwnership.rejectedMechanisms,
    },
    activationGates: directGates,
  };

  /** Sort keys and blank wall-clock stamps so the comparison is about content. */
  const TIME_KEYS = new Set(["evaluatedAt", "assessedAt", "checkedAt", "timestamp", "at"]);
  const normalise = (node: unknown, key?: string): unknown => {
    if (key && TIME_KEYS.has(key)) return "<TIMESTAMP>";
    if (Array.isArray(node)) return node.map((n) => normalise(n));
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(node).sort()) out[k] = normalise((node as any)[k], k);
      return out;
    }
    return node === undefined ? null : node;
  };
  const gotTree = JSON.stringify(normalise(body), null, 1).split("\n");
  const wantTree = JSON.stringify(normalise(JSON.parse(JSON.stringify(expectedBody))), null, 1).split("\n");
  console.log("\n=== 3. ENDPOINT vs DIRECT EVALUATION (whole-tree deep equality) ===");
  const treeMatch = gotTree.join("\n") === wantTree.join("\n");
  if (!treeMatch) {
    const firstDiff = gotTree.findIndex((l, i) => l !== wantTree[i]);
    line("  first differing line", firstDiff);
    line("  endpoint", gotTree[firstDiff]);
    line("  direct", wantTree[firstDiff]);
  }
  line("  compared JSON lines", wantTree.length);
  line("  timestamp fields normalised", [...TIME_KEYS].join(","));
  line("  activationGates compared in full", JSON.stringify(directGates.blockingGateIds));
  line("  feedOwnership compared in full (incl. topology, rejectedMechanisms)", directOwnership.rejectedMechanisms.length);
  const allMatch = treeMatch;
  line("WHOLE RESPONSE MATCHES DIRECT EVALUATION", allMatch);

  // 4. Nothing sensitive and no payload. Key spellings, not entropy guesses:
  //    the response is full of long upper-snake enum codes and sha256 hashes,
  //    which any naive "looks like a secret" regex flags.
  console.log("\n=== 4. RESPONSE SAFETY SCAN ===");
  //    Two precise checks instead: (a) no response KEY is a credential-bearing
  //    name, (b) no environment value appears anywhere in the body.
  const forbiddenKeyNames = new Set([
    "apikey", "api_key", "accesstoken", "access_token", "refreshtoken", "secret",
    "apisecret", "api_secret", "password", "credential", "credentials",
    "authorization", "cookie", "sessionid", "session_secret", "databaseurl",
    "database_url", "requesttoken", "request_token",
  ]);
  const badKeys: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (forbiddenKeyNames.has(k.toLowerCase())) badKeys.push(k);
        walk(v);
      }
    }
  };
  walk(body);
  line("credential-bearing keys in response", badKeys.join(",") || "NONE");

  // Every environment value of meaningful length must be absent from the body.
  // Names are printed, values never are.
  const leakedEnvNames = Object.entries(process.env)
    .filter(([, v]) => typeof v === "string" && v.length >= 8)
    .filter(([, v]) => bodyText.includes(v as string))
    .map(([k]) => k);
  line("environment values echoed in body", leakedEnvNames.join(",") || "NONE");
  const hits = [...badKeys, ...leakedEnvNames];
  line("body bytes", bodyText.length);

  // The response must carry ONLY the agreed metadata shape. An allow-list beats
  // a deny-list here: a future field that starts serialising identities is
  // caught because it is unexpected, not because someone predicted its name.
  const ALLOWED: Record<string, readonly string[]> = {
    $root: ["phase", "evaluatedAt", "manifest", "shardPlan", "feedOwnership", "activationGates"],
    manifest: [
      "state", "activationAuthorized", "policyVersion", "registryGenerationId",
      "registryGeneratedAt", "schemaVersion", "manifestPolicyVersion", "authorityState",
      "authorityReasons", "totalRecords", "classificationCounts", "remainder",
      "liveRequired", "admittedCount", "subscriptionSetHash", "blockers", "blockerCode",
    ],
    shardPlan: [
      "state", "blockerCode", "capacity", "maxSockets", "maxTokensPerSocket",
      "totalTokens", "headroom", "completeManifestHash", "activationAuthorized", "shards",
    ],
    shard: ["shardId", "priorityClass", "count", "shardHash"],
    feedOwnership: [
      "ownershipAdmitted", "singleWriterStructurallyGuaranteed", "blockerCode",
      "rationale", "phase", "topology", "rejectedMechanisms",
    ],
  };
  const unexpected: string[] = [];
  const checkKeys = (obj: unknown, allowed: readonly string[], where: string): void => {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) unexpected.push(`${where}.${k}`);
  };
  checkKeys(body, ALLOWED.$root, "$");
  checkKeys(body.manifest, ALLOWED.manifest, "manifest");
  checkKeys(body.shardPlan, ALLOWED.shardPlan, "shardPlan");
  checkKeys(body.feedOwnership, ALLOWED.feedOwnership, "feedOwnership");
  for (const s of body.shardPlan?.shards ?? []) checkKeys(s, ALLOWED.shard, "shardPlan.shards[]");
  line("unexpected response fields", unexpected.join(",") || "NONE");

  // No payload, checked against the WHOLE admitted set rather than a sample,
  // and structurally rather than by substring: a raw-text search reports a hit
  // whenever a six-digit token happens to sit inside a sha256 hash, which says
  // nothing about whether the token was published. What matters is whether any
  // token or identity appears as an actual VALUE in the response tree.
  //    KEYS are scanned too: an identity-keyed object would leak the payload
  //    without ever putting an identity in a value position.
  const values: string[] = [];
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        values.push(k);
        collect(v);
      }
      return;
    }
    values.push(String(node));
  };
  collect(body);
  const valueSet = new Set(values);
  const echoedTokens = direct.admitted.filter((a) => valueSet.has(String(a.providerToken))).length;
  const echoedIdentities = direct.admitted.filter((a) => valueSet.has(a.canonicalInstrumentId)).length;
  const substringTokenHits = direct.admitted.filter((a) => bodyText.includes(String(a.providerToken))).length;
  line("admitted set size checked", direct.admitted.length);
  line("provider tokens present as a value", echoedTokens);
  line("canonical identities present as a value", echoedIdentities);
  line("raw-substring token hits (hash coincidence)", substringTokenHits);
  const payloadMarkers = ['"identities"', '"tokens"', '"admitted":['].filter((m) => bodyText.includes(m));
  line("payload markers present", payloadMarkers.join(" ") || "NONE");
  // Size is the blunt structural proof: 7,876 identities cannot hide in 5 KB.
  let longestArray = 0;
  const measureArrays = (node: unknown): void => {
    if (Array.isArray(node)) {
      longestArray = Math.max(longestArray, node.length);
      return node.forEach(measureArrays);
    }
    if (node && typeof node === "object") Object.values(node).forEach(measureArrays);
  };
  measureArrays(body);
  line("longest array in response", longestArray);
  const sizeBounded = bodyText.length < 16384 && longestArray <= 16;
  line("payload structurally impossible (size + array bound)", sizeBounded);

  // 5. The request path must leave nothing running. Baselined, because the
  //    read-only registry restore legitimately holds a database socket open
  //    and that handle exists before the first request is made.
  console.log("\n=== 5. RESIDUAL HANDLES ===");
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  const after = (process as unknown as { getActiveResourcesInfo?: () => string[] })
    .getActiveResourcesInfo?.() ?? [];
  const tally = (xs: readonly string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const beforeTally = tally(baselineHandles);
  const addedHandles = [...tally(after).entries()]
    .filter(([k, n]) => n > (beforeTally.get(k) ?? 0))
    .map(([k, n]) => `${k}x${n - (beforeTally.get(k) ?? 0)}`);
  line("baseline handles (pre-request)", baselineHandles.join(",") || "NONE");
  line("handles after requests", after.join(",") || "NONE");
  line("handles ADDED by the request path", addedHandles.join(",") || "NONE");

  const pass =
    anon.status === 401 &&
    owner.status === 200 &&
    allMatch &&
    hits.length === 0 &&
    unexpected.length === 0 &&
    payloadMarkers.length === 0 &&
    echoedTokens === 0 &&
    echoedIdentities === 0 &&
    sizeBounded &&
    addedHandles.length === 0;
  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("ENDPOINT PROOF FAILED", err);
  process.exit(1);
});
