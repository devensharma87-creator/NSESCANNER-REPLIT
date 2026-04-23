"""
NSE Scanner — API & Layout Inspector
=====================================

A standalone Python utility that hits every backend endpoint of the running
NSE Scanner app, prints the data each one returns, and maps each endpoint
to the UI page / component that consumes it.

Use this file as a single source of truth to:
  • Trace what data is currently flowing through the app
  • Spot endpoints that return null/empty fields
  • See where each piece of data is rendered in the UI
  • Identify gaps (UI sections with no backing endpoint, or endpoints
    not yet wired to any UI)

USAGE
-----
    pip install requests
    python scripts/api_inspector.py                    # full report (console)
    python scripts/api_inspector.py --json report.json # also save JSON
    python scripts/api_inspector.py --base http://localhost:80
    python scripts/api_inspector.py --only market      # filter by tag
"""

from __future__ import annotations
import argparse
import json
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Any

try:
    import requests
except ImportError:
    print("Missing dependency: pip install requests", file=sys.stderr)
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────
# 1. ENDPOINT REGISTRY
#    Every backend route, what it returns, and where the UI uses it.
# ─────────────────────────────────────────────────────────────────────
@dataclass
class Endpoint:
    method: str
    path: str
    tag: str                    # logical grouping (market, stocks, flows, ...)
    description: str
    params: dict = field(default_factory=dict)   # query/path params for the probe
    used_by: list[str] = field(default_factory=list)  # UI files that consume it
    key_fields: list[str] = field(default_factory=list)  # important response fields


ENDPOINTS: list[Endpoint] = [
    # ── Health ───────────────────────────────────────────────────────
    Endpoint(
        "GET", "/api/healthz", "health",
        "Liveness probe — returns ok+timestamp",
        used_by=["(infra only)"],
        key_fields=["status", "timestamp"],
    ),

    # ── Market overview ──────────────────────────────────────────────
    Endpoint(
        "GET", "/api/market/summary", "market",
        "All NSE indices (Nifty50, BankNifty, IT, Auto, Pharma, FMCG, Sensex, FinNifty) "
        "with live OHLC, change%, per-index breadth & market open/closed status",
        used_by=[
            "components/key-indices-cards.tsx (4-card live panel)",
            "components/indian-strip.tsx (top ticker)",
            "components/markets-tabs.tsx",
            "pages/dashboard.tsx",
        ],
        key_fields=["indices[].symbol/name/price/open/high/low/change/changePercent",
                    "indices[].breadth", "marketStatus", "advancers/decliners"],
    ),
    Endpoint(
        "GET", "/api/market/global", "market",
        "Global indices (GIFT NIFTY, Nikkei, Hang Seng, Shanghai, FTSE, DAX, S&P, Dow, Nasdaq)",
        used_by=["components/global-strip.tsx (global ticker)"],
        key_fields=["indices[].symbol/name/region/price/changePercent"],
    ),
    Endpoint(
        "GET", "/api/market/trend", "market",
        "Composite market trend score, advancers/decliners, leaders/laggards, sector commentary",
        used_by=["components/trend-card.tsx (Overall Market Trend card)"],
        key_fields=["score", "label", "narrative", "leaders", "laggards", "indexCommentary"],
    ),
    Endpoint(
        "GET", "/api/market/events", "market",
        "Upcoming earnings, holidays, F&O expiry events",
        used_by=["pages/news.tsx (Market Info → Events tab)"],
        key_fields=["events[].date/title/type"],
    ),

    # ── Scanner / signals ───────────────────────────────────────────
    Endpoint(
        "GET", "/api/scan/top", "scanner",
        "Top buy/sell signal candidates from full universe scan (RSI, MACD, EMA, VWAP)",
        used_by=["pages/scanner.tsx (signal table)", "pages/dashboard.tsx (top gainers/losers)"],
        key_fields=["buys[]", "sells[]", "signal scores"],
    ),
    Endpoint(
        "GET", "/api/options/signals", "scanner",
        "F&O intraday setups with ≥1:1 risk-reward",
        used_by=["pages/options.tsx (F&O Intraday tab)"],
        key_fields=["setups[].symbol/entry/stop/target/rr"],
    ),

    # ── Sectors ─────────────────────────────────────────────────────
    Endpoint(
        "GET", "/api/sectors", "sectors",
        "Sector performance leaderboard",
        used_by=["pages/sectors.tsx"],
        key_fields=["sectors[].name/changePercent/advancers/decliners"],
    ),
    Endpoint(
        "GET", "/api/sectors/:sector", "sectors",
        "Sector detail with constituents",
        params={":sector": "BANKING"},
        used_by=["pages/sector-detail.tsx"],
        key_fields=["constituents[]", "topGainers", "topLosers"],
    ),

    # ── Stocks ──────────────────────────────────────────────────────
    Endpoint(
        "GET", "/api/stocks", "stocks",
        "All scanned stocks with quote + signal score",
        used_by=["pages/dashboard.tsx (gainers/losers)", "pages/scanner.tsx"],
        key_fields=["stocks[].symbol/quote/signal"],
    ),
    Endpoint(
        "GET", "/api/stocks/:symbol", "stocks",
        "Single stock detail (quote, fundamentals, signals)",
        params={":symbol": "RELIANCE"},
        used_by=["pages/stock-detail.tsx (overview tab)"],
        key_fields=["quote", "fundamentals", "signal", "indicators"],
    ),
    Endpoint(
        "GET", "/api/stocks/:symbol/statements", "stocks",
        "Full screener.in-style financial statements (Quarterly P&L, Annual P&L, "
        "Balance Sheet, Cash Flow, Ratios, Shareholding) — values in ₹ crore",
        params={":symbol": "RELIANCE"},
        used_by=["components/stock-statements.tsx (Financials tab, 6 sub-tabs)"],
        key_fields=["quarterly[]", "annualPL[]", "balanceSheet[]", "cashFlow[]",
                    "ratios[]", "shareholding[]"],
    ),
    Endpoint(
        "GET", "/api/stocks/:symbol/history", "stocks",
        "OHLC historical bars for the stock detail chart",
        params={":symbol": "RELIANCE"},
        used_by=["pages/stock-detail.tsx (chart tab)"],
        key_fields=["bars[].date/open/high/low/close/volume"],
    ),

    # ── Indices (clickable detail) ──────────────────────────────────
    Endpoint(
        "GET", "/api/index/:slug", "indices",
        "Per-index detail — constituents, breadth, top movers",
        params={":slug": "NIFTY50"},
        used_by=["pages/index-detail.tsx"],
        key_fields=["index", "constituents[]", "breadth", "topGainers", "topLosers"],
    ),

    # ── Institutional flows ─────────────────────────────────────────
    Endpoint(
        "GET", "/api/inst/fii-dii", "flows",
        "FII & DII cash market history merged with Nifty 50 daily close + change%. "
        "Used for the StockMojo-style table + stacked charts",
        used_by=["pages/flows.tsx (FII/DII page — table + 3 stacked charts)"],
        key_fields=["days[].date/fiiNet/diiNet/niftyClose/niftyChangePct",
                    "monthly[].month/fiiNet/diiNet"],
    ),
    Endpoint(
        "GET", "/api/inst/participant-oi", "flows",
        "Participant-wise Open Interest (FII, DII, Pro, Client) for index & stock futures/options",
        used_by=["pages/flows.tsx (Participant OI section)"],
        key_fields=["rows[].date/category/instrument/longOI/shortOI"],
    ),

    # ── News ────────────────────────────────────────────────────────
    Endpoint(
        "GET", "/api/news", "news",
        "Live RSS-aggregated market news",
        used_by=["components/markets-news-card.tsx", "pages/news.tsx"],
        key_fields=["items[].title/link/pubDate/source"],
    ),

    # ── TradingView webhooks ────────────────────────────────────────
    Endpoint(
        "GET", "/api/webhooks/tradingview", "tradingview",
        "Recent TradingView webhook alerts received",
        used_by=["components/tradingview-alerts.tsx"],
        key_fields=["alerts[].timestamp/symbol/message"],
    ),

    # ── Provider status ─────────────────────────────────────────────
    Endpoint(
        "GET", "/api/provider/status", "infra",
        "Which data providers (Yahoo, NSE, Zerodha) are healthy",
        used_by=["(diagnostic only)"],
        key_fields=["providers"],
    ),
]


# ─────────────────────────────────────────────────────────────────────
# 2. PAGE → ENDPOINT MAP (UI layout overview)
# ─────────────────────────────────────────────────────────────────────
PAGE_LAYOUT = {
    "Dashboard (/)": [
        "GET /api/market/summary  → KeyIndicesCards (4 cards), IndianStrip ticker",
        "GET /api/market/global   → GlobalStrip ticker",
        "GET /api/market/trend    → TrendCard + MarketMoodGauge",
        "GET /api/scan/top        → Top Gainers / Top Losers",
        "GET /api/stocks          → MarketsTabs lists",
        "GET /api/news            → MarketsNewsCard",
    ],
    "Scanner (/scanner)": [
        "GET /api/scan/top        → buy/sell signal table",
        "GET /api/stocks          → universe table",
    ],
    "F&O Intraday (/options)": [
        "GET /api/options/signals → ≥1:1 RR setups table",
    ],
    "Sectors (/sectors)": [
        "GET /api/sectors         → sector leaderboard",
    ],
    "Sector Detail (/sectors/:sector)": [
        "GET /api/sectors/:sector → constituents + movers",
    ],
    "FII/DII (/flows)": [
        "GET /api/inst/fii-dii         → StockMojo table + 3 stacked charts (Nifty/FII/DII)",
        "GET /api/inst/participant-oi  → Participant OI section",
    ],
    "Stock Detail (/stocks/:symbol)": [
        "GET /api/stocks/:symbol            → header quote + signal",
        "GET /api/stocks/:symbol/history    → price chart",
        "GET /api/stocks/:symbol/statements → Financials tab (6 sub-tabs)",
    ],
    "Index Detail (/index/:slug)": [
        "GET /api/index/:slug → constituents, breadth, movers",
    ],
    "Market Info / News (/news)": [
        "GET /api/news           → RSS feed",
        "GET /api/market/events  → events calendar",
    ],
}


# ─────────────────────────────────────────────────────────────────────
# 3. PROBE LOGIC
# ─────────────────────────────────────────────────────────────────────
def resolve_path(ep: Endpoint) -> str:
    p = ep.path
    for k, v in ep.params.items():
        if k.startswith(":"):
            p = p.replace(k, str(v))
    return p


def summarize(payload: Any, depth: int = 0, max_depth: int = 2) -> str:
    """Compact, type-aware summary of a JSON response."""
    if depth > max_depth:
        return "…"
    if isinstance(payload, dict):
        bits = []
        for k, v in list(payload.items())[:10]:
            bits.append(f"{k}: {summarize(v, depth + 1, max_depth)}")
        more = f" …(+{len(payload) - 10} keys)" if len(payload) > 10 else ""
        return "{" + ", ".join(bits) + more + "}"
    if isinstance(payload, list):
        if not payload:
            return "[] (empty)"
        sample = summarize(payload[0], depth + 1, max_depth)
        return f"[{len(payload)} × {sample}]"
    if isinstance(payload, str):
        return f'"{payload[:40]}"' + ("…" if len(payload) > 40 else "")
    if payload is None:
        return "null"
    return repr(payload)


def probe(base_url: str, ep: Endpoint, timeout: int = 15) -> dict:
    url = base_url.rstrip("/") + resolve_path(ep)
    started = time.time()
    out = {
        "method": ep.method,
        "url": url,
        "tag": ep.tag,
        "description": ep.description,
        "used_by": ep.used_by,
        "key_fields": ep.key_fields,
        "ok": False,
        "status": None,
        "elapsed_ms": None,
        "summary": None,
        "error": None,
        "null_or_empty_fields": [],
    }
    try:
        r = requests.request(ep.method, url, timeout=timeout)
        out["status"] = r.status_code
        out["elapsed_ms"] = int((time.time() - started) * 1000)
        if r.headers.get("content-type", "").startswith("application/json"):
            data = r.json()
            out["summary"] = summarize(data)
            # Top-level null/empty detection
            if isinstance(data, dict):
                for k, v in data.items():
                    if v is None or v == [] or v == {} or v == "":
                        out["null_or_empty_fields"].append(k)
        else:
            out["summary"] = f"<non-JSON {len(r.content)}B>"
        out["ok"] = 200 <= r.status_code < 300
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    return out


# ─────────────────────────────────────────────────────────────────────
# 4. REPORT RENDERER
# ─────────────────────────────────────────────────────────────────────
GREEN, RED, YELLOW, DIM, BOLD, RESET = (
    "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[1m", "\033[0m"
)


def render(results: list[dict]) -> None:
    print()
    print(BOLD + "═" * 80 + RESET)
    print(BOLD + " NSE SCANNER — API & LAYOUT INSPECTOR".ljust(80) + RESET)
    print(BOLD + "═" * 80 + RESET)

    # Group by tag
    by_tag: dict[str, list[dict]] = {}
    for r in results:
        by_tag.setdefault(r["tag"], []).append(r)

    for tag, rows in by_tag.items():
        print(f"\n{BOLD}▌ {tag.upper()}{RESET}")
        for r in rows:
            badge = (GREEN + "✓" + RESET) if r["ok"] else (RED + "✗" + RESET)
            status = f"{r['status']}" if r["status"] else "ERR"
            ms = f"{r['elapsed_ms']}ms" if r["elapsed_ms"] is not None else "—"
            print(f"  {badge} {r['method']:5} {r['url']:60} [{status} · {ms}]")
            print(f"       {DIM}{r['description']}{RESET}")
            if r["error"]:
                print(f"       {RED}error: {r['error']}{RESET}")
            else:
                print(f"       data: {r['summary']}")
            if r["null_or_empty_fields"]:
                print(f"       {YELLOW}⚠ empty fields: "
                      f"{', '.join(r['null_or_empty_fields'])}{RESET}")
            print(f"       {DIM}used by: {', '.join(r['used_by']) or '(unused)'}{RESET}")
            if r["key_fields"]:
                print(f"       {DIM}key fields: {' | '.join(r['key_fields'])}{RESET}")

    # Summary
    ok = sum(1 for r in results if r["ok"])
    fail = len(results) - ok
    print()
    print(BOLD + "─" * 80 + RESET)
    print(f" {GREEN}{ok} ok{RESET}  ·  {RED if fail else DIM}{fail} failed{RESET}  "
          f"·  {len(results)} endpoints total")
    print(BOLD + "─" * 80 + RESET)

    # Layout map
    print(f"\n{BOLD}▌ UI LAYOUT MAP — which page renders which endpoint{RESET}\n")
    for page, lines in PAGE_LAYOUT.items():
        print(f"  {BOLD}{page}{RESET}")
        for line in lines:
            print(f"    • {line}")
        print()


# ─────────────────────────────────────────────────────────────────────
# 5. MAIN
# ─────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description="NSE Scanner API & layout inspector")
    ap.add_argument("--base", default="http://localhost:80",
                    help="Base URL of the running API server (default: localhost:80)")
    ap.add_argument("--only", help="Only probe endpoints with this tag (market, stocks, ...)")
    ap.add_argument("--json", help="Also write the structured report to this JSON file")
    ap.add_argument("--timeout", type=int, default=15)
    args = ap.parse_args()

    eps = [e for e in ENDPOINTS if not args.only or e.tag == args.only]
    if not eps:
        print(f"No endpoints match tag '{args.only}'", file=sys.stderr)
        sys.exit(2)

    print(f"Probing {len(eps)} endpoints against {args.base} …")
    results = [probe(args.base, ep, args.timeout) for ep in eps]
    render(results)

    if args.json:
        with open(args.json, "w") as f:
            json.dump({
                "base": args.base,
                "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "results": results,
                "page_layout": PAGE_LAYOUT,
                "registry": [asdict(e) for e in eps],
            }, f, indent=2, default=str)
        print(f"\n→ JSON report saved to {args.json}")


if __name__ == "__main__":
    main()
