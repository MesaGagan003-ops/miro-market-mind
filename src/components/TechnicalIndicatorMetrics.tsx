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

    const indicators: any = prediction.indicators || {};

    // Safety: provide defaults for all indicator properties
    const rsi = indicators.rsi ?? 50;
    const macd = indicators.macd ?? 0;
    const macdSignal = indicators.macdSignal ?? 0;
    const bbUpper = indicators.bbUpper ?? currentPrice * 1.02;
    const bbLower = indicators.bbLower ?? currentPrice * 0.98;
    const stochasticK = indicators.stochasticK ?? 50;
    const stochasticD = indicators.stochasticD ?? 50;
    const atr = indicators.atr ?? currentPrice * 0.01;
    const sma50 = indicators.sma50 ?? currentPrice;
    const sma200 = indicators.sma200 ?? currentPrice;
    const adx = indicators.adx ?? 25;
    const cci = indicators.cci ?? 0;

    // RSI interpretation
    const rsiLevel = rsi <= 30 ? "OVERSOLD" : rsi >= 70 ? "OVERBOUGHT" : "NEUTRAL";
    const rsiColor = rsi <= 30 ? "text-bull" : rsi >= 70 ? "text-bear" : "text-foreground";

    // MACD interpretation
    const macdSignalValue = macdSignal || 0;
    const macdSignalText = macd > macdSignalValue ? "BULLISH" : "BEARISH";
    const macdColor = macd > macdSignalValue ? "text-bull" : "text-bear";

    // Bollinger Bands interpretation
    const bbPosition = (currentPrice - bbLower) / (bbUpper - bbLower);
    const bbLevel = bbPosition > 0.8 ? "NEAR TOP" : bbPosition < 0.2 ? "NEAR BOTTOM" : "MID-BAND";

    // Stochastic %K interpretation
    const stochasticLevel =
      stochasticK <= 20 ? "OVERSOLD" : stochasticK >= 80 ? "OVERBOUGHT" : "NEUTRAL";
    const stochasticColor =
      stochasticK <= 20 ? "text-bull" : stochasticK >= 80 ? "text-bear" : "text-foreground";

    // ATR normalized (volatility indicator)
    const atrPercent = (atr / currentPrice) * 100;
    const atrLevel = atrPercent > 2 ? "HIGH VOLATILITY" : atrPercent < 0.5 ? "LOW VOLATILITY" : "NORMAL";

    // Moving averages confluence
    const sma50Above = currentPrice > sma50 ? "ABOVE" : "BELOW";
    const sma200Above = currentPrice > sma200 ? "ABOVE" : "BELOW";
    const ma_confluence =
      sma50Above === "ABOVE" && sma200Above === "ABOVE"
        ? "STRONG_UPTREND"
        : sma50Above === "BELOW" && sma200Above === "BELOW"
          ? "STRONG_DOWNTREND"
          : "MIXED";

    // ADX trend strength
    const adxStrength = adx > 25 ? "STRONG TREND" : adx > 20 ? "MODERATE TREND" : "WEAK TREND";
    const adxColor = adx > 25 ? "text-bull" : adx > 20 ? "text-foreground" : "text-muted-foreground";

    // CCI interpretation
    const cciLevel = cci > 100 ? "EXTREME_UP" : cci < -100 ? "EXTREME_DOWN" : "NORMAL";

    return {
      rsi: { value: rsi.toFixed(1), level: rsiLevel, color: rsiColor },
      macd: {
        value: macd.toFixed(4),
        signal: macdSignalText,
        color: macdColor,
        histogram: (macd - macdSignalValue).toFixed(4),
      },
      bb: { upper: bbUpper.toFixed(4), lower: bbLower.toFixed(4), level: bbLevel },
      stochastic: {
        k: stochasticK.toFixed(1),
        d: stochasticD.toFixed(1),
        level: stochasticLevel,
        color: stochasticColor,
      },
      atr: { value: atrPercent.toFixed(2), level: atrLevel },
      sma: { sma50Above, sma200Above, confluence: ma_confluence },
      adx: { value: adx.toFixed(1), level: adxStrength, color: adxColor },
      cci: { value: cci.toFixed(1), level: cciLevel },
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
