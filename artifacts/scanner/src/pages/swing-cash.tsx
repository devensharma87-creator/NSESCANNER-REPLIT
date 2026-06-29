import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { AlertCircle, ShieldAlert, CheckCircle2, RotateCw, XCircle, Eye, Clock, ShieldX, Play } from "lucide-react";

import { 
  useGetSwingExecutionStatus, getGetSwingExecutionStatusQueryKey,
  useListSwingStagedOrders, getListSwingStagedOrdersQueryKey,
  useStageSwingStagedOrder,
  useApproveSwingStagedOrder,
  useRejectSwingStagedOrder,
  useRefreshSwingStagedOrder,
  useWatchSwingStagedOrder,
  useExpireSwingStagedOrder,
  useExpireStaleSwingStagedOrders,
  useSetSwingKillSwitch,
  type SwingStagedOrder,
  type SwingStatusResponse
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const IN_RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export default function SwingCashLiveQueue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("PENDING,APPROVAL_REQUIRED");

  const { data: statusResp, isLoading: statusLoading } = useGetSwingExecutionStatus({
    query: { refetchInterval: 15_000, queryKey: getGetSwingExecutionStatusQueryKey() }
  });

  const listParams = useMemo(
    () => (filter && filter !== "ALL" ? { status: filter } : {}),
    [filter],
  );
  const { data: listResp, isLoading: listLoading, refetch: refetchList } = useListSwingStagedOrders(
    listParams,
    { query: { refetchInterval: 15_000, queryKey: getListSwingStagedOrdersQueryKey(listParams) } }
  );

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetSwingExecutionStatusQueryKey() });
    qc.invalidateQueries({ queryKey: getListSwingStagedOrdersQueryKey() });
  }, [qc]);

  const killSwitchMut = useSetSwingKillSwitch();
  const expireStaleMut = useExpireStaleSwingStagedOrders();

  const handleToggleKillSwitch = async (currentStatus: boolean) => {
    try {
      const reason = currentStatus ? "Disabled via UI toggle" : "Enabled via UI toggle";
      await killSwitchMut.mutateAsync({ data: { enabled: !currentStatus, reason } });
      toast({ title: !currentStatus ? "Kill Switch ACTIVATED" : "Kill Switch DEACTIVATED", variant: !currentStatus ? "destructive" : "default" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Failed to toggle kill switch", description: e.message, variant: "destructive" });
    }
  };

  const handleExpireStale = async () => {
    try {
      const res = await expireStaleMut.mutateAsync();
      toast({ title: "Stale Orders Expired", description: `Expired ${res.expired} orders.` });
      invalidate();
    } catch (e: any) {
      toast({ title: "Failed to expire stale orders", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-6xl space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Swing Cash Queue
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Fast approval cockpit for staged swing-cash equity orders. 
          </p>
        </div>
      </div>

      <SafetyHeader status={statusResp} onToggleKillSwitch={handleToggleKillSwitch} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-card p-3 rounded-lg border shadow-sm">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium whitespace-nowrap">Filter Status:</Label>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING,APPROVAL_REQUIRED">Pending & Action Required</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="WATCH_ONLY">Watch Only</SelectItem>
                  <SelectItem value="REJECTED,EXPIRED,CANCELLED">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetchList()} disabled={listLoading || killSwitchMut.isPending}>
                <RotateCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleExpireStale} disabled={expireStaleMut.isPending}>
                Expire Stale
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {listLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-48 w-full rounded-xl" />
              </div>
            ) : !listResp?.items?.length ? (
              <Card className="bg-card">
                <CardContent className="flex flex-col items-center justify-center p-12 text-center space-y-3">
                  <ShieldAlert className="w-12 h-12 text-muted-foreground/50" />
                  <div className="text-lg font-medium">No staged orders found</div>
                  <p className="text-sm text-muted-foreground">Queue is empty for the current filter.</p>
                </CardContent>
              </Card>
            ) : (
              listResp.items.map(order => (
                <OrderCard key={order.id} order={order} invalidate={invalidate} />
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <StageCandidateForm invalidate={invalidate} killSwitchActive={statusResp?.killSwitch?.enabled} />
        </div>
      </div>
    </div>
  );
}

function SafetyHeader({ status, onToggleKillSwitch }: { status?: SwingStatusResponse, onToggleKillSwitch: (v: boolean) => void }) {
  if (!status) return <Skeleton className="h-24 w-full rounded-xl" />;

  const ksEnabled = status.killSwitch.enabled;
  const mode = status.execution.mode;

  return (
    <div className={`p-4 border-l-4 rounded-r-xl bg-card shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-colors ${ksEnabled ? 'border-destructive bg-destructive/10' : 'border-emerald-500'}`}>
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Badge variant={ksEnabled ? "destructive" : "outline"} className="text-xs font-mono uppercase tracking-wider">
            Mode: {mode}
          </Badge>
          <Badge variant="destructive" className="bg-destructive text-destructive-foreground font-bold tracking-widest px-3 uppercase shadow-sm">
            Broker execution: DISABLED
          </Badge>
        </div>
        <p className="text-sm font-medium pt-1">
          {status.execution.summary}
        </p>
      </div>

      <div className="flex items-center space-x-3 bg-background/50 p-2 rounded-lg border">
        <div className="flex flex-col items-end">
          <Label htmlFor="master-kill" className="font-bold uppercase tracking-wider text-xs">
            Master Kill-Switch
          </Label>
          {ksEnabled && (
            <span className="text-[10px] text-destructive font-mono mt-0.5">
              ACTIVE - Blocks all actions
            </span>
          )}
        </div>
        <Switch 
          id="master-kill" 
          checked={ksEnabled} 
          onCheckedChange={() => onToggleKillSwitch(ksEnabled)}
          className={ksEnabled ? "data-[state=checked]:bg-destructive" : ""}
        />
      </div>
    </div>
  );
}

function OrderCard({ order, invalidate }: { order: SwingStagedOrder, invalidate: () => void }) {
  const { toast } = useToast();
  const approveMut = useApproveSwingStagedOrder();
  const rejectMut = useRejectSwingStagedOrder();
  const refreshMut = useRefreshSwingStagedOrder();
  const watchMut = useWatchSwingStagedOrder();
  const expireMut = useExpireSwingStagedOrder();

  const [rejectReason, setRejectReason] = useState("");

  const isActive = order.status === "STAGED" || order.status === "APPROVAL_REQUIRED";
  const isApproved = order.status === "APPROVED";

  const handleApprove = async () => {
    try {
      const res = await approveMut.mutateAsync({ id: order.id, data: {} });
      if (!res.approved) {
        toast({ title: "Approval Blocked", description: res.reason || "Recheck blocked the approval.", variant: "destructive" });
      } else {
        toast({ title: "Order Approved", description: "Successfully advanced staged order state." });
      }
      invalidate();
    } catch (e: any) {
      toast({ title: "Failed to approve", description: e.message, variant: "destructive" });
    }
  };

  const handleReject = async () => {
    try {
      await rejectMut.mutateAsync({ id: order.id, data: { reason: rejectReason || "Manual rejection" } });
      toast({ title: "Order Rejected" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Failed to reject", description: e.message, variant: "destructive" });
    }
  };

  const handleRefresh = async () => {
    try {
      const res = await refreshMut.mutateAsync({ id: order.id, data: {} });
      if (!res.ok) {
         toast({ title: "Refresh Issue", description: res.reason || "Could not refresh live data.", variant: "destructive" });
      } else {
         toast({ title: "Data Refreshed" });
      }
      invalidate();
    } catch (e: any) {
      toast({ title: "Failed to refresh", description: e.message, variant: "destructive" });
    }
  };

  const handleWatch = async () => {
    try {
      await watchMut.mutateAsync({ id: order.id });
      toast({ title: "Moved to Watch Only" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Failed to watch", description: e.message, variant: "destructive" });
    }
  };

  const handleExpire = async () => {
    try {
      await expireMut.mutateAsync({ id: order.id });
      toast({ title: "Order Expired" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Failed to expire", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Card className="bg-card border-l-4 border-l-accent overflow-hidden transition-all hover:shadow-md">
      <CardHeader className="pb-3 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-lg">{order.symbol}</span>
              {order.exchange && <Badge variant="secondary" className="text-[10px]">{order.exchange}</Badge>}
              <Badge variant={isActive ? "default" : "outline"} className="uppercase font-mono text-[10px] tracking-wider">
                {order.status}
              </Badge>
              {order.brokerStatus === "BROKER_DISABLED" && (
                <Badge variant="destructive" className="uppercase font-mono text-[10px] tracking-wider">
                  BROKER DISABLED
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono flex items-center gap-2">
              <span>Data: {order.dataSource || "n/a"}</span>
              <span>·</span>
              <span>As of {order.dataAsOf ? format(new Date(order.dataAsOf), 'HH:mm:ss') : "n/a"}</span>
              {order.expiresAt && (
                <>
                   <span>·</span>
                   <span className="text-amber-500/80">Expires {formatDistanceToNow(new Date(order.expiresAt))}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right flex flex-col items-end gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
              Approval does NOT place a real order
            </span>
            <span className="text-[10px] text-muted-foreground">ID: {order.id.slice(0, 8)}...</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Action</span>
          <span className="font-medium">{order.side} {order.quantity} qty</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Entry</span>
          <span className="font-medium">{IN_RUPEES.format(order.entryPrice)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Stop</span>
          <span className="font-medium text-rose-400">{IN_RUPEES.format(order.stopLoss)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Target 1</span>
          <span className="font-medium text-emerald-400">{IN_RUPEES.format(order.target1)}</span>
        </div>
        
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Target 2</span>
          <span className="font-medium text-emerald-400/80">{order.target2 != null ? IN_RUPEES.format(order.target2) : "n/a"}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Risk %</span>
          <span className="font-medium">{order.riskPercent != null ? `${order.riskPercent}%` : "n/a"}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Max Risk</span>
          <span className="font-medium">{order.maxRisk != null ? IN_RUPEES.format(order.maxRisk) : "n/a"}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase">Capital Reqd</span>
          <span className="font-medium">{order.capitalRequired != null ? IN_RUPEES.format(order.capitalRequired) : "n/a"}</span>
        </div>

        <div className="col-span-2 md:col-span-4 mt-2">
           <JsonDetails title="Risk Decision" data={order.riskDecision} />
           <JsonDetails title="Recheck Decision" data={order.recheckDecision} />
           <JsonDetails title="Missed Opportunity" data={order.missedOpportunity} />
        </div>
      </CardContent>

      <CardFooter className="bg-muted/10 border-t flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="flex flex-wrap gap-2">
          {isActive && (
            <>
              <Button size="sm" variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm" onClick={handleApprove} disabled={approveMut.isPending}>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Approve (staged only)
              </Button>
              <div className="flex gap-1 items-center bg-card border rounded p-1">
                 <Input 
                   value={rejectReason} 
                   onChange={e => setRejectReason(e.target.value)} 
                   placeholder="Reject reason..." 
                   className="h-8 w-32 text-xs border-none shadow-none focus-visible:ring-0"
                 />
                 <Button size="sm" variant="destructive" onClick={handleReject} disabled={rejectMut.isPending} className="h-8 text-xs">
                   <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                 </Button>
              </div>
            </>
          )}
          {!isApproved && order.status !== "WATCH_ONLY" && order.status !== "REJECTED" && order.status !== "EXPIRED" && order.status !== "CANCELLED" && (
            <Button size="sm" variant="secondary" onClick={handleWatch} disabled={watchMut.isPending}>
               <Eye className="w-4 h-4 mr-2" /> Watch
            </Button>
          )}
          {isActive && (
             <Button size="sm" variant="outline" onClick={handleExpire} disabled={expireMut.isPending}>
                <Clock className="w-4 h-4 mr-2" /> Expire
             </Button>
          )}
        </div>
        
        <div className="flex gap-2">
          {(isActive || isApproved || order.status === "WATCH_ONLY") && (
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshMut.isPending}>
              <RotateCw className="w-4 h-4 mr-2" /> Refresh Data
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

function JsonDetails({ title, data }: { title: string, data?: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <Collapsible className="mb-2">
      <CollapsibleTrigger className="flex items-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider">
        <Play className="w-3 h-3 mr-1" /> {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 text-xs font-mono bg-muted/30 p-2 rounded border overflow-x-auto">
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StageCandidateForm({ invalidate, killSwitchActive }: { invalidate: () => void, killSwitchActive?: boolean }) {
  const { toast } = useToast();
  const stageMut = useStageSwingStagedOrder();
  
  const [symbol, setSymbol] = useState("");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target1, setTarget1] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (killSwitchActive) {
      toast({ title: "Blocked", description: "Cannot stage order while Kill Switch is active.", variant: "destructive" });
      return;
    }

    try {
      const res = await stageMut.mutateAsync({
        data: {
          symbol: symbol.toUpperCase(),
          entry: Number(entry),
          stop: Number(stop),
          target1: Number(target1),
        }
      });
      if (res.reason === "KILL_SWITCH_ACTIVE") {
         toast({ title: "Kill Switch Active", description: "Server rejected staging.", variant: "destructive" });
      } else {
         toast({ title: "Order Staged", description: res.status });
         setSymbol(""); setEntry(""); setStop(""); setTarget1("");
         invalidate();
      }
    } catch(e: any) {
      toast({ title: "Failed to stage", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Card className="sticky top-24 shadow-sm border-accent/20">
      <CardHeader className="bg-muted/10 border-b pb-4">
        <CardTitle className="text-lg">Stage a candidate</CardTitle>
        <CardDescription>Manually push a candidate to the queue. Server fetches live quote and computes sizing.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Symbol *</Label>
            <Input required placeholder="e.g. RELIANCE" value={symbol} onChange={e => setSymbol(e.target.value)} className="uppercase" />
          </div>
          <div className="space-y-2">
            <Label>Entry Price *</Label>
            <Input required type="number" step="0.05" min="0.05" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Stop Loss *</Label>
            <Input required type="number" step="0.05" min="0.05" placeholder="0.00" value={stop} onChange={e => setStop(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Target 1 *</Label>
            <Input required type="number" step="0.05" min="0.05" placeholder="0.00" value={target1} onChange={e => setTarget1(e.target.value)} />
          </div>
          
          <div className="pt-2">
            <Button type="submit" className="w-full" disabled={stageMut.isPending || killSwitchActive}>
              {stageMut.isPending ? "Staging..." : "Stage Order"}
            </Button>
          </div>
          {killSwitchActive && (
            <p className="text-xs text-destructive text-center font-medium mt-2">
              Action disabled while Kill Switch is ON
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
