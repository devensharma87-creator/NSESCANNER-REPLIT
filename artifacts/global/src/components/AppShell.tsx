import { Link, useLocation } from "wouter";
import { useGlobalLogout, useGetGlobalAuthStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Globe, LayoutDashboard, Filter, Star, LogOut } from "lucide-react";
import {
  CommandPalette,
  CommandPaletteTrigger,
  useCommandPalette,
} from "@/components/CommandPalette";

const NAV = [
  { to: "/", label: "Dashboard",  icon: LayoutDashboard },
  { to: "/screener", label: "Screener", icon: Filter },
  { to: "/watchlist", label: "Watchlist", icon: Star },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const status = useGetGlobalAuthStatus();
  const logout = useGlobalLogout({
    mutation: { onSuccess: () => { window.location.reload(); } },
  });
  // Cmd/Ctrl+K is wired up globally via this hook; the trigger button in
  // the header just opens the same overlay for users who don't know the
  // shortcut.
  const palette = useCommandPalette();

  return (
    <div className="min-h-screen bg-background">
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      <header className="border-b sticky top-0 z-10 bg-background/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold hover-elevate active-elevate-2 px-2 py-1 rounded-md"
            data-testid="link-home"
          >
            <Globe className="h-5 w-5 text-primary" />
            <span>Global Scanner</span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = location === n.to || (n.to !== "/" && location.startsWith(n.to));
              return (
                <Link
                  key={n.to}
                  href={n.to}
                  data-testid={`nav-${n.label.toLowerCase()}`}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md hover-elevate active-elevate-2 ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <CommandPaletteTrigger onClick={() => palette.setOpen(true)} />
            {status.data?.authenticated && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logout.mutate()}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-1" />
                Sign out
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
