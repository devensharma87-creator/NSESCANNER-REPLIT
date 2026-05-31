/**
 * W1A — Static verification-status config for the owner-only Gate Status
 * panel on /infra-health.
 *
 * This is a DISPLAY-ONLY ledger of where each gate/upgrade stands per the
 * human sign-off record. It does NOT gate, score, or alter any runtime
 * behaviour — flipping a value here changes a badge colour and nothing
 * else. The live P25 evidence gate is NOT listed here; its numbers are
 * pulled live from the shadow-exit endpoint and derived via
 * `deriveP25Gate` so the count is never stale.
 */
import type { GateState } from "@/lib/infraHealth";

export interface VerificationEntry {
  id: string;
  label: string;
  /** Display text shown in the status column. */
  status: string;
  state: GateState;
  note?: string;
}

export const VERIFICATION_STATUS: VerificationEntry[] = [
  {
    id: "S2b",
    label: "S2b · Intraday refresh loop",
    status: "Verified",
    state: "verified",
    note: "Refresh cycles + trigger-hit latching confirmed in production.",
  },
  {
    id: "S3b",
    label: "S3b · RS benchmark resilience",
    status: "Friday verified",
    state: "verified",
    note: "Resilient NIFTY-50 benchmark fallback chain confirmed on a Friday deep scan.",
  },
  {
    id: "H10b",
    label: "H10b · B1/B3 shadow diagnostic",
    status: "Partially verified",
    state: "partial",
    note: "Aggregator + route live; full payload coverage still being confirmed.",
  },
  {
    id: "H10d",
    label: "H10d · Owner shadow payload",
    status: "Pending",
    state: "pending",
    note: "Awaiting first full owner-session payload capture.",
  },
  { id: "S4c", label: "S4c · Sector activation", status: "Not approved", state: "not_approved" },
  { id: "S4d", label: "S4d · Sector activation", status: "Not approved", state: "not_approved" },
  { id: "S4e", label: "S4e · Sector activation", status: "Not approved", state: "not_approved" },
  { id: "S4f", label: "S4f · Sector activation", status: "Not approved", state: "not_approved" },
];
