# Signal Logging Fix — Specification v1

**Problem (proven from your data):** In 16 trading days, `fno_signal_reasoning` logged 44,625 rows representing only **83 unique signals** — an average of **88 duplicate rows per signal**, worst case **307×**. The cause: the engine writes a reasoning row on every ~30-second poll, re-recording the same signal in the same state over and over. This inflates every count, breaks reconciliation between pages (the 25-vs-8 gap), and makes win rates meaningless.

**Goal:** Log **once per state-change**, not once per poll. One signal should produce a small, bounded number of rows across its entire life — roughly 2 to 5 — not hundreds.

**Non-goal:** This does not change trading logic, signals, or P&L. It only changes *when a row is written*. Behaviour is identical; the audit trail becomes truthful.

---

## 1. The lifecycle model (single source of truth)

Every signal has exactly one identity and moves through a small set of states. Both the live engine AND the backtester use this same model, so their outputs are directly comparable later.

**Identity:** the existing SHA-256 fingerprint of
`(signal_date, index_symbol, setup_key, direction, type, strike)`.
One fingerprint = one signal = one logical row that gets *updated*, plus an append-only event trail.

**States (terminal states end the signal's life):**

```
            ┌─────────────┐
            │   EMITTED   │  (signal first passes the gate)
            └──────┬──────┘
                   │ spot reaches entry trigger
            ┌──────▼──────┐
            │  TRIGGERED  │
            └──────┬──────┘
        ┌──────────┼──────────┬───────────┐
        ▼          ▼          ▼           ▼
   TARGET1_HIT  TARGET2_HIT  STOPPED   EXPIRED   (all terminal)
        │
        ▼ (runner)
   TARGET2_HIT / STOPPED / EXPIRED

   Pre-emission path (never becomes a trade):
   PRE_EMISSION_REJECTED   (terminal, with reason_code)
```

**The rule:** write a row **only when the state changes**, or when a *materially different* rejection reason occurs for a not-yet-emitted signal.

---

## 2. The write rule (the actual fix)

On each evaluation cycle, for each candidate signal, compute its current `(fingerprint, state)`.

```
key = (fingerprint, state)

if key == last_logged_key_for_this_fingerprint:
    SKIP   # identical state already on record — this is the 88x killer
else:
    WRITE one row   # a genuine transition
    last_logged_key_for_this_fingerprint = key
```

That single guard collapses 44,625 rows toward roughly 200–400 for the same period.

**Two refinements so we don't lose useful signal:**

1. **Rejection churn.** A pre-emission signal can be rejected for different reasons on different cycles (e.g. `HC_FLOOR` then later `LATE_SESSION_ENTRY`). Key the dedupe on `(fingerprint, state, reason_code)` so a *changed reason* is recorded, but the *same* reason repeating is not. The common case — `CONDITIONS_NOT_MET` logged 21,868 times — collapses to one row per signal per distinct reason.

2. **Heartbeat (optional, off by default).** If you ever want proof the engine was alive and evaluating a signal at time T (not silently dead), keep that in a separate lightweight `signal_heartbeat` table or counter — NOT in the reasoning log. The reasoning log is for transitions only. Mixing liveness telemetry into the audit trail is what created this mess.

---

## 3. What each row should carry

A transition row should be self-describing so no page has to re-derive context:

| Field | Purpose |
|---|---|
| `fingerprint` | signal identity (dedupe key) |
| `from_state`, `to_state` | the transition itself |
| `reason_code` | why (especially for rejections / demotions) |
| `captured_at` | when the transition happened |
| `signal_date`, `index_symbol`, `setup_key`, `direction` | the signal |
| spot/option levels, confidence, regime | snapshot at transition |
| `realized_pnl`, `exit_reason` | populated ONLY on terminal states |

Note your current export has `realized_pnl` null on all 7,299 emitted rows — because emitted signals were never updated to terminal with their P&L. Under this model, the terminal transition (TARGET/STOPPED/EXPIRED) is exactly where P&L gets written, once, correctly.

---

## 4. How this fixes the reconciliation gap (25 vs 8)

Once logging is once-per-transition, every page counts the **same rows**:

- **"Signals"** = count of distinct fingerprints that reached `EMITTED`.
- **"Triggered"** = distinct fingerprints that reached `TRIGGERED`.
- **"Closed trades"** = distinct fingerprints in a terminal *traded* state (TARGET/STOPPED), with non-null `realized_pnl`.
- **"Win"** = terminal traded state where `net_pnl > 0` (using the shared cost function).

The 25-vs-8 gap disappears because the Reports page (closed trades) and the Intraday page (triggered signals) are now counting clearly-defined, non-duplicated states from one table — not the same signal 88 times under two different filters.

---

## 5. Migration (don't lose the history)

The existing 44,625 rows are still useful as a one-time archive. Recommended path:

1. **Snapshot** the current `fno_signal_reasoning` to an archive table (`fno_signal_reasoning_archive_pre_dedupe`). Never delete raw history.
2. **Backfill** a clean transition log by collapsing the archive: group by `(fingerprint, state, reason_code)`, keep the *first* occurrence of each as the transition timestamp. This reconstructs the true ~83-signal history.
3. **Switch** the live writer to the write-rule in section 2.
4. **Verify:** after one trading day, the new log should show on the order of tens of rows, not thousands. If it shows thousands again, the dedupe guard isn't keyed correctly.

---

## 6. Acceptance test (how you know it worked)

Run this against one day of the NEW log:

```
rows_per_signal = total_rows / distinct_fingerprints
```

- **Before:** ~88 (broken)
- **Target:** between 2 and 6 (healthy — emit, trigger, terminal, plus maybe a demotion/reason change)
- **Red flag:** > 10 means a state is flapping or the dedupe key is wrong.

And the reconciliation check:
```
Reports "closed trades" count  ==  distinct fingerprints in terminal traded states
Intraday "triggered" count     ==  distinct fingerprints that reached TRIGGERED
```
These two numbers are now *allowed* to differ (triggered ≥ closed, because some triggered signals expire open), but each is independently correct and explainable — which is the whole point.
