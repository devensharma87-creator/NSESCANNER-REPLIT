import { Link, useLocation } from "wouter";
import { Search, ChevronLeft, ChevronRight, ChevronDown, ShieldCheck, LogOut } from "lucide-react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import GlobalStrip from "@/components/global-strip";
import IndianStrip from "@/components/indian-strip";
import { useListStocks, getListStocksQueryKey } from "@workspace/api-client-react";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ThemeSwitcher, applyTheme, loadInitialTheme } from "@/components/theme-switcher";
import { isSeoManagedPath } from "@/lib/seo-config";
import { useAuth } from "@/hooks/use-auth";
import { logout, type AllowedTabKey } from "@/lib/auth-api";
import { PublicModeBanner } from "@/components/public-mode-banner";
import { GlobalStatusBanner } from "@/components/global-status-banner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { role, allowedTabs, subscriber, publicMode, refresh: refreshAuth } = useAuth();

  const { data: allStocks } = useListStocks(undefined, {
    query: { staleTime: 30_000, queryKey: getListStocksQueryKey() },
  });

  const matches = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (q.length < 1) return [];
    return (allStocks ?? [])
      .filter(s => s.symbol.toUpperCase().includes(q) || s.name.toUpperCase().includes(q))
      .slice(0, 8);
  }, [search, allStocks]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (matches.length > 0) {
      go(matches[0]!.symbol);
    } else if (search.trim()) {
      setLocation(`/scanner?search=${encodeURIComponent(search.trim())}`);
      setOpen(false);
    }
  };

  const go = (sym: string) => {
    setSearch("");
    setOpen(false);
    setLocation(`/stock/${encodeURIComponent(sym)}`);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Apply persisted theme on mount (defaults to dark)
  useEffect(() => {
    applyTheme(loadInitialTheme());
  }, []);

  const [location] = useLocation();

  // Horizontal nav scroll affordances
  const navScrollRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateNavEdges = useCallback(() => {
    const el = navScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft < maxScroll - 2);
  }, []);

  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    updateNavEdges();
    el.addEventListener("scroll", updateNavEdges, { passive: true });
    const ro = new ResizeObserver(updateNavEdges);
    ro.observe(el);
    if (navRef.current) ro.observe(navRef.current);
    return () => {
      el.removeEventListener("scroll", updateNavEdges);
      ro.disconnect();
    };
  }, [updateNavEdges]);

  // Auto-scroll the active tab into view on route change
  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[data-active="true"]');
    if (active) {
      const elBox = el.getBoundingClientRect();
      const aBox = active.getBoundingClientRect();
      const offset = aBox.left - elBox.left + el.scrollLeft - (elBox.width - aBox.width) / 2;
      el.scrollTo({ left: Math.max(0, offset), behavior: "smooth" });
    }
    requestAnimationFrame(updateNavEdges);
  }, [location, updateNavEdges]);

  const scrollNav = (dir: 1 | -1) => {
    const el = navScrollRef.current;
    if (!el) return;
    const step = Math.max(120, Math.round(el.clientWidth * 0.7));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  // Update browser tab title per route
  useEffect(() => {
    const safeDecode = (s: string): string => {
      try { return decodeURIComponent(s); } catch { return s; }
    };
    const titles: Record<string, string> = {
      "/": "Home",
      "/scanner": "Scanner",
      "/deep-scan": "Deep Scan",
      "/options": "F&O Intraday",
      "/strategies": "Strategies",
      "/option-chain": "Option Chain",
      "/oi-lab": "OI Lab",
      "/premarket": "Pre / Post",
      "/watchlist": "Watchlist",
      "/sectors": "Sectors",
      "/flows": "FII / DII",
      "/stocks-to-watch": "Stocks To Watch",
      "/charting": "Charting",
      "/portfolio-analyser": "Portfolio Analyser",
      "/news": "Market Info",
      "/status": "Status",
      "/audit": "Audit",
      "/kite": "Live Feed",
      "/paper-trading": "Paper Trading",
      "/learn": "Learn",
    };
    let label = titles[location];
    if (!label) {
      if (location.startsWith("/stock/")) label = safeDecode(location.slice(7));
      else if (location.startsWith("/sectors/")) label = safeDecode(location.slice(9));
      else if (location.startsWith("/index/")) label = safeDecode(location.slice(7)).toUpperCase();
      else if (location.startsWith("/option-chain/")) label = `${safeDecode(location.slice(14))} Chain`;
    }
    // Skip routes that mount <Seo /> — they own document.title themselves
    // (single source of truth in seo-config.ts). React effect ordering is
    // child-before-parent on mount AND on each render, so without this guard
    // Layout would consistently overwrite Seo's title after Seo set it.
    if (isSeoManagedPath(location)) return;
    document.title = label ? `${label} · Market Scanner by Dev` : "Market Scanner by Dev";
  }, [location]);

  // Legal pages render with stripped-down chrome — no nav, no live data
  // strips, no admin search/login surface, no public-mode banner.
  // The disclaimer/terms/privacy/methodology pages are reachable
  // without auth (see login-gate.tsx PUBLIC_ROUTES) so we keep the
  // header surface deliberately minimal: brand-only header + a thin
  // legal-only footer. Owner controls (Kite reauth, paper-trade
  // toggles, public-mode banner) are intentionally suppressed here.
  if (location.startsWith("/legal/")) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
        <header className="border-b border-border bg-card">
          <div className="w-full px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-mono font-bold text-sm tracking-tight hover:text-primary transition-colors">
              Hrishi Associates · Market Scanner
            </Link>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Legal</span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border bg-card">
          <div className="w-full px-4 py-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between text-xs text-muted-foreground">
            <span className="italic">Educational only — not financial advice. Hrishi Associates is not a SEBI-registered investment adviser.</span>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link href="/legal/disclaimer" className="hover:text-foreground transition-colors">Disclaimer</Link>
              <Link href="/legal/methodology" className="hover:text-foreground transition-colors">Methodology &amp; Sources</Link>
              <Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms</Link>
              <Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            </nav>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className={`min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-primary ${publicMode ? "pt-9" : ""}`}>
      {publicMode && <PublicModeBanner />}
      <GlobalStatusBanner />
      <div className={`sticky ${publicMode ? "top-9" : "top-0"} z-40 w-full bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65 border-b border-border`}>
      <header className="w-full border-b border-border">
        <div className="w-full px-4 flex h-20 items-center gap-4 min-w-0">
          <Link
            href="/manifesto"
            className="brand-link group flex flex-col justify-center leading-[1.05] shrink-0 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md py-1 pl-1 pr-2"
            aria-label="Hrishi Associates Market Scanner — open manifesto"
            title="Open the Trader's Manifesto"
          >
            <span
              className="brand-name font-black italic text-[26px] sm:text-[28px] lg:text-[32px] tracking-tight leading-none"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Hrishi&nbsp;Associates
            </span>
            <span className="font-mono text-[10px] sm:text-[10.5px] tracking-[0.32em] uppercase text-foreground/65 mt-1.5">
              Market Scanner <span className="text-foreground/35">·</span> by Dev
            </span>
            <span className="hidden sm:flex items-center gap-1.5 italic text-[10.5px] text-muted-foreground/85 mt-1">
              <span>Learn Smarter</span>
              <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-amber-500/80" />
              <span>Trade Smarter</span>
              <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-cyan-500/80" />
              <span>Grow Faster</span>
            </span>
          </Link>
          <div className="relative flex-1 min-w-0">
            {(() => {
              // Grouped navigation. Every leaf carries either:
              //   tab: AllowedTabKey  → visible only if subscriber has that grant (always shown to owner)
              //   ownerOnly: true     → visible only to the site owner
              // Grouping is presentation-only: each leaf still points at its
              // original route, and route-level <AccessGuard> remains the real
              // gate. No route, page, or access level is changed here.
              type NavLeaf = {
                href: string;
                label: string;
                desc: string;
                isActive: (l: string) => boolean;
                tab?: AllowedTabKey;
                ownerOnly?: boolean;
              };
              type NavEntry =
                | ({ kind: "link" } & NavLeaf)
                | { kind: "group"; label: string; items: NavLeaf[] };

              const entries: NavEntry[] = [
                { kind: "link", href: "/", label: "Home", desc: "Market dashboard overview", isActive: l => l === "/", tab: "HOME" },
                {
                  kind: "group",
                  label: "Stock Intelligence",
                  items: [
                    { href: "/scanner", label: "Full Scanner", desc: "Fast sortable universe scan", isActive: l => l.startsWith("/scanner"), tab: "SCANNER" },
                    { href: "/deep-scan", label: "Deep Scan", desc: "Single-symbol deep technical & fundamental analysis", isActive: l => l.startsWith("/deep-scan"), tab: "DEEP_SCAN" },
                    { href: "/watchlist", label: "Watchlist", desc: "Saved baskets & short-term trend view", isActive: l => l.startsWith("/watchlist"), tab: "WATCHLIST" },
                    { href: "/sectors", label: "Sector Rotation", desc: "Sector rotation & industry strength", isActive: l => l.startsWith("/sectors"), tab: "SECTORS" },
                    { href: "/stocks-to-watch", label: "To Watch", desc: "Curated high-interest stocks & catalysts", isActive: l => l.startsWith("/stocks-to-watch"), tab: "STOCKS_TO_WATCH" },
                  ],
                },
                {
                  kind: "group",
                  label: "Derivatives",
                  items: [
                    { href: "/option-chain", label: "Option Chain", desc: "Live chain — PCR, max pain, S/R zones", isActive: l => l.startsWith("/option-chain"), tab: "OPTION_CHAIN" },
                    { href: "/oi-lab", label: "OI Lab", desc: "Open-interest analytics, heatmaps & delta flow", isActive: l => l.startsWith("/oi-lab"), tab: "OI_LAB" },
                  ],
                },
                {
                  kind: "group",
                  label: "Trading Desk",
                  items: [
                    { href: "/options", label: "F\u00A0&\u00A0O Intraday", desc: "Live F&O setup board", isActive: l => l === "/options", tab: "FNO" },
                    { href: "/strategies", label: "Strategies", desc: "Strategy idea simulator & education", isActive: l => l.startsWith("/strategies"), tab: "STRATEGIES" },
                    { href: "/paper-trading", label: "Paper Trading", desc: "Paper positions & live trades", isActive: l => l.startsWith("/paper-trading"), ownerOnly: true },
                    { href: "/paper-reports", label: "P&L Reports", desc: "P&L, drawdown, MFE/MAE & journal analytics", isActive: l => l.startsWith("/paper-reports"), ownerOnly: true },
                  ],
                },
                {
                  kind: "group",
                  label: "Market Pulse",
                  items: [
                    { href: "/premarket", label: "Pre / Post", desc: "Pre-market & post-market analysis", isActive: l => l.startsWith("/premarket"), tab: "PREMARKET" },
                    { href: "/news", label: "Market Info", desc: "News, earnings, holidays & events", isActive: l => l === "/news", tab: "NEWS" },
                    { href: "/flows", label: "FII / DII", desc: "Foreign & domestic institutional cash flows", isActive: l => l.startsWith("/flows"), tab: "FLOWS" },
                    { href: "/kite", label: "Live Feed", desc: "Zerodha Kite live data feed", isActive: l => l.startsWith("/kite"), ownerOnly: true },
                  ],
                },
                { kind: "link", href: "/charting", label: "Charting", desc: "Interactive charting workspace", isActive: l => l.startsWith("/charting"), tab: "CHARTING" },
                { kind: "link", href: "/portfolio-analyser", label: "Portfolio", desc: "Portfolio health & risk analysis", isActive: l => l.startsWith("/portfolio-analyser"), tab: "PORTFOLIO_ANALYSER" },
                { kind: "link", href: "/backtest-lab", label: "Backtest Lab", desc: "F&O backtesting — real replay & directional", isActive: l => l.startsWith("/backtest-lab"), tab: "BACKTEST_LAB" },
                { kind: "link", href: "/learn", label: "Learn", desc: "Trading education & methodology", isActive: l => l.startsWith("/learn"), tab: "LEARN" },
                {
                  kind: "group",
                  label: "Admin",
                  items: [
                    { href: "/admin", label: "Admin Console", desc: "Subscriber & access management", isActive: l => l.startsWith("/admin"), ownerOnly: true },
                    { href: "/audit", label: "Audit", desc: "Security & compliance audit", isActive: l => l.startsWith("/audit"), ownerOnly: true },
                    { href: "/status", label: "Status", desc: "System & data-source status", isActive: l => l.startsWith("/status"), ownerOnly: true },
                    { href: "/infra-health", label: "Infra", desc: "Data infrastructure health", isActive: l => l.startsWith("/infra-health"), ownerOnly: true },
                    { href: "/fno-diagnostics", label: "F&O Diag", desc: "F&O execution & signal observability", isActive: l => l.startsWith("/fno-diagnostics"), ownerOnly: true },
                  ],
                },
              ];

              const canSee = (t: { tab?: AllowedTabKey; ownerOnly?: boolean }) => {
                if (role === "owner") return true;
                if (t.ownerOnly) return false;
                if (t.tab) return allowedTabs.includes(t.tab);
                return false;
              };
              const linkCls = (active: boolean) =>
                `transition-colors hover:text-foreground ${active ? "text-foreground" : "text-foreground/60"}`;

              return (
                <div ref={navScrollRef} className="overflow-x-auto no-scrollbar scroll-smooth">
                  <nav ref={navRef} className="flex items-center gap-x-4 lg:gap-x-5 text-[13.5px] lg:text-[14px] font-semibold whitespace-nowrap pl-7 pr-7">
                    {entries.map(entry => {
                      if (entry.kind === "link") {
                        if (!canSee(entry)) return null;
                        const active = entry.isActive(location);
                        return (
                          <Link
                            key={entry.href}
                            href={entry.href}
                            title={entry.desc}
                            data-active={active ? "true" : undefined}
                            className={linkCls(active)}
                          >
                            {entry.label}
                          </Link>
                        );
                      }
                      const items = entry.items.filter(canSee);
                      if (items.length === 0) return null;
                      const groupActive = items.some(i => i.isActive(location));
                      return (
                        <DropdownMenu key={entry.label}>
                          <DropdownMenuTrigger
                            data-active={groupActive ? "true" : undefined}
                            className={`inline-flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm ${linkCls(groupActive)}`}
                          >
                            {entry.label}
                            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-64">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              {entry.label}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {items.map(i => {
                              const active = i.isActive(location);
                              return (
                                <DropdownMenuItem key={i.href} asChild className={active ? "bg-accent" : ""}>
                                  <Link
                                    href={i.href}
                                    data-active={active ? "true" : undefined}
                                    className="flex flex-col items-start gap-0.5 cursor-pointer"
                                  >
                                    <span className={`text-[13px] font-semibold ${active ? "text-foreground" : ""}`}>{i.label}</span>
                                    <span className="text-[11px] font-normal text-muted-foreground leading-snug whitespace-normal">{i.desc}</span>
                                  </Link>
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    })}
                  </nav>
                </div>
              );
            })()}

            {/* Left edge: fade + chevron */}
            <div
              className={`pointer-events-none absolute top-0 left-0 h-full w-10 bg-gradient-to-r from-card via-card/85 to-transparent transition-opacity ${canLeft ? "opacity-100" : "opacity-0"}`}
              aria-hidden
            />
            {canLeft && (
              <button
                type="button"
                onClick={() => scrollNav(-1)}
                aria-label="Scroll navigation left"
                className="absolute top-1/2 -translate-y-1/2 left-0 z-10 inline-flex items-center justify-center h-7 w-7 rounded-full border border-border bg-card/95 text-foreground shadow-md hover:bg-background hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}

            {/* Right edge: fade + chevron */}
            <div
              className={`pointer-events-none absolute top-0 right-0 h-full w-10 bg-gradient-to-l from-card via-card/85 to-transparent transition-opacity ${canRight ? "opacity-100" : "opacity-0"}`}
              aria-hidden
            />
            {canRight && (
              <button
                type="button"
                onClick={() => scrollNav(1)}
                aria-label="Scroll navigation right"
                className="absolute top-1/2 -translate-y-1/2 right-0 z-10 inline-flex items-center justify-center h-7 w-7 rounded-full border border-border bg-card/95 text-foreground shadow-md hover:bg-background hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-ring animate-pulse-once"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 shrink-0 w-40 sm:w-56 md:w-64 lg:w-72">
            {/*
              UserMenu — small identity chip at the top-right.
              Owner: shows "ADMIN" badge + link to /admin + sign-out.
              Subscriber: shows initials + name + sign-out.
            */}
            {role === "owner" ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <Link href="/admin" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 text-[11px] font-mono font-bold tracking-wider" data-testid="link-admin">
                  <ShieldCheck className="h-3.5 w-3.5" /> ADMIN
                </Link>
                <Link href="/infra-health" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/40 bg-primary/5 text-primary hover:bg-primary/15 text-[11px] font-mono font-bold tracking-wider" data-testid="link-infra-health" title="Data Infrastructure Health">
                  INFRA
                </Link>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7"
                  title="Sign out"
                  onClick={async () => { await logout(); await refreshAuth(); }}
                  data-testid="button-logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : role === "subscriber" && subscriber ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="text-[11px] font-mono text-muted-foreground hidden lg:block max-w-[100px] truncate" title={subscriber.email}>
                  {subscriber.fullName.split(" ")[0]}
                </div>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7"
                  title="Sign out"
                  onClick={async () => { await logout(); await refreshAuth(); }}
                  data-testid="button-logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}
            <ThemeSwitcher />
            <div ref={containerRef} className="relative flex-1 min-w-0">
              <form onSubmit={handleSubmit}>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search any NSE stock — e.g. RELIANCE, HDFC, Tata..."
                    className="pl-8 bg-background border-border"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                  />
                </div>
              </form>
              {open && search.trim() && (
                <div className="absolute right-0 left-0 mt-1 rounded-md border border-border bg-card shadow-xl max-h-[400px] overflow-auto z-[60]">
                  {matches.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground font-mono">No matches in current universe.</div>
                  ) : (
                    matches.map(s => {
                      const up = s.quote.changePercent >= 0;
                      return (
                        <button
                          type="button"
                          key={s.symbol}
                          onClick={() => go(s.symbol)}
                          className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 hover-row border-b border-border/50 last:border-0"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-sm">{s.symbol}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{s.name} · {s.sector}</div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <div className="font-mono text-sm tabular-nums">{s.quote.price.toFixed(2)}</div>
                              <div className={`font-mono text-[10px] ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                                {up ? "+" : ""}{s.quote.changePercent.toFixed(2)}%
                              </div>
                            </div>
                            <SignalBadge signal={s.recommendation.signal} />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      {location === "/" && (
        <>
          <IndianStrip />
          <GlobalStrip />
        </>
      )}
      </div>

      <main className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border bg-card">
        <div className="w-full px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:py-3">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>
              Hrishi Associates · Market Scanner by Dev — built for active Indian traders.
            </p>
            <p>
              Data: Zerodha Kite (live, when broker session active) with chart-provider /
              Yahoo Finance fallback (~15 min delayed). Indicators are computed server-side.
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <Link href="/legal/disclaimer" className="text-muted-foreground hover:text-foreground transition-colors">Disclaimer</Link>
            <Link href="/legal/methodology" className="text-muted-foreground hover:text-foreground transition-colors">Methodology &amp; Sources</Link>
            <Link href="/legal/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
            <Link href="/legal/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground italic">Educational only — not financial advice</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
