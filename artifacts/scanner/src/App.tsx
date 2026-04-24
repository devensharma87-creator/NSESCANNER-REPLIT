import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { LoginGate } from "@/components/login-gate";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Scanner from "@/pages/scanner";
import DeepScan from "@/pages/deep-scan";
import Strategies from "@/pages/strategies";
import Sectors from "@/pages/sectors";
import SectorDetail from "@/pages/sector-detail";
import StockDetail from "@/pages/stock-detail";
import IndexDetail from "@/pages/index-detail";
import News from "@/pages/news";
import Options from "@/pages/options";
import OptionChain from "@/pages/option-chain";
import Flows from "@/pages/flows";
import PreMarket from "@/pages/premarket";
import Watchlist from "@/pages/watchlist";
import KitePage from "@/pages/kite";
import AuditPage from "@/pages/audit";
import StatusPage from "@/pages/status";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/scanner" component={Scanner} />
      <Route path="/deep-scan" component={DeepScan} />
      <Route path="/options" component={Options} />
      <Route path="/option-chain" component={OptionChain} />
      <Route path="/option-chain/:underlying" component={OptionChain} />
      <Route path="/strategies" component={Strategies} />
      <Route path="/premarket" component={PreMarket} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/sectors" component={Sectors} />
      <Route path="/sectors/:sector" component={SectorDetail} />
      <Route path="/stock/:symbol" component={StockDetail} />
      <Route path="/index/:slug" component={IndexDetail} />
      <Route path="/news" component={News} />
      <Route path="/flows" component={Flows} />
      <Route path="/kite" component={KitePage} />
      <Route path="/status" component={StatusPage} />
      <Route path="/audit" component={AuditPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LoginGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Layout>
              <Router />
            </Layout>
          </WouterRouter>
        </LoginGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
