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

    // RSI interpretation
    const rsiLevel = indicators.rsi <= 30 ? "OVERSOLD" : indicators.rsi >= 70 ? "OVERBOUGHT" : "NEUTRAL";
    const rsiColor = indicators.rsi <= 30 ? "text-bull" : indicators.rsi >= 70 ? "text-bear" : "text-foreground";

    // MACD interpretation
    const macdSignal = indicators.macd > indicators.macdSignal ? "BULLISH" : "BEARISH";
    const macdColor = indicators.macd > indicators.macdSignal ? "text-bull" : "text-bear";

    // Bollinger Bands interpretation
    const bbPosition = (currentPrice - indicators.bbLower) / (indicators.bbUpper - indicators.bbLower);
    const bbLevel = bbPosition > 0.8 ? "NEAR TOP" : bbPosition < 0.2 ? "NEAR BOTTOM" : "MID-BAND";

    // Stochastic %K interpretation
    const stochasticLevel =
      indicators.stochasticK <= 20 ? "OVERSOLD" : indicators.stochasticK >= 80 ? "OVERBOUGHT" : "NEUTRAL";
    const stochasticColor =
      indicators.stochasticK <= 20 ? "text-bull" : indicators.stochasticK >= 80 ? "text-bear" : "text-foreground";

    // ATR normalized (volatility indicator)
    const atrPercent = (indicators.atr / currentPrice) * 100;
    const atrLevel = atrPercent > 2 ? "HIGH VOLATILITY" : atrPercent < 0.5 ? "LOW VOLATILITY" : "NORMAL";

    // Moving averages confluence
    const sma50Above = currentPrice > indicators.sma50 ? "ABOVE" : "BELOW";
    const sma200Above = currentPrice > indicators.sma200 ? "ABOVE" : "BELOW";
    const ma_confluence =
      sma50Above === "ABOVE" && sma200Above === "ABOVE"
        ? "STRONG_UPTREND"
        : sma50Above === "BELOW" && sma200Above === "BELOW"
          ? "STRONG_DOWNTREND"
          : "MIXED";

    // ADX trend strength
    const adxStrength = indicators.adx > 25 ? "STRONG TREND" : indicators.adx > 20 ? "MODERATE TREND" : "WEAK TREND";
    const adxColor = indicators.adx > 25 ? "text-bull" : indicators.adx > 20 ? "text-foreground" : "text-muted-foreground";

    // CCI interpretation
    const cciLevel = indicators.cci > 100 ? "EXTREME_UP" : indicators.cci < -100 ? "EXTREME_DOWN" : "NORMAL";

    return {
      rsi: { value: indicators.rsi.toFixed(1), level: rsiLevel, color: rsiColor },
      macd: {
        value: indicators.macd.toFixed(4),
        signal: macdSignal,
        color: macdColor,
        histogram: (indicators.macd - indicators.macdSignal).toFixed(4),
      },
      bb: { upper: indicators.bbUpper.toFixed(4), lower: indicators.bbLower.toFixed(4), level: bbLevel },
      stochastic: {
        k: indicators.stochasticK.toFixed(1),
        d: indicators.stochasticD.toFixed(1),
        level: stochasticLevel,
        color: stochasticColor,
      },
      atr: { value: atrPercent.toFixed(2), level: atrLevel },
      sma: { sma50Above, sma200Above, confluence: ma_confluence },
      adx: { value: indicators.adx.toFixed(1), level: adxStrength, color: adxColor },
      cci: { value: indicators.cci.toFixed(1), level: cciLevel },
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
        {/* Momentum Indicators */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">RSI(14)</div>
            <div className={`font-bold ${metrics.rsi.color}`}>{metrics.rsi.value}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.rsi.level}</div>
          </div>
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">Stochastic %K</div>
            <div className={`font-bold ${metrics.stochastic.color}`}>{metrics.stochastic.k}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.stochastic.level}</div>
          </div>
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">CCI</div>
            <div className="font-bold text-foreground">{metrics.cci.value}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.cci.level}</div>
          </div>
        </div>

        {/* Trend Indicators */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">ADX</div>
            <div className={`font-bold ${metrics.adx.color}`}>{metrics.adx.value}</div>
            <div className="text-[8px] text-muted-foreground">{metrics.adx.level}</div>
          </div>
          <div className="bg-card p-2 rounded border border-border/50 col-span-2">
            <div className="text-muted-foreground text-[8px] mb-1">MA Confluence</div>
            <div className="font-bold text-foreground text-[9px]">{metrics.sma.confluence}</div>
            <div className="text-[8px] text-muted-foreground">
              SMA50: {metrics.sma.sma50Above} | SMA200: {metrics.sma.sma200Above}
            </div>
          </div>
        </div>

        {/* Trend-Following Indicators */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">MACD</div>
            <div className={`font-bold ${metrics.macd.color}`}>{metrics.macd.signal}</div>
            <div className="text-[8px] text-muted-foreground">Hist: {metrics.macd.histogram}</div>
          </div>
          <div className="bg-card p-2 rounded border border-border/50">
            <div className="text-muted-foreground text-[8px] mb-1">ATR</div>
            <div className="font-bold text-foreground">{metrics.atr.value}%</div>
            <div className="text-[8px] text-muted-foreground">{metrics.atr.level}</div>
          </div>
        </div>

        {/* Volatility Indicators */}
        <div className="bg-card p-2.5 rounded border border-border/50">
          <div className="text-muted-foreground text-[8px] mb-1.5">Bollinger Bands</div>
          <div className="text-[9px] space-y-1">
            <div className="flex justify-between">
              <span>Upper: {metrics.bb.upper}</span>
              <span className="text-muted-foreground">Lower: {metrics.bb.lower}</span>
            </div>
            <div className="text-foreground font-semibold">{metrics.bb.level}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
