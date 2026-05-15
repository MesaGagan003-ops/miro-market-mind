import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoinPicker } from "@/components/CoinPicker";
import { TimeframePicker } from "@/components/TimeframePicker";
import { PredictionChart } from "@/components/PredictionChart";
import { ModelPanels } from "@/components/ModelPanels";
import { AccuracyTracker } from "@/components/AccuracyTracker";
import { DemoTrading } from "@/components/DemoTrading";
import { DataSourceInfo } from "@/components/DataSourceInfo";
import { ProviderHealthPanel, type ProviderHealthItem } from "@/components/ProviderHealthPanel";
import { TrainerPanel } from "@/components/TrainerPanel";
import { FEATURED_ASSETS, type MarketAsset } from "@/lib/markets";
import { TIMEFRAMES, type Timeframe } from "@/lib/timeframes";
import {
  subscribeAsset,
  fetchAssetHistory,
  type ProviderStatusHandler,
  type Tick,
} from "@/lib/stream";
import { hybridPredict } from "@/lib/physics/hybrid";
import {
  computeAccuracy,
  recordPrediction,
  resolvePredictions,
  type AccuracyStats,
} from "@/lib/accuracy";
import { recordPredictionCloud, resolvePendingPredictions, loadWeights } from "@/lib/learning";
import type { AdaptiveWeights } from "@/lib/learning";
import { assessDataQuality, isReadyForTrading, type DataQualityScore } from "@/lib/dataQuality";
import { fetchYahooHistory } from "@/lib/yahooProxy";
import { fetchDeepHistory } from "@/lib/deepHistory";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { WalkForwardPanel } from "@/components/WalkForwardPanel";
import { DeepHistoryBacktestPanel } from "@/components/DeepHistoryBacktestPanel";
import { PerformanceTable } from "@/components/PerformanceTable";
import { DisclaimerModal, DisclaimerBanner, DisclaimerFooter } from "@/components/Disclaimer";
import { TradingReadinessAlert } from "@/components/TradingReadinessAlert";
import { IndicatorOverlayPanel } from "@/components/IndicatorOverlayPanel";
import { fetchCoinNews } from "@/lib/news";
import { getDecayedLlmSignal, peekDecayedSignal } from "@/lib/llmCache";
import { StrategicPlanPanel } from "@/components/StrategicPlanPanel";
import { TechnicalIndicatorMetrics } from "@/components/TechnicalIndicatorMetrics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MIRO — Physics-based Market Prediction Engine" },
      {
        name: "description",
        content:
          "Live market forecasting across crypto, NSE/BSE using ARIMA, GARCH, HMM, entropy, Hurst & Hamiltonian energy with adaptive learning.",
      },
      { property: "og:title", content: "MIRO — Physics Prediction Engine" },
      {
        property: "og:description",
        content: "Hybrid physics + statistics model for live crypto prediction.",
      },
    ],
  }),
  component: PredictionEngine,
});

function PredictionEngine() {
  const [coin, setCoin] = useState<MarketAsset>(FEATURED_ASSETS[0]);
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[2]); // 10m default
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [stats, setStats] = useState<AccuracyStats>(() => computeAccuracy(`${coin.market}:${coin.id}`, timeframe.id));
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealthItem>>({});
  const [yahooTrain, setYahooTrain] = useState<number[]>([]);
  const [deepHistory, setDeepHistory] = useState<number[]>([]);
  const [adaptive, setAdaptive] = useState<AdaptiveWeights | null>(null);
  const [llmSignal, setLlmSignal] = useState<{ bias: number; confidence: number; rationale: string }>({ bias: 0, confidence: 0, rationale: "" });
  const [dataQuality, setDataQuality] = useState<DataQualityScore>({ score: 0, isGappy: true, isSparse: true, isFresh: false, detail: "Initializing" });
  const [isReadyToTrade, setIsReadyToTrade] = useState(false);
  const lastRecordRef = useRef<number>(0);

  const onStatus = useMemo<ProviderStatusHandler>(() => {
    return (s) => {
      setProviderHealth((prev) => ({
        ...prev,
        [s.provider]: {
          key: s.provider,
          provider: s.provider,
          state: s.state,
          detail: s.detail,
          updatedAt: Date.now(),
        },
      }));
    };
  }, []);

  // Load history + subscribe live.
  // Long-session hardening: throttle tick → state writes to at most ~1/s and
  // COALESCE live updates into the current minute bucket. Previously we kept
  // only the last ~800 raw ticks; after a while that discarded the original
  // 1-minute history, leaving the model and chart with just a few minutes of
  // second-level prices. That is why the actual and forecast lines started to
  // look artificially linear during long sessions.
  useEffect(() => {
    let cancelled = false;
    setTicks([]);
    setCurrentPrice(0);

    const init = async () => {
      let hist: Tick[] = await fetchAssetHistory(coin, 240, { onStatus });
      if (cancelled) return;
      if (hist.length > 240) {
        const step = Math.ceil(hist.length / 240);
        hist = hist.filter((_, i) => i % step === 0);
      }
      setTicks(hist);
      if (hist.length) setCurrentPrice(hist[hist.length - 1].price);
    };

    init();

    let lastFlush = 0;
    let pending: Tick | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const historyCap = 720;
    const flush = () => {
      flushTimer = null;
      if (cancelled || !pending) return;
      const t = pending;
      pending = null;
      lastFlush = Date.now();
      setCurrentPrice(t.price);
      setTicks((prev) => {
         const last = prev[prev.length - 1];
         if (last) {
           const lastBucket = Math.floor(last.ts / 60000);
           const nextBucket = Math.floor(t.ts / 60000);
           if (lastBucket === nextBucket) {
             if (last.price === t.price && last.ts === t.ts) return prev;
             const next = prev.slice();
             next[next.length - 1] = { ...last, ts: t.ts, price: t.price };
             return next;
           }
         }
         const next = prev.length >= historyCap ? prev.slice(-(historyCap - 1)) : prev.slice();
         next.push(t);
         return next;
      });
    };

    const unsub = subscribeAsset(coin, (t) => {
      pending = t;
      const now = Date.now();
      const since = now - lastFlush;
      if (since >= 1000) {
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, 1000 - since);
      }
    }, { onStatus });

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      unsub?.();
    };
  }, [coin, onStatus]);

  useEffect(() => {
    let cancelled = false;
    const loadYahoo = async () => {
      if (!coin.yahooSymbol) {
        setYahooTrain([]);
        return;
      }
      const rows = await fetchYahooHistory({
        data: {
          symbol: coin.yahooSymbol,
          interval: "1m",
          range: "7d",
        },
      });
      if (cancelled) return;
      setYahooTrain(rows.map((r) => r.price).slice(-300));
      onStatus({ provider: "yfinance", state: rows.length > 0 ? "live" : "failing", detail: rows.length > 0 ? "history" : "empty" });
    };
    void loadYahoo();
    const id = setInterval(loadYahoo, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [coin.yahooSymbol, onStatus]);

  // Deep multi-year history (daily bars) used to train ARIMA/GARCH/HMM/neural
  // on long-horizon structure for the selected market/symbol.
  useEffect(() => {
    let cancelled = false;
    setDeepHistory([]);
    void fetchDeepHistory(coin).then((bars) => {
      if (cancelled) return;
      setDeepHistory(bars.map((b) => b.price));
      onStatus({
        provider: "deep-history",
        state: bars.length > 100 ? "live" : "failing",
        detail: `${bars.length} daily bars`,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [coin, onStatus]);

  useEffect(() => {
    let cancelled = false;
    setAdaptive(null);
    void loadWeights(coin.market, coin.id, timeframe.id).then((w) => {
      if (!cancelled) setAdaptive(w);
    });
    return () => {
      cancelled = true;
    };
  }, [coin.market, coin.id, timeframe.id]);

  // Build a strict 1-minute series for the model. One forecast step is one
  // minute, so we must keep input cadence on minutes too.
  const resampled = useMemo(() => {
    if (ticks.length === 0) return [] as number[];
    const buckets = new Map<number, number>();
    for (const t of ticks) {
      const bucket = Math.floor(t.ts / 60000);
      buckets.set(bucket, t.price);
    }
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    if (sorted.length === 0) return [] as number[];

    const minuteSeries: number[] = [];
    let cursor = sorted[0][0];
    const end = sorted[sorted.length - 1][0];
    let idx = 0;
    let lastPrice = sorted[0][1];

    while (cursor <= end) {
      while (idx < sorted.length && sorted[idx][0] <= cursor) {
        lastPrice = sorted[idx][1];
        idx++;
      }
      minuteSeries.push(lastPrice);
      cursor += 1;
    }

    return minuteSeries;
  }, [ticks]);

  // CRITICAL: the forecast series MUST be on a single, consistent time-scale
  // (one step = one minute) — that is the scale the chart plots against and
  // the scale `timeframe.minutes` represents. Mixing 5 years of DAILY bars
  // with live MINUTE ticks made ARIMA/GARCH calibrate σ and drift to daily
  // volatility (~hundreds of × the per-minute σ), which is why the predicted
  // line was diverging wildly from the actual line. Deep history is still
  // fetched and surfaced as a "training corpus" stat for transparency, but
  // it is no longer fed directly into the per-minute forecast model.
  const modelSeries = useMemo(() => {
    const live =
      coin.market === "crypto" || coin.market === "forex"
        ? resampled
        : yahooTrain.length >= 30
          ? [...yahooTrain.slice(-300), ...resampled.slice(-300)]
          : resampled;
    return live.slice(-500);
  }, [coin.market, resampled, yahooTrain]);

  useEffect(() => {
    let cancelled = false;
    const loadLlmSignal = async () => {
      if (!currentPrice || modelSeries.length < 10) return;
      const cached = peekDecayedSignal(coin.market, coin.id);
      if (cached && cached.confidence > 0.08) {
        if (!cancelled) setLlmSignal({ bias: cached.bias, confidence: cached.confidence, rationale: cached.rationale });
        return;
      }
      try {
        const recentReturnPct = ((modelSeries[modelSeries.length - 1] - modelSeries[Math.max(0, modelSeries.length - 6)]) / Math.max(1e-9, modelSeries[Math.max(0, modelSeries.length - 6)])) * 100;
        const news = await fetchCoinNews({ data: { symbol: coin.symbol.toUpperCase(), market: coin.market } });
        const titles = (news.items ?? []).slice(0, 8).map((item: any) => item.title).filter(Boolean);
        const llm = await getDecayedLlmSignal({
          market: coin.market,
          symbol: coin.id,
          spotPrice: currentPrice,
          recentReturnPct,
          newsTitles: titles,
        });
        if (!cancelled) setLlmSignal(llm);
      } catch {
        if (!cancelled) setLlmSignal({ bias: 0, confidence: 0, rationale: "" });
      }
    };
    void loadLlmSignal();
    const id = setInterval(loadLlmSignal, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [coin.market, coin.id, coin.symbol, currentPrice, modelSeries]);

  // Assess data quality from live ticks (pure compute — no setState here)
  const dataQualityMemo = useMemo(() => assessDataQuality(ticks), [ticks]);

  // Mirror it into state in an effect so children that read `dataQuality`
  // still get updates, without violating React's "no side effects in useMemo"
  // rule (which was triggering hydration mismatches on long sessions).
  useEffect(() => {
    setDataQuality(dataQualityMemo);
  }, [dataQualityMemo]);

  // Run hybrid prediction — gate on the NUMBER of distinct 1-minute buckets
  // (a stable integer) rather than on the modelSeries array reference, which
  // would change every throttled tick and re-fit GARCH/HMM/ARIMA needlessly.
  // Over a 5-hour session this prevents thousands of redundant heavy fits.
  const minuteBuckets = useMemo(() => {
    if (ticks.length === 0) return 0;
    const set = new Set<number>();
    for (const t of ticks) set.add(Math.floor(t.ts / 60000));
    return set.size;
  }, [ticks]);

  const latestModelPrice = modelSeries[modelSeries.length - 1] ?? 0;
  const latestModelDelta =
    modelSeries.length >= 2 ? latestModelPrice - modelSeries[modelSeries.length - 2] : 0;

  const prediction = useMemo(() => {
    if (modelSeries.length < 12) return null;
    const steps = Math.min(timeframe.minutes, 200);
    const pred = hybridPredict(modelSeries, steps, {
      adaptiveWeights: adaptive
        ? {
            arima: adaptive.arima,
            hmm: adaptive.hmm,
            entropy: adaptive.entropy,
            hurst: adaptive.hurst,
            neural: adaptive.neural,
          }
        : undefined,
      dataQualityScore: dataQualityMemo.score,
      market: coin.market,
      llmBias: llmSignal.bias,
      llmConfidence: llmSignal.confidence,
      deepDailyPrices: deepHistory,
    });
    return pred;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteBuckets, latestModelPrice, latestModelDelta, timeframe.id, adaptive, dataQualityMemo.score, coin.market, llmSignal.bias, llmSignal.confidence, deepHistory.length]);

  // Trading-readiness derived state — moved out of useMemo to fix SSR
  // hydration mismatch ("Model accuracy too low: X% vs 0.0%") and avoid
  // double-renders during long sessions.
  useEffect(() => {
    setIsReadyToTrade(isReadyForTrading(dataQualityMemo, stats.accuracy, stats.brier, adaptive?.samples ?? 0));
  }, [dataQualityMemo, stats.accuracy, stats.brier, adaptive?.samples]);

  // Record predictions periodically + resolve old ones (local + cloud learning)
  useEffect(() => {
    if (!prediction || currentPrice === 0) return;
    const now = Date.now();
    resolvePredictions(currentPrice, now);
    // Cloud-side resolution + adaptive weight update (fire and forget)
    void resolvePendingPredictions(coin.market, coin.id, timeframe.id, currentPrice);
    const interval = Math.max(30_000, (timeframe.minutes * 60 * 1000) / 4);
    if (now - lastRecordRef.current > interval) {
      lastRecordRef.current = now;
      // Only record predictions if data quality is acceptable (>0.4) and confidence is >0.36
      // This prevents training on noisy/sparse data that would hurt model learning
      if (dataQuality.score > 0.4 && prediction.hybridConfidence > 0.36) {
        recordPrediction({
          coinId: `${coin.market}:${coin.id}`,
          timeframeId: timeframe.id,
          startTs: now,
          resolveTs: now + timeframe.minutes * 60 * 1000,
          startPrice: currentPrice,
          predictedPrice: prediction.finalPrice,
          predictedDirection: prediction.direction,
          hybridConfidence: prediction.hybridConfidence,
        });
        // Persist to Lovable Cloud for the adaptive learning loop
        void recordPredictionCloud({
          market: coin.market,
          symbol: coin.id,
          timeframe: timeframe.id,
          spotPrice: currentPrice,
          predictedPrice: prediction.finalPrice,
          direction: prediction.direction,
          horizonSeconds: timeframe.minutes * 60,
          hybridConfidence: prediction.hybridConfidence,
          weights: prediction.weights,
          features: {
            market: coin.market,
          },
        });
        // Warm cache for adaptive weights (used by future hybrid runs)
        void loadWeights(coin.market, coin.id, timeframe.id).then(setAdaptive);
      }
    }
    setStats(computeAccuracy(`${coin.market}:${coin.id}`, timeframe.id));
  }, [prediction, currentPrice, coin.id, coin.market, timeframe, dataQuality.score]);

  const minutesPerStep = Math.max(1, timeframe.minutes / Math.min(timeframe.minutes, 200));
  const healthItems = useMemo(() => Object.values(providerHealth).sort((a, b) => a.provider.localeCompare(b.provider)), [providerHealth]);

  return (
    <div className="min-h-screen relative z-10">
      <DisclaimerModal />
      {/* Header */}
      <header className="border-b border-border backdrop-blur-md bg-background/70 sticky top-0 z-40">
        <div className="max-w-[1000px] mx-auto px-3 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <img src="/favicon.ico" alt="MIRO" className="w-9 h-9 rounded-full glow-primary object-cover border border-primary/40" />
            <div>
              <h1 className="font-display font-bold text-lg leading-none text-gradient-primary">
                MIRO
              </h1>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <CoinPicker value={coin} onChange={setCoin} />
            <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-md">
              <span className="live-dot" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {coin.market === "crypto"
                  ? coin.binanceSymbol
                    ? "Binance tick"
                    : "5s poll"
                  : "Yahoo (NSE/BSE)"}
              </span>
              <span className="font-mono font-bold text-foreground">
                {currentPrice > 0 ? `$${formatLive(currentPrice)}` : "—"}
              </span>
            </div>
          </div>
        </div>
        <div className="max-w-[1000px] mx-auto px-3 pb-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Predict horizon →
          </span>
          <TimeframePicker value={timeframe} onChange={setTimeframe} />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1000px] mx-auto px-3 py-4 space-y-2">
        <DisclaimerBanner />

        <TradingReadinessAlert
          isReady={isReadyToTrade}
          dataQualityScore={dataQuality.score}
          recentAccuracy={stats.accuracy}
          recentBrier={stats.brier}
          sampleCount={adaptive?.samples ?? 0}
        />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
          <div className="xl:col-span-2">
            <DataSourceInfo />
          </div>
          <ProviderHealthPanel items={healthItems} />
        </div>

        <section className="space-y-2">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display font-semibold text-foreground">Live forecast workspace</h2>
              <p className="text-[11px] text-muted-foreground">Forecast, execution bias, and market context in one place.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_280px] gap-2 items-start">
            <div className="panel scan-line min-w-0">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <h2 className="font-display font-semibold text-foreground">
                  {coin.name} <span className="text-muted-foreground">·</span>{" "}
                  <span className="text-primary">{timeframe.label} forecast</span>
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Hybrid path = ARIMA(2,1,1) + HMM regime drift + GARCH volatility, SSL-bounded
                </p>
              </div>
              {prediction && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Final {timeframe.label}
                  </div>
                  <div
                    className="text-xl font-display font-bold"
                    style={{
                      color:
                        prediction.direction === "up"
                          ? "var(--bull)"
                          : prediction.direction === "down"
                            ? "var(--bear)"
                            : "var(--foreground)",
                    }}
                  >
                    ${formatLive(prediction.finalPrice)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Δ {((prediction.finalPrice - currentPrice) / currentPrice * 100).toFixed(2)}%
                  </div>
                </div>
              )}
            </div>
              {prediction && currentPrice > 0 ? (
                <PredictionChart
                  history={ticks.slice(-240).map((t) => ({ ts: t.ts, price: t.price }))}
                  prediction={prediction}
                  currentPrice={currentPrice}
                  minutesPerStep={minutesPerStep}
                />
              ) : (
                <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm">
                  <div className="text-center">
                    <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                    <div>Streaming ticks & fitting models…</div>
                  </div>
                </div>
              )}
              <ChartLegend />
            </div>

            <div className="sidebar-stack min-w-0">
              <div className="panel panel--compact controls-sticky">
                <div className="flex flex-col gap-2">
                  <CoinPicker value={coin} onChange={setCoin} />
                  <TimeframePicker value={timeframe} onChange={setTimeframe} />
                </div>
              </div>
              <div className="panel">
                <h3 className="font-display font-semibold text-foreground mb-4">
                  <span className="text-primary">Strategic Plan</span> · Hybrid + technical decision layer
                </h3>
                {prediction && currentPrice > 0 ? (
                  <StrategicPlanPanel
                    prediction={prediction}
                    currentPrice={currentPrice}
                    recentPrices={modelSeries}
                    dataQualityScore={dataQuality.score}
                    llmSignal={llmSignal}
                  />
                ) : (
                  <div className="text-sm text-muted-foreground">Strategic recommendation appears once the first forecast is ready.</div>
                )}
              </div>

              {prediction ? (
                <div className="panel">
                  <AccuracyTracker
                    stats={stats}
                    currentDirection={prediction.direction}
                    confidence={prediction.hybridConfidence}
                  />
                </div>
              ) : (
                <div className="panel text-sm text-muted-foreground">Awaiting first prediction…</div>
              )}

              <div className="panel panel--compact bg-card/50">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  News & Sentiment
                </h3>
                <div className="text-[10px] text-muted-foreground leading-relaxed">
                  {llmSignal.rationale ? (
                    <div>
                      <div className="text-foreground font-semibold mb-1">{llmSignal.rationale}</div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-border rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${llmSignal.confidence * 100}%` }}
                          />
                        </div>
                        <span className="font-semibold">{(llmSignal.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ) : (
                    "Loading sentiment analysis…"
                  )}
                </div>
              </div>

              <div className="panel panel--compact bg-card/40 text-[10px] text-muted-foreground">
                <div className="uppercase tracking-wider font-semibold text-foreground mb-1">Training corpus</div>
                {deepHistory.length > 0
                  ? `${deepHistory.length} daily bars feeding deep-history drift bias for ${coin.market.toUpperCase()} · ${coin.symbol}`
                  : "Loading multi-year history…"}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <div>
            <h2 className="font-display font-semibold text-foreground">Technical structure</h2>
            <p className="text-[11px] text-muted-foreground">Overlay indicators and concise metrics aligned with the hybrid forecast.</p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-2 items-start">
            <div className="min-w-0">
              <IndicatorOverlayPanel history={ticks.map((t) => ({ ts: t.ts, price: t.price }))} prediction={prediction} />
            </div>

            <div className="sidebar-stack min-w-0">
              {prediction ? (
                <TechnicalIndicatorMetrics
                  prediction={prediction}
                  currentPrice={currentPrice}
                  recentPrices={modelSeries}
                />
              ) : (
                <div className="panel text-sm text-muted-foreground">Technical metrics will appear after the first forecast.</div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <div>
            <h2 className="font-display font-semibold text-foreground">Validation & training</h2>
            <p className="text-[11px] text-muted-foreground">Adaptive learning, calibration, and walk-forward validation for the selected market.</p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-2 items-start">
            <div className="space-y-3 min-w-0">
              <TrainerPanel market={coin.market} symbol={coin.id} timeframe={timeframe.id} />
              <CalibrationPanel coin={coin} timeframe={timeframe} />
            </div>
            <div className="sidebar-stack min-w-0">
              <WalkForwardPanel coin={coin} />
              <DeepHistoryBacktestPanel coin={coin} />
              <PerformanceTable />
            </div>
          </div>
        </section>

        {prediction && (
          <section className="space-y-2">
            <div>
              <h2 className="font-display font-semibold text-foreground">Model diagnostics</h2>
              <p className="text-[11px] text-muted-foreground">Detailed physics and statistical internals behind the active forecast.</p>
            </div>
            <ModelPanels result={prediction} currentPrice={currentPrice} minutes={timeframe.minutes} />
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display font-semibold text-foreground">Paper trading sandbox</h2>
              <p className="text-[11px] text-muted-foreground">Optional execution simulator placed below the core analysis workflow.</p>
            </div>
          </div>
          <DemoTrading coin={coin} currentPrice={currentPrice} prediction={prediction} recentPrices={modelSeries} />
        </section>

        <div className="panel text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Model note:</strong> ARIMA(2,1,1) provides the stochastic forecast path,
          HMM adds regime bias, entropy and Hurst regulate trust, GARCH defines the volatility cone,
          the neural layer refines next-return bias, and the SSL master-equation bound caps regime-driven excursions.
        </div>

        <DisclaimerFooter />
      </main>
    </div>
  );
}

function ChartLegend() {
  const items = [
    { c: "var(--foreground)", l: "Actual" },
    { c: "var(--bear)", l: "Hybrid forecast" },
    { c: "var(--garch)", l: "GARCH 1σ" },
    { c: "var(--ssl)", l: "SSL 95% bound" },
  ];
  return (
    <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-muted-foreground">
      {items.map((i) => (
        <div key={i.l} className="flex items-center gap-1.5">
          <span className="w-3 h-0.5" style={{ background: i.c }} />
          {i.l}
        </div>
      ))}
    </div>
  );
}

function formatLive(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(3);
  if (v >= 0.01) return v.toFixed(5);
  return v.toExponential(3);
}
