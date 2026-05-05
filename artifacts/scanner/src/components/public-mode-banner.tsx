/**
 * PublicModeBanner — the persistent amber strip that appears at the
 * very top of the app shell whenever the owner has flipped the site
 * into public-access mode.
 *
 * Two purposes:
 *   1. Make it impossible for the owner to FORGET the site is public
 *      (avoids "I left it open for a year" disasters).
 *   2. Provide a one-click relock: opens a small inline form that
 *      asks for the owner password and POSTs to /api/auth/public-mode
 *      with `enabled: false`. On success, refreshes the auth context
 *      so the banner disappears and the cookie gate is back.
 *
 * The banner is rendered above the fold and does NOT push the rest of
 * the layout down on its own — the layout reserves the space via the
 * `pt-9` it adds when `publicMode` is true (see layout.tsx).
 */
import { useState } from "react";
import { Globe, Lock, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPublicMode } from "@/lib/auth-api";
import { useAuth } from "@/hooks/use-auth";

export function PublicModeBanner() {
  const { role, refresh } = useAuth();
  // Only the owner sees the relock affordance. Everyone else sees a thin
  // amber strip noting the site is in public-access mode (so visiting
  // analysts know they're looking at a publicly-shared snapshot), but
  // without the password form which is meaningless to non-owners.
  const isOwner = role === "owner";
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function relock(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Owner password required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await setPublicMode(false, password);
      setPassword("");
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to relock");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-amber-500/95 text-amber-950 border-b border-amber-700 shadow-md"
      data-testid="public-mode-banner"
    >
      <div className="max-w-screen-2xl mx-auto px-3 py-1.5 flex items-center gap-2 text-xs">
        <Globe className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">{isOwner ? "Public access ON" : "Shared view"}</span>
        <span className="hidden sm:inline opacity-80">
          {isOwner
            ? "— anyone with the URL can browse this site without logging in."
            : "— you are viewing a publicly-shared snapshot of this dashboard."}
        </span>
        <div className="flex-1" />
        {!isOwner ? null : showForm ? (
          <form onSubmit={relock} className="flex items-center gap-1.5">
            <Input
              type="password"
              autoFocus
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Owner password"
              className="h-7 text-xs w-40 bg-amber-50 border-amber-700 text-amber-950 placeholder:text-amber-700/60"
              data-testid="input-relock-password"
            />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={submitting}
              className="h-7 px-2 bg-amber-950 text-amber-50 hover:bg-amber-900 hover:text-amber-50"
              data-testid="button-relock-confirm"
            >
              <Lock className="h-3 w-3 mr-1" />
              {submitting ? "…" : "Relock"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => { setShowForm(false); setPassword(""); setError(null); }}
              className="h-7 w-7 p-0 hover:bg-amber-400"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </form>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowForm(true)}
            className="h-7 px-2 bg-amber-950 text-amber-50 hover:bg-amber-900 hover:text-amber-50"
            data-testid="button-relock-open"
          >
            <Lock className="h-3 w-3 mr-1" />
            Lock again
          </Button>
        )}
      </div>
      {error && (
        <div className="max-w-screen-2xl mx-auto px-3 pb-1.5 flex items-center gap-1.5 text-xs text-red-900 font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </div>
  );
}
