/**
 * LoginGate — the top-level auth boundary. Three cases:
 *   1. AuthContext loading → splash
 *   2. AuthContext guest → render the login/signup/admin form
 *   3. AuthContext authenticated → render children (the main app)
 *      EXCEPT when subscriber is pending / suspended / expired — then we
 *      render an account-status screen instead of the app.
 *
 * Login form has three tabs:
 *   - "Sign In"  — existing subscriber email + password
 *   - "Sign Up"  — new subscriber registration
 *   - "Admin"    — site owner access password (legacy APP_ACCESS_PASSWORD)
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Lock, AlertTriangle, UserPlus, LogIn, Shield, Clock, Ban, Globe } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ownerLogin, userLogin, userSignup, logout, setPublicMode } from "@/lib/auth-api";

type Mode = "signin" | "signup" | "admin";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function AccountStatusScreen({ kind, subscriberName, expiresAt }: {
  kind: "pending" | "suspended" | "expired";
  subscriberName: string;
  expiresAt: string | null;
}) {
  const { refresh } = useAuth();
  const config = {
    pending: {
      icon: Clock,
      tone: "amber",
      title: "Account awaiting approval",
      body: "Your registration was received. To activate, please pay the annual subscription of Rs. 5,500/- and contact the administrator with your registered email so they can mark your account active.",
    },
    suspended: {
      icon: Ban,
      tone: "red",
      title: "Account suspended",
      body: "Your account has been temporarily disabled by the administrator. Please contact them for details.",
    },
    expired: {
      icon: Clock,
      tone: "red",
      title: "Subscription expired",
      body: `Your annual subscription expired on ${fmtDate(expiresAt)}. To regain access, please pay the renewal of Rs. 5,500/- and contact the administrator to extend your account.`,
    },
  } as const;
  const c = config[kind];
  const Icon = c.icon;
  const ring = c.tone === "amber" ? "border-amber-500/40 bg-amber-500/5" : "border-red-500/40 bg-red-500/5";
  const text = c.tone === "amber" ? "text-amber-500" : "text-red-500";
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className={`w-full max-w-md border-2 ${ring}`}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Icon className={`h-8 w-8 ${text}`} />
            <div>
              <CardTitle className="text-xl">{c.title}</CardTitle>
              <CardDescription className="mt-1">Hello {subscriberName}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={async () => { await refresh(); }}>
              Re-check status
            </Button>
            <Button variant="ghost" className="flex-1" onClick={async () => { await logout(); await refresh(); }}>
              Log out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthForm() {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Shared field state — kept across mode switches so users don't lose typing
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // ── Public-access toggle (collapsible owner-only control) ──────────
  // Tucked at the bottom of the form behind a "Make site public" link.
  // Expands into a small password field + Enable button. On success the
  // server flips the disk-persisted flag and refresh() makes /auth/me
  // return synthetic owner identity → the LoginGate renders children.
  const [publicShowForm, setPublicShowForm] = useState(false);
  const [publicPassword, setPublicPassword] = useState("");
  const [publicSubmitting, setPublicSubmitting] = useState(false);
  const [publicError, setPublicError] = useState<string | null>(null);

  async function enablePublicMode(e: FormEvent) {
    e.preventDefault();
    if (!publicPassword) {
      setPublicError("Owner password required");
      return;
    }
    setPublicSubmitting(true);
    setPublicError(null);
    try {
      await setPublicMode(true, publicPassword);
      setPublicPassword("");
      setPublicShowForm(false);
      await refresh();
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : "Failed to enable public access");
    } finally {
      setPublicSubmitting(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === "signin") {
        if (!email || !password) throw new Error("Email and password are required");
        await userLogin(email, password);
      } else if (mode === "signup") {
        if (!fullName.trim()) throw new Error("Full name is required");
        if (password.length < 8) throw new Error("Password must be at least 8 characters");
        await userSignup({ email, password, fullName, phone: phone || undefined });
        setInfo("Account created. Awaiting admin approval — see next screen.");
      } else {
        if (!adminPassword) throw new Error("Admin password required");
        await ownerLogin(adminPassword);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md border-2 border-primary/20">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-3">
            <Activity className="h-7 w-7 text-primary" />
            <div>
              <CardTitle className="text-2xl">NSE Stock Scanner</CardTitle>
              <CardDescription>Live Indian market intelligence</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode toggle */}
          <div className="grid grid-cols-3 rounded-md border border-border bg-muted/30 p-0.5 text-xs font-mono">
            {([
              { k: "signin", label: "Sign In",   icon: LogIn },
              { k: "signup", label: "Sign Up",   icon: UserPlus },
              { k: "admin",  label: "Admin",     icon: Shield },
            ] as const).map(t => {
              const Icon = t.icon;
              const active = mode === t.k;
              return (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => { setMode(t.k); setError(null); setInfo(null); }}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`mode-${t.k}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} required data-testid="input-fullname" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" data-testid="input-phone" />
                </div>
              </>
            )}

            {(mode === "signin" || mode === "signup") && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete={mode === "signin" ? "email" : "off"} required data-testid="input-email" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="password">Password {mode === "signup" && <span className="text-xs text-muted-foreground">(min 8 chars)</span>}</Label>
                  <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} data-testid="input-password" />
                </div>
              </>
            )}

            {mode === "admin" && (
              <div className="space-y-1">
                <Label htmlFor="adminPassword" className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Admin access password</Label>
                <Input id="adminPassword" type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} autoFocus data-testid="input-admin-password" />
                <p className="text-xs text-muted-foreground mt-1 leading-snug">Owner-only. This is the master site password, not a user account.</p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {info && (
              <div className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded p-2">
                {info}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit-auth">
              {submitting ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Unlock as admin"}
            </Button>
          </form>

          {mode === "signup" && (
            <p className="text-xs text-muted-foreground leading-relaxed border-t pt-3">
              Annual subscription is Rs. 5,500/-. New accounts start in <span className="font-semibold text-amber-500">pending</span> state until the administrator verifies your payment.
            </p>
          )}

          {/* Owner-only public-access toggle. Collapsed by default — only
              the owner (knowing the password) can expand and submit. */}
          <div className="border-t pt-3">
            {publicShowForm ? (
              <form onSubmit={enablePublicMode} className="space-y-2">
                <Label htmlFor="publicPassword" className="flex items-center gap-1.5 text-xs">
                  <Globe className="h-3.5 w-3.5 text-amber-500" />
                  Owner password to enable public access
                </Label>
                <Input
                  id="publicPassword"
                  type="password"
                  autoFocus
                  value={publicPassword}
                  onChange={e => setPublicPassword(e.target.value)}
                  placeholder="Same as Admin password"
                  data-testid="input-public-password"
                />
                <p className="text-[11px] text-amber-600 dark:text-amber-500 leading-snug">
                  Anyone with the URL will be able to browse the site without logging in until you click "Lock again" in the banner.
                </p>
                {publicError && (
                  <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{publicError}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="outline"
                    className="flex-1 border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                    disabled={publicSubmitting}
                    data-testid="button-public-enable"
                  >
                    {publicSubmitting ? "Please wait…" : "Make site public"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => { setPublicShowForm(false); setPublicPassword(""); setPublicError(null); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setPublicShowForm(true)}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-amber-600 transition-colors"
                data-testid="button-public-toggle-open"
              >
                <Globe className="h-3.5 w-3.5" />
                Owner: temporarily make this site public
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function LoginGate({ children }: { children: ReactNode }) {
  const { state } = useAuth();

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm font-mono text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md border-red-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500"><AlertTriangle className="h-5 w-5" /> Cannot reach server</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (state.kind === "guest") {
    return <AuthForm />;
  }
  if (state.kind === "subscriber") {
    const sub = state.subscriber;
    if (sub.status !== "active") {
      return (
        <AccountStatusScreen
          kind={sub.status}
          subscriberName={sub.fullName}
          expiresAt={sub.subscriptionExpiresAt}
        />
      );
    }
  }
  return <>{children}</>;
}
