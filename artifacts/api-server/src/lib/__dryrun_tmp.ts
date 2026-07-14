import { buildPreMarketReport, buildPostMarketReport } from "./dailyReports";
import { buildCanonicalFnoReadiness, type CanonicalFnoReadinessInputs } from "./canonicalFnoReadiness";
const now = new Date("2026-07-10T04:30:00.000Z");
const inputs: CanonicalFnoReadinessInputs = {
  now, kite:{sessionValid:true,sessionPresent:true,feedConnected:true,feedRunning:true,marketSession:"open"},
  cycle:{ts:now.getTime(),indicesWithBars:3,suppressed:[],suppressedSummary:"",signalCount:5,highConvictionCount:2,baselineCount:3},
  optionSnapshot:{enabled:true,lastRun:{underlyingsAttempted:3,underlyingsOk:3,errors:[]}},
  totalIndices:3,paperAutoTradingEnabled:true,
};
const cFno = buildCanonicalFnoReadiness(inputs);
const pre = buildPreMarketReport({
  isManualTest:false,istDatetime:"10 Jul 2026 10:00",isWeekend:false,
  kite:{sessionPresent:true,user:"AB1234",expiresAt:"2026-07-10T15:30:00Z",minsToExpiry:330,feedConnected:true,feedSubscribed:3},
  canonicalFno:cFno,
  swing:{pending:2,approvalRequired:1,approved:3,expired:0,openedToday:2,closedToday:1,blockedToday:0,notificationFailures:0},
  fiiDii:{date:"2026-07-09",fiiNetCr:1234.5,diiNetCr:-890.2},
});
const post = buildPostMarketReport({
  isManualTest:false,istDate:"2026-07-10",datetimeStr:"10 Jul 2026 15:45",isWeekend:false,
  canonicalFno:cFno,
  fno:{tradesOpened:3,tradesClosed:2,openCount:1,totalPnl:4250},
  swing:{pending:1,approved:2,expired:0,openedToday:2,closedToday:1,blockedToday:0,equityOpenCount:3},
  equityPaper:{openedToday:4,closedToday:2,openCount:5},
  indexPerformance:{rows:[{name:"NIFTY 50",close:24500,changePct:0.85,high:24600,low:24350}],asOfIst:"15:30"},
  optionChainEod:null,exitMonitorVerified:true,
});
const d=cFno.indexDiagnostics;
console.log("===PRE===\n"+pre);
console.log("\n===POST===\n"+post);
console.log("\n===DIAG_READY===");
for(const k of["NIFTY","BANKNIFTY","SENSEX"]){const x=d[k];if(!x){console.log(k+": MISSING");continue;}console.log(`${k}|${x.dailyBarsCount}|${x.dailyBarsOk}|${x.intradayBarsCount}|${x.intradayBarsOk}|${x.optionChainFetchOk}|${x.quoteStatus}|${x.source}|${x.asOf?.slice(0,19)??"null"}|${x.freshness}|${x.exactBlockReason??"null"}|${x.blocked}`);}
// SENSEX intraday fail — isolation proof
const bi: CanonicalFnoReadinessInputs={...inputs,cycle:{...inputs.cycle!,indicesWithBars:2,suppressed:[{index:"SENSEX",reasons:["no_live_kite_intraday (intraday bars missing)"]}],suppressedSummary:"SENSEX suppressed",signalCount:3,highConvictionCount:1,baselineCount:2}};
const bf=buildCanonicalFnoReadiness(bi);
const bd=bf.indexDiagnostics;
console.log("\n===DIAG_SENSEX_FAIL_ISOLATION===");
for(const k of["NIFTY","BANKNIFTY","SENSEX"]){const x=bd[k];if(!x){console.log(k+": MISSING");continue;}console.log(`${k}|${x.dailyBarsCount}|${x.intradayBarsCount}|${x.optionChainFetchOk}|${x.quoteStatus}|${x.source}|${x.freshness}|${x.exactBlockReason??"null"}|${x.blocked}`);}
