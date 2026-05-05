import { Link, useLocation } from "wouter";
import { Search, ChevronLeft, ChevronRight, ShieldCheck, LogOut } from "lucide-react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import GlobalStrip from "@/components/global-strip";
import IndianStrip from "@/components/indian-strip";
import { useListStocks, getListStocksQueryKey } from "@workspace/api-client-react";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ThemeSwitcher, applyTheme, loadInitialTheme } from "@/components/theme-switcher";
import { useAuth } from "@/hooks/use-auth";
import { logout, type AllowedTabKey } from "@/lib/auth-api";
import { PublicModeBanner } from "@/components/public-mode-banner";

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
    document.title = label ? `${label} · NSE Scanner` : "NSE Scanner";
  }, [location]);

  return (
    <div className={`min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-primary ${publicMode ? "pt-9" : ""}`}>
      {publicMode && <PublicModeBanner />}
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
              // Each tab is tagged with either:
              //   tab: AllowedTabKey  → visible only if subscriber has that grant (always shown to owner)
              //   ownerOnly: true     → visible only to the site owner
              type NavTab = {
                href: string;
                label: string;
                isActive: (l: string) => boolean;
                tab?: AllowedTabKey;
                ownerOnly?: boolean;
              };
              const allTabs: NavTab[] = [
                { href: "/", label: "Home", isActive: l => l === "/", tab: "HOME" },
                { href: "/scanner", label: "Scanner", isActive: l => l.startsWith("/scanner"), tab: "SCANNER" },
                { href: "/deep-scan", label: "Deep Scan", isActive: l => l.startsWith("/deep-scan"), tab: "DEEP_SCAN" },
                { href: "/options", label: "F\u00A0&\u00A0O Intraday", isActive: l => l === "/options", tab: "FNO" },
                { href: "/strategies", label: "Strategies", isActive: l => l.startsWith("/strategies"), tab: "STRATEGIES" },
                { href: "/option-chain", label: "Option Chain", isActive: l => l.startsWith("/option-chain"), tab: "OPTION_CHAIN" },
                { href: "/oi-lab", label: "OI Lab", isActive: l => l.startsWith("/oi-lab"), tab: "OI_LAB" },
                { href: "/premarket", label: "Pre / Post", isActive: l => l.startsWith("/premarket"), tab: "PREMARKET" },
                { href: "/watchlist", label: "Watchlist", isActive: l => l.startsWith("/watchlist"), tab: "WATCHLIST" },
                { href: "/sectors", label: "Sectors", isActive: l => l.startsWith("/sectors"), tab: "SECTORS" },
                { href: "/flows", label: "FII / DII", isActive: l => l.startsWith("/flows"), tab: "FLOWS" },
                { href: "/stocks-to-watch", label: "To Watch", isActive: l => l.startsWith("/stocks-to-watch"), tab: "STOCKS_TO_WATCH" },
                { href: "/news", label: "Market Info", isActive: l => l === "/news", tab: "NEWS" },
                { href: "/kite", label: "Live Feed", isActive: l => l.startsWith("/kite"), ownerOnly: true },
                { href: "/learn", label: "Learn", isActive: l => l.startsWith("/learn"), tab: "LEARN" },
                { href: "/audit", label: "Audit", isActive: l => l.startsWith("/audit"), ownerOnly: true },
                { href: "/status", label: "Status", isActive: l => l.startsWith("/status"), ownerOnly: true },
                { href: "/paper-trading", label: "Paper", isActive: l => l.startsWith("/paper-trading"), ownerOnly: true },
                { href: "/paper-reports", label: "Reports", isActive: l => l.startsWith("/paper-reports"), ownerOnly: true },
              ];
              const tabs = allTabs.filter(t => {
                if (role === "owner") return true;
                if (t.ownerOnly) return false;
                if (t.tab) return allowedTabs.includes(t.tab);
                return false;
              });
              return (
                <div ref={navScrollRef} className="overflow-x-auto no-scrollbar scroll-smooth">
                  <nav ref={navRef} className="flex items-center gap-x-4 lg:gap-x-5 text-[13.5px] lg:text-[14px] font-semibold whitespace-nowrap pl-7 pr-7">
                    {tabs.map(t => {
                      const active = t.isActive(location);
                      return (
                        <Link
                          key={t.href}
                          href={t.href}
                          data-active={active ? "true" : undefined}
                          className={`transition-colors hover:text-foreground ${active ? "text-foreground" : "text-foreground/60"}`}
                        >
                          {t.label}
                        </Link>
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
      <IndianStrip />
      <GlobalStrip />
      </div>

      <main className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border bg-card py-6 md:py-0">
        <div className="w-full px-4 flex flex-col items-center justify-between gap-4 md:h-16 md:flex-row">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built for active traders · Yahoo Finance fallback (~15 min delayed). Set <code className="font-mono text-foreground">KITE_API_KEY</code> + <code className="font-mono text-foreground">KITE_API_SECRET</code> + <code className="font-mono text-foreground">KITE_ACCESS_TOKEN</code> to upgrade to live ticks.
          </p>
          <p className="text-center text-xs text-muted-foreground md:text-left">
            Indicators computed server-side · Educational only — not financial advice
          </p>
        </div>
      </footer>
    </div>
  );
}
