import { useState } from "react";
import { useGetGlobalAuthStatus, useGlobalLogin, getGetGlobalAuthStatusQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ShieldAlert, Globe } from "lucide-react";

export function LoginGate({ children }: { children: React.ReactNode }) {
  const status = useGetGlobalAuthStatus({
    query: { queryKey: getGetGlobalAuthStatusQueryKey(), staleTime: 5_000, refetchOnWindowFocus: false },
  });

  if (status.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status.data?.authenticated) return <>{children}</>;

  if (status.data && !status.data.passwordConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Server not configured
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The Global Multi-Asset Scanner requires the{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">GLOBAL_APP_ACCESS_PASSWORD</code>{" "}
              secret to be set on the server. Please add it in Replit Secrets and refresh.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <LoginForm onLoggedIn={() => status.refetch()} />;
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useGlobalLogin({
    mutation: {
      onSuccess: () => { setError(null); onLoggedIn(); },
      onError: (err) => {
        const msg = (err as { status?: number })?.status === 401
          ? "Invalid password"
          : "Login failed — please try again";
        setError(msg);
      },
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-6 w-6 text-primary" />
            <CardTitle>Global Multi-Asset Scanner</CardTitle>
          </div>
          <CardDescription>
            Crypto · Commodities · Forex — Phase 1. Enter the access password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!password) return;
              login.mutate({ data: { password } });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Sign-in failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={login.isPending || !password} className="w-full">
              {login.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sign in
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              This password is independent from the NSE Stock Scanner.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
