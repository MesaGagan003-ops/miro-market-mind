import { ComposedChart, Line, Area, XAxis, YAxis, ReferenceLine, Tooltip, CartesianGrid } from "recharts";
import type { HybridResult } from "@/lib/physics/hybrid";

interface Props {
  history: { ts: number; price: number }[];
  prediction: HybridResult;
  currentPrice: number;
  minutesPerStep: number;
}

export function PredictionChart({ history, prediction, currentPrice, minutesPerStep }: Props) {
  const histPoints = history.map((h) => ({ t: h.ts, actual: h.price }));

  // Anchor the prediction at the LAST ACTUAL data point, not at the current
  // wall-clock. This guarantees the predicted line continues seamlessly from
  // where the actual tick data ends — no time gap, no price jump — across
  // crypto, forex, NSE and BSE (whose feeds may lag the wall clock).
  const lastTs = history.length > 0 ? history[history.length - 1].ts : Date.now();
  const lastActual = history.length > 0 ? history[history.length - 1].price : currentPrice;
  const stepMs = minutesPerStep * 60 * 1000;
  const futurePoints = prediction.forecast.map((f) => ({
    t: lastTs + f.step * stepMs,
    predicted: f.price,
    upper: f.upper,
    lower: f.lower,
    sslU: f.sslUpper,
    sslL: f.sslLower,
  }));

  // Bridge: predicted line begins exactly where actual line ends (same ts,
  // same price). This removes the visible "jump" the chart used to show
  // when currentPrice diverged from the last bar's close.
  const bridge = { t: lastTs, actual: lastActual, predicted: lastActual };
  const data = [...histPoints, bridge, ...futurePoints];

  const coreVals = data.flatMap((d: any) =>
    [d.actual, d.predicted, d.upper, d.lower].filter((v) => typeof v === "number"),
  );
  const envelopeVals = data.flatMap((d: any) =>
    [d.sslU, d.sslL].filter((v) => typeof v === "number"),
  );
  const coreMin = Math.min(...coreVals);
  const coreMax = Math.max(...coreVals);
  const coreRange = Math.max(1e-9, coreMax - coreMin);
  // Prevent a single extreme QSL/SSL point from crushing the visible price path.
  const envMin = envelopeVals.length ? Math.max(Math.min(...envelopeVals), coreMin - coreRange * 1.5) : coreMin;
  const envMax = envelopeVals.length ? Math.min(Math.max(...envelopeVals), coreMax + coreRange * 1.5) : coreMax;
  const min = Math.min(coreMin, envMin);
  const max = Math.max(coreMax, envMax);
  const pad = (max - min) * 0.06 || Math.max(Math.abs(max), 1) * 0.001;

  const tStart = data[0]?.t ?? lastTs;
  const tEnd = data[data.length - 1]?.t ?? lastTs;

  // Prediction statistics
  const lastPredicted = futurePoints.length > 0 ? futurePoints[futurePoints.length - 1].predicted : lastActual;
  const predictionReturn = lastActual > 0 ? ((lastPredicted - lastActual) / lastActual) * 100 : 0;
  const predictionDirection = predictionReturn > 0 ? "↑ UP" : predictionReturn < 0 ? "↓ DOWN" : "→ FLAT";
  const directionColor = predictionReturn > 0 ? "hsl(142 76% 50%)" : predictionReturn < 0 ? "hsl(0 84% 60%)" : "hsl(50 85% 45%)";

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline text-[10px] px-2">
        <span className="text-muted-foreground">Forecast: {prediction.forecast.length} steps · {(prediction.forecast.length * minutesPerStep).toFixed(0)} min horizon</span>
      </div>
      <div style={{ width: "100%", height: 420, overflow: "auto", display: "flex", justifyContent: "center" }}>
        <ComposedChart data={data} width={980} height={420} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.72 0.18 230)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="oklch(0.72 0.18 230)" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.25} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[tStart, tEnd]}
            tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
            stroke="oklch(0.28 0.04 265)"
            tickFormatter={(v) => formatTime(v, tEnd - tStart)}
            minTickGap={48}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
            stroke="oklch(0.28 0.04 265)"
            tickFormatter={(v) => formatPrice(v)}
            width={70}
            orientation="right"
          />
          <Tooltip
            contentStyle={{
              background: "oklch(0.17 0.03 265)",
              border: "1px solid oklch(0.28 0.04 265)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v: any) => new Date(v).toLocaleString()}
            formatter={(value: any, name: any) => [typeof value === "number" ? formatPrice(value) : String(value), String(name)]}
          />
          <ReferenceLine x={lastTs} stroke="oklch(0.65 0.03 255)" strokeDasharray="2 4" strokeOpacity={0.5} label={{ value: "now", position: "top", fill: "oklch(0.65 0.03 255)", fontSize: 10 }} />
          <ReferenceLine y={currentPrice} stroke="oklch(0.72 0.18 230)" strokeDasharray="3 3" strokeOpacity={0.4} />
          {/* SSL */}
          <Line dataKey="sslU" stroke="oklch(0.78 0.18 130)" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="sslL" stroke="oklch(0.78 0.18 130)" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls isAnimationActive={false} />
          {/* GARCH 1σ */}
          <Line dataKey="upper" stroke="oklch(0.75 0.18 60)" strokeWidth={0.8} strokeOpacity={0.6} dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="lower" stroke="oklch(0.75 0.18 60)" strokeWidth={0.8} strokeOpacity={0.6} dot={false} connectNulls isAnimationActive={false} />
          {/* Actual price (CoinGecko-style filled area) */}
          <Area dataKey="actual" stroke="oklch(0.72 0.18 230)" strokeWidth={1.6} fill="url(#actualFill)" dot={false} connectNulls isAnimationActive={false} />
          {/* Prediction */}
          <Line dataKey="predicted" stroke="oklch(0.65 0.24 25)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </div>

    </div>
  );
}

function Legend({ c, l, dash }: { c: string; l: string; dash?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div style={{ width: 14, height: 1.5, background: c, opacity: 0.8, ...( dash && { backgroundImage: "repeating-linear-gradient(to right, " + c + " 0, " + c + " 3px, transparent 3px, transparent 6px)", background: "transparent" }) }} />
      <span className="text-muted-foreground">{l}</span>
    </div>
  );
}

function formatPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

// CoinGecko-style adaptive time labels.
function formatTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  const spanH = spanMs / 3_600_000;
  if (spanH < 6) {
    // intraday: HH:MM
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (spanH < 48) {
    // ~1-2 days: "DD HH:MM"
    return `${d.getDate().toString().padStart(2, "0")} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  }
  if (spanH < 24 * 14) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
}
