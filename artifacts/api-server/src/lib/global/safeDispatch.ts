/**
 * W6-P5 Phase 1G — Global scanner failure isolation.
 *
 * Fire-and-forget a promise-returning function at a scheduler boundary
 * (`setInterval` / `setTimeout`) WITHOUT letting a rejection (or a
 * synchronous throw before the promise is even created) escape as an
 * unhandled rejection. Node treats an unhandled rejection as fatal
 * (`--unhandled-rejections=throw`, default since v15), so a single global
 * scanner DB timeout dispatched via a bare `void fn()` could — and did —
 * crash the shared api-server process and every subsystem hosted in it.
 *
 * Contract:
 *  - never throws to the caller (the interval/timeout callback stays clean);
 *  - never returns a promise (callers keep their `void` fire-and-forget shape);
 *  - logs a single compact warning per failed cycle so the degradation is
 *    observable without spamming;
 *  - does NOT change cadence, does NOT block the event loop, does NOT retry.
 */

import { logger } from "../logger";

export function safeFireAndForget(label: string, fn: () => Promise<void>): void {
  let p: Promise<void>;
  try {
    p = fn();
  } catch (err) {
    // Synchronous throw before the async function ever returned a promise.
    logger.warn(
      { label, err: err instanceof Error ? err.message : String(err) },
      "global scheduler dispatch threw synchronously (isolated — process continues)",
    );
    return;
  }
  void p.catch((err: unknown) => {
    logger.warn(
      { label, err: err instanceof Error ? err.message : String(err) },
      "global scheduler dispatch rejected (isolated — process continues)",
    );
  });
}
