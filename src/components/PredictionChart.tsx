import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { HybridResult } from "@/lib/physics/hybrid";

interface Props {
  history: { ts: number; price: number }[];
  prediction: HybridResult;
  currentPrice: number;
  minutesPerStep: number;
}

interface ChartPoint {
  t: number;
  actual?: number;
  predicted?: number;
  upper?: number;
  lower?: number;
  sslU?: number;
  sslL?: number;
  step?: number;
}

// Resample sparse OHLC-style history into evenly spaced "tick" points using
// linear interpolation. Produces a much smoother actual-price line that mimics
// a tick-by-tick feed even when the underlying source is 1m/5m candles.
function resampleToTicks(
  history: { ts: number; price: number }[],
  targetTicks = 600,
): { ts: number; price: number }[] {
  if (history.length < 2) return history.slice();
  const first = history[0].ts;
  const last = history[history.length - 1].ts;
  const span = last - first;
  if (span <= 0) return history.slice();
  // Pick a tick interval: at least 1s, at most the native gap, aiming for ~targetTicks.
  const nativeGap = span / (history.length - 1);
  const desired = span / targetTicks;
  const tickMs = Math.max(1000, Math.min(nativeGap, desired));
  const out: { ts: number; price: number }[] = [];
  let j = 0;
  for (let t = first; t <= last; t += tickMs) {
    while (j < history.length - 2 && history[j + 1].ts < t) j++;
    const a = history[j];
    const b = history[j + 1] ?? a;
    const denom = b.ts - a.ts;
    const frac = denom > 0 ? (t - a.ts) / denom : 0;
    const price = a.price + (b.price - a.price) * Math.max(0, Math.min(1, frac));
    out.push({ ts: t, price });
  }
  // Ensure the final true sample is preserved exactly.
  if (out.length === 0 || out[out.length - 1].ts !== last) {
    out.push(history[history.length - 1]);
  }
  return out;
}

export function PredictionChart({ history, prediction, currentPrice, minutesPerStep }: Props) {
  const ticks = resampleToTicks(history);
  const histPoints = ticks.map((h) => ({ t: h.ts, actual: h.price }));

  // Anchor the prediction at the LAST ACTUAL data point, not at the current
  // wall-clock. This guarantees the predicted line continues seamlessly from
  // where the actual tick data ends — no time gap, no price jump — across
  // crypto, forex, NSE and BSE (whose feeds may lag the wall clock).
  const lastTs = history.length > 0 ? history[history.length - 1].ts : 0;
  const lastActual = history.length > 0 ? history[history.length - 1].price : currentPrice;
  const stepMs = minutesPerStep * 60 * 1000;
  const futurePoints = prediction.forecast.map((f) => ({
    t: lastTs + f.step * stepMs,
    predicted: f.price,
    upper: f.upper,
    lower: f.lower,
    sslU: f.sslUpper,
    sslL: f.sslLower,
    step: f.step, // Add step number for labeling
  }));

  // Bridge: predicted line begins exactly where actual line ends (same ts,
  // same price). This removes the visible "jump" the chart used to show
  // when currentPrice diverged from the last bar's close.
  const bridge = { t: lastTs, actual: lastActual, predicted: lastActual };
  const data = [...histPoints, bridge, ...futurePoints];

  const coreVals = data.flatMap((d: ChartPoint) =>
    [d.actual, d.predicted, d.upper, d.lower].filter((v) => typeof v === "number"),
  );
  const envelopeVals = data.flatMap((d: ChartPoint) =>
    [d.sslU, d.sslL].filter((v) => typeof v === "number"),
  );
  const coreMin = Math.min(...coreVals);
  const coreMax = Math.max(...coreVals);
  const coreRange = Math.max(1e-9, coreMax - coreMin);
  // Prevent a single extreme QSL/SSL point from crushing the visible price path.
  const envMin = envelopeVals.length
    ? Math.max(Math.min(...envelopeVals), coreMin - coreRange * 1.5)
    : coreMin;
  const envMax = envelopeVals.length
    ? Math.min(Math.max(...envelopeVals), coreMax + coreRange * 1.5)
    : coreMax;
  const min = Math.min(coreMin, envMin);
  const max = Math.max(coreMax, envMax);
  const pad = (max - min) * 0.06 || Math.max(Math.abs(max), 1) * 0.001;

  const tStart = data[0]?.t ?? lastTs;
  const tEnd = data[data.length - 1]?.t ?? lastTs;

  // Prediction statistics
  const lastPredicted =
    futurePoints.length > 0 ? futurePoints[futurePoints.length - 1].predicted : lastActual;
  const predictionReturn = lastActual > 0 ? ((lastPredicted - lastActual) / lastActual) * 100 : 0;
  const predictionDirection =
    predictionReturn > 0 ? "↑ UP" : predictionReturn < 0 ? "↓ DOWN" : "→ FLAT";
  const directionColor =
    predictionReturn > 0
      ? "hsl(142 76% 50%)"
      : predictionReturn < 0
        ? "hsl(0 84% 60%)"
        : "hsl(50 85% 45%)";

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline text-[10px] px-2">
        <span className="text-muted-foreground">
          Forecast: {prediction.forecast.length} steps ·{" "}
          {(prediction.forecast.length * minutesPerStep).toFixed(0)} min horizon · 1 step = 1 min
        </span>
        <span className="text-muted-foreground">Each dot = 1-minute prediction</span>
      </div>
      <div style={{ width: "100%", height: 420, display: "flex", justifyContent: "center" }}>
        <ResponsiveContainer width="100%" height={420}>
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
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
            labelFormatter={(label) => {
              const ts = typeof label === "number" ? label : Number(label);
              return Number.isFinite(ts)
                ? new Date(ts).toLocaleString("en-US")
                : String(label ?? "");
            }}
            formatter={(value, name, item) => {
              const step = (item as { payload?: { step?: number } } | undefined)?.payload?.step;
              const stepLabel = step ? ` (min ${step})` : "";
              const num = typeof value === "number" ? value : Number(value);
              return [
                Number.isFinite(num) ? formatPrice(num) : String(value ?? ""),
                String(name ?? "") + stepLabel,
              ];
            }}
          />
          <ReferenceLine
            x={lastTs}
            stroke="oklch(0.65 0.03 255)"
            strokeDasharray="2 4"
            strokeOpacity={0.5}
            label={{ value: "now", position: "top", fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
          />
          <ReferenceLine
            y={currentPrice}
            stroke="oklch(0.72 0.18 230)"
            strokeDasharray="3 3"
            strokeOpacity={0.4}
          />
          {/* SSL */}
          <Line
            dataKey="sslU"
            stroke="oklch(0.78 0.18 130)"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="sslL"
            stroke="oklch(0.78 0.18 130)"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          {/* GARCH 1σ */}
          <Line
            dataKey="upper"
            stroke="oklch(0.75 0.18 60)"
            strokeWidth={0.8}
            strokeOpacity={0.6}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="lower"
            stroke="oklch(0.75 0.18 60)"
            strokeWidth={0.8}
            strokeOpacity={0.6}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          {/* Actual price (CoinGecko-style filled area) */}
          <Area
            dataKey="actual"
            stroke="oklch(0.72 0.18 230)"
            strokeWidth={1.6}
            fill="url(#actualFill)"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          {/* Prediction */}
          <Line
            dataKey="predicted"
            stroke="oklch(0.65 0.24 25)"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground px-2 border-t border-border/40 pt-2">
        <div className="flex items-center gap-1.5">
          <span
            style={{ width: 14, height: 1.5, background: "oklch(0.72 0.18 230)" }}
            className="inline-block"
          />
          <span>Actual price</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            style={{ width: 14, height: 1.5, background: "oklch(0.65 0.24 25)" }}
            className="inline-block"
          />
          <span>Hybrid forecast (dots = each 1-min step)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            style={{ width: 14, height: 1.5, background: "oklch(0.75 0.18 60)" }}
            className="inline-block"
          />
          <span>GARCH ±1σ band</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            style={{
              width: 14,
              height: 1.5,
              background: "oklch(0.78 0.18 130)",
              backgroundImage:
                "repeating-linear-gradient(to right, oklch(0.78 0.18 130) 0, oklch(0.78 0.18 130) 3px, transparent 3px, transparent 6px)",
            }}
            className="inline-block"
          />
          <span>SSL 95% bound</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ c, l, dash }: { c: string; l: string; dash?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        style={{
          width: 14,
          height: 1.5,
          background: c,
          opacity: 0.8,
          ...(dash && {
            backgroundImage:
              "repeating-linear-gradient(to right, " +
              c +
              " 0, " +
              c +
              " 3px, transparent 3px, transparent 6px)",
            background: "transparent",
          }),
        }}
      />
      <span className="text-muted-foreground">{l}</span>
    </div>
  );
}

function formatPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

// CoinGecko-style adaptive time labels.
function formatTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  const spanH = spanMs / 3_600_000;
  const timeFormat: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (spanH <= 24) {
    return d.toLocaleTimeString("en-US", timeFormat);
  }
  if (spanH <= 24 * 7) {
    return `${d.getDate().toString().padStart(2, "0")} ${d.toLocaleTimeString("en-US", timeFormat)}`;
  }
  if (spanH < 24 * 14) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
