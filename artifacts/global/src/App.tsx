import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import NotFound from "@/pages/not-found";
import { queryClient } from "@/lib/queryClient";
import { configureApiClient } from "@/lib/api";
import { LoginGate } from "@/components/LoginGate";
import { AppShell } from "@/components/AppShell";
import { DashboardPage } from "@/pages/Dashboard";
import { InstrumentDetailPage } from "@/pages/InstrumentDetail";
import { ScreenerPage } from "@/pages/Screener";
import { WatchlistPage } from "@/pages/Watchlist";

configureApiClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/i/:symbol" component={InstrumentDetailPage} />
      <Route path="/screener" component={ScreenerPage} />
      <Route path="/watchlist" component={WatchlistPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <LoginGate>
              <AppShell>
                <Router />
              </AppShell>
            </LoginGate>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
