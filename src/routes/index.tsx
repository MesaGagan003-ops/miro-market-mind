import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoinPicker } from "@/components/CoinPicker";
import { TimeframePicker } from "@/components/TimeframePicker";
import { PredictionChart } from "@/components/PredictionChart";
import { ModelPanels, type RegimeHistoryEntry } from "@/components/ModelPanels";
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
import { DisclaimerModal, DisclaimerBanner, DisclaimerFooter } from "@/components/Disclaimer";
import { TradingReadinessAlert } from "@/components/TradingReadinessAlert";
import { IndicatorOverlayPanel } from "@/components/IndicatorOverlayPanel";
import { fetchCoinNews } from "@/lib/news";
import { getDecayedLlmSignal, peekDecayedSignal } from "@/lib/llmCache";
import { StrategicPlanPanel } from "@/components/StrategicPlanPanel";
import { TechnicalIndicatorMetrics } from "@/components/TechnicalIndicatorMetrics";
import { PredictionHistoryPanel } from "@/components/PredictionHistoryPanel";

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
  const [stats, setStats] = useState<AccuracyStats>({
    total: 0,
    resolved: 0,
    correct: 0,
    rate: 0,
    accuracy: 0,
    brier: 0.25,
    lastN: [],
  });

  useEffect(() => {
    setStats(computeAccuracy(`${coin.market}:${coin.id}`, timeframe.id));
  }, [coin.market, coin.id, timeframe.id]);
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealthItem>>({});
  const [yahooTrain, setYahooTrain] = useState<number[]>([]);
  const [deepHistory, setDeepHistory] = useState<number[]>([]);
  const [adaptive, setAdaptive] = useState<AdaptiveWeights | null>(null);
  const [llmSignal, setLlmSignal] = useState<{
    bias: number;
    confidence: number;
    rationale: string;
  }>({ bias: 0, confidence: 0, rationale: "" });
  const [dataQuality, setDataQuality] = useState<DataQualityScore>({
    score: 0,
    isGappy: true,
    isSparse: true,
    isFresh: false,
    detail: "Initializing",
  });
  const [isReadyToTrade, setIsReadyToTrade] = useState(false);
  const [regimeHistory, setRegimeHistory] = useState<RegimeHistoryEntry[]>([]);
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

    const unsub = subscribeAsset(
      coin,
      (t) => {
        pending = t;
        const now = Date.now();
        const since = now - lastFlush;
        if (since >= 1000) {
          flush();
        } else if (!flushTimer) {
          flushTimer = setTimeout(flush, 1000 - since);
        }
      },
      { onStatus },
    );

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
      onStatus({
        provider: "yfinance",
        state: rows.length > 0 ? "live" : "failing",
        detail: rows.length > 0 ? "history" : "empty",
      });
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
        if (!cancelled)
          setLlmSignal({
            bias: cached.bias,
            confidence: cached.confidence,
            rationale: cached.rationale,
          });
        return;
      }
      try {
        const recentReturnPct =
          ((modelSeries[modelSeries.length - 1] -
            modelSeries[Math.max(0, modelSeries.length - 6)]) /
            Math.max(1e-9, modelSeries[Math.max(0, modelSeries.length - 6)])) *
          100;
        const news = await fetchCoinNews({
          data: { symbol: coin.symbol.toUpperCase(), market: coin.market },
        });
        const titles = (news.items ?? [])
          .slice(0, 8)
          .map((item: { title?: string }) => item.title)
          .filter((title): title is string => Boolean(title));
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

  useEffect(() => {
    setRegimeHistory([]);
  }, [coin.market, coin.id, timeframe.id]);

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

  const [prediction, setPrediction] = useState<any | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastReqRef = useRef<string | null>(null);

  const lastResolveRef = useRef<number>(0);

  // Create worker on mount
  useEffect(() => {
    try {
      // Relative path from this module to the worker file
      // @ts-ignore
      const w = new Worker(new URL("../lib/physics/hybrid.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = w;
      const handler = (ev: MessageEvent) => {
        const { id, result, error } = ev.data as any;
        if (!id || id !== lastReqRef.current) return;
        if (error) {
          console.error("hybrid worker error:", error);
          return;
        }
        // Debug log the raw worker payload for diagnosis
        // eslint-disable-next-line no-console
        console.debug("hybrid-worker payload:", result);

        // Normalize payload to ensure UI consumers don't read undefined
        const normalized = {
          forecast: result?.forecast ?? [],
          finalPrice: result?.finalPrice ?? 0,
          direction: result?.direction ?? "flat",
          currentSignal: result?.currentSignal ?? "hold",
          futureSignal: result?.futureSignal ?? "hold",
          hybridConfidence: result?.hybridConfidence ?? 0.6,
          weights: result?.weights ?? {},
          garch: {
            sigma: result?.garch?.sigma ?? 0,
            sigmaReturn: result?.garch?.sigmaReturn ?? 0,
          },
          kalman: { snr: result?.kalman?.snr ?? 0, velocity: result?.kalman?.velocity ?? 0 },
          jump: {
            lambda: result?.jump?.lambda ?? 0,
            jumpFraction: result?.jump?.jumpFraction ?? 0,
            pUp: result?.jump?.pUp ?? 0,
            recentJump: result?.jump?.recentJump ?? null,
          },
          hawkes: {
            branching: result?.hawkes?.branching ?? 0,
            currentIntensity: result?.hawkes?.currentIntensity ?? 0,
            cascadeProbability: result?.hawkes?.cascadeProbability ?? 0,
            isClusterRegime: result?.hawkes?.isClusterRegime ?? false,
          },
          wavelet: { dominantScale: result?.wavelet?.dominantScale ?? 0, trendSlope: result?.wavelet?.trendSlope ?? 0 },
          transferEntropy: { selfTE: result?.transferEntropy?.selfTE ?? 0, crossTE: result?.transferEntropy?.crossTE ?? 0 },
          multifractal: { width: result?.multifractal?.width ?? 0, regimeShiftRisk: result?.multifractal?.regimeShiftRisk ?? "low" },
          fokkerPlanck: { mean: result?.fokkerPlanck?.mean ?? 0, bands: result?.fokkerPlanck?.bands ?? [] },
          indicators: { bias: result?.indicators?.bias ?? 0 },
          entropy: { H: result?.entropy?.H ?? 0, edge: result?.entropy?.edge ?? 0, upRatio: result?.entropy?.upRatio ?? 0 },
          arima: {
            c: result?.arima?.c ?? 0,
            phi: result?.arima?.phi ?? 0,
            phi2: result?.arima?.phi2 ?? 0,
            theta: result?.arima?.theta ?? 0,
            driftPerStep: result?.arima?.driftPerStep ?? 0,
            residualStd: result?.arima?.residualStd ?? 0,
          },
          hamiltonian: { H: result?.hamiltonian?.H ?? 0, KE: result?.hamiltonian?.KE ?? 0, PE: result?.hamiltonian?.PE ?? 0, velocity: result?.hamiltonian?.velocity ?? 0 },
          hmm: {
            dominantState: result?.hmm?.dominantState ?? 1,
            stateProbs: result?.hmm?.stateProbs ?? [0.33, 0.34, 0.33],
            transitionMatrix: result?.hmm?.transitionMatrix ?? [[0.7,0.2,0.1],[0.2,0.6,0.2],[0.1,0.2,0.7]],
            emIterations: result?.hmm?.emIterations ?? 0,
            logLik: result?.hmm?.logLik ?? 0,
            viterbiSamples: result?.hmm?.viterbiSamples ?? 0,
          },
        } as any;

        setPrediction(normalized);
      };
      w.addEventListener("message", handler);
      return () => {
        w.removeEventListener("message", handler);
        w.terminate();
        workerRef.current = null;
      };
    } catch (e) {
      // Worker creation failed (older browsers or dev environment) — fall back
      workerRef.current = null;
    }
  }, []);

  // Compute prediction asynchronously via worker (or fallback to sync)
  useEffect(() => {
    let cancelled = false;
    if (modelSeries.length < 12) {
      setPrediction(null);
      return;
    }
    const steps = Math.min(timeframe.minutes, 200);

    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    lastReqRef.current = reqId;

    const options = {
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
    };

    const w = workerRef.current;
    if (w) {
      try {
        w.postMessage({ id: reqId, prices: modelSeries, steps, options });
      } catch (e) {
        // If worker posting fails, fallback to sync compute
        try {
          const res = hybridPredict(modelSeries, steps, options as any);
          if (!cancelled) setPrediction(res);
        } catch (err) {
          console.error("hybridPredict fallback error", err);
        }
      }
    } else {
      // No worker available: compute synchronously but schedule briefly to keep UI responsive
      const t = setTimeout(() => {
        try {
          const res = hybridPredict(modelSeries, steps, options as any);
          if (!cancelled) setPrediction(res);
        } catch (err) {
          console.error("hybridPredict error", err);
        }
      }, 50);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    minuteBuckets,
    timeframe.id,
    adaptive,
    dataQualityMemo.score,
    coin.market,
    llmSignal.bias,
    llmSignal.confidence,
    deepHistory.length,
    // explicitly ignoring modelSeries so it doesn't trigger on every tick,
    // minuteBuckets is the stable trigger for a new minute.
  ]);

  // Trading-readiness derived state — moved out of useMemo to fix SSR
  // hydration mismatch ("Model accuracy too low: X% vs 0.0%") and avoid
  // double-renders during long sessions.
  useEffect(() => {
    setIsReadyToTrade(
      isReadyForTrading(dataQualityMemo, stats.accuracy, stats.brier, adaptive?.samples ?? 0),
    );
  }, [dataQualityMemo, stats.accuracy, stats.brier, adaptive?.samples]);

  // Record predictions periodically + resolve old ones (local + cloud learning)
  useEffect(() => {
    if (!prediction || currentPrice === 0) return;
    const now = Date.now();
    resolvePredictions(currentPrice, now);
    
    // Cloud-side resolution + adaptive weight update (fire and forget)
    // Throttle to avoid 409 and ERR_INSUFFICIENT_RESOURCES from repeating every tick
    if (now - lastResolveRef.current > 15_000) {
      lastResolveRef.current = now;
      void resolvePendingPredictions(coin.market, coin.id, timeframe.id, currentPrice);
    }
    
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

  useEffect(() => {
    if (!prediction) return;
    const observedAt = ticks[ticks.length - 1]?.ts ?? Date.now();
    const currentState = prediction.hmm.dominantState;

    setRegimeHistory((prev) => {
      if (prev.length === 0) {
        return [{ state: currentState, startedAt: observedAt }];
      }

      const last = prev[prev.length - 1];
      if (last.state === currentState) return prev;

      return [...prev.slice(-11), { state: currentState, startedAt: observedAt }];
    });
  }, [prediction, ticks]);

  const minutesPerStep = Math.max(1, timeframe.minutes / Math.min(timeframe.minutes, 200));
  const healthItems = useMemo(
    () => Object.values(providerHealth).sort((a, b) => a.provider.localeCompare(b.provider)),
    [providerHealth],
  );

  return (
    <div className="min-h-screen relative z-10">
      <DisclaimerModal />
      <header className="border-b border-border backdrop-blur-md bg-background/70 sticky top-0 z-40">
        <div className="container py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <img
              src="/favicon.ico"
              alt="MIRO"
              className="w-9 h-9 rounded-full glow-primary object-cover border border-primary/40"
            />
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
        <div className="container pb-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Predict horizon →
          </span>
          <TimeframePicker value={timeframe} onChange={setTimeframe} />
        </div>
      </header>

      <main className="container py-4 space-y-4 lg:space-y-5">
        <DisclaimerBanner />

        <TradingReadinessAlert
          isReady={isReadyToTrade}
          dataQualityScore={dataQuality.score}
          recentAccuracy={stats.accuracy}
          recentBrier={stats.brier}
          sampleCount={adaptive?.samples ?? 0}
        />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="xl:col-span-2">
            <DataSourceInfo />
          </div>
          <ProviderHealthPanel items={healthItems} />
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="font-display font-semibold text-foreground">Market Workspace</h2>
            <p className="text-[11px] text-muted-foreground">
              A clean, ordered layout for the live market view and supporting analysis panels.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <div className="xl:col-span-2 panel scan-line min-w-0">
              <DashboardCardHeader
                title={`${coin.name} · ${timeframe.label} forecast`}
                description="Live price feed and forecast chart"
                action={
                  prediction ? (
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
                        Δ{" "}
                        {currentPrice > 0
                          ? (((prediction.finalPrice - currentPrice) / currentPrice) * 100).toFixed(
                              2,
                            )
                          : "0.00"}
                        %
                      </div>
                    </div>
                  ) : null
                }
              />
              {/* Duplicate live-source badge removed (already shown in header) */}
              {prediction && currentPrice > 0 ? (
                <PredictionChart
                  history={ticks.slice(-240).map((t) => ({ ts: t.ts, price: t.price }))}
                  prediction={prediction}
                  currentPrice={currentPrice}
                  minutesPerStep={minutesPerStep}
                />
              ) : (
                <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm rounded border border-border/60 bg-card/20">
                  <div className="text-center">
                    <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                    <div>Streaming ticks &amp; fitting models…</div>
                  </div>
                </div>
              )}
              <ChartLegend />
            </div>

            <div className="panel min-w-0">
              <DashboardCardHeader
                title="Strategic Plan & News Sentiment"
                description="Decision layer, context, and confidence"
              />
              <div className="space-y-4">
                {prediction && currentPrice > 0 ? (
                  <StrategicPlanPanel
                    prediction={prediction}
                    currentPrice={currentPrice}
                    recentPrices={modelSeries}
                    dataQualityScore={dataQuality.score}
                    llmSignal={llmSignal}
                  />
                ) : (
                  <div className="text-sm text-muted-foreground rounded border border-border/60 bg-card/20 p-3">
                    Strategic recommendation appears once the first forecast is ready.
                  </div>
                )}

                {prediction ? (
                  <AccuracyTracker
                    stats={stats}
                    currentDirection={prediction.direction}
                    confidence={prediction.hybridConfidence}
                  />
                ) : (
                  <div className="text-sm text-muted-foreground rounded border border-border/60 bg-card/20 p-3">
                    Awaiting first prediction…
                  </div>
                )}

                <div className="rounded border border-border/60 bg-card/20 p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    News Sentiment
                  </h3>
                  <div className="text-[11px] leading-relaxed text-muted-foreground">
                    {llmSignal.rationale ? (
                      <div>
                        <div className="mb-2 font-semibold text-foreground">
                          {llmSignal.rationale}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${llmSignal.confidence * 100}%` }}
                            />
                          </div>
                          <span className="font-semibold text-foreground">
                            {(llmSignal.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ) : (
                      "Loading sentiment analysis…"
                    )}
                  </div>
                </div>

                <div className="rounded border border-border/60 bg-card/20 p-3 text-[11px] text-muted-foreground">
                  <div className="mb-1 uppercase tracking-wider font-semibold text-foreground">
                    Training corpus
                  </div>
                  {deepHistory.length > 0
                    ? `${deepHistory.length} daily bars feeding deep-history drift bias for ${coin.market.toUpperCase()} · ${coin.symbol}`
                    : "Loading multi-year history…"}
                </div>
              </div>
            </div>

            <div className="panel min-w-0">
              <DashboardCardHeader
                title="Technical Indicators"
                description="Overlay and metric summary"
              />
              {prediction ? (
                <div className="space-y-4">
                  <IndicatorOverlayPanel
                    history={ticks.map((t) => ({ ts: t.ts, price: t.price }))}
                    prediction={prediction}
                  />
                  <TechnicalIndicatorMetrics
                    prediction={prediction}
                    currentPrice={currentPrice}
                    recentPrices={modelSeries}
                  />
                </div>
              ) : (
                <div className="rounded border border-border/60 bg-card/20 p-3 text-sm text-muted-foreground">
                  Technical metrics will appear after the first forecast.
                </div>
              )}
            </div>

            <div className="xl:col-span-2 panel min-w-0">
              <DashboardCardHeader
                title="Validation / Backtest Panels"
                description="Adaptive learning, calibration, and historical validation"
              />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <div className="space-y-4 min-w-0">
                  <TrainerPanel market={coin.market} symbol={coin.id} timeframe={timeframe.id} />
                  <CalibrationPanel coin={coin} timeframe={timeframe} />
                </div>
                <div className="space-y-4 min-w-0">
                  <WalkForwardPanel coin={coin} />
                  <DeepHistoryBacktestPanel coin={coin} />
                </div>
              </div>
            </div>

            {prediction && (
              <div className="xl:col-span-2 panel min-w-0">
                <DashboardCardHeader
                  title="Model Diagnostics"
                  description="Detailed physics and statistical internals behind the active forecast"
                />
                <ModelPanels
                  result={prediction}
                  currentPrice={currentPrice}
                  minutes={timeframe.minutes}
                  regimeHistory={regimeHistory}
                />
              </div>
            )}

            <div className="xl:col-span-2 panel min-w-0">
              <DashboardCardHeader
                title="Paper Trading Sandbox"
                description="Optional execution simulator placed below the core analysis workflow"
              />
              <DemoTrading
                coin={coin}
                currentPrice={currentPrice}
                prediction={prediction}
                recentPrices={modelSeries}
              />
            </div>

            <div className="xl:col-span-2 min-w-0">
              <PredictionHistoryPanel />
            </div>
          </div>
        </section>

        <div className="panel text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Model note:</strong> ARIMA(2,1,1) provides the
          stochastic forecast path, HMM adds regime bias, entropy and Hurst regulate trust, GARCH
          defines the volatility cone, the neural layer refines next-return bias, and the SSL
          master-equation bound caps regime-driven excursions.
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

function DashboardCardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-border/60 pb-3">
      <div>
        <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function formatLive(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(3);
  if (v >= 0.01) return v.toFixed(5);
  return v.toExponential(3);
}
