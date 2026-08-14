/**
 * PHASE 0.8B — THREE-SHARD FEED MANAGER (BUILT, DISABLED)
 *
 * Owns every socket the process would ever hold, and the state machine that
 * decides whether it may hold any. This phase builds the machine and leaves it
 * switched off: `FEED_RUNTIME_ACTIVATION_AUTHORIZED` is a compile-time `false`,
 * so a production process constructs this manager, wires its shutdown hook, and
 * never opens a connection.
 *
 * STATE MACHINE
 * -------------
 *   DISABLED ──────────► WAITING_FOR_GATES ──► STARTING ──► RUNNING ⇄ DEGRADED
 *      ▲                                          │             │        │
 *      │                                          ▼             ▼        ▼
 *      └───────────────── STOPPED ◄──── STOPPING ◄─────────────────────────
 *                            ▲
 *                          FAILED (terminal for this start attempt)
 *
 * WHY STARTUP IS TRANSACTIONAL
 * ----------------------------
 * Three sockets are opened one after another; the third can fail after the
 * first two succeeded. A manager that reported RUNNING at that point would hold
 * two-thirds of the universe while every consumer, and the coverage badge,
 * believed it held all of it. The missing third produces no error — it produces
 * silence, which reads exactly like a quiet instrument.
 *
 * So startup is all-or-nothing: any failure closes every socket opened during
 * the attempt and lands in FAILED with zero clients held. RUNNING is set only
 * after EVERY shard has connected AND confirmed a complete subscription.
 *
 * PARTIAL SUBSCRIPTION IS A FAILURE, NOT A DEGRADED SUCCESS
 * ---------------------------------------------------------
 * A provider that accepts 2,600 of 2,625 tokens has not "mostly worked". The 25
 * rejected instruments are indistinguishable from instruments that simply are
 * not trading. The accepted set is therefore compared for exact equality with
 * the requested set, not for a count or a threshold.
 *
 * WHY A LOST SHARD IS NEVER REDISTRIBUTED
 * ---------------------------------------
 * The instinct on losing socket 1 is to spread its ~2,625 tokens over sockets 0
 * and 2. It cannot be done. Each socket holds a hard 3,000-token ceiling and is
 * already carrying ~2,625, leaving ~375 free apiece — 750 against 2,625 needed.
 * Redistribution would either breach the provider ceiling (which fails the
 * whole socket, turning one lost shard into three) or silently drop ~1,875
 * instruments while reporting a successful rebalance. So a lost shard makes the
 * manager DEGRADED and stays lost until its own replacement socket connects.
 * DEGRADED is a truthful state; a rebalanced lie is not.
 *
 * WHY THE OLD CLIENT IS CLOSED BEFORE THE REPLACEMENT IS CONSTRUCTED
 * ------------------------------------------------------------------
 * The provider counts concurrent sockets per API KEY. A "disconnected" client
 * that has not been closed may still be counted. Constructing the replacement
 * first would momentarily require a fourth socket against a three-socket
 * ceiling, and the provider refuses the new one — so the recovery attempt
 * itself is what prevents recovery. The slot is therefore emptied and its old
 * client closed BEFORE any replacement is built, and the slot array is fixed at
 * MAX_SOCKETS entries so a fourth cannot be represented, let alone held.
 */

import {
  type FeedClientFactory,
  type FeedClientPort,
  type FeedClientEvents,
  type FeedTickEnvelope,
  type FeedSubscriptionConfirmation,
} from "./feedClientPort";
import { MAX_SOCKETS } from "../registry/feedShardPlan";
import type { FeedShardPlan } from "../registry/feedShardPlan";
import { admitShardPlan, type ShardAdmissionBlocker } from "./shardPlanInvariants";
import { ingestTick, type TickAdmissionContext, type TickRejectReason } from "./tickIngestion";

/**
 * THE RUNTIME LOCK.
 *
 * Phase 0.8B delivers the machine, not the feed. Activation is a separate,
 * explicitly authorised change. Typed as `boolean` (not `false`) so tests can
 * assert `=== false` without the comparison being narrowed away at compile
 * time — the same convention as the other runtime locks in this codebase.
 */
export const FEED_RUNTIME_ACTIVATION_AUTHORIZED: boolean = false;

export type FeedManagerState =
  | "DISABLED"
  | "WAITING_FOR_GATES"
  | "STARTING"
  | "RUNNING"
  | "DEGRADED"
  | "STOPPING"
  | "STOPPED"
  | "FAILED";

export type FeedManagerBlocker =
  | "FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED"
  | "ACTIVATION_GATES_NOT_PASSED"
  | "ACTIVATION_GENERATION_MISSING"
  | "ACTIVATION_GENERATION_MISMATCH"
  | "ACTIVATION_MANIFEST_HASH_MISSING"
  | "ACTIVATION_MANIFEST_HASH_MISMATCH"
  | "SHARD_PLAN_NOT_ADMISSIBLE"
  | "SOCKET_CEILING_WOULD_BE_EXCEEDED"
  | "CLIENT_CONSTRUCTION_FAILED"
  | "CLIENT_CONNECT_FAILED"
  | "SUBSCRIBE_FAILED"
  | "SUBSCRIPTION_INCOMPLETE"
  | "MANAGER_ALREADY_ACTIVE"
  | "SHUTDOWN_IN_PROGRESS"
  | "SHARD_LOST_DURING_STARTUP"
  | "SOCKET_RELEASE_FAILED";

// ── Structured activation gates ────────────────────────────────────────────

/**
 * Stable identifiers for every gate the manager must see PASS before creating
 * a single socket. These are checked by the manager itself — never trusted
 * from a caller-supplied summary boolean.
 */
export type FeedActivationGateId =
  | "REGISTRY_RESTORATION_SETTLED"
  | "REGISTRY_AUTHORITY_CURRENT"
  | "REGISTRY_SCHEMA_AND_POLICY_SUPPORTED"
  | "SUBSCRIPTION_MANIFEST_ACCEPTED"
  | "REGISTRY_GENERATION_ID_PRESENT"
  | "SUBSCRIPTION_SET_HASH_PRESENT"
  | "COMPLETE_MANIFEST_HASH_PRESENT"
  | "SHARD_POLICY_VERSION_SUPPORTED"
  | "SHARD_PLAN_CAPACITY_ADMITTED"
  | "FEED_OWNERSHIP_SINGLETON_ATTESTED"
  | "SHUTDOWN_LIFECYCLE_INSTALLED"
  | "KITE_SESSION_VALID"
  | "TOKEN_RECONCILIATION_CLEAR"
  | "OWNER_ACTIVATION_AUTHORIZATION"
  | "COMPILE_TIME_FEED_LOCK";

export type ActivationGateDecisionState = "PASS" | "FAIL" | "NOT_EVALUATED";

export interface FeedActivationGate {
  readonly gateId: FeedActivationGateId;
  readonly state: ActivationGateDecisionState;
  readonly blockerCode?: string;
}

/**
 * Every gate the manager requires. A gate missing from the supplied array is
 * treated as NOT_EVALUATED (same as FAIL — never counts as passing).
 */
export const REQUIRED_ACTIVATION_GATE_IDS: readonly FeedActivationGateId[] = [
  "REGISTRY_RESTORATION_SETTLED",
  "REGISTRY_AUTHORITY_CURRENT",
  "REGISTRY_SCHEMA_AND_POLICY_SUPPORTED",
  "SUBSCRIPTION_MANIFEST_ACCEPTED",
  "REGISTRY_GENERATION_ID_PRESENT",
  "SUBSCRIPTION_SET_HASH_PRESENT",
  "COMPLETE_MANIFEST_HASH_PRESENT",
  "SHARD_POLICY_VERSION_SUPPORTED",
  "SHARD_PLAN_CAPACITY_ADMITTED",
  "FEED_OWNERSHIP_SINGLETON_ATTESTED",
  "SHUTDOWN_LIFECYCLE_INSTALLED",
  "KITE_SESSION_VALID",
  "TOKEN_RECONCILIATION_CLEAR",
  "OWNER_ACTIVATION_AUTHORIZATION",
  "COMPILE_TIME_FEED_LOCK",
] as const;

/**
 * Structured activation decision — the input to start().
 *
 * The manager DERIVES allPassed by inspecting every gate in `gates`.
 * It never trusts a caller-supplied summary boolean. In addition it
 * cross-validates `registryGenerationId` against `plan.registryGenerationId`
 * and `completeManifestHash` against `plan.completeManifestHash` so those
 * cross-checks cannot be defeated by passing matching gate values alone.
 */
export interface StructuredActivationDecision {
  readonly plan: FeedShardPlan;
  readonly gates: readonly FeedActivationGate[];
  /** Cross-validated against plan.registryGenerationId inside start(). */
  readonly registryGenerationId: string | null;
  /** Non-null required for SUBSCRIPTION_SET_HASH_PRESENT gate to pass. */
  readonly subscriptionSetHash: string | null;
  /** Cross-validated against plan.completeManifestHash inside start(). */
  readonly completeManifestHash: string | null;
}

export interface FeedManagerOptions {
  readonly clientFactory: FeedClientFactory;
  readonly getActivation: () => StructuredActivationDecision;
  /** Generation the registry resolves against right now; bound per tick. */
  readonly getCurrentGenerationId: () => string | null;
  readonly now?: () => number;
  /** Observability sink. Never throws into the tick path. */
  readonly onRejectedTick?: (reason: TickRejectReason, detail: string) => void;
}

export interface StartOutcome {
  readonly started: boolean;
  readonly state: FeedManagerState;
  readonly blocker: FeedManagerBlocker | null;
  readonly detail: string;
  readonly shardsConnected: number;
  /** Non-empty only when a rollback could not fully release its sockets. */
  readonly rollbackErrors: readonly string[];
}

export interface ShardSlotView {
  readonly shardId: number;
  readonly held: boolean;
  readonly clientState: string | null;
  readonly lost: boolean;
  readonly expectedTokens: number;
}

export interface FeedManagerDiagnostics {
  readonly state: FeedManagerState;
  readonly blocker: FeedManagerBlocker | null;
  readonly detail: string;
  readonly activationAuthorizedConstant: boolean;
  readonly maxSockets: number;
  readonly clientsHeld: number;
  /**
   * Sockets this process opened and FAILED to release.
   *
   * Non-zero means the provider may still consider those connections live
   * against the per-API-key ceiling. It is tracked separately from
   * `clientsHeld` because such a client is no longer usable — but forgetting
   * it would let the process claim it owns nothing and exit cleanly.
   */
  readonly unreleasedSockets: number;
  /**
   * Whether the provider actually acknowledged the subscriptions behind a
   * RUNNING state, or merely accepted the request. Kite's ticker cannot
   * acknowledge, so RUNNING there means "requested", and this field is what
   * stops that being read as "confirmed".
   */
  readonly subscriptionConfirmation: FeedSubscriptionConfirmation | null;
  readonly shards: readonly ShardSlotView[];
  readonly lostShardIds: readonly number[];
  readonly planGenerationId: string | null;
  readonly acceptedTickCount: number;
  readonly rejectedTickCount: number;
  readonly startAttempts: number;
}

export interface FeedCloseHookResult {
  readonly closed: boolean;
  readonly detail: string;
}

export interface FeedManager {
  state(): FeedManagerState;
  start(): Promise<StartOutcome>;
  /** Provider-driven disconnect. Marks the shard lost; never redistributes. */
  notifyShardDisconnected(shardId: number, reason: string): void;
  /** Attempt one replacement socket for a lost shard. */
  reconnectShard(shardId: number): Promise<{ readonly ok: boolean; readonly detail: string }>;
  /**
   * Release everything. Idempotent and safe when DISABLED/STOPPED.
   * THROWS when a socket could not be released — see the note on the hook.
   */
  close(signal: string): Promise<FeedCloseHookResult>;
  diagnostics(): FeedManagerDiagnostics;
  /** token -> shardId for everything currently subscribed. Empty when not running. */
  subscribedTokenMap(): ReadonlyMap<number, number>;
  lostShardIds(): ReadonlySet<number>;
}

const ACCEPTING_STATES: ReadonlySet<FeedManagerState> = new Set<FeedManagerState>([
  "RUNNING",
  "DEGRADED",
]);

function sameTokenSet(requested: readonly number[], accepted: readonly number[]): boolean {
  if (requested.length !== accepted.length) return false;
  const want = new Set(requested);
  if (want.size !== requested.length) return false; // duplicate in the request
  for (const t of accepted) {
    if (!want.delete(t)) return false;
  }
  return want.size === 0;
}

function createFeedManagerInternal(options: FeedManagerOptions, enforceCompileTimeLock: boolean): FeedManager {
  const now = options.now ?? (() => Date.now());

  let state: FeedManagerState = "DISABLED";
  let blocker: FeedManagerBlocker | null = "FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED";
  let detail = "feed activation is not authorized in this phase";

  /**
   * Fixed-length slot array. A fourth client has nowhere to live — the ceiling
   * is enforced by the shape of the storage, not only by a bounds check.
   */
  const slots: (FeedClientPort | null)[] = new Array<FeedClientPort | null>(MAX_SOCKETS).fill(null);
  const lost = new Set<number>();
  const tokenToShardId = new Map<number, number>();
  /**
   * Sockets this process opened but could not release. See `releaseOne`.
   * Anything on this ledger keeps the manager from ever claiming it owns
   * nothing, which is what keeps the shutdown exit code truthful.
   */
  const unreleased: { readonly shardId: number; readonly client: FeedClientPort }[] = [];

  let planGenerationId: string | null = null;
  let activePlan: FeedShardPlan | null = null;
  /**
   * The WEAKEST subscription confirmation across all shards, or null when
   * nothing is subscribed. Weakest rather than latest: one unconfirmed shard
   * means the feed as a whole is unconfirmed.
   */
  let subscriptionConfirmation: FeedSubscriptionConfirmation | null = null;
  let acceptedTickCount = 0;
  let rejectedTickCount = 0;
  let startAttempts = 0;

  function clientsHeld(): number {
    return slots.reduce<number>((acc, c) => acc + (c === null ? 0 : 1), 0);
  }

  /**
   * Lifecycle operations run STRICTLY ONE AT A TIME.
   *
   * Every one of start/reconnect/close releases a socket and then awaits, and
   * an await is a window in which another caller sees a half-torn-down world:
   * an emptied slot whose socket has not yet been released is invisible to
   * both the held count and the unreleased ledger. Two concurrent reconnects
   * for the same shard could each conclude there was room and open a socket,
   * putting four connections against a ceiling of three; a close overlapping a
   * reconnect could report a clean shutdown and then have a socket opened
   * behind it. Serialising the operations removes the window entirely, which
   * is far easier to prove correct than reserving slots at every await point.
   *
   * Safe from deadlock because no exclusive operation calls another one.
   */
  let operationTail: Promise<void> = Promise.resolve();
  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = operationTail.then(fn);
    // The tail must never reject, or one failed operation would poison every
    // later one. A close() that throws still has to let shutdown proceed.
    operationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Shards that dropped while start() was still bringing the feed up.
   *
   * These cannot go through the normal DEGRADED path: the manager is not yet
   * RUNNING, so there is nothing to degrade from, and swallowing them would
   * let start() finish and declare RUNNING over a shard that is already dead.
   */
  const disconnectedDuringStart = new Set<number>();

  /** Downgrade-only: once any shard is unconfirmed, the feed is unconfirmed. */
  function noteConfirmation(c: FeedSubscriptionConfirmation): void {
    if (c === "REQUEST_ACCEPTED_UNCONFIRMED" || subscriptionConfirmation === null) {
      subscriptionConfirmation =
        c === "REQUEST_ACCEPTED_UNCONFIRMED" ? "REQUEST_ACCEPTED_UNCONFIRMED" : "PROVIDER_ACKNOWLEDGED";
    }
  }

  function set(next: FeedManagerState, b: FeedManagerBlocker | null, d: string): void {
    state = next;
    blocker = b;
    detail = d;
  }

  function admissionContext(): TickAdmissionContext {
    return {
      accepting: ACCEPTING_STATES.has(state),
      planGenerationId,
      currentGenerationId: options.getCurrentGenerationId(),
      tokenToShardId,
      getShardHash: (shardId) =>
        activePlan?.shards.find((s) => s.shardId === shardId)?.shardHash ?? null,
      completeManifestHash: activePlan?.completeManifestHash ?? null,
    };
  }

  function handleTicks(shardId: number, ticks: readonly FeedTickEnvelope[]): void {
    // A lost shard's socket must not be feeding us. If it is, the shard
    // bookkeeping is wrong and the ticks are unattributable.
    const ctx = admissionContext();
    for (const tick of ticks) {
      const res = ingestTick(tick, shardId, ctx);
      if (res.ok) {
        acceptedTickCount++;
      } else {
        rejectedTickCount++;
        options.onRejectedTick?.(res.reason, res.detail);
      }
    }
  }

  function eventsFor(shardId: number): FeedClientEvents {
    return {
      onTicks: (ticks) => handleTicks(shardId, ticks),
      onConnected: () => {
        /* connection success is observed synchronously by start/reconnect */
      },
      onDisconnected: (reason) => notifyShardDisconnected(shardId, reason),
      onError: () => {
        /* transport errors surface as disconnects; nothing to decide here */
      },
    };
  }

  /**
   * Release every held socket, unconditionally.
   *
   * Never short-circuits on the first failure: a client that refuses to close
   * must not prevent the other two from being released. Errors are collected
   * and returned so the caller can decide whether the outcome is honest.
   */
  /**
   * Release ONE client, and never lose it if the release fails.
   *
   * A client whose `close()` refuses or throws is moved to the `unreleased`
   * ledger rather than dropped. Dropping it was the original sin: the manager
   * would then report `clientsHeld: 0`, `close()` would answer "owned
   * nothing", and the shutdown coordinator would exit 0 — while the provider
   * still counted that socket against the three-per-key ceiling. The next
   * deployment would then be refused its third shard with no way to explain
   * why. Remembering the failure is what makes the exit code honest.
   *
   * Returns null on success, or the error text on failure.
   */
  async function releaseOne(shardId: number, client: FeedClientPort): Promise<string | null> {
    try {
      const res = await client.close();
      if (res.ok) return null;
      unreleased.push({ shardId, client });
      return `shard ${shardId}: ${res.detail}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      unreleased.push({ shardId, client });
      return `shard ${shardId}: ${msg}`;
    }
  }

  /**
   * Release every held socket, unconditionally.
   *
   * Never short-circuits on the first failure: a client that refuses to close
   * must not prevent the other two from being released. Errors are collected
   * and returned so the caller can decide whether the outcome is honest.
   */
  async function releaseAll(): Promise<string[]> {
    const errors: string[] = [];
    for (let i = 0; i < slots.length; i++) {
      const client = slots[i];
      if (client === null) continue;
      // Empty the slot first so a throwing close cannot leave a client that is
      // both unreleasable and still counted as held. `releaseOne` keeps hold of
      // it on the unreleased ledger, so emptying the slot loses nothing.
      slots[i] = null;
      const err = await releaseOne(i, client);
      if (err !== null) errors.push(err);
    }
    tokenToShardId.clear();
    return errors;
  }

  /**
   * Re-attempt every socket a previous rollback or reconnect could not release.
   * Still-failing clients stay on the ledger, so the failure cannot be
   * "used up" by a single close attempt.
   */
  async function retryUnreleased(): Promise<string[]> {
    if (unreleased.length === 0) return [];
    const pending = unreleased.splice(0, unreleased.length);
    const errors: string[] = [];
    for (const entry of pending) {
      const err = await releaseOne(entry.shardId, entry.client);
      if (err !== null) errors.push(err);
    }
    return errors;
  }

  async function start(): Promise<StartOutcome> {
    startAttempts++;

    if (state === "STARTING" || state === "RUNNING" || state === "DEGRADED") {
      return Object.freeze({
        started: false,
        state,
        blocker: "MANAGER_ALREADY_ACTIVE" as const,
        detail: "a feed is already active; start refused",
        shardsConnected: clientsHeld(),
        rollbackErrors: Object.freeze([]),
      });
    }
    // A previous attempt left sockets we could not release. Starting again
    // would stack a fresh set on top of connections the provider may still be
    // counting, and blow the per-key ceiling on the second attempt.
    if (unreleased.length > 0) {
      return Object.freeze({
        started: false,
        state,
        blocker: "SOCKET_RELEASE_FAILED" as const,
        detail: `${unreleased.length} socket(s) from a previous attempt were never released; start refused`,
        shardsConnected: clientsHeld(),
        rollbackErrors: Object.freeze([]),
      });
    }
    if (state === "STOPPING") {
      return Object.freeze({
        started: false,
        state,
        blocker: "SHUTDOWN_IN_PROGRESS" as const,
        detail: "shutdown is in progress; start refused",
        shardsConnected: clientsHeld(),
        rollbackErrors: Object.freeze([]),
      });
    }

    // ── The compile-time lock. Only enforced by createFeedManager (not the test factory). ──
    if (enforceCompileTimeLock && !FEED_RUNTIME_ACTIVATION_AUTHORIZED) {
      set(
        "DISABLED",
        "FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED",
        "FEED_RUNTIME_ACTIVATION_AUTHORIZED is false in this build",
      );
      return Object.freeze({
        started: false,
        state,
        blocker,
        detail,
        shardsConnected: 0,
        rollbackErrors: Object.freeze([]),
      });
    }

    const decision = options.getActivation();

    // ── Cross-validate registryGenerationId against the plan (inside the mutex). ──
    // Done independently of the gate array so matching gate values cannot substitute
    // for a correctly bound decision.
    if (decision.registryGenerationId === null) {
      set("FAILED", "ACTIVATION_GENERATION_MISSING", "registryGenerationId is null in decision");
      return Object.freeze({ started: false, state, blocker, detail, shardsConnected: 0, rollbackErrors: Object.freeze([]) });
    }
    if (decision.registryGenerationId !== decision.plan.registryGenerationId) {
      set(
        "FAILED",
        "ACTIVATION_GENERATION_MISMATCH",
        `decision gen=${decision.registryGenerationId} plan gen=${decision.plan.registryGenerationId ?? "null"}`,
      );
      return Object.freeze({ started: false, state, blocker, detail, shardsConnected: 0, rollbackErrors: Object.freeze([]) });
    }

    // ── Cross-validate completeManifestHash against the plan. ──
    if (decision.completeManifestHash === null) {
      set("FAILED", "ACTIVATION_MANIFEST_HASH_MISSING", "completeManifestHash is null in decision");
      return Object.freeze({ started: false, state, blocker, detail, shardsConnected: 0, rollbackErrors: Object.freeze([]) });
    }
    if (decision.completeManifestHash !== decision.plan.completeManifestHash) {
      set(
        "FAILED",
        "ACTIVATION_MANIFEST_HASH_MISMATCH",
        "decision manifest hash differs from plan manifest hash",
      );
      return Object.freeze({ started: false, state, blocker, detail, shardsConnected: 0, rollbackErrors: Object.freeze([]) });
    }

    // ── Re-derive allPassed from each gate state. Never trust a summary boolean. ──
    // A gate not present in the array is treated as NOT_EVALUATED which counts as FAIL.
    {
      const gateMap = new Map(decision.gates.map((g) => [g.gateId, g]));
      const blockingCodes: string[] = [];
      for (const id of REQUIRED_ACTIVATION_GATE_IDS) {
        const gate = gateMap.get(id);
        if (!gate || gate.state !== "PASS") {
          blockingCodes.push(gate?.blockerCode ?? id);
        }
      }
      if (blockingCodes.length > 0) {
        set("WAITING_FOR_GATES", "ACTIVATION_GATES_NOT_PASSED", blockingCodes.join(", "));
        return Object.freeze({ started: false, state, blocker, detail, shardsConnected: 0, rollbackErrors: Object.freeze([]) });
      }
    }

    // Re-prove the plan from its own contents immediately before acting.
    const verdict = admitShardPlan(decision.plan);
    if (!verdict.admitted) {
      set(
        "FAILED",
        "SHARD_PLAN_NOT_ADMISSIBLE",
        (verdict.blockers as readonly ShardAdmissionBlocker[]).join(", "),
      );
      return Object.freeze({
        started: false,
        state,
        blocker,
        detail,
        shardsConnected: 0,
        rollbackErrors: Object.freeze([]),
      });
    }
    if (verdict.observedShardCount > MAX_SOCKETS) {
      set("FAILED", "SOCKET_CEILING_WOULD_BE_EXCEEDED", `${verdict.observedShardCount} shards`);
      return Object.freeze({
        started: false,
        state,
        blocker,
        detail,
        shardsConnected: 0,
        rollbackErrors: Object.freeze([]),
      });
    }

    set("STARTING", null, "opening sockets");
    disconnectedDuringStart.clear();
    lost.clear();
    tokenToShardId.clear();
    activePlan = decision.plan;
    planGenerationId = decision.registryGenerationId;

    let failure: { blocker: FeedManagerBlocker; detail: string } | null = null;

    for (const shard of decision.plan.shards) {
      const shardId = shard.shardId;
      let client: FeedClientPort;
      try {
        client = await options.clientFactory({
          shardId,
          tokens: shard.tokens,
          events: eventsFor(shardId),
        });
      } catch (err) {
        failure = {
          blocker: "CLIENT_CONSTRUCTION_FAILED",
          detail: `shard ${shardId}: ${err instanceof Error ? err.message : String(err)}`,
        };
        break;
      }

      // Registered before connect so rollback releases it even if connect throws.
      slots[shardId] = client;

      try {
        const connected = await client.connect();
        if (!connected.ok) {
          failure = { blocker: "CLIENT_CONNECT_FAILED", detail: `shard ${shardId}: ${connected.detail}` };
          break;
        }
      } catch (err) {
        failure = {
          blocker: "CLIENT_CONNECT_FAILED",
          detail: `shard ${shardId}: ${err instanceof Error ? err.message : String(err)}`,
        };
        break;
      }

      let shardConfirmation: FeedSubscriptionConfirmation;
      try {
        const subscribed = await client.subscribe(shard.tokens);
        if (!subscribed.ok) {
          failure = { blocker: "SUBSCRIBE_FAILED", detail: `shard ${shardId}: ${subscribed.detail}` };
          break;
        }
        // Exact set equality. A short accept is a coverage hole, not a warning.
        if (!sameTokenSet(shard.tokens, subscribed.acceptedTokens)) {
          failure = {
            blocker: "SUBSCRIPTION_INCOMPLETE",
            detail: `shard ${shardId}: requested ${shard.tokens.length}, confirmed ${subscribed.acceptedTokens.length}`,
          };
          break;
        }
        shardConfirmation = subscribed.confirmation;
      } catch (err) {
        failure = {
          blocker: "SUBSCRIBE_FAILED",
          detail: `shard ${shardId}: ${err instanceof Error ? err.message : String(err)}`,
        };
        break;
      }

      noteConfirmation(shardConfirmation);
      for (const token of shard.tokens) tokenToShardId.set(token, shardId);
    }

    // A shard that dropped mid-startup makes the whole start a failure. It is
    // checked here, after the loop, so the rollback below releases everything
    // rather than leaving a partially-connected feed behind.
    if (failure === null && disconnectedDuringStart.size > 0) {
      const dropped = [...disconnectedDuringStart].sort((a, b) => a - b);
      failure = {
        blocker: "SHARD_LOST_DURING_STARTUP",
        detail: `shard(s) ${dropped.join(", ")} disconnected before startup completed`,
      };
    }

    if (failure !== null) {
      const rollbackErrors = await releaseAll();
      activePlan = null;
      planGenerationId = null;
      subscriptionConfirmation = null;
      lost.clear();
      set(
        "FAILED",
        failure.blocker,
        rollbackErrors.length === 0
          ? failure.detail
          : `${failure.detail}; rollback incomplete: ${rollbackErrors.join("; ")}`,
      );
      return Object.freeze({
        started: false,
        state,
        blocker,
        detail,
        shardsConnected: 0,
        rollbackErrors: Object.freeze(rollbackErrors),
      });
    }

    set("RUNNING", null, `all ${decision.plan.shards.length} shard(s) connected and fully subscribed`);
    return Object.freeze({
      started: true,
      state,
      blocker: null,
      detail,
      shardsConnected: clientsHeld(),
      rollbackErrors: Object.freeze([]),
    });
  }

  function notifyShardDisconnected(shardId: number, reason: string): void {
    // A drop DURING startup is recorded so start() can fail honestly rather
    // than completing over a shard that has already gone away.
    if (state === "STARTING") {
      disconnectedDuringStart.add(shardId);
      return;
    }
    if (state !== "RUNNING" && state !== "DEGRADED") return;
    lost.add(shardId);
    // The shard's tokens stay mapped to it. They are NOT reassigned — see the
    // module header for why redistribution cannot work at this scale.
    set("DEGRADED", null, `shard ${shardId} disconnected: ${reason}`);
  }

  async function reconnectShard(
    shardId: number,
  ): Promise<{ readonly ok: boolean; readonly detail: string }> {
    if (state !== "DEGRADED") {
      return { ok: false, detail: `reconnect refused in state ${state}` };
    }
    if (!lost.has(shardId)) {
      return { ok: false, detail: `shard ${shardId} is not marked lost` };
    }
    if (activePlan === null) {
      return { ok: false, detail: "no active plan" };
    }
    const shard = activePlan.shards.find((s) => s.shardId === shardId);
    if (shard === undefined) {
      return { ok: false, detail: `shard ${shardId} is not in the active plan` };
    }

    // ── Close the old socket BEFORE constructing a replacement. ──
    //
    // If the old socket cannot be released, recovery STOPS here. Building a
    // replacement anyway would be betting that a socket we just failed to
    // close is nonetheless gone from the provider's count — and if that bet is
    // wrong the replacement is a fourth concurrent connection against a
    // three-per-key ceiling. Staying DEGRADED with one shard dark is strictly
    // better than losing the whole key.
    const old = slots[shardId];
    slots[shardId] = null;
    if (old !== null) {
      const releaseError = await releaseOne(shardId, old);
      if (releaseError !== null) {
        set(
          "DEGRADED",
          "SOCKET_RELEASE_FAILED",
          `shard ${shardId} could not be released; replacement refused to protect the socket ceiling`,
        );
        return {
          ok: false,
          detail: `old socket not released (${releaseError}); replacement refused`,
        };
      }
    }

    // ── The ceiling is counted against sockets that MIGHT still be live. ──
    //
    // Emptying a slot is not the same as the provider forgetting the socket.
    // A previous refused release leaves a connection we cannot account for, and
    // once a slot is empty nothing else would stop the next reconnect attempt
    // constructing a replacement anyway — so the budget must be
    // held + unreleased, never just held.
    const possiblyLiveSockets = clientsHeld() + unreleased.length;
    if (possiblyLiveSockets >= MAX_SOCKETS) {
      set(
        "DEGRADED",
        "SOCKET_CEILING_WOULD_BE_EXCEEDED",
        `${possiblyLiveSockets} socket(s) may still be live against a ceiling of ${MAX_SOCKETS}; replacement refused`,
      );
      return {
        ok: false,
        detail: `replacement refused: ${possiblyLiveSockets} socket(s) may still be live (ceiling ${MAX_SOCKETS})`,
      };
    }

    let client: FeedClientPort;
    try {
      client = await options.clientFactory({
        shardId,
        tokens: shard.tokens,
        events: eventsFor(shardId),
      });
    } catch (err) {
      return { ok: false, detail: `construction failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    slots[shardId] = client;
    let replacementConfirmation: FeedSubscriptionConfirmation;
    try {
      const connected = await client.connect();
      if (!connected.ok) {
        slots[shardId] = null;
        await releaseOne(shardId, client);
        return { ok: false, detail: `connect failed: ${connected.detail}` };
      }
      const subscribed = await client.subscribe(shard.tokens);
      if (!subscribed.ok || !sameTokenSet(shard.tokens, subscribed.acceptedTokens)) {
        slots[shardId] = null;
        await releaseOne(shardId, client);
        return { ok: false, detail: "replacement subscription incomplete" };
      }
      replacementConfirmation = subscribed.confirmation;
    } catch (err) {
      slots[shardId] = null;
      await releaseOne(shardId, client);
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }

    for (const token of shard.tokens) tokenToShardId.set(token, shardId);
    lost.delete(shardId);
    noteConfirmation(replacementConfirmation);
    if (lost.size === 0) set("RUNNING", null, "all shards recovered");
    else set("DEGRADED", null, `${lost.size} shard(s) still lost`);
    return { ok: true, detail: `shard ${shardId} replaced` };
  }

  /**
   * Shutdown hook.
   *
   * Returns `closed: false` ONLY when nothing was owned — that is a truthful
   * "nothing to do" and the shutdown coordinator treats it as clean.
   *
   * When sockets WERE held and could not be released, this THROWS. That is
   * deliberate: the coordinator maps a returned `closed: false` to NOT_OWNED
   * (exit 0) and only a thrown hook to HOOK_FAILED (exit 1). A process that
   * left provider sockets open must not exit zero — the next deployment would
   * inherit a phantom socket against the three-socket ceiling and be unable to
   * explain why its own third shard is refused.
   */
  async function close(signal: string): Promise<FeedCloseHookResult> {
    const held = clientsHeld();
    const carriedOver = unreleased.length;

    // "Owned nothing" requires BOTH no live slot and no socket left behind by
    // an earlier failed rollback or reconnect. Checking only `held` is what
    // previously let a process that had abandoned a socket report a clean
    // shutdown and exit 0.
    if (held === 0 && carriedOver === 0) {
      // Idempotent no-op. Safe from DISABLED, STOPPED, FAILED and WAITING.
      if (state !== "DISABLED" && state !== "FAILED" && state !== "WAITING_FOR_GATES") {
        set("STOPPED", blocker, `no sockets owned at ${signal}`);
      }
      return Object.freeze({
        closed: false,
        detail: `NO_FEED_OWNED_STATE_${state}`,
      });
    }

    set("STOPPING", null, `closing ${held} socket(s) on ${signal}`);
    // Retry the carried-over failures first, then release what is still held.
    // Order matters only for reporting; both sets must be attempted.
    const errors = [...(await retryUnreleased()), ...(await releaseAll())];
    lost.clear();
    activePlan = null;
    planGenerationId = null;
    subscriptionConfirmation = null;

    if (errors.length > 0) {
      set("FAILED", "SOCKET_RELEASE_FAILED", `feed close incomplete: ${errors.join("; ")}`);
      throw new Error(`FEED_CLOSE_INCOMPLETE: ${errors.join("; ")}`);
    }

    const released = held + carriedOver;
    set("STOPPED", null, `closed ${released} socket(s) on ${signal}`);
    return Object.freeze({ closed: true, detail: `CLOSED_${released}_SOCKETS` });
  }

  function diagnostics(): FeedManagerDiagnostics {
    const shards: ShardSlotView[] = [];
    for (let i = 0; i < slots.length; i++) {
      const client = slots[i];
      const planned = activePlan?.shards.find((s) => s.shardId === i) ?? null;
      if (client === null && planned === null) continue;
      shards.push(
        Object.freeze({
          shardId: i,
          held: client !== null,
          clientState: client === null ? null : client.state(),
          lost: lost.has(i),
          expectedTokens: planned?.count ?? 0,
        }),
      );
    }
    return Object.freeze({
      state,
      blocker,
      detail,
      activationAuthorizedConstant: FEED_RUNTIME_ACTIVATION_AUTHORIZED,
      maxSockets: MAX_SOCKETS,
      clientsHeld: clientsHeld(),
      unreleasedSockets: unreleased.length,
      subscriptionConfirmation,
      shards: Object.freeze(shards),
      lostShardIds: Object.freeze([...lost].sort((a, b) => a - b)),
      planGenerationId,
      acceptedTickCount,
      rejectedTickCount,
      startAttempts,
    });
  }

  // `now` is retained for future observation windows; referenced here so the
  // option is not silently ignored.
  void now;

  return Object.freeze({
    state: () => state,
    // Every socket-owning operation is serialised. See `runExclusive`.
    start: () => runExclusive(start),
    notifyShardDisconnected,
    reconnectShard: (shardId: number) => runExclusive(() => reconnectShard(shardId)),
    close: (signal: string) => runExclusive(() => close(signal)),
    diagnostics,
    subscribedTokenMap: () => new Map(tokenToShardId),
    lostShardIds: () => new Set(lost),
  });
}

/**
 * Production feed manager factory.
 *
 * Enforces the `FEED_RUNTIME_ACTIVATION_AUTHORIZED` compile-time lock before
 * reading or acting on the activation decision. Even if all 15 gates in the
 * StructuredActivationDecision report PASS, start() refuses while the lock is false.
 */
export function createFeedManager(options: FeedManagerOptions): FeedManager {
  return createFeedManagerInternal(options, true);
}

/**
 * TEST-ONLY feed manager factory.
 *
 * Bypasses ONLY the `FEED_RUNTIME_ACTIVATION_AUTHORIZED` compile-time lock.
 * All other checks — including the COMPILE_TIME_FEED_LOCK gate inside the
 * structured decision, the generation/hash cross-validates, and the full gate
 * iteration — are still enforced from the caller-supplied evidence.
 *
 * Production code must NEVER import or call this export. A test in
 * `p08b.activationBoundary.test.ts` asserts zero production callers repo-wide.
 */
export function createFeedManagerForTesting(options: FeedManagerOptions): FeedManager {
  return createFeedManagerInternal(options, false);
}
