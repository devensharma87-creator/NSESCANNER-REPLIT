/**
 * `RecordedKiteClient` — replays ticks from a recorded fixture.
 *
 * Presents the same subscription-based API the trading engine expects
 * from the real Kite client (subscribe(instruments), onTick(cb),
 * disconnect()) but drives ticks from the fixture in strict recorded
 * order. Each `advance(deltaMs)` call fires all ticks whose
 * `receivedAtNs` falls in the window.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §4.3 step 6.
 *
 * R1 scope: interface + tick sequencing + subscription tracking.
 * R2 will wire this into the real engine — for R1 we only test that
 * ticks flow deterministically in fixture order.
 */

export interface RecordedTick {
  /** Nanosecond timestamp of tick reception (from Kite websocket). */
  receivedAtNs: number;
  /** Instrument identifier — matches what the engine subscribed to. */
  instrumentToken: number;
  ltp: number;
  ltq: number | null;
  volume: number | null;
  oi: number | null;
  /** Raw payload preserved for engine consumption. */
  raw: Record<string, unknown>;
}

export interface RecordedKiteClientArgs {
  ticksJsonl: string;
  /** Called if the engine subscribes to an instrument the fixture
   *  never captured. Throws in strict mode (default). */
  strictSubscriptions?: boolean;
}

export type TickListener = (tick: RecordedTick) => void;

export class RecordedKiteClient {
  private readonly _ticks: RecordedTick[];
  private _cursor = 0;
  private readonly _subscribed = new Set<number>();
  private readonly _listeners = new Set<TickListener>();
  private _connected = true;
  private readonly _strict: boolean;

  constructor(args: RecordedKiteClientArgs) {
    this._strict = args.strictSubscriptions ?? true;
    this._ticks = parseTicks(args.ticksJsonl);
    // R2 pre-check: enforce recorded order at load-time (fixtures
    // captured out-of-order = corruption, not a live problem to solve).
    for (let i = 1; i < this._ticks.length; i++) {
      if (this._ticks[i]!.receivedAtNs < this._ticks[i - 1]!.receivedAtNs) {
        throw new Error(
          `RecordedKiteClient: ticks[${i}] receivedAtNs=${this._ticks[i]!.receivedAtNs} ` +
            `< ticks[${i - 1}]=${this._ticks[i - 1]!.receivedAtNs} — fixture is not monotonic`,
        );
      }
    }
  }

  subscribe(instrumentTokens: number[]): void {
    for (const t of instrumentTokens) this._subscribed.add(t);
  }

  unsubscribe(instrumentTokens: number[]): void {
    for (const t of instrumentTokens) this._subscribed.delete(t);
  }

  onTick(listener: TickListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  disconnect(): void {
    this._connected = false;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Advance the fixture stream until (and including) the tick at
   * `nowMs` real replay time. Returns the number of ticks emitted.
   */
  advanceTo(nowNs: number): number {
    if (!this._connected) return 0;
    let emitted = 0;
    while (this._cursor < this._ticks.length) {
      const t = this._ticks[this._cursor]!;
      if (t.receivedAtNs > nowNs) break;
      this._cursor += 1;
      if (this._subscribed.size > 0 && !this._subscribed.has(t.instrumentToken)) {
        if (this._strict) {
          throw new Error(
            `RecordedKiteClient: fixture emitted tick for instrument ${t.instrumentToken} ` +
              `which was NOT subscribed by the engine. In strict mode, this is a driver bug.`,
          );
        }
        // non-strict: silently drop, do not count as emitted.
        continue;
      }
      for (const cb of this._listeners) {
        try { cb(t); } catch { /* driver-level error, keep going */ }
      }
      emitted += 1;
    }
    return emitted;
  }

  /** Convenience for tests: consume all remaining ticks. */
  drain(): number {
    return this.advanceTo(Number.MAX_SAFE_INTEGER);
  }

  get position(): { cursor: number; total: number } {
    return { cursor: this._cursor, total: this._ticks.length };
  }
}

function parseTicks(jsonl: string): RecordedTick[] {
  if (!jsonl.trim()) return [];
  const out: RecordedTick[] = [];
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`RecordedKiteClient: ticks.jsonl:${i + 1} parse error: ${(err as Error).message}`);
    }
    const p = parsed as Partial<RecordedTick>;
    if (
      typeof p.receivedAtNs !== "number" ||
      typeof p.instrumentToken !== "number" ||
      typeof p.ltp !== "number"
    ) {
      throw new Error(`RecordedKiteClient: ticks.jsonl:${i + 1} missing required fields (receivedAtNs, instrumentToken, ltp)`);
    }
    out.push({
      receivedAtNs: p.receivedAtNs,
      instrumentToken: p.instrumentToken,
      ltp: p.ltp,
      ltq: p.ltq ?? null,
      volume: p.volume ?? null,
      oi: p.oi ?? null,
      raw: (parsed as { raw?: Record<string, unknown> }).raw ?? {},
    });
  }
  return out;
}
