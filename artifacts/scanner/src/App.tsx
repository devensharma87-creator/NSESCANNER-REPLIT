import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AuthProvider } from "@/hooks/use-auth";
import { LoginGate } from "@/components/login-gate";
import { AccessGuard } from "@/components/access-guard";
import { ErrorBoundary } from "@/components/error-boundary";
import Layout from "@/components/layout";
import { OptionSignalAlerter } from "@/components/option-signal-alerter";
import { EqEventToaster } from "@/components/eq-event-toaster";
import Home from "@/pages/dashboard";
import Scanner from "@/pages/scanner";
import IndicesRedirect from "@/pages/indices";
import DeepScan from "@/pages/deep-scan";
import Strategies from "@/pages/strategies";
import Sectors from "@/pages/sectors";
import SectorDetail from "@/pages/sector-detail";
import StockDetail from "@/pages/stock-detail";
import IndexDetail from "@/pages/index-detail";
import News from "@/pages/news";
import StocksToWatch from "@/pages/stocks-to-watch";
import Charting from "@/pages/charting";
import PortfolioAnalyser from "@/pages/portfolio-analyser";
import BacktestLab from "@/pages/backtest-lab";
import Options from "@/pages/options";
import OptionChain from "@/pages/option-chain";
import OiLab from "@/pages/oi-lab";
import Flows from "@/pages/flows";
import PreMarket from "@/pages/premarket";
import Watchlist from "@/pages/watchlist";
import KitePage from "@/pages/kite";
import LearnPage from "@/pages/learn";
import AuditPage from "@/pages/audit";
import StatusPage from "@/pages/status";
import Manifesto from "@/pages/manifesto";
import AdminPage from "@/pages/admin";
import InfraHealthPage from "@/pages/infra-health";
import SecretsVaultPage from "@/pages/secrets-vault";
import FnODiagnosticsPage from "@/pages/fno-diagnostics";
import DailyAnalysisPage from "@/pages/daily-analysis";
import SwingCash from "@/pages/swing-cash";
import PaperTrading from "@/pages/paper-trading";
import PaperReports from "@/pages/paper-reports";
// HomeDebugPage is DEV-only. Vite replaces import.meta.env.DEV with false in
// production builds and Rollup tree-shakes both the lazy() branch and the
// underlying dynamic import(), removing the page from the production bundle.
// Do NOT convert this to a static import — that would include it in production.
const HomeDebugPage = (import.meta.env.DEV as boolean)
  ? React.lazy(() => import("@/pages/home-debug"))
  : null;
import DisclaimerPage from "@/pages/legal/disclaimer";
import MethodologyPage from "@/pages/legal/methodology";
import TermsPage from "@/pages/legal/terms";
import PrivacyPage from "@/pages/legal/privacy";

const queryClient = new QueryClient();

/**
 * Wrap a page in <AccessGuard> at route declaration time. The guard handles
 * the role + tab-grant check and renders a friendly "not in your plan"
 * screen for forbidden URLs (backend also 403s for real protection).
 *
 * Typed loosely (any) to satisfy wouter's per-route param generics — the
 * underlying Component receives the same params object it would have anyway.
 */
function guarded<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  opts: { tab?: import("@/lib/auth-api").AllowedTabKey; ownerOnly?: boolean; allowSubscriberDetail?: boolean },
): React.ComponentType<any> {
  return function GuardedRoute(props: P) {
    return (
      <AccessGuard tab={opts.tab} ownerOnly={opts.ownerOnly} allowSubscriberDetail={opts.allowSubscriberDetail}>
        <Component {...props} />
      </AccessGuard>
    );
  };
}

function Router() {
  return (
    <Switch>
      {/* 10 subscriber-allowed tabs (gated by allowedTabs grant) */}
      <Route path="/" component={guarded(Home, { tab: "HOME" })} />
      <Route path="/scanner" component={guarded(Scanner, { tab: "SCANNER" })} />
      <Route path="/option-chain" component={guarded(OptionChain, { tab: "OPTION_CHAIN" })} />
      <Route path="/option-chain/:underlying" component={guarded(OptionChain, { tab: "OPTION_CHAIN" })} />
      <Route path="/oi-lab" component={guarded(OiLab, { tab: "OI_LAB" })} />
      <Route path="/watchlist" component={guarded(Watchlist, { tab: "WATCHLIST" })} />
      <Route path="/premarket" component={guarded(PreMarket, { tab: "PREMARKET" })} />
      <Route path="/flows" component={guarded(Flows, { tab: "FLOWS" })} />
      <Route path="/stocks-to-watch" component={guarded(StocksToWatch, { tab: "STOCKS_TO_WATCH" })} />
      <Route path="/charting" component={guarded(Charting, { tab: "CHARTING" })} />
      <Route path="/portfolio-analyser" component={guarded(PortfolioAnalyser, { tab: "PORTFOLIO_ANALYSER" })} />
      <Route path="/backtest-lab" component={guarded(BacktestLab, { tab: "BACKTEST_LAB" })} />
      <Route path="/news" component={guarded(News, { tab: "NEWS" })} />
      <Route path="/learn" component={guarded(LearnPage, { tab: "LEARN" })} />

      {/* Subscriber-grantable tabs (owner can grant via /admin) */}
      <Route path="/deep-scan" component={guarded(DeepScan, { tab: "DEEP_SCAN" })} />
      <Route path="/options" component={guarded(Options, { tab: "FNO" })} />
      <Route path="/strategies" component={guarded(Strategies, { tab: "STRATEGIES" })} />
      <Route path="/sectors" component={guarded(Sectors, { tab: "SECTORS" })} />
      <Route path="/sectors/:sector" component={guarded(SectorDetail, { tab: "SECTORS" })} />
      <Route path="/kite" component={guarded(KitePage, { ownerOnly: true })} />
      <Route path="/audit" component={guarded(AuditPage, { ownerOnly: true })} />
      <Route path="/status" component={guarded(StatusPage, { ownerOnly: true })} />
      <Route path="/manifesto" component={guarded(Manifesto, { ownerOnly: true })} />
      <Route path="/admin" component={guarded(AdminPage, { ownerOnly: true })} />
      <Route path="/infra-health" component={guarded(InfraHealthPage, { ownerOnly: true })} />
      <Route path="/secrets-vault" component={guarded(SecretsVaultPage, { ownerOnly: true })} />
      <Route path="/fno-diagnostics" component={guarded(FnODiagnosticsPage, { ownerOnly: true })} />
      <Route path="/daily-analysis" component={guarded(DailyAnalysisPage, { ownerOnly: true })} />
      <Route path="/swing-cash" component={guarded(SwingCash, { ownerOnly: true })} />
      <Route path="/paper-trading" component={guarded(PaperTrading, { ownerOnly: true })} />
      <Route path="/paper-reports" component={guarded(PaperReports, { ownerOnly: true })} />

      {/* Detail pages — any active subscriber may view (drill-down from allowed tabs) */}
      <Route path="/stock/:symbol" component={guarded(StockDetail, { allowSubscriberDetail: true })} />
      <Route path="/index/:slug" component={guarded(IndexDetail, { allowSubscriberDetail: true })} />

      {/* Legacy redirect — no guard needed, just bounces to / */}
      <Route path="/indices" component={IndicesRedirect} />

      {/* Dev-only fixture page — owner-only, for evidence screenshots.
          guarded(HomeDebugPage) is only reachable when import.meta.env.DEV=true.
          In production builds Rollup removes this branch and the dynamic import entirely. */}
      {(import.meta.env.DEV as boolean) && HomeDebugPage && (
        <Route path="/debug/home-states" component={guarded(HomeDebugPage, { ownerOnly: true })} />
      )}

      {/* Legal pages — public, no AccessGuard. LoginGate also short-circuits
          for these paths so an unauthenticated visitor can read them from
          a shared link or the login-screen footer. */}
      <Route path="/legal/disclaimer" component={DisclaimerPage} />
      <Route path="/legal/methodology" component={MethodologyPage} />
      <Route path="/legal/terms" component={TermsPage} />
      <Route path="/legal/privacy" component={PrivacyPage} />

      <Route component={NotFound} />
    </Switch>
  );
}

function RoutedShell() {
  const [location] = useLocation();
  return (
    <Layout>
      <ErrorBoundary resetKey={location}>
        <Router />
      </ErrorBoundary>
    </Layout>
  );
}

/**
 * Detects Kite OAuth callback params (request_token + action=login + status=success)
 * on ANY page load and immediately forwards to the backend /api/kite/callback handler.
 * This allows the Zerodha Connect redirect URL to be set to the root domain
 * (e.g. https://marketscannerbydev.in/) rather than the full /api/kite/callback path.
 */
function KiteCallbackForwarder() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestToken = params.get("request_token");
    const action = params.get("action");
    const status = params.get("status");
    if (requestToken && action === "login") {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.location.replace(`${base}/api/kite/callback${window.location.search}`);
    }
    // If Kite returns a non-success status, still forward so the backend can
    // redirect to /kite?login=failed&reason=... with the right error message.
    if (!requestToken && action === "login" && status && status !== "success") {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.location.replace(`${base}/api/kite/callback${window.location.search}`);
    }
  }, []);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <KiteCallbackForwarder />
      <TooltipProvider>
        <ErrorBoundary>
          <AuthProvider>
            <LoginGate>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <RoutedShell />
              </WouterRouter>
              <OptionSignalAlerter />
              <EqEventToaster />
            </LoginGate>
          </AuthProvider>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
