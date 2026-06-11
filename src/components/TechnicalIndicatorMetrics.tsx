import { useMemo } from "react";
import type { HybridResult } from "@/lib/physics/hybrid";
import { Card } from "@/components/ui/card";

interface Props {
  prediction: HybridResult | null;
  currentPrice: number;
  recentPrices: number[];
}

export function TechnicalIndicatorMetrics({ prediction, currentPrice, recentPrices }: Props) {
  const metrics = useMemo(() => {
    if (!prediction || recentPrices.length < 20) return null;

    const indicators = prediction.indicators;
    const bias = indicators.bias ?? 0;
    const vwapZ = indicators.vwapZ ?? 0;
    const emaSlopeFast = indicators.emaSlopeFast ?? 0;
    const emaSlopeSlow = indicators.emaSlopeSlow ?? 0;
    const macdHist = indicators.macdHist ?? 0;
    const superTrendDir = indicators.superTrendDir ?? 1;
    const fibPosition = indicators.fibPosition ?? 0.5;
    const fibBias = indicators.fibBias ?? 0;

    const biasLevel = bias > 0.2 ? "BULLISH" : bias < -0.2 ? "BEARISH" : "NEUTRAL";
    const biasColor = bias > 0.2 ? "text-bull" : bias < -0.2 ? "text-bear" : "text-foreground";

    const vwapZLevel = vwapZ <= -1 ? "MEAN-REVERT LONG" : vwapZ >= 1 ? "MEAN-REVERT SHORT" : "BALANCED";
    const vwapZColor = vwapZ <= -1 ? "text-bull" : vwapZ >= 1 ? "text-bear" : "text-foreground";

    const slopeLevel =
      emaSlopeFast > emaSlopeSlow ? "SHORTER EMA LEADING" : emaSlopeFast < emaSlopeSlow ? "LONGER EMA LEADING" : "ALIGNED";
    const slopeColor =
      emaSlopeFast > emaSlopeSlow ? "text-bull" : emaSlopeFast < emaSlopeSlow ? "text-bear" : "text-foreground";

    const macdLevel = macdHist > 0 ? "POSITIVE MOMENTUM" : macdHist < 0 ? "NEGATIVE MOMENTUM" : "FLAT";
    const macdColor = macdHist > 0 ? "text-bull" : macdHist < 0 ? "text-bear" : "text-foreground";

    const trendLevel = superTrendDir > 0 ? "UPTREND" : "DOWNTREND";
    const trendColor = superTrendDir > 0 ? "text-bull" : "text-bear";

    const fibLevel = fibPosition > 0.75 ? "NEAR HIGH" : fibPosition < 0.25 ? "NEAR LOW" : "MID-RANGE";
    const fibColor = fibBias > 0.1 ? "text-bull" : fibBias < -0.1 ? "text-bear" : "text-foreground";

    return {
      bias: { value: bias.toFixed(3), level: biasLevel, color: biasColor },
      vwapZ: { value: vwapZ.toFixed(2), level: vwapZLevel, color: vwapZColor },
      slope: {
        fast: emaSlopeFast.toFixed(4),
        slow: emaSlopeSlow.toFixed(4),
        level: slopeLevel,
        color: slopeColor,
      },
      macd: { value: macdHist.toFixed(4), level: macdLevel, color: macdColor },
      trend: { value: trendLevel, color: trendColor },
      fib: { value: fibPosition.toFixed(2), level: fibLevel, color: fibColor },
    };
  }, [prediction, currentPrice, recentPrices]);

  if (!metrics) {
    return (
      <Card className="panel p-4 text-sm text-muted-foreground">
        <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        Computing technical indicators…
      </Card>
    );
  }

  return (
    <Card className="panel p-4">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
        Technical Indicator Metrics
      </h3>
      <div className="space-y-3 text-[10px]">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">Composite Bias</div>
            <div className={`font-bold ${metrics.bias.color}`}>{metrics.bias.value}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.bias.level}</div>
          </div>
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">VWAP Z-Score</div>
            <div className={`font-bold ${metrics.vwapZ.color}`}>{metrics.vwapZ.value}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.vwapZ.level}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">EMA Slope</div>
            <div className={`font-bold ${metrics.slope.color}`}>{metrics.slope.level}</div>
            <div className="text-[8px] text-muted-foreground">
              Fast {metrics.slope.fast} | Slow {metrics.slope.slow}
            </div>
          </div>
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">MACD Histogram</div>
            <div className={`font-bold ${metrics.macd.color}`}>{metrics.macd.value}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.macd.level}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">SuperTrend</div>
            <div className={`font-bold ${metrics.trend.color}`}>{metrics.trend.value}</div>
            <div className="text-[8px] text-muted-foreground">Direction from trend regime</div>
          </div>
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">Fibonacci Position</div>
            <div className={`font-bold ${metrics.fib.color}`}>{metrics.fib.value}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.fib.level}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
