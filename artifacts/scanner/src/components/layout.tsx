import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import GlobalStrip from "@/components/global-strip";
import IndianStrip from "@/components/indian-strip";
import { useListStocks, getListStocksQueryKey } from "@workspace/api-client-react";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ThemeSwitcher, applyTheme, loadInitialTheme } from "@/components/theme-switcher";
import logoUrl from "@assets/logo_transparent.png";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Update browser tab title per route
  useEffect(() => {
    const safeDecode = (s: string): string => {
      try { return decodeURIComponent(s); } catch { return s; }
    };
    const titles: Record<string, string> = {
      "/": "Dashboard",
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
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-primary">
      <div className="sticky top-0 z-50 w-full bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65 border-b border-border">
      <header className="w-full border-b border-border">
        <div className="w-full px-4 flex h-20 items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-3 shrink-0" aria-label="Hrishi Associates Market Scanner — Home">
            <img
              src={logoUrl}
              alt="Hrishi Associates Market Scanner logo"
              className="h-16 w-16 object-contain drop-shadow-sm select-none"
              draggable={false}
            />
            <span className="hidden md:flex flex-col leading-[1.15] font-mono">
              <span className="text-[14px] font-bold tracking-tight uppercase">Hrishi Associates</span>
              <span className="text-[11px] tracking-widest uppercase text-muted-foreground">Market Scanner by Dev</span>
              <span className="text-[10px] italic text-muted-foreground/80 mt-0.5">Learn Smarter. Trade Smarter. Grow Faster.</span>
            </span>
          </Link>
          <div className="relative flex-1 min-w-0">
            <div className="overflow-x-auto no-scrollbar">
            <nav className="flex items-center gap-x-4 lg:gap-x-5 text-[13.5px] lg:text-[14px] font-semibold whitespace-nowrap">
              <Link href="/" className={`transition-colors hover:text-foreground ${location === "/" ? "text-foreground" : "text-foreground/60"}`}>
                Dashboard
              </Link>
              <Link href="/scanner" className={`transition-colors hover:text-foreground ${location.startsWith("/scanner") ? "text-foreground" : "text-foreground/60"}`}>
                Scanner
              </Link>
              <Link href="/deep-scan" className={`transition-colors hover:text-foreground ${location.startsWith("/deep-scan") ? "text-foreground" : "text-foreground/60"}`}>
                Deep Scan
              </Link>
              <Link href="/options" className={`transition-colors hover:text-foreground ${location === "/options" ? "text-foreground" : "text-foreground/60"}`}>
                F&amp;O Intraday
              </Link>
              <Link href="/strategies" className={`transition-colors hover:text-foreground ${location.startsWith("/strategies") ? "text-foreground" : "text-foreground/60"}`}>
                Strategies
              </Link>
              <Link href="/option-chain" className={`transition-colors hover:text-foreground ${location.startsWith("/option-chain") ? "text-foreground" : "text-foreground/60"}`}>
                Option Chain
              </Link>
              <Link href="/oi-lab" className={`transition-colors hover:text-foreground ${location.startsWith("/oi-lab") ? "text-foreground" : "text-foreground/60"}`}>
                OI Lab
              </Link>
              <Link href="/premarket" className={`transition-colors hover:text-foreground ${location.startsWith("/premarket") ? "text-foreground" : "text-foreground/60"}`}>
                Pre / Post
              </Link>
              <Link href="/watchlist" className={`transition-colors hover:text-foreground ${location.startsWith("/watchlist") ? "text-foreground" : "text-foreground/60"}`}>
                Watchlist
              </Link>
              <Link href="/sectors" className={`transition-colors hover:text-foreground ${location.startsWith("/sectors") ? "text-foreground" : "text-foreground/60"}`}>
                Sectors
              </Link>
              <Link href="/flows" className={`transition-colors hover:text-foreground ${location.startsWith("/flows") ? "text-foreground" : "text-foreground/60"}`}>
                FII / DII
              </Link>
              <Link href="/stocks-to-watch" className={`transition-colors hover:text-foreground ${location.startsWith("/stocks-to-watch") ? "text-foreground" : "text-foreground/60"}`}>
                To Watch
              </Link>
              <Link href="/news" className={`transition-colors hover:text-foreground ${location === "/news" ? "text-foreground" : "text-foreground/60"}`}>
                Market Info
              </Link>
              <Link href="/kite" className={`transition-colors hover:text-foreground ${location.startsWith("/kite") ? "text-foreground" : "text-foreground/60"}`}>
                Live Feed
              </Link>
              <Link href="/learn" className={`transition-colors hover:text-foreground ${location.startsWith("/learn") ? "text-foreground" : "text-foreground/60"}`}>
                Learn
              </Link>
              <Link href="/audit" className={`transition-colors hover:text-foreground ${location.startsWith("/audit") ? "text-foreground" : "text-foreground/60"}`}>
                Audit
              </Link>
              <Link href="/status" className={`transition-colors hover:text-foreground ${location.startsWith("/status") ? "text-foreground" : "text-foreground/60"}`}>
                Status
              </Link>
            </nav>
            </div>
            {/* Right-edge fade hint that more tabs are scrollable */}
            <div className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-card to-transparent" aria-hidden />
          </div>
          <div className="flex items-center justify-end gap-2 shrink-0 w-40 sm:w-56 md:w-64 lg:w-72">
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
