/* indicators.js — pure functions over candle arrays
 * candle = { time, open, high, low, close, volume }
 * All return arrays aligned to input length (null where undefined).
 */
const Ind = (() => {

  /* ---------- EMA ---------- */
  function ema(candles, period, key = "close") {
    const k = 2 / (period + 1);
    const out = new Array(candles.length).fill(null);
    let prev;
    for (let i = 0; i < candles.length; i++) {
      const v = candles[i][key];
      if (i === 0) { prev = v; out[i] = v; continue; }
      prev = v * k + prev * (1 - k);
      out[i] = i >= period - 1 ? prev : null;
    }
    return out.map((v, i) => (v == null ? null : { time: candles[i].time, value: +v.toFixed(4) }));
  }

  /* ---------- RSI (Wilder) ---------- */
  function rsi(candles, period = 14) {
    const out = new Array(candles.length).fill(null);
    let gain = 0, loss = 0;
    for (let i = 1; i < candles.length; i++) {
      const ch = candles[i].close - candles[i - 1].close;
      const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= period) { gain += g; loss += l; if (i === period) { gain /= period; loss /= period; out[i] = rs(gain, loss, candles[i].time); } }
      else { gain = (gain * (period - 1) + g) / period; loss = (loss * (period - 1) + l) / period; out[i] = rs(gain, loss, candles[i].time); }
    }
    return out;
    function rs(g, l, t) { const r = l === 0 ? 100 : 100 - 100 / (1 + g / l); return { time: t, value: +r.toFixed(2) }; }
  }

  /* ---------- VWAP (session-anchored, resets each day) ---------- */
  function vwap(candles) {
    const out = []; let cumPV = 0, cumV = 0, day = null;
    for (const c of candles) {
      const d = new Date(c.time * 1000).toDateString();
      if (d !== day) { day = d; cumPV = 0; cumV = 0; }
      const tp = (c.high + c.low + c.close) / 3;
      cumPV += tp * c.volume; cumV += c.volume;
      out.push({ time: c.time, value: cumV ? +(cumPV / cumV).toFixed(4) : c.close });
    }
    return out;
  }

  /* ---------- Fixed-range Volume Profile ---------- */
  function volumeProfile(candles, bins = 40) {
    if (!candles.length) return { rows: [], poc: null, vah: null, val: null };
    const hi = Math.max(...candles.map((c) => c.high));
    const lo = Math.min(...candles.map((c) => c.low));
    const step = (hi - lo) / bins || 1;
    const rows = Array.from({ length: bins }, (_, i) => ({ price: lo + step * (i + 0.5), vol: 0 }));
    for (const c of candles) {
      const mid = (c.high + c.low) / 2;
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((mid - lo) / step)));
      rows[idx].vol += c.volume;
    }
    const total = rows.reduce((s, r) => s + r.vol, 0);
    const pocIdx = rows.reduce((m, r, i, a) => (r.vol > a[m].vol ? i : m), 0);
    // Value Area = 70% volume around POC
    let loI = pocIdx, hiI = pocIdx, acc = rows[pocIdx].vol;
    while (acc < total * 0.7 && (loI > 0 || hiI < bins - 1)) {
      const down = loI > 0 ? rows[loI - 1].vol : -1;
      const up = hiI < bins - 1 ? rows[hiI + 1].vol : -1;
      if (up >= down) { hiI++; acc += rows[hiI].vol; } else { loI--; acc += rows[loI].vol; }
    }
    return { rows, poc: rows[pocIdx].price, vah: rows[hiI].price, val: rows[loI].price, maxVol: rows[pocIdx].vol };
  }

  /* ---------- Swing pivots -> Support / Resistance ---------- */
  function pivots(candles, left = 3, right = 3) {
    const highs = [], lows = [];
    for (let i = left; i < candles.length - right; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - left; j <= i + right; j++) {
        if (candles[j].high > candles[i].high) isHigh = false;
        if (candles[j].low < candles[i].low) isLow = false;
      }
      if (isHigh) highs.push({ time: candles[i].time, price: candles[i].high, i });
      if (isLow) lows.push({ time: candles[i].time, price: candles[i].low, i });
    }
    return { highs, lows };
  }
  function supportResistance(candles) {
    const { highs, lows } = pivots(candles);
    const cluster = (pts) => {
      const tol = avgRange(candles) * 0.5;
      const zones = [];
      pts.forEach((p) => {
        const z = zones.find((z) => Math.abs(z.price - p.price) < tol);
        if (z) { z.price = (z.price * z.n + p.price) / (z.n + 1); z.n++; }
        else zones.push({ price: p.price, n: 1 });
      });
      return zones.filter((z) => z.n >= 2).sort((a, b) => b.n - a.n).slice(0, 4);
    };
    return { resistance: cluster(highs), support: cluster(lows) };
  }

  /* ---------- Fair Value Gaps (3-candle imbalance) ---------- */
  function fvg(candles) {
    const gaps = [];
    for (let i = 2; i < candles.length; i++) {
      const a = candles[i - 2], c = candles[i];
      if (a.high < c.low) gaps.push({ type: "bull", top: c.low, bottom: a.high, time: candles[i - 1].time, i });
      if (a.low > c.high) gaps.push({ type: "bear", top: a.low, bottom: c.high, time: candles[i - 1].time, i });
    }
    // keep last 12 unfilled-ish
    return gaps.slice(-12);
  }

  /* ---------- Smart Money Concepts: BOS / CHoCH / Order Blocks ---------- */
  function smc(candles) {
    const { highs, lows } = pivots(candles, 2, 2);
    const events = [];
    let trend = null;
    // Break of Structure / Change of Character
    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price > highs[i - 1].price) {
        events.push({ kind: trend === "down" ? "CHoCH" : "BOS", dir: "up", time: highs[i].time, price: highs[i].price });
        trend = "up";
      }
    }
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price < lows[i - 1].price) {
        events.push({ kind: trend === "up" ? "CHoCH" : "BOS", dir: "down", time: lows[i].time, price: lows[i].price });
        trend = "down";
      }
    }
    // Order blocks: last opposite candle before a strong move
    const ob = [];
    for (let i = 3; i < candles.length - 1; i++) {
      const body = Math.abs(candles[i].close - candles[i].open);
      const next = Math.abs(candles[i + 1].close - candles[i + 1].open);
      if (next > body * 1.8) {
        const bull = candles[i + 1].close > candles[i + 1].open;
        if (bull && candles[i].close < candles[i].open)
          ob.push({ type: "bull", top: candles[i].high, bottom: candles[i].low, time: candles[i].time });
        if (!bull && candles[i].close > candles[i].open)
          ob.push({ type: "bear", top: candles[i].high, bottom: candles[i].low, time: candles[i].time });
      }
    }
    return { events: events.sort((a, b) => a.time - b.time).slice(-8), orderBlocks: ob.slice(-6), trend };
  }

  /* ---------- Signal generator (confluence-based) ----------
   * Scores up to 4 points of confluence:
   *   +1 EMA stack (11>20>50 for long / inverse for short)
   *   +1 price on correct side of VWAP
   *   +1 RSI in trend-but-not-exhausted zone
   *   +1 recent 11/20 cross within `crossWindow` bars (momentum trigger)
   * Emits when score >= minScore, with a cooldown to prevent clustering.
   */
  function signals(candles, { minScore = 3, crossWindow = 4, cooldown = 6 } = {}) {
    if (candles.length < 60) return [];
    const e11 = ema(candles, 11), e20 = ema(candles, 20), e50 = ema(candles, 50);
    const r = rsi(candles, 14), vw = vwap(candles);
    const out = [];
    let lastIdx = -Infinity;

    const recentCross = (i, up) => {
      for (let j = Math.max(1, i - crossWindow); j <= i; j++) {
        const a = e11[j]?.value, b = e20[j]?.value, pa = e11[j - 1]?.value, pb = e20[j - 1]?.value;
        if (a == null || pa == null) continue;
        if (up && pa <= pb && a > b) return true;
        if (!up && pa >= pb && a < b) return true;
      }
      return false;
    };

    for (let i = 51; i < candles.length; i++) {
      const c = candles[i];
      const a = e11[i]?.value, b = e20[i]?.value, d = e50[i]?.value;
      const rv = r[i]?.value, vwv = vw[i]?.value;
      if (a == null || b == null || d == null || rv == null || vwv == null) continue;

      const stackUp = a > b && b > d, stackDn = a < b && b < d;
      const dir = stackUp ? "buy" : stackDn ? "sell" : null;
      if (!dir) continue;

      let score = 1; // stack
      if (dir === "buy" ? c.close > vwv : c.close < vwv) score++;
      if (dir === "buy" ? rv > 50 && rv < 72 : rv < 50 && rv > 28) score++;
      if (recentCross(i, dir === "buy")) score++;

      if (score >= minScore && i - lastIdx >= cooldown) {
        out.push({ time: c.time, price: dir === "buy" ? c.low : c.high, dir, strength: Math.min(4, score) });
        lastIdx = i;
      }
    }
    return out;
  }

  /* ---------- helpers ---------- */
  function avgRange(candles) {
    const n = Math.min(50, candles.length);
    let s = 0; for (let i = candles.length - n; i < candles.length; i++) s += candles[i].high - candles[i].low;
    return s / n;
  }

  return { ema, rsi, vwap, volumeProfile, supportResistance, fvg, smc, signals };
})();
