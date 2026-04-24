import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Lock, AlertTriangle } from "lucide-react";

const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api${path}`;

type Status =
  | { kind: "loading" }
  | { kind: "authenticated" }
  | { kind: "needs_login"; passwordConfigured: boolean }
  | { kind: "error"; message: string };

export function LoginGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  async function checkStatus() {
    try {
      const r = await fetch(apiUrl("/auth/status"), { credentials: "include" });
      if (!r.ok) {
        setStatus({ kind: "error", message: `Auth status check failed (${r.status})` });
        return;
      }
      const j = (await r.json()) as { authenticated: boolean; passwordConfigured: boolean };
      if (j.authenticated) setStatus({ kind: "authenticated" });
      else setStatus({ kind: "needs_login", passwordConfigured: j.passwordConfigured });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Cannot reach API server",
      });
    }
  }

  useEffect(() => {
    void checkStatus();
  }, []);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setLoginError(null);
    try {
      const r = await fetch(apiUrl("/auth/login"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        setPassword("");
        await checkStatus();
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.status === 503) setLoginError("Server has no APP_ACCESS_PASSWORD configured. Set it in Secrets and restart.");
      else if (r.status === 401) setLoginError("Invalid password.");
      else setLoginError(j.error ?? `Login failed (${r.status})`);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (status.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground font-mono text-sm">
        <Activity className="w-4 h-4 mr-2 animate-pulse" /> Connecting…
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Cannot reach API
            </CardTitle>
            <CardDescription className="font-mono text-xs">{status.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void checkStatus()} variant="outline" className="w-full">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status.kind === "needs_login") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-xl">NSE SCANNER</CardTitle>
            <CardDescription>Private workspace — sign in to continue</CardDescription>
          </CardHeader>
          <CardContent>
            {!status.passwordConfigured ? (
              <div className="border border-amber-500/40 bg-amber-500/5 rounded-md p-3 text-xs font-mono text-amber-600 mb-4">
                <div className="font-bold mb-1">Server not configured</div>
                Set the <span className="font-bold">APP_ACCESS_PASSWORD</span> secret in Replit and restart the API server. Until then, login is disabled.
              </div>
            ) : null}
            <form onSubmit={handleLogin} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={submitting || !status.passwordConfigured}
                />
              </div>
              {loginError ? (
                <div className="text-xs font-mono text-destructive">{loginError}</div>
              ) : null}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !password || !status.passwordConfigured}
              >
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
            <div className="mt-4 text-[10px] font-mono text-muted-foreground/70 text-center">
              Session lasts 30 days · Cookie-based · No accounts, no signups
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
