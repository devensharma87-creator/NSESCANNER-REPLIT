/**
 * AccessGuard — wraps a page and decides whether the current identity is
 * allowed to view it.
 *
 *   - Owner: always allowed.
 *   - Subscriber: allowed iff page's tab key is in their allowedTabs.
 *   - Pages without a tab key (owner-only routes like /admin, /kite, /audit,
 *     /status, /manifesto, /stock/:symbol, /index/:slug) require owner role
 *     unless explicitly opted in via the `allowSubscriberDetail` prop.
 *
 * Subscribers hitting a forbidden URL see a "not in your plan" screen with a
 * link back to Home — it's a hard backend gate too, but this gives a friendly
 * UI instead of leaking 403 text.
 */
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Home as HomeIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import type { AllowedTabKey } from "@/lib/auth-api";
import type { ReactNode } from "react";

export function AccessGuard({
  tab,
  ownerOnly,
  allowSubscriberDetail,
  children,
}: {
  /** The allowed-tab key this page belongs to. Omit for owner-only pages. */
  tab?: AllowedTabKey;
  /** Mark as owner-only explicitly (e.g. /admin, /audit). */
  ownerOnly?: boolean;
  /** Allow any active subscriber regardless of tab list (e.g. stock detail). */
  allowSubscriberDetail?: boolean;
  children: ReactNode;
}) {
  const { role, allowedTabs, status } = useAuth();

  if (role === "owner") return <>{children}</>;

  if (role === "subscriber") {
    if (status !== "active") {
      // The LoginGate normally intercepts inactive subscribers, but guard
      // anyway in case of stale state.
      return <DeniedScreen reason="inactive" />;
    }
    if (ownerOnly) return <DeniedScreen reason="ownerOnly" />;
    if (allowSubscriberDetail) return <>{children}</>;
    if (!tab) return <DeniedScreen reason="ownerOnly" />;
    if (!allowedTabs.includes(tab)) return <DeniedScreen reason="notInPlan" tabKey={tab} />;
    return <>{children}</>;
  }

  // role === null  → LoginGate normally renders the login form before this is
  // reached, but render a placeholder just in case.
  return null;
}

function DeniedScreen({ reason, tabKey }: { reason: "ownerOnly" | "notInPlan" | "inactive"; tabKey?: AllowedTabKey }) {
  const titles = {
    ownerOnly: "Owner-only area",
    notInPlan: "Not included in your plan",
    inactive: "Account not active",
  } as const;
  const bodies = {
    ownerOnly: "This section is restricted to the site administrator. Subscribers do not have access.",
    notInPlan: tabKey ? `The "${tabKey.replace(/_/g, " ").toLowerCase()}" tab is not currently enabled on your subscription. Contact the administrator to request access.` : "This area is not included in your subscription.",
    inactive: "Your account is not currently active. Please contact the administrator.",
  } as const;
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-2 border-amber-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-amber-500" /> {titles[reason]}</CardTitle>
          <CardDescription>{bodies[reason]}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/">
            <Button className="gap-2"><HomeIcon className="h-4 w-4" /> Back to Home</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
