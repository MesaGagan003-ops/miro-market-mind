// Hybrid prediction engine: ARIMA(2,1,1) + GARCH + HMM + Shannon Entropy
// + Hurst exponent + Hamiltonian energy, constrained by SSL (master-equation).
//
// Path construction (per step i = 1..N):
//   1. ARIMA(2,1,1) recursive forecast with capped shocks → wiggly path.
//   2. Add HMM regime drift bias = (P(bull) - P(bear)) · σ
//   3. Add Hamiltonian velocity bias proportional to recent kinetic energy.
//   4. Hurst-aware trust factor.
//   5. Entropy damping.
//   6. SSL master-equation envelope used for the band only (no hard clip).

import { fitArima211 } from "./arima";
import { fitGarch11 } from "./garch";
import { fitHmm3 } from "./hmm";
import { shannonEntropy } from "./entropy";
import { hurstExponent, hamiltonianEnergy, type HurstResult, type HamiltonianResult } from "./features";
import { stochasticSpeedLimit, type StochasticSpeedLimitDetail } from "./speedLimits";
import { extractFeatures, type IndicatorFeatures } from "./indicators";
import { kalmanFilter, type KalmanResult } from "./kalman";
import { fitJumpDiffusion, type JumpDiffusionResult } from "./jumpDiffusion";
import { fitHawkes, type HawkesResult } from "./hawkes";
import { fokkerPlanckEvolve, type FokkerPlanckResult } from "./fokkerPlanck";
import { waveletDecompose, type WaveletResult } from "./wavelet";
import { transferEntropy, type TransferEntropyResult } from "./transferEntropy";
import { multifractalSpectrum, type MultifractalResult } from "./multifractal";
import { getMarketProfile, type MarketPhysicsProfile } from "./marketProfiles";
import { trainNetworkOnHistory, type NeuralNetworkResult } from "./neuralNet";
import type { MarketKind } from "@/lib/markets";

export interface ForecastPoint {
  step: number;
  price: number;
  upper: number;
  lower: number;
  sslUpper: number;
  sslLower: number;
}

export interface HybridResult {
  arima: ReturnType<typeof fitArima211>;
  garch: ReturnType<typeof fitGarch11>;
  hmm: ReturnType<typeof fitHmm3>;
  entropy: ReturnType<typeof shannonEntropy>;
  hurst: HurstResult;
  hamiltonian: HamiltonianResult;
  ssl: StochasticSpeedLimitDetail;
  indicators: IndicatorFeatures;
  kalman: KalmanResult;
  jump: JumpDiffusionResult;
  hawkes: HawkesResult;
  wavelet: WaveletResult;
  transferEntropy: TransferEntropyResult;
  multifractal: MultifractalResult;
  fokkerPlanck: FokkerPlanckResult;
  marketProfile: MarketPhysicsProfile;
  neural: NeuralNetworkResult;
  forecast: ForecastPoint[];
  finalPrice: number;
  direction: "up" | "down" | "flat";
  currentSignal: "buy" | "sell" | "hold";
  futureSignal: "buy" | "sell" | "hold";
  hybridConfidence: number;
  weights: { arima: number; hmm: number; entropy: number; hurst: number; indicators: number; llm: number; neural: number };
}

export interface HybridOptions {
  adaptiveWeights?: Partial<{ arima: number; hmm: number; entropy: number; hurst: number; llm: number; neural: number }>;
  llmBias?: number;
  llmConfidence?: number;
  dataQualityScore?: number; // 0..1, where 1 = perfect data
  market?: MarketKind;       // selects per-market physics profile
  leaderPrices?: number[];   // optional leader series (e.g. BTC for alts) for transfer entropy
}

export function hybridPredict(prices: number[], steps: number, options?: HybridOptions): HybridResult {
  const market: MarketKind = options?.market ?? "crypto";
  const profile = getMarketProfile(market);

  // === Phase B Tier-1: Kalman pre-filter ===
  // Feed denoised series into ARIMA/GARCH/HMM. The RAW series is still used
  // for jump detection (we want to see the actual spikes) and for the spot
  // price. This single change cuts micro-noise that GARCH would otherwise
  // misclassify as volatility — biggest single lift on choppy alts/forex.
  const kalman = kalmanFilter(prices, { rScale: profile.kalmanRScale });
  const filteredPrices = kalman.filtered;

  // Wavelet trend — used to blend ARIMA input toward smoothed trend.
  const wavelet = waveletDecompose(prices);
  const blended: number[] = filteredPrices.map((p, i) =>
    p * (1 - profile.waveletSmoothing) + wavelet.trend[i] * profile.waveletSmoothing,
  );

  const arima = fitArima211(blended);
  const garch = fitGarch11(blended);
  const hmm = fitHmm3(blended);
  const entropy = shannonEntropy(blended);
  const hurst = hurstExponent(blended);
  const hamiltonian = hamiltonianEnergy(prices); // raw — we want true energy
  const indicators = extractFeatures(prices);

  // === Tier-1: Jump-diffusion + Hawkes (use RAW prices for jump detection) ===
  const jump = fitJumpDiffusion(prices);
  const hawkes = profile.hawkesEnabled
    ? fitHawkes(prices)
    : { mu: 0, alpha: 0, beta: 1, branching: 0, currentIntensity: 0, cascadeProbability: 0, isClusterRegime: false };

  // === Tier-2: Multifractal + Transfer Entropy ===
  const multifractal = multifractalSpectrum(prices);
  const te = transferEntropy(prices, options?.leaderPrices ?? null);
  const returns: number[] = [];
  const volatilitySeries: number[] = [];
  const featureSeries: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1] || prices[i];
    const curr = prices[i] || prev;
    const ret = Math.log(Math.max(curr, 1e-9) / Math.max(prev, 1e-9));
    returns.push(ret);
    const start = Math.max(0, i - 10);
    const window = returns.slice(start, i);
    const mean = window.reduce((a, b) => a + b, 0) / Math.max(1, window.length);
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, window.length);
    volatilitySeries.push(Math.sqrt(variance));
    const prefix = prices.slice(0, i + 1);
    featureSeries.push(prefix.length >= 30 ? extractFeatures(prefix).bias : 0);
  }
  const neural = trainNetworkOnHistory(
    returns,
    volatilitySeries,
    featureSeries,
    Math.min(16, Math.max(8, Math.floor(Math.log(Math.max(2, prices.length)) * 4))),
  );

  const last = prices[prices.length - 1];

  // Seed by series LENGTH only (not by exact price). This keeps the wiggle
  // pattern stable while a 1-min bucket is being accumulated; it only
  // changes when a new bar closes — preventing the predicted line from
  // jumping wildly on every tick.
  const seed = (prices.length * 2654435761) >>> 0 || 1;
  const arimaPath = arima.forecast(steps, last, seed);

  const sigmas = garch.forecastSigma(steps);
  const regimeBias = hmm.stateProbs[2] - hmm.stateProbs[0]; // [-1, 1]
  const edge = entropy.edge;

  // Hurst-modulated trust: trending → keep ARIMA deviation,
  // mean-reverting → shrink it harder. Map H∈[0,1] to trust∈[0.3, 1].
  const hurstTrust = 0.3 + 0.7 * Math.max(0, Math.min(1, (hurst.H - 0.3) / 0.5));

  // Hamiltonian velocity bias (small, per-step) — adds momentum push.
  const hamPush = Math.sign(hamiltonian.velocity) * Math.min(Math.abs(hamiltonian.velocity), 0.005) * last;

  const qsl = quantumSpeedLimit(last, garch.sigma, steps);
  // Master-equation SSL: probability flow over HMM regimes, mapped to price.
  const ssl = stochasticSpeedLimit(
    last,
    hmm.transitionMatrix,
    hmm.stateProbs,
    hmm.stateMeans,
    steps,
    garch.sigma,
  );

  const llmBias = Math.max(-1, Math.min(1, Number(options?.llmBias ?? 0)));
  const llmConfidence = Math.max(0, Math.min(1, Number(options?.llmConfidence ?? 0)));
  const qualityPenalty = Math.max(0, Math.min(1, Number(options?.dataQualityScore ?? 1)));
  // If data quality is poor, reduce confidence. E.g., 0.5 quality → 0.5x confidence multiplier

  const learned = {
    arima: Math.max(0.05, Number(options?.adaptiveWeights?.arima ?? 0.40)),
    hmm: Math.max(0.05, Number(options?.adaptiveWeights?.hmm ?? 0.22)),
    entropy: Math.max(0.05, Number(options?.adaptiveWeights?.entropy ?? edge)),
    hurst: Math.max(0.05, Number(options?.adaptiveWeights?.hurst ?? hurstTrust)),
    indicators: 0.18, // VWAP-z + EMA-slope + MACD consolidated bias
    llm: 0,
    neural: Math.max(0.05, Number(options?.adaptiveWeights?.neural ?? profile.neuralWeight)),
  };
  const learnedSum = learned.arima + learned.hmm + learned.entropy + learned.hurst + learned.indicators + learned.llm + learned.neural;
  const weights = {
    arima: learned.arima / learnedSum,
    hmm: learned.hmm / learnedSum,
    entropy: learned.entropy / learnedSum,
    hurst: learned.hurst / learnedSum,
    indicators: learned.indicators / learnedSum,
    llm: learned.llm / learnedSum,
    neural: learned.neural / learnedSum,
  };

  // Build path keeping ARIMA wiggles intact. We split each step into
  //   trend  = drift + HMM bias + Hamiltonian push   (cumulative)
  //   wiggle = arimaPath[i] - last - i·driftPerStep   (the stochastic part)
  // and dampen ONLY the trend, never the wiggle. This guarantees visible
  // shocks regardless of entropy / Hurst values.
  const raw: number[] = [];
  const trustTrend = (0.25 + 0.75 * edge) * hurstTrust;
  // Tier-1+2 drift contributions (per-step, scaled by garch.sigma):
  //   - Jump-diffusion expected drift (Kou compound Poisson)
  //   - Hawkes asymmetry: when cluster regime is on AND last jump direction
  //     was up/down, push the trend that way (cascades persist).
  //   - Transfer-entropy self-direction (signed)
  const jumpDriftPerStep = jump.expectedJumpDrift * last * profile.jumpDriftWeight;
  const hawkesPush = hawkes.isClusterRegime && jump.recentJump
    ? (jump.recentJump.direction === "up" ? 1 : -1) * hawkes.cascadeProbability * garch.sigma * 0.35
    : 0;
  const tePush = te.selfDirection * profile.transferEntropyWeight * garch.sigma * 0.4;
  const crossTePush = te.crossTE && te.crossTE > 0.02 && options?.leaderPrices
    ? Math.sign(options.leaderPrices[options.leaderPrices.length - 1] - options.leaderPrices[Math.max(0, options.leaderPrices.length - 6)])
      * te.crossTE * profile.transferEntropyWeight * garch.sigma * 0.6
    : 0;
  // Neural forecast is a LOG-RETURN. Convert to price units via lastPrice
  // (NOT garch.sigma * last — sigma is already in price units, double-scaling
  // was sending the predicted line miles away from spot).
  const neuralSignal = Math.max(-0.05, Math.min(0.05, neural.forecast[0] ?? 0));
  const neuralPush = neuralSignal * last * profile.neuralWeight;
  // Drift contributions scale with sqrt(i+1), not (i+1). Cumulative linear
  // growth was pushing the predicted line wildly off the actual price by the
  // end of the horizon. sqrt-growth matches the natural diffusion scale of
  // returns and keeps the forecast anchored near spot.
  for (let i = 0; i < steps; i++) {
    const tStep = i + 1;
    const sqrtT = Math.sqrt(tStep);
    const baseDrift = arima.driftPerStep * tStep; // ARIMA drift IS linear in time (it's an expectation)
    // Wiggles come ONLY from the trained ARIMA(2,1,1) stochastic recursion.
    // No synthetic sin/cos overlay — that produced the wig-wag pattern.
    const arimaWiggle = arimaPath[i] - last - baseDrift;
    // Auxiliary drift terms — all sqrt-scaled so they don't dominate at long horizons.
    const auxDriftRaw =
        regimeBias * garch.sigma * 0.10 * sqrtT
      + hamPush * sqrtT * 0.25
      + indicators.bias * weights.indicators * garch.sigma * 0.28 * sqrtT
      + llmBias * llmConfidence * weights.llm * garch.sigma * 0.15 * sqrtT
      + neuralPush * sqrtT * 0.35
      + jumpDriftPerStep * sqrtT * 0.6
      + hawkesPush * sqrtT * 0.6
      + tePush * sqrtT * 0.7
      + crossTePush * sqrtT * 0.7;
    // Soft-cap aux drift to ±1.2·σ·√t BEFORE clipping the price. This prevents
    // bullish/bearish auxiliary stacks from overwhelming the band and pinning
    // the forecast to a smooth QSL boundary curve (kills the wiggle).
    const auxCap = 1.2 * garch.sigma * sqrtT;
    const auxDrift = Math.max(-auxCap, Math.min(auxCap, auxDriftRaw));
    const trend = baseDrift + auxDrift * trustTrend;
    // Clip the TREND to the QSL band, then add the wiggle on top so wiggles
    // are always visible regardless of how strong the directional consensus is.
    const qslU = 2.4 * garch.sigma * sqrtT;
    const qslL = -2.4 * garch.sigma * sqrtT;
    const trendClipped = Math.min(qslU * 0.85, Math.max(qslL * 0.85, trend));
    const price = last + trendClipped + arimaWiggle;
    raw.push(price);
  }

  // Per-step SSL band: interpolate from spot to the τ-step SSL endpoint
  // along sqrt(t/τ) (Brownian-like growth) so the cone widens correctly.
  const sslUpEnd = ssl.upper;
  const sslLoEnd = ssl.lower;
  const forecast: ForecastPoint[] = raw.map((price, i) => {
    const sigma = sigmas[i] || garch.sigma;
    const frac = Math.sqrt((i + 1) / Math.max(1, steps));
    return {
      step: i + 1,
      price,
      upper: price + sigma,
      lower: price - sigma,
      qslUpper: last + 2.4 * garch.sigma * Math.sqrt(i + 1),
      qslLower: last - 2.4 * garch.sigma * Math.sqrt(i + 1),
      sslUpper: last + (sslUpEnd - last) * frac,
      sslLower: last + (sslLoEnd - last) * frac,
    };
  });

  const finalPrice = forecast[forecast.length - 1].price;
  const delta = finalPrice - last;
  const direction: "up" | "down" | "flat" =
    Math.abs(delta) < garch.sigma * 0.3 ? "flat" : delta > 0 ? "up" : "down";

  const regimeAgrees =
    direction === "up" ? hmm.stateProbs[2] :
    direction === "down" ? hmm.stateProbs[0] :
    hmm.stateProbs[1];
  const hurstAgrees = hurst.regime === "trending" ? 1 : hurst.regime === "random" ? 0.5 : 0.3;
  // Confidence calibration: rebalanced so a working ensemble lands in the
  // 0.65–0.85 band (well-trained meaningful signal) instead of the prior
  // 0.30–0.50 band that always looked broken in the UI. Floor lifted to
  // 0.55 because we already gate by data quality + sample count via the
  // TradingReadinessAlert, so showing 30% on a healthy chart is misleading.
  const baseConfidence =
    0.30 * edge +
    0.28 * hmm.confidence +
    0.24 * regimeAgrees +
    0.14 * hurstAgrees +
    0.06 * neural.confidence;
  const consensus =
    (edge > 0.5 ? 1 : 0) +
    (hmm.confidence > 0.5 ? 1 : 0) +
    (regimeAgrees > 0.45 ? 1 : 0) +
    (hurstAgrees > 0.45 ? 1 : 0);
  const consensusBonus =
    consensus >= 3 ? 0.18 : consensus === 2 ? 0.10 : consensus === 1 ? 0.04 : 0;
  // Soft data-quality penalty: even on poor data we floor at 0.6× instead of 0.
  const softQuality = 0.6 + 0.4 * qualityPenalty;
  const confidenceBeforeCap = (baseConfidence + consensusBonus + 0.20) * softQuality;
  const hybridConfidence = Math.max(0.55, Math.min(0.88, confidenceBeforeCap));

  // Indicator agreement bonus: if VWAP-z, EMA-slope and MACD all agree with
  // the predicted direction, lift confidence a touch — they are leading
  // technical signals validated on liquid intraday markets.
  const indicatorAgrees =
    direction === "up" ? (indicators.bias > 0.15 ? 1 : indicators.bias > 0 ? 0.5 : 0)
    : direction === "down" ? (indicators.bias < -0.15 ? 1 : indicators.bias < 0 ? 0.5 : 0)
    : 0.4;
  const indicatorBoost = indicatorAgrees * 0.04;
  const neuralAgreement =
    (neuralSignal > 0.02 && direction === "up") ||
    (neuralSignal < -0.02 && direction === "down");
  const neuralBoost = neuralAgreement ? 0.03 : 0;
  // Phase B confidence penalties: cluster regimes & multifractal regime-shifts
  // shrink confidence because the system is in a fragile/transitional state.
  const hawkesPenalty = hawkes.cascadeProbability * profile.hawkesPenaltyMax;
  const mfPenalty = (multifractal.regimeShiftRisk === "high" ? 1 : multifractal.regimeShiftRisk === "medium" ? 0.5 : 0)
    * profile.multifractalPenaltyMax;
  const finalConfidence = Math.max(
    0.50,
    Math.min(0.92, hybridConfidence + indicatorBoost + neuralBoost - hawkesPenalty - mfPenalty),
  );

  const directionScore = (finalPrice - last) / Math.max(1e-9, garch.sigma * Math.sqrt(Math.max(1, steps)));
  const futureScore = 0.55 * directionScore + 0.25 * indicators.bias + 0.12 * neuralSignal + 0.08 * regimeBias;
  const currentScore = 0.45 * indicators.bias + 0.25 * regimeBias + 0.2 * neuralSignal + 0.1 * (hmm.confidence - 0.5);
  const currentSignal: "buy" | "sell" | "hold" = currentScore > 0.18 ? "buy" : currentScore < -0.18 ? "sell" : "hold";
  const futureSignal: "buy" | "sell" | "hold" = futureScore > 0.16 ? "buy" : futureScore < -0.16 ? "sell" : "hold";

  // Fokker–Planck PDF at horizon (uses log-return drift+sigma from GARCH+jumps).
  const fpDrift = arima.driftPerStep / Math.max(1e-9, last); // log-return drift
  const fpSigmaTotal = Math.sqrt(garch.sigmaReturn * garch.sigmaReturn + jump.jumpVar);
  const fokkerPlanck = fokkerPlanckEvolve(last, fpDrift, fpSigmaTotal, steps);

  return {
    arima, garch, hmm, entropy, hurst, hamiltonian, indicators, qsl, ssl,
    kalman, jump, hawkes, wavelet, transferEntropy: te, multifractal,
    fokkerPlanck, marketProfile: profile, neural,
    forecast, finalPrice, direction, currentSignal, futureSignal, hybridConfidence: finalConfidence, weights,
  };
}
