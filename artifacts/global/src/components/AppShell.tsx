import { Link, useLocation } from "wouter";
import { useGlobalLogout, useGetGlobalAuthStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Globe, LayoutDashboard, Filter, Star, LogOut, ChevronDown } from "lucide-react";
import {
  CommandPalette,
  CommandPaletteTrigger,
  useCommandPalette,
} from "@/components/CommandPalette";

const NAV = [
  { to: "/",          label: "Dashboard",  icon: LayoutDashboard, exact: true  },
  { to: "/screener",  label: "Screener",   icon: Filter,          exact: false },
  { to: "/watchlist", label: "Watchlist",  icon: Star,            exact: false },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const status = useGetGlobalAuthStatus();
  const logout = useGlobalLogout({
    mutation: { onSuccess: () => { window.location.reload(); } },
  });
  const palette = useCommandPalette();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Skip-to-content for keyboard users */}
      <a
        href="#main-content"
        className="absolute -top-full left-2 z-[9999] rounded-b px-3 py-1.5 text-sm font-semibold
                   bg-primary text-primary-foreground shadow-lg
                   focus:top-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1
                   transition-[top] duration-150"
      >
        Skip to main content
      </a>

      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header
        role="banner"
        className="border-b sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      >
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Brand */}
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold hover-elevate active-elevate-2 px-2 py-1 rounded-md"
            data-testid="link-home"
            aria-label="Global Multi-Asset Scanner — home"
          >
            <Globe className="h-5 w-5 text-primary" aria-hidden />
            <span className="hidden sm:inline">Global Scanner</span>
            <span className="sm:hidden">Global</span>
          </Link>

          {/* Primary navigation */}
          <nav role="navigation" aria-label="Primary navigation" className="flex items-center gap-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = n.exact
                ? location === n.to
                : location === n.to || (!n.exact && location.startsWith(n.to));
              return (
                <Link
                  key={n.to}
                  href={n.to}
                  data-testid={`nav-${n.label.toLowerCase()}`}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md",
                    "hover-elevate active-elevate-2 transition-colors",
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{n.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <CommandPaletteTrigger
              onClick={() => palette.setOpen(true)}
              aria-label="Open command palette (Ctrl+K)"
            />
            {status.data?.authenticated && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logout.mutate()}
                data-testid="button-logout"
                aria-label="Sign out of Global Scanner"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="ml-1 hidden sm:inline">Sign out</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main
        id="main-content"
        role="main"
        className="flex-1 max-w-7xl w-full mx-auto px-4 py-6"
        tabIndex={-1}
      >
        {children}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer role="contentinfo" className="border-t mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-3 text-xs text-muted-foreground text-center">
          Global Multi-Asset Scanner — reference data only, not financial advice.
        </div>
      </footer>
    </div>
  );
}
