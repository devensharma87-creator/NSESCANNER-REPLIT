---
name: Stale-date test fixture — proximity-window failure pattern
description: Hardcoded future dates in test fixtures eventually enter proximity/threshold windows and cause deterministic, calendar-driven test failures that look like code regressions.
---

## Rule
Never use hardcoded absolute date strings as result/event dates in tests that involve proximity guards
(e.g. `resultWithinDaysBlock`, `daysToResult ≤ N`). Always compute them dynamically from the test
epoch so the margin never shrinks to zero.

## Why
`swingOrderStaging.test.ts` Case 10 used `resultDate: "2026-08-01"`. On 2026-07-29, `daysBetweenIstDates` returned 3 — exactly the `resultWithinDaysBlock: 3` boundary — so `RESULT_WITHIN_3_DAYS` fired, blocked the second approval, and caused a consistent `AssertionError: expected false to be true`. The fixture had been safe since it was written but drifted into the window as time advanced. It blocked the A0.3.3 acceptance pass for an entire session.

**How to apply:**
- For any test involving a proximity window of N days, derive the date as:
  `new Date(t + (N + margin) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)`
  where `margin ≥ 27` absorbs ±1-day IST/UTC boundary skew plus generous drift room.
- IST/UTC boundary skew is ≤1 day — a 30-day offset leaves 27+ days of clearance from a 3-day window.
- Grep signal: `resultDate.*20[0-9]{2}-[0-9]{2}-[0-9]{2}|daysToResult.*=.*[0-9]+` in test files
  to find static future dates near threshold values.
