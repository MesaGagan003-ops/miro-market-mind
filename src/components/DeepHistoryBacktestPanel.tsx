// Deep-history walk-forward backtest UI.
// Runs the SAME hybridPredict engine over multi-year DAILY bars fetched by
// fetchDeepHistory(), so users can validate the physics-only forecast on
// long-horizon structure (no look-ahead, expanding window).

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine,
} from "recharts";
import { fetchDeepHistory } from "@/lib/deepHistory";
import { walkForwardBacktest, type BacktestResult } from "@/lib/backtest";
import { DEFAULT_COSTS, type CostModel } from "@/lib/costs";
import type { MarketAsset } from "@/lib/markets";

interface Props {
  coin: MarketAsset;
}

const HORIZONS: Array<{ key: string; label: string; horizon: number }> = [
  { key: "1d",  label: "1 day",   horizon: 1 },
  { key: "5d",  label: "5 days",  horizon: 5 },
  { key: "20d", label: "20 days", horizon: 20 },
];

export function DeepHistoryBacktestPanel({ coin }: Props) {
  const [horizonKey, setHorizonKey] = useState("5d");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [bars, setBars] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostModel>(() => DEFAULT_COSTS[coin.market]);

  useEffect(() => { setCost(DEFAULT_COSTS[coin.market]); }, [coin.market]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setResult(null);
    const cfg = HORIZONS.find((h) => h.key === horizonKey)!;
    void (async () => {
      try {
        const hist = await fetchDeepHistory(coin);
        if (cancelled) return;
        setBars(hist.length);
        if (hist.length < 150) {
          setError("Not enough deep daily history for this asset.");
          setLoading(false);
          return;
        }
        const r = walkForwardBacktest(hist, {
          horizon: cfg.horizon,
          cost,
          threshold: 0.001,
          step: cfg.horizon,
          minTrain: 120,
        });
        if (cancelled) return;
        setResult(r);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(String((e as Error)?.message ?? e));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [coin, horizonKey, cost.feesBps, cost.slippageBps]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => result?.equityCurve ?? [], [result]);
  const m = result?.metrics;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm">Deep-History Backtest <span className="text-muted-foreground">· daily bars</span></h3>
          <p className="text-[10px] text-muted-foreground">
            Walk-forward over {bars > 0 ? `${bars} multi-year daily bars` : "fetched deep history"} · same hybrid engine, no look-ahead.
          </p>
        </div>
        <div className="flex gap-1">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              onClick={() => setHorizonKey(h.key)}
              className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                horizonKey === h.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="Fees (bps)" value={cost.feesBps} onChange={(v) => setCost((c) => ({ ...c, feesBps: v }))} />
        <NumField label="Slippage (bps)" value={cost.slippageBps} onChange={(v) => setCost((c) => ({ ...c, slippageBps: v }))} />
      </div>

      {loading ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
          Running deep-history backtest…
        </div>
      ) : error ? (
        <div className="h-[100px] flex items-center justify-center text-xs text-destructive">{error}</div>
      ) : !result ? null : (
        <>
          <div className="h-[200px]">
            <div style={{ width: "100%", height: "100%", overflow: "hidden", display: "flex", justifyContent: "center" }}>
              <LineChart data={chartData} width={980} height={200} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.3} />
                <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleDateString([], { year: "2-digit", month: "short" })} tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }} tickFormatter={(v) => `${((v - 1) * 100).toFixed(0)}%`} width={56} />
                <Tooltip
                  labelFormatter={(v) => new Date(Number(v)).toLocaleDateString()}
                  formatter={(value, name) => {
                    const v = Number(value);
                    return [Number.isFinite(v) ? `${((v - 1) * 100).toFixed(2)}%` : "—", String(name)];
                  }}
                  contentStyle={{ background: "oklch(0.18 0.04 265)", border: "1px solid oklch(0.28 0.04 265)", fontSize: 11 }}
                />
                <ReferenceLine y={1} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="equity" stroke="var(--quantum)" strokeWidth={1.6} dot={false} />
              </LineChart>
            </div>
          </div>
          {m && (
            <div className="grid grid-cols-4 gap-2 mt-3 text-[10px]">
              <Stat label="Net return" value={`${(m.netReturn * 100).toFixed(2)}%`} good={m.netReturn > 0} />
              <Stat label="Trades" value={String(m.nTrades)} />
              <Stat label="Hit rate" value={`${(m.hitRate * 100).toFixed(1)}%`} good={m.hitRate > 0.5} />
              <Stat label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe > 1} />
              <Stat label="Sortino" value={m.sortino.toFixed(2)} good={m.sortino > 1} />
              <Stat label="Max DD" value={`${(m.maxDrawdown * 100).toFixed(2)}%`} good={m.maxDrawdown < 0.15} />
              <Stat label="Calmar" value={m.calmar.toFixed(2)} good={m.calmar > 0.5} />
              <Stat label="Direction acc." value={`${(m.directionalAccuracy * 100).toFixed(1)}%`} good={m.directionalAccuracy > 0.52} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="text-[10px] text-muted-foreground uppercase mb-0.5">{label}</div>
      <input
        type="number" min={0} step={0.5} value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full bg-card border border-border rounded px-2 py-1 text-xs font-mono"
      />
    </label>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const color = good === undefined ? "text-foreground" : good ? "text-bull" : "text-bear";
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-muted-foreground uppercase">{label}</div>
      <div className={`font-mono font-semibold ${color}`}>{value}</div>
    </div>
  );
}
