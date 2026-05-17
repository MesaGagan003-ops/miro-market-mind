// Demo trading panel — paper trades only, persisted to localStorage.
// Mirrors the "Place Trade" + Positions/Log/Stats panel from the v2 mockup.

import { useEffect, useMemo, useState } from "react";
import type { MarketAsset } from "@/lib/markets";
import type { HybridResult } from "@/lib/physics/hybrid";

type Direction = "long" | "short";

interface Position {
  id: number;
  pair: string;
  dir: Direction;
  entry: number;
  size: number;
  lev: number;
  stop: number;
  tp: number;
  qty: number;
  time: string;
}

interface ClosedTrade {
  time: string;
  pair: string;
  dir: Direction;
  entry: number;
  exit: number;
  pnl: number;
  correct: boolean;
}

interface Account {
  balance: number;
  realPnl: number;
  totalTrades: number;
  positions: Position[];
  trades: ClosedTrade[];
}

const STORAGE_KEY = "qe_demo_account_v1";
const INITIAL: Account = {
  balance: 10000,
  realPnl: 0,
  totalTrades: 0,
  positions: [],
  trades: [],
};

function loadAccount(): Account {
  if (typeof window === "undefined") return INITIAL;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL;
    return { ...INITIAL, ...JSON.parse(raw) };
  } catch {
    return INITIAL;
  }
}

function saveAccount(a: Account) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
}

function fmtPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(3);
  if (v >= 0.01) return v.toFixed(5);
  return v.toExponential(3);
}

interface Props {
  coin: MarketAsset;
  currentPrice: number;
  prediction: HybridResult | null;
  /** Recent prices (most recent last) used to size stop/TP via ATR. */
  recentPrices?: number[];
}

// Per-market default ATR multipliers for SL/TP. Crypto futures move much
// further than NSE equities or major FX in the same wall-clock window, so a
// "2σ stop" means very different things across markets.
const MARKET_RISK: Record<string, { slMult: number; tpMult: number; minBps: number }> = {
  crypto: { slMult: 1.8, tpMult: 3.0, minBps: 25 }, // 0.25% min stop
  nse: { slMult: 1.4, tpMult: 2.4, minBps: 35 }, // 0.35% min stop (slower)
  bse: { slMult: 1.4, tpMult: 2.4, minBps: 35 },
  forex: { slMult: 1.2, tpMult: 2.0, minBps: 8 }, // 8 bps ~ typical FX stop
};

export function DemoTrading({ coin, currentPrice, prediction, recentPrices }: Props) {
  const [mounted, setMounted] = useState(false);
  const [acct, setAcct] = useState<Account>(INITIAL);
  const [direction, setDirection] = useState<Direction>("long");
  const [size, setSize] = useState<number>(100);
  const [lev, setLev] = useState<number>(2);
  const [entry, setEntry] = useState<number>(currentPrice || 0);
  const [customSL, setCustomSL] = useState<number | null>(null);
  const [customTP, setCustomTP] = useState<number | null>(null);
  const [tab, setTab] = useState<"pos" | "log" | "stats">("pos");

  useEffect(() => {
    setMounted(true);
    setAcct(loadAccount());
  }, []);

  // Reset entry & custom SL/TP when the selected coin/market changes
  useEffect(() => {
    setEntry(currentPrice || 0);
    setCustomSL(null);
    setCustomTP(null);
  }, [coin.market, coin.symbol, currentPrice]);

  useEffect(() => {
    if (currentPrice > 0) setEntry((e) => (e === 0 ? currentPrice : e));
  }, [currentPrice]);

  useEffect(() => {
    if (!mounted) return;
    saveAccount(acct);
  }, [acct, mounted]);

  // Auto-fill direction from current model bias
  useEffect(() => {
    if (prediction?.direction === "up") setDirection("long");
    else if (prediction?.direction === "down") setDirection("short");
  }, [prediction?.direction]);

  // When direction flips, drop manual SL/TP so they don't sit on the wrong side
  useEffect(() => {
    setCustomSL(null);
    setCustomTP(null);
  }, [direction]);

  // ATR-style range from recent prices (true range = high-low over last N bars).
  // Falls back to GARCH σ if no recent series is provided.
  const atr = useMemo(() => {
    if (recentPrices && recentPrices.length >= 14) {
      const slice = recentPrices.slice(-30);
      let sum = 0;
      for (let i = 1; i < slice.length; i++) sum += Math.abs(slice[i] - slice[i - 1]);
      return sum / Math.max(1, slice.length - 1);
    }
    return prediction?.garch.sigma ?? 0;
  }, [recentPrices, prediction?.garch.sigma]);

  const risk = MARKET_RISK[coin.market] ?? MARKET_RISK.crypto;
  // Floor stop at minBps so micro-volatility regimes don't produce a 1-tick stop.
  const minMove = entry * (risk.minBps / 10000);
  const slDist = Math.max(atr * risk.slMult, minMove);
  const tpDist = Math.max(atr * risk.tpMult, minMove * 1.6);
  const suggestedStop = direction === "long" ? entry - slDist : entry + slDist;
  const suggestedTp = direction === "long" ? entry + tpDist : entry - tpDist;
  const stop = customSL ?? suggestedStop;
  const tp = customTP ?? suggestedTp;
  const riskU = entry > 0 ? size * lev * (Math.abs(entry - stop) / entry) : 0;
  const rewardU = entry > 0 ? size * lev * (Math.abs(tp - entry) / entry) : 0;
  const rrRatio = riskU > 0 ? rewardU / riskU : 0;
  const kelly = 0.275; // half-Kelly @ 55% wr, 1.5 RR

  const unrealized = useMemo(() => {
    if (currentPrice === 0) return 0;
    return acct.positions.reduce((sum, p) => {
      const dirSign = p.dir === "short" ? -1 : 1;
      return sum + p.qty * (currentPrice - p.entry) * dirSign * p.lev;
    }, 0);
  }, [acct.positions, currentPrice]);

  const openTrade = () => {
    if (entry <= 0 || size <= 0) return;
    const pos: Position = {
      id: Date.now(),
      pair: coin.symbol.toUpperCase().includes("/")
        ? coin.symbol.toUpperCase()
        : coin.symbol.toUpperCase(),
      dir: direction,
      entry,
      size,
      lev,
      stop,
      tp,
      qty: (size * lev) / entry,
      time: new Date().toLocaleTimeString(),
    };
    setAcct((a) => ({
      ...a,
      positions: [...a.positions, pos],
      totalTrades: a.totalTrades + 1,
    }));
  };

  const closePos = (id: number) => {
    setAcct((a) => {
      const i = a.positions.findIndex((p) => p.id === id);
      if (i < 0) return a;
      const p = a.positions[i];
      const exit = currentPrice;
      const dirSign = p.dir === "short" ? -1 : 1;
      const pnl = +(p.qty * (exit - p.entry) * dirSign * p.lev).toFixed(2);
      const priceWentUp = exit > p.entry;
      const correct = (p.dir === "long" && priceWentUp) || (p.dir === "short" && !priceWentUp);
      const trade: ClosedTrade = {
        time: new Date().toLocaleTimeString(),
        pair: p.pair,
        dir: p.dir,
        entry: p.entry,
        exit,
        pnl,
        correct,
      };
      const positions = [...a.positions];
      positions.splice(i, 1);
      return {
        ...a,
        positions,
        trades: [trade, ...a.trades].slice(0, 100),
        balance: a.balance + pnl,
        realPnl: a.realPnl + pnl,
      };
    });
  };

  const resetAccount = () => {
    if (confirm("Reset demo account to $10,000?")) setAcct(INITIAL);
  };

  // Stats
  const stats = useMemo(() => {
    const t = acct.trades;
    if (t.length === 0) return null;
    const pnls = t.map((x) => x.pnl);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p <= 0);
    const wr = wins.length / pnls.length;
    const avgW = wins.reduce((a, b) => a + b, 0) / Math.max(1, wins.length);
    const avgL = Math.abs(losses.reduce((a, b) => a + b, 0)) / Math.max(1, losses.length);
    const pf = avgL > 0 ? (avgW * wins.length) / (avgL * losses.length) : 0;
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const std = Math.sqrt(pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / pnls.length) || 1;
    const sharpe = (mean / std) * Math.sqrt(pnls.length);
    let peak = 0,
      dd = 0,
      cum = 0;
    for (const p of pnls.slice().reverse()) {
      cum += p;
      peak = Math.max(peak, cum);
      dd = Math.min(dd, cum - peak);
    }
    const dirAcc = t.filter((x) => x.correct).length / t.length;
    const rr = avgL > 0 ? avgW / avgL : 0;
    return { wr, pf, sharpe, dd, dirAcc, rr };
  }, [acct.trades]);

  const isLong = direction === "long";
  const colorOk = "hsl(142 76% 50%)";
  const colorBad = "hsl(0 84% 60%)";

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className="font-display font-semibold text-foreground text-sm">Demo Trade</h3>
          <span className="text-[10px] uppercase tracking-wider text-primary font-mono">
            {coin.symbol.toUpperCase()}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {coin.market}
          </span>
        </div>
        <button
          onClick={resetAccount}
          className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      </div>

      {/* Direction */}
      <div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
          Direction
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setDirection("long")}
            className="flex-1 py-1.5 rounded text-xs font-bold border transition-colors"
            style={
              isLong
                ? { background: "hsl(142 76% 50% / 0.15)", borderColor: colorOk, color: colorOk }
                : {
                    background: "transparent",
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--muted-foreground))",
                  }
            }
          >
            LONG
          </button>
          <button
            onClick={() => setDirection("short")}
            className="flex-1 py-1.5 rounded text-xs font-bold border transition-colors"
            style={
              !isLong
                ? { background: "hsl(0 84% 60% / 0.15)", borderColor: colorBad, color: colorBad }
                : {
                    background: "transparent",
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--muted-foreground))",
                  }
            }
          >
            SHORT
          </button>
        </div>
      </div>

      {/* Market Risk Profile Display */}
      <div className="p-2 rounded border border-border/50 bg-card/50 text-[9px] space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <span>Volatility (ATR):</span>
          <span className="font-mono font-bold text-foreground">{atr.toFixed(8)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Market Risk:</span>
          <span className="font-mono font-bold text-foreground">
            {risk.slMult.toFixed(1)}σ SL · {risk.tpMult.toFixed(1)}σ TP · {risk.minBps} bps min
          </span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Suggested SL/TP:</span>
          <span className="font-mono font-bold text-foreground">
            {fmtPrice(suggestedStop)} / {fmtPrice(suggestedTp)}
          </span>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-3 gap-2">
        <NumField label="Size (USDT)" value={size} onChange={setSize} min={1} />
        <NumField label="Leverage" value={lev} onChange={setLev} min={1} max={50} />
        <NumField label="Entry" value={entry} onChange={setEntry} step="any" />
      </div>

      {/* Manual SL / TP */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Stop Loss
            </span>
            <button
              onClick={() => setCustomSL(null)}
              className="text-[9px] uppercase tracking-wider text-primary/70 hover:text-primary"
              title="Use suggested 2σ stop"
            >
              auto
            </button>
          </div>
          <input
            type="number"
            value={Number.isFinite(stop) ? +stop.toFixed(8) : 0}
            step="any"
            onChange={(e) => setCustomSL(parseFloat(e.target.value) || 0)}
            className="w-full px-2 py-1.5 rounded bg-card border border-border text-xs font-mono outline-none focus:border-primary transition-colors"
            style={{ color: colorBad }}
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Take Profit
            </span>
            <button
              onClick={() => setCustomTP(null)}
              className="text-[9px] uppercase tracking-wider text-primary/70 hover:text-primary"
              title="Use suggested 3σ TP"
            >
              auto
            </button>
          </div>
          <input
            type="number"
            value={Number.isFinite(tp) ? +tp.toFixed(8) : 0}
            step="any"
            onChange={(e) => setCustomTP(parseFloat(e.target.value) || 0)}
            className="w-full px-2 py-1.5 rounded bg-card border border-border text-xs font-mono outline-none focus:border-primary transition-colors"
            style={{ color: colorOk }}
          />
        </div>
      </div>

      {/* Risk box */}
      <div className="grid grid-cols-2 gap-1 p-2 rounded border border-border bg-card text-[10px]">
        <div>
          <span className="text-muted-foreground">Risk: </span>
          <span className="font-bold" style={{ color: colorBad }}>
            ${riskU.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Reward: </span>
          <span className="font-bold" style={{ color: colorOk }}>
            ${rewardU.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">R:R: </span>
          <span className="text-primary font-bold">{rrRatio.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Kelly: </span>
          <span className="text-primary font-bold">{(kelly * 100).toFixed(1)}%</span>
        </div>
      </div>

      <button
        onClick={openTrade}
        className="w-full py-2.5 rounded font-display font-bold text-sm tracking-wide transition-opacity hover:opacity-90"
        style={{ background: isLong ? colorOk : colorBad, color: "#040710" }}
      >
        {isLong ? "OPEN LONG" : "OPEN SHORT"}
      </button>

      {/* Tabs */}
      <div className="flex border-b border-border -mx-4 px-4">
        {(["pos", "log", "stats"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors border-b-2"
            style={
              tab === t
                ? { color: "hsl(var(--primary))", borderColor: "hsl(var(--primary))" }
                : { color: "hsl(var(--muted-foreground))", borderColor: "transparent" }
            }
          >
            {t === "pos" ? `Positions (${acct.positions.length})` : t === "log" ? "Log" : "Stats"}
          </button>
        ))}
      </div>

      {tab === "pos" && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {acct.positions.length === 0 && (
            <div className="text-center text-[10px] text-muted-foreground py-4">
              No open positions
            </div>
          )}
          {acct.positions.map((p) => {
            const dirSign = p.dir === "short" ? -1 : 1;
            const upnl = currentPrice > 0 ? p.qty * (currentPrice - p.entry) * dirSign * p.lev : 0;
            const pos = upnl >= 0;
            return (
              <div key={p.id} className="rounded border border-border bg-card p-2 text-[11px]">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-display font-bold text-xs">{p.pair}</span>
                  <span
                    className="px-1.5 rounded text-[9px] font-bold"
                    style={{
                      background:
                        p.dir === "long" ? "hsl(142 76% 50% / 0.2)" : "hsl(0 84% 60% / 0.2)",
                      color: p.dir === "long" ? colorOk : colorBad,
                    }}
                  >
                    {p.dir.toUpperCase()} ×{p.lev}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="text-muted-foreground">
                    Entry <span className="text-foreground">${fmtPrice(p.entry)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Now <span className="text-foreground">${fmtPrice(currentPrice)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Stop <span className="text-foreground">${fmtPrice(p.stop)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    TP <span className="text-foreground">${fmtPrice(p.tp)}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-1.5">
                  <span className="text-[9px] text-muted-foreground">{p.time}</span>
                  <span className="font-bold" style={{ color: pos ? colorOk : colorBad }}>
                    {pos ? "+" : ""}${Math.abs(upnl).toFixed(2)}
                  </span>
                </div>
                <button
                  onClick={() => closePos(p.id)}
                  className="w-full mt-1.5 py-1 rounded border border-border text-[10px] hover:border-destructive hover:text-destructive transition-colors"
                >
                  Close Position
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "log" && (
        <div className="max-h-64 overflow-y-auto">
          {acct.trades.length === 0 ? (
            <div className="text-center text-[10px] text-muted-foreground py-4">No trades yet</div>
          ) : (
            acct.trades.map((t, i) => (
              <div
                key={i}
                className="flex justify-between py-1.5 border-b border-border text-[10px]"
              >
                <span className="text-muted-foreground">{t.time}</span>
                <span>{t.pair}</span>
                <span
                  style={{ color: t.dir === "long" ? colorOk : colorBad }}
                  className="font-bold"
                >
                  {t.dir[0].toUpperCase()}
                </span>
                <span style={{ color: t.pnl >= 0 ? colorOk : colorBad }} className="font-bold">
                  {t.pnl >= 0 ? "+" : ""}${Math.abs(t.pnl).toFixed(2)}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "stats" && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {stats ? (
            <>
              <Stat label="Win Rate" value={`${(stats.wr * 100).toFixed(1)}%`} />
              <Stat label="Profit Factor" value={stats.pf.toFixed(2)} />
              <Stat label="Sharpe" value={stats.sharpe.toFixed(2)} />
              <Stat label="Max DD" value={`$${stats.dd.toFixed(2)}`} color={colorBad} />
              <Stat label="Dir. Accuracy" value={`${(stats.dirAcc * 100).toFixed(1)}%`} />
              <Stat label="Avg RR" value={stats.rr.toFixed(2)} />
            </>
          ) : (
            <div className="col-span-2 text-center text-[10px] text-muted-foreground py-4">
              Close a trade to see stats
            </div>
          )}
        </div>
      )}

      {/* Account bar */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border">
        <Stat
          label="Balance"
          value={`$${acct.balance.toFixed(2)}`}
          color={acct.balance >= 10000 ? colorOk : colorBad}
        />
        <Stat
          label="Unrealized P&L"
          value={`${unrealized >= 0 ? "+" : ""}$${Math.abs(unrealized).toFixed(2)}`}
          color={unrealized >= 0 ? colorOk : colorBad}
        />
        <Stat
          label="Realized P&L"
          value={`${acct.realPnl >= 0 ? "+" : ""}$${Math.abs(acct.realPnl).toFixed(2)}`}
          color={acct.realPnl >= 0 ? colorOk : colorBad}
        />
        <Stat label="Total Trades" value={acct.totalTrades.toString()} />
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number | "any";
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step as number | undefined}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-2 py-1.5 rounded bg-card border border-border text-xs font-mono outline-none focus:border-primary transition-colors"
      />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded bg-card p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-bold text-sm" style={{ color: color ?? "hsl(var(--foreground))" }}>
        {value}
      </div>
    </div>
  );
}
