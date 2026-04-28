/**
 * Typed fetchers for the auth + admin + personal-watchlist endpoints.
 *
 * These endpoints are NOT in the OpenAPI spec / generated client — they're
 * one-off concerns and the surface is small enough that hand-rolled fetch
 * keeps the code shorter than a full openapi roundtrip would. Every call
 * returns either the typed payload or throws a structured Error.
 */

const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api${path}`;

export const ALLOWED_TAB_KEYS = [
  "HOME",
  "SCANNER",
  "OPTION_CHAIN",
  "OI_LAB",
  "WATCHLIST",
  "PREMARKET",
  "FLOWS",
  "STOCKS_TO_WATCH",
  "NEWS",
  "LEARN",
] as const;
export type AllowedTabKey = (typeof ALLOWED_TAB_KEYS)[number];

/** Map of tab key → URL path it gates. Used by access-guard + nav filter. */
export const TAB_PATH: Record<AllowedTabKey, string> = {
  HOME: "/",
  SCANNER: "/scanner",
  OPTION_CHAIN: "/option-chain",
  OI_LAB: "/oi-lab",
  WATCHLIST: "/watchlist",
  PREMARKET: "/premarket",
  FLOWS: "/flows",
  STOCKS_TO_WATCH: "/stocks-to-watch",
  NEWS: "/news",
  LEARN: "/learn",
};

/** Reverse: URL prefix → tab key. Returns null for owner-only / detail routes. */
export function tabKeyForPath(pathname: string): AllowedTabKey | null {
  if (pathname === "/") return "HOME";
  for (const [k, p] of Object.entries(TAB_PATH)) {
    if (p === "/") continue;
    if (pathname === p || pathname.startsWith(p + "/")) return k as AllowedTabKey;
  }
  return null;
}

export type UserStatus = "pending" | "active" | "suspended" | "expired";

export interface SubscriberInfo {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  status: UserStatus;
  allowedTabs: AllowedTabKey[];
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  amountPaise: number | null;
}

export type MeResponse =
  | { authenticated: false; error?: string }
  | { authenticated: true; role: "owner"; allowedTabs: AllowedTabKey[] }
  | { authenticated: true; role: "subscriber"; user: SubscriberInfo };

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* body stays null */ }
  if (!r.ok) {
    const obj = (body ?? {}) as Record<string, unknown>;
    const err = new Error(
      typeof obj["message"] === "string" ? obj["message"] :
      typeof obj["error"] === "string" ? obj["error"] :
      `Request failed (${r.status})`
    );
    (err as Error & { code?: string; status?: number }).code = typeof obj["code"] === "string" ? obj["code"] : undefined;
    (err as Error & { code?: string; status?: number }).status = r.status;
    throw err;
  }
  return body as T;
}

// ----- public auth -----

export const fetchMe = () => jsonFetch<MeResponse>("/auth/me");

export const ownerLogin = (password: string) =>
  jsonFetch<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) });

export const userLogin = (email: string, password: string) =>
  jsonFetch<{ ok: true; user: { id: number; email: string; fullName: string; status: UserStatus; allowedTabs: AllowedTabKey[] } }>(
    "/auth/user-login", { method: "POST", body: JSON.stringify({ email, password }) }
  );

export const userSignup = (input: { email: string; password: string; fullName: string; phone?: string }) =>
  jsonFetch<{ ok: true; user: { id: number; email: string; fullName: string; status: UserStatus } }>(
    "/auth/signup", { method: "POST", body: JSON.stringify(input) }
  );

export const logout = () =>
  jsonFetch<{ ok: true }>("/auth/logout", { method: "POST" });

// ----- admin (owner-only) -----

export interface AdminUserRow extends SubscriberInfo {
  role: string;
  effectiveStatus: UserStatus;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  paymentRef: string | null;
  notes: string | null;
}

export const adminListUsers = () =>
  jsonFetch<{ users: AdminUserRow[] }>("/admin/users");

export interface AdminUpdatePayload {
  status?: UserStatus;
  fullName?: string;
  phone?: string | null;
  subscriptionStartedAt?: string | null;
  subscriptionExpiresAt?: string | null;
  amountPaise?: number | null;
  paidAt?: string | null;
  paymentRef?: string | null;
  notes?: string | null;
  allowedTabs?: AllowedTabKey[];
}

export const adminUpdateUser = (id: number, patch: AdminUpdatePayload) =>
  jsonFetch<{ user: AdminUserRow }>(`/admin/users/${id}`, {
    method: "PATCH", body: JSON.stringify(patch),
  });

export const adminDeleteUser = (id: number) =>
  jsonFetch<{ ok: true }>(`/admin/users/${id}`, { method: "DELETE" });

// ----- personal watchlist -----

export interface PersonalWatchlistItem {
  symbol: string;
  addedAt: string;
  notes: string | null;
}

export const getPersonalWatchlist = () =>
  jsonFetch<{ items: PersonalWatchlistItem[] }>("/personal-watchlist");

export const addToPersonalWatchlist = (symbol: string, notes?: string | null) =>
  jsonFetch<{ ok: true; symbol: string }>("/personal-watchlist", {
    method: "POST", body: JSON.stringify({ symbol, notes }),
  });

export const removeFromPersonalWatchlist = (symbol: string) =>
  jsonFetch<{ ok: true }>(`/personal-watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" });
