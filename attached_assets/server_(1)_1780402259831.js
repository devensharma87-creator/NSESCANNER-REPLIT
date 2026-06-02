/**
 * Charting Backend — Zerodha Kite Connect + Global data layer
 * --------------------------------------------------------------
 * Endpoints:
 *   GET  /api/login            -> Kite login URL (step 1 of session)
 *   GET  /api/callback         -> exchange request_token for access_token
 *   GET  /api/instruments      -> searchable instrument master (cached)
 *   GET  /api/history          -> historical OHLCV candles
 *   WS   /ws                   -> live tick stream (Kite ticker) + heartbeat
 *
 * Requires: npm i express ws kiteconnect axios cors dotenv
 * Env: KITE_API_KEY, KITE_API_SECRET, PORT
 */

const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");
const { KiteConnect, KiteTicker } = require("kiteconnect");
const axios = require("axios");
require("dotenv").config();

const API_KEY = process.env.KITE_API_KEY;
const API_SECRET = process.env.KITE_API_SECRET;
const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(require("path").join(__dirname, "..", "frontend")));

const kc = new KiteConnect({ api_key: API_KEY });

// In-memory session + caches (swap for Redis/DB in production)
const state = {
  accessToken: null,
  instruments: [],          // full master
  instrumentByToken: {},     // token -> instrument
  lastFetched: 0,
};

/* ----------------------------- AUTH FLOW ----------------------------- */
app.get("/api/login", (req, res) => {
  // Step 1: send user to Kite, they approve, Kite redirects to /api/callback?request_token=...
  res.json({ url: kc.getLoginURL() });
});

app.get("/api/callback", async (req, res) => {
  try {
    const { request_token } = req.query;
    const session = await kc.generateSession(request_token, API_SECRET);
    state.accessToken = session.access_token;
    kc.setAccessToken(session.access_token);
    await loadInstruments();
    // Redirect back to the app; in production set an httpOnly cookie / JWT instead.
    res.redirect("/?auth=ok");
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/session", (req, res) => {
  res.json({ authed: !!state.accessToken, instruments: state.instruments.length });
});

/* -------------------------- INSTRUMENT MASTER ------------------------- */
async function loadInstruments() {
  // Kite returns the full tradable universe (indices + equities + F&O).
  const all = await kc.getInstruments();
  state.instruments = all.map((i) => ({
    token: i.instrument_token,
    symbol: i.tradingsymbol,
    name: i.name,
    exchange: i.exchange,
    segment: i.segment,
    type: i.instrument_type, // EQ, FUT, CE, PE, INDICES...
    tick: i.tick_size,
    lot: i.lot_size,
  }));
  state.instrumentByToken = {};
  for (const i of state.instruments) state.instrumentByToken[i.token] = i;
  state.lastFetched = Date.now();
  console.log(`Loaded ${state.instruments.length} instruments`);
}

app.get("/api/instruments", (req, res) => {
  const q = (req.query.q || "").toUpperCase();
  const seg = req.query.segment; // optional filter
  let out = state.instruments;
  if (seg) out = out.filter((i) => i.segment === seg);
  if (q) {
    out = out.filter(
      (i) =>
        (i.symbol && i.symbol.toUpperCase().includes(q)) ||
        (i.name && i.name.toUpperCase().includes(q))
    );
  }
  res.json(out.slice(0, 200)); // cap payload
});

/* ----------------------------- HISTORY -------------------------------- */
// Maps UI timeframe -> Kite interval
const INTERVAL_MAP = {
  "1m": "minute", "3m": "3minute", "5m": "5minute", "10m": "10minute",
  "15m": "15minute", "30m": "30minute", "60m": "60minute",
  "1D": "day", "1W": "week",
};

app.get("/api/history", async (req, res) => {
  try {
    const { token, tf = "5m", from, to } = req.query;
    const interval = INTERVAL_MAP[tf] || "5minute";
    const data = await kc.getHistoricalData(
      Number(token),
      interval,
      from || isoDaysAgo(60),
      to || new Date().toISOString().slice(0, 19),
      false // continuous
    );
    // Normalize -> lightweight-charts format (time in seconds)
    const candles = data.map((d) => ({
      time: Math.floor(new Date(d.date).getTime() / 1000),
      open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
    }));
    res.json(candles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --------------------------- GLOBAL INDICES --------------------------- */
// Zerodha doesn't carry US/EU indices. We proxy a free global feed.
// (Replace with your licensed vendor — Polygon, TwelveData, etc.)
const GLOBAL = {
  "^GSPC": "S&P 500", "^DJI": "Dow Jones", "^IXIC": "Nasdaq",
  "^FTSE": "FTSE 100", "^N225": "Nikkei 225", "^HSI": "Hang Seng",
  "^GDAXI": "DAX", "^FCHI": "CAC 40",
};
app.get("/api/global", async (req, res) => {
  try {
    const sym = req.query.symbol;
    const r = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`,
      { params: { range: req.query.range || "60d", interval: req.query.interval || "1d" } }
    );
    const result = r.data.chart.result[0];
    const t = result.timestamp || [];
    const q = result.indicators.quote[0];
    const candles = t.map((ts, i) => ({
      time: ts, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i],
    })).filter((c) => c.close != null);
    res.json(candles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/global/list", (req, res) =>
  res.json(Object.entries(GLOBAL).map(([token, name]) => ({ token, name, exchange: "GLOBAL", type: "INDEX" })))
);

/* ----------------------------- LIVE WS -------------------------------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
let ticker = null;
const subscribed = new Set();

function ensureTicker() {
  if (ticker || !state.accessToken) return;
  ticker = new KiteTicker({ api_key: API_KEY, access_token: state.accessToken });
  ticker.connect();
  ticker.on("connect", () => console.log("Kite ticker connected"));
  ticker.on("ticks", (ticks) => {
    const payload = JSON.stringify({ type: "ticks", ticks });
    wss.clients.forEach((c) => c.readyState === 1 && c.send(payload));
  });
  ticker.on("error", (e) => console.error("ticker err", e));
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", authed: !!state.accessToken }));
  ws.on("message", (msg) => {
    try {
      const { action, tokens } = JSON.parse(msg);
      ensureTicker();
      if (!ticker) return;
      if (action === "subscribe") {
        tokens.forEach((t) => subscribed.add(t));
        ticker.subscribe(tokens);
        ticker.setMode(ticker.modeFull, tokens);
      } else if (action === "unsubscribe") {
        tokens.forEach((t) => subscribed.delete(t));
        ticker.unsubscribe(tokens);
      }
    } catch (_) {}
  });
});

function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19);
}

server.listen(PORT, () => console.log(`Charting backend on http://localhost:${PORT}`));
