/**
 * PHASE 0.8B — PROVIDER-NEUTRAL FEED CLIENT PORT
 *
 * The seam between the shard manager and whatever actually opens a socket.
 * The manager is written against this interface ONLY. It never imports
 * `kiteconnect`, never names a provider type, and cannot tell a real adapter
 * from a fake one. That is what makes the whole state machine testable without
 * a single network call.
 *
 * IMPORT-TIME PURITY IS THE LOAD-BEARING PROPERTY
 * -----------------------------------------------
 * A provider SDK that constructs a client, reads a credential, or opens a
 * handle at module scope turns `import` into a side effect. Every test file
 * that transitively touches this module would then contact the provider, and
 * the "feed is disabled" claim would be false the moment the process starts.
 *
 * So the rule is absolute: NOTHING in this file, and nothing in any adapter
 * that implements it, may touch a provider SDK at module scope. The real
 * adapter resolves its SDK with a dynamic `import()` INSIDE `connect()` —
 * after the gates have already been checked — so an un-activated process never
 * loads the provider at all.
 *
 * WHY THE FACTORY IS ASYNC
 * ------------------------
 * Because the dynamic import is async. Making the factory synchronous would
 * force the adapter to either top-level-import the SDK (breaking the rule
 * above) or resolve it lazily on first use (hiding a connection failure behind
 * a later subscribe). An async factory lets construction fail loudly at the
 * one point the manager is prepared to roll back.
 */

/** Lifecycle of a single socket. Strictly one-way except CONNECTING→CONNECTED. */
export type FeedClientState =
  | "CONSTRUCTED"
  | "CONNECTING"
  | "CONNECTED"
  | "CLOSING"
  | "CLOSED"
  | "FAILED";

/**
 * One tick as the provider delivered it, normalised to field NAMES only.
 *
 * Values are passed through untouched. Absent fields stay absent — see
 * `tickIngestion.ts` for why a missing field must never become a zero.
 */
export interface FeedTickEnvelope {
  /** Provider instrument token. The ONLY identity the provider supplies. */
  readonly providerToken: number;
  readonly ltp: number;
  /** Epoch milliseconds. */
  readonly ts: number;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
  readonly volume?: number;
  readonly changePercent?: number;
}

/**
 * Callbacks the manager installs on every client it constructs.
 *
 * `onDisconnected` is the reconnect trigger; it carries a reason string for
 * diagnostics but the manager never parses it to decide behaviour.
 */
export interface FeedClientEvents {
  readonly onTicks: (ticks: readonly FeedTickEnvelope[]) => void;
  readonly onConnected: () => void;
  readonly onDisconnected: (reason: string) => void;
  readonly onError: (message: string) => void;
}

/** Everything a client needs to exist. Deliberately carries no credential. */
export interface FeedClientSpec {
  readonly shardId: number;
  readonly tokens: readonly number[];
  readonly events: FeedClientEvents;
}

export interface FeedClientOpResult {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * How much a subscribe result is actually worth.
 *
 * Some providers acknowledge a subscription; Kite's ticker does not — its
 * `subscribe()` is fire-and-forget over an already-open socket, so a returning
 * call proves only that the request was written, never that the server
 * accepted it. An adapter for such a provider MUST say so rather than echo the
 * requested tokens back as if they were confirmed, because that turns a silent
 * subscription failure into a feed that reports RUNNING with no data.
 */
export type FeedSubscriptionConfirmation =
  | "PROVIDER_ACKNOWLEDGED"
  | "REQUEST_ACCEPTED_UNCONFIRMED";

export interface FeedSubscribeResult extends FeedClientOpResult {
  /**
   * Tokens the provider confirmed. The manager compares this against what it
   * asked for; a short accept is a partial subscription, which is a startup
   * failure, not a degraded success.
   */
  readonly acceptedTokens: readonly number[];
  /**
   * Whether `acceptedTokens` is provider truth or merely the request echoed
   * back. Surfaced in diagnostics so RUNNING can never be silently read as
   * "the provider agreed".
   */
  readonly confirmation: FeedSubscriptionConfirmation;
}

export interface FeedClientPort {
  readonly shardId: number;
  state(): FeedClientState;
  /** Open the socket. Must reject rather than resolve on failure to connect. */
  connect(): Promise<FeedClientOpResult>;
  /** Subscribe this shard's tokens. Never called with a token from another shard. */
  subscribe(tokens: readonly number[]): Promise<FeedSubscribeResult>;
  /**
   * Release the socket. MUST be idempotent and MUST NOT throw for an
   * already-closed client — shutdown calls it on every slot unconditionally.
   */
  close(): Promise<FeedClientOpResult>;
  subscribedTokenCount(): number;
}

/**
 * Constructs one client. Injected everywhere; there is no default.
 *
 * A manager with no factory cannot start — which is the correct behaviour for
 * a process that was never given a way to reach a provider.
 */
export type FeedClientFactory = (spec: FeedClientSpec) => Promise<FeedClientPort>;

/**
 * The factory installed when the feed is disabled.
 *
 * It does not return a dormant client — it REFUSES. A dormant client is a
 * handle that something later in the process could connect by accident; a
 * refusal cannot be accidentally connected. If this throws, a code path tried
 * to open a socket while the feed was disabled, and that is exactly the bug
 * this phase exists to make impossible.
 */
export const REFUSING_FEED_CLIENT_FACTORY: FeedClientFactory = async () => {
  throw new Error("FEED_CLIENT_CONSTRUCTION_REFUSED_FEED_DISABLED");
};
