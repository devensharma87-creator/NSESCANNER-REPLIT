import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Sectors from "@/pages/sectors";
import SectorDetail from "@/pages/sector-detail";
import StockDetail from "@/pages/stock-detail";
import News from "@/pages/news";
import Options from "@/pages/options";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/options" component={Options} />
      <Route path="/sectors" component={Sectors} />
      <Route path="/sectors/:sector" component={SectorDetail} />
      <Route path="/stock/:symbol" component={StockDetail} />
      <Route path="/news" component={News} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
