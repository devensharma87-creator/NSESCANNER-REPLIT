import { Link, useLocation } from "wouter";
import { Search, Activity } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import GlobalStrip from "@/components/global-strip";
import { useListStocks, getListStocksQueryKey } from "@workspace/api-client-react";
import { SignalBadge } from "@/components/ui/signal-badge";

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

  // Add dark class on mount for dark-only theme
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-primary">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="w-full px-4 flex h-14 items-center">
          <div className="mr-4 flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <Activity className="h-5 w-5 text-signal-strong-buy" />
              <span className="font-bold tracking-tight uppercase tracking-wider font-mono">NSE Scanner</span>
            </Link>
            <nav className="flex items-center space-x-5 text-[15px] font-semibold">
              <Link href="/" className={`transition-colors hover:text-foreground ${location === "/" ? "text-foreground" : "text-foreground/60"}`}>
                Dashboard
              </Link>
              <Link href="/scanner" className={`transition-colors hover:text-foreground ${location.startsWith("/scanner") ? "text-foreground" : "text-foreground/60"}`}>
                Scanner
              </Link>
              <Link href="/options" className={`transition-colors hover:text-foreground ${location.startsWith("/options") ? "text-foreground" : "text-foreground/60"}`}>
                Options
              </Link>
              <Link href="/sectors" className={`transition-colors hover:text-foreground ${location.startsWith("/sectors") ? "text-foreground" : "text-foreground/60"}`}>
                Sectors
              </Link>
              <Link href="/news" className={`transition-colors hover:text-foreground ${location === "/news" ? "text-foreground" : "text-foreground/60"}`}>
                News
              </Link>
            </nav>
          </div>
          <div className="flex flex-1 items-center justify-end space-x-2">
            <div ref={containerRef} className="relative w-full max-w-md">
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
                          className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 hover:bg-white/5 border-b border-border/50 last:border-0"
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
      <GlobalStrip />

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
