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
      <Route path="/news" component={guarded(News, { tab: "NEWS" })} />
      <Route path="/learn" component={guarded(LearnPage, { tab: "LEARN" })} />

      {/* Owner-only tabs */}
      <Route path="/deep-scan" component={guarded(DeepScan, { ownerOnly: true })} />
      <Route path="/options" component={guarded(Options, { ownerOnly: true })} />
      <Route path="/strategies" component={guarded(Strategies, { ownerOnly: true })} />
      <Route path="/sectors" component={guarded(Sectors, { ownerOnly: true })} />
      <Route path="/sectors/:sector" component={guarded(SectorDetail, { ownerOnly: true })} />
      <Route path="/kite" component={guarded(KitePage, { ownerOnly: true })} />
      <Route path="/audit" component={guarded(AuditPage, { ownerOnly: true })} />
      <Route path="/status" component={guarded(StatusPage, { ownerOnly: true })} />
      <Route path="/manifesto" component={guarded(Manifesto, { ownerOnly: true })} />
      <Route path="/admin" component={guarded(AdminPage, { ownerOnly: true })} />

      {/* Detail pages — any active subscriber may view (drill-down from allowed tabs) */}
      <Route path="/stock/:symbol" component={guarded(StockDetail, { allowSubscriberDetail: true })} />
      <Route path="/index/:slug" component={guarded(IndexDetail, { allowSubscriberDetail: true })} />

      {/* Legacy redirect — no guard needed, just bounces to / */}
      <Route path="/indices" component={IndicesRedirect} />

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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <AuthProvider>
            <LoginGate>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <RoutedShell />
              </WouterRouter>
            </LoginGate>
          </AuthProvider>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
