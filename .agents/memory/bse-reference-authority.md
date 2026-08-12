---
name: BSE reference authority is event-based, not hour-based
description: Why BSE freshness uses calendar-day + completed-session identity instead of a max-age, and the three traps that come with enforcing an authority verdict.
---

# BSE reference freshness

The owner approved an **event-based** policy for BSE reference data, explicitly rejecting
another hour threshold. Authority requires the List of Scrips retrieved during the current
IST calendar day, AND classification reconciled to the newest official UDiFF for the
latest **completed** session.

**Why:** the BSE List of Scrips is a continuously-maintained endpoint with no publication
timestamp, no effective date and no documented cadence. "How many hours old is it" is a
question the source cannot answer, so any max-age constant is invented precision. NSE's
EQUITY_L.csv is a dated daily publication, which is why its 48-hour policy is legitimate
and must not be touched.

**How to apply:** never compare BSE reference data against wall-clock age — compare
calendar-day identity and completed-session identity. Because the repo has no BSE trading
calendar, "calendar unknown" must be a **representable input state**, not an assumption;
that is what makes fail-closed enforceable rather than aspirational. Pass the calendar in;
never derive it inside the policy.

## Trap 1 — an authority verdict is only a boolean unless you can prove provenance

`readonly` is compile-time only. A gate that reads `verdict.mayAuthorizeNewGeneration`
trusts any structurally-correct object a caller hands it, so authority can be asserted
without a single source being evaluated.

**How to apply:** for any "X is authorized" object crossing a trust boundary, enforce two
things — (a) in-process provenance, e.g. a module-private `WeakSet` of verdicts the
evaluator actually issued, and (b) a **content-hash binding** back to the specific source
body the verdict was computed over, so a genuine verdict cannot be transplanted onto a
different generation. Object identity does not survive serialization, so the durable
boundary must re-check the hash binding, not the brand.

## Trap 2 — regex-valid dates are not real dates

`2026-02-31` matches `^\d{4}-\d{2}-\d{2}$`, sorts lexically like any February date, and
therefore slides through every `<`/`>` comparison. Round-trip through the calendar
(`Date.parse` then re-format and compare) and validate **before** any ordering comparison,
on every date input including the one naming the latest completed session.

## Trap 3 — a schema bump orphans every stored generation

Adding a required manifest field bumps the schema version, and the loader refuses rows at
a different version. Every persisted generation stops loading and coverage falls back to
"not configured". That is correct fail-closed behaviour, but it means **a schema bump is a
re-generation event**: plan the rebuild (source fetch + write) in the same authorization,
or the universe sits unconfigured until someone notices.
