import { Link, useLocation } from "wouter";
import { Search, Activity, BookOpen, Layers } from "lucide-react";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/?search=${encodeURIComponent(search.trim())}`);
    }
  };

  // Add dark class on mount for dark-only theme
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-primary">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container flex h-14 max-w-screen-2xl items-center">
          <div className="mr-4 flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <Activity className="h-5 w-5 text-signal-strong-buy" />
              <span className="font-bold tracking-tight uppercase tracking-wider font-mono">NSE Scanner</span>
            </Link>
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link href="/" className={`transition-colors hover:text-foreground/80 ${location === "/" ? "text-foreground" : "text-foreground/60"}`}>
                Dashboard
              </Link>
              <Link href="/sectors" className={`transition-colors hover:text-foreground/80 ${location.startsWith("/sectors") ? "text-foreground" : "text-foreground/60"}`}>
                Sectors
              </Link>
              <Link href="/news" className={`transition-colors hover:text-foreground/80 ${location === "/news" ? "text-foreground" : "text-foreground/60"}`}>
                News
              </Link>
            </nav>
          </div>
          <div className="flex flex-1 items-center justify-end space-x-2">
            <form onSubmit={handleSearch} className="w-full max-w-sm">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search symbol or name..."
                  className="pl-8 bg-background border-border"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border bg-card py-6 md:py-0">
        <div className="container flex flex-col items-center justify-between gap-4 md:h-16 md:flex-row max-w-screen-2xl">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built for active traders. Data delayed.
          </p>
          <p className="text-center text-xs text-muted-foreground md:text-left">
            Data sources & disclaimer: Live quotes via Yahoo Finance. Indicators computed server-side. Signals are educational, not financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
