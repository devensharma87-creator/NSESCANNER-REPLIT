/**
 * `RecordingTelegramClient` — captures every message the engine tries
 * to send in strict order for golden comparison.
 *
 * The real bot deliberately batches, priority-tiers, and rate-limits
 * outbound. Golden comparison must see the EXACT sequence the trader
 * would receive — priority-tier drift or backoff bug shows up here as
 * an ordering diff.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §4.3 step 7.
 */

export interface RecordedTelegramMessage {
  /** Server-tagged send order (1-indexed for readability). */
  sequence: number;
  /** Bot tier: PREPOST | ALERTS | RISK (mirrors the real routing). */
  tier: string;
  chatId: string | number;
  text: string;
  /** Wall-clock (replay `Date.now()`) when the send was attempted. */
  attemptedAtMs: number;
  /** Injected error, if the fixture said the send should fail. */
  injectedError?: string;
}

export class RecordingTelegramClient {
  private readonly _out: RecordedTelegramMessage[] = [];
  private _seq = 0;

  send(args: {
    tier: string;
    chatId: string | number;
    text: string;
    injectedError?: string;
  }): Promise<{ ok: boolean; sequence: number }> {
    this._seq += 1;
    this._out.push({
      sequence: this._seq,
      tier: args.tier,
      chatId: args.chatId,
      text: args.text,
      attemptedAtMs: Date.now(),
      ...(args.injectedError !== undefined ? { injectedError: args.injectedError } : {}),
    });
    if (args.injectedError) {
      return Promise.resolve({ ok: false, sequence: this._seq });
    }
    return Promise.resolve({ ok: true, sequence: this._seq });
  }

  get outbox(): readonly RecordedTelegramMessage[] {
    return this._out;
  }

  reset(): void {
    this._out.length = 0;
    this._seq = 0;
  }
}
