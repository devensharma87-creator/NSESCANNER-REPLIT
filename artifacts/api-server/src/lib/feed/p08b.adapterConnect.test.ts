/**
 * PHASE 0.8B — GATE G: THE PROVIDER ADAPTER HANDSHAKE
 *
 * The adapter must not report a connection until the provider says the socket
 * is open. Reporting success at request time would let the manager subscribe
 * to a dead socket and then declare RUNNING — a feed that looks healthy and
 * delivers nothing.
 *
 * The SDK is mocked, so no network call and no real provider connection occurs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Handler = (...args: unknown[]) => void;

class FakeTicker {
  static instances: FakeTicker[] = [];
  static autoEmitConnect = true;

  private handlers = new Map<string, Handler[]>();
  connectCalled = false;
  disconnectCalled = false;
  subscribedTokens: number[] = [];
  modeSet: string | null = null;
  autoReconnectArgs: unknown[] | null = null;

  constructor(public readonly opts: { api_key: string; access_token: string }) {
    FakeTicker.instances.push(this);
  }

  on(event: string, fn: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }

  autoReconnect(...args: unknown[]): void {
    this.autoReconnectArgs = args;
  }

  connect(): void {
    this.connectCalled = true;
    if (FakeTicker.autoEmitConnect) queueMicrotask(() => this.emit("connect"));
  }

  disconnect(): void {
    this.disconnectCalled = true;
  }

  subscribe(tokens: number[]): void {
    this.subscribedTokens = tokens;
  }

  setMode(mode: string): void {
    this.modeSet = mode;
  }
}

vi.mock("kiteconnect", () => ({ KiteTicker: FakeTicker }));

// Imported AFTER the mock is declared; the adapter loads the SDK lazily anyway.
const { createKiteFeedClientFactory } = await import("./kiteFeedClientAdapter");

const CREDS = { apiKey: "test-key", accessToken: "test-token" };

/**
 * The adapter loads the SDK with a dynamic import, so the ticker does not
 * exist until that promise settles. Polling is required — a single microtask
 * tick is not enough and made these tests flaky.
 */
async function waitForTicker(): Promise<FakeTicker> {
  for (let i = 0; i < 100; i++) {
    const t = FakeTicker.instances[0];
    if (t !== undefined) return t;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("provider ticker was never constructed");
}

function makeSpec(shardId = 0, tokens = [11, 22]) {
  const events = {
    onTicks: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onError: vi.fn(),
  };
  return { spec: { shardId, tokens, events }, events };
}

beforeEach(() => {
  FakeTicker.instances = [];
  FakeTicker.autoEmitConnect = true;
});

describe("P0.8B Gate G — connect waits for the provider", () => {
  it("G1: connect resolves ok only once the provider emits its connect event", async () => {
    const factory = createKiteFeedClientFactory(() => CREDS);
    const { spec } = makeSpec();
    const client = await factory(spec);
    const res = await client.connect();
    expect(res.ok).toBe(true);
    expect(client.state()).toBe("CONNECTED");
  });

  it("G2: a provider that never connects yields a TIMEOUT failure, not success", async () => {
    FakeTicker.autoEmitConnect = false;
    const factory = createKiteFeedClientFactory(() => CREDS, () => Date.now(), 20);
    const { spec } = makeSpec();
    const client = await factory(spec);
    const res = await client.connect();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("PROVIDER_CONNECT_TIMEOUT");
    expect(client.state()).toBe("FAILED");
  });

  it("G3: an error before the handshake completes fails the connect", async () => {
    FakeTicker.autoEmitConnect = false;
    const factory = createKiteFeedClientFactory(() => CREDS, () => Date.now(), 5_000);
    const { spec } = makeSpec();
    const client = await factory(spec);
    const pending = client.connect();
    (await waitForTicker()).emit("error", "handshake rejected");
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("PROVIDER_ERROR");
  });

  it("G4: a disconnect before connect is a failed connect, NOT a lost shard", async () => {
    FakeTicker.autoEmitConnect = false;
    const factory = createKiteFeedClientFactory(() => CREDS, () => Date.now(), 5_000);
    const { spec, events } = makeSpec();
    const client = await factory(spec);
    const pending = client.connect();
    (await waitForTicker()).emit("disconnect", "closed early");
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("DISCONNECTED_BEFORE_CONNECT");
    // The manager must NOT be told it lost a shard it never held.
    expect(events.onDisconnected).not.toHaveBeenCalled();
  });

  it("G5: a disconnect AFTER connect does reach the manager", async () => {
    const factory = createKiteFeedClientFactory(() => CREDS);
    const { spec, events } = makeSpec();
    const client = await factory(spec);
    await client.connect();
    FakeTicker.instances[0]!.emit("disconnect", "network drop");
    expect(events.onDisconnected).toHaveBeenCalledWith("network drop");
  });

  it("G6: missing credentials refuse the connect without loading the SDK", async () => {
    const factory = createKiteFeedClientFactory(() => null);
    const { spec } = makeSpec();
    const client = await factory(spec);
    const res = await client.connect();
    expect(res.ok).toBe(false);
    expect(res.detail).toBe("PROVIDER_CREDENTIALS_UNAVAILABLE");
    expect(FakeTicker.instances).toHaveLength(0);
  });

  it("G7: provider-side auto-reconnect is disabled so the manager owns the policy", async () => {
    const factory = createKiteFeedClientFactory(() => CREDS);
    const { spec } = makeSpec();
    const client = await factory(spec);
    await client.connect();
    expect(FakeTicker.instances[0]!.autoReconnectArgs).toEqual([false, 0, 0]);
  });

  it("G8: a timed-out socket can still be closed rather than abandoned", async () => {
    FakeTicker.autoEmitConnect = false;
    const factory = createKiteFeedClientFactory(() => CREDS, () => Date.now(), 20);
    const { spec } = makeSpec();
    const client = await factory(spec);
    await client.connect();
    const closed = await client.close();
    expect(closed.ok).toBe(true);
    expect(FakeTicker.instances[0]!.disconnectCalled).toBe(true);
  });
});

describe("P0.8B Gate G — subscription honesty", () => {
  it("G9: Kite subscriptions are labelled UNCONFIRMED, never claimed as acknowledged", async () => {
    const factory = createKiteFeedClientFactory(() => CREDS);
    const { spec } = makeSpec();
    const client = await factory(spec);
    await client.connect();
    const res = await client.subscribe([11, 22]);
    expect(res.ok).toBe(true);
    // The provider gives no ack, so the adapter must not pretend otherwise.
    expect(res.confirmation).toBe("REQUEST_ACCEPTED_UNCONFIRMED");
    expect(res.acceptedTokens).toEqual([11, 22]);
  });

  it("G11: subscribing a socket that has since dropped is refused", async () => {
    const factory = createKiteFeedClientFactory(() => CREDS);
    const { spec } = makeSpec();
    const client = await factory(spec);
    await client.connect();
    FakeTicker.instances[0]!.emit("disconnect", "dropped right after connect");

    const res = await client.subscribe([11, 22]);

    // Writing a subscribe to a dead socket would silently "succeed" and leave
    // the caller believing the shard is covered.
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("NOT_CONNECTED");
    expect(FakeTicker.instances[0]!.subscribedTokens).toEqual([]);
  });

  it("G10: subscribing before connect is refused", async () => {
    const factory = createKiteFeedClientFactory(() => CREDS);
    const { spec } = makeSpec();
    const client = await factory(spec);
    const res = await client.subscribe([11]);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe("NOT_CONNECTED");
  });
});
