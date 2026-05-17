import { useMemo } from "react";
import type { HybridResult } from "@/lib/physics/hybrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

interface Props {
  prediction: HybridResult;
  currentPrice: number;
  recentPrices: number[];
  dataQualityScore: number;
  llmSignal: { bias: number; confidence: number; rationale: string };
}

export function StrategicPlanPanel({
  prediction,
  currentPrice,
  recentPrices,
  dataQualityScore,
  llmSignal,
}: Props) {
  // 1. Multi-Agent Simulation: Analyze competing strategies
  const agentAnalysis = useMemo(() => {
    if (recentPrices.length < 10) return null;

    // Momentum trader: follows recent trend
    const recentReturn =
      (recentPrices[recentPrices.length - 1] - recentPrices[Math.max(0, recentPrices.length - 6)]) /
      recentPrices[Math.max(0, recentPrices.length - 6)];
    const momentumSignal =
      recentReturn > 0.001 ? "long" : recentReturn < -0.001 ? "short" : "neutral";
    const momentumConfidence = Math.min(0.95, Math.abs(recentReturn) * 100);

    // Mean-reversion trader: bets on reversion to average
    const sma20 =
      recentPrices.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, recentPrices.length);
    const deviation = (currentPrice - sma20) / sma20;
    const meanReversionSignal = deviation > 0.02 ? "short" : deviation < -0.02 ? "long" : "neutral";
    const meanReversionConfidence = Math.min(0.95, Math.abs(deviation) * 80);

    // Market maker: follows volatility & volume (simulated from price variance)
    const volatility = calculateVolatility(recentPrices.slice(-20));
    const makerSignal =
      volatility > 0.015 ? "widen_spread" : volatility < 0.005 ? "tighten_spread" : "neutral";
    const makerConfidence = Math.min(0.95, volatility * 100);

    // Consensus detector: how many agree?
    const agreements = [
      momentumSignal === "long",
      meanReversionSignal === "long",
      prediction.direction === "up",
      llmSignal.bias > 0.1,
    ].filter(Boolean).length;

    const convergence = agreements / 4; // 0 to 1

    return {
      momentum: { signal: momentumSignal, confidence: momentumConfidence },
      meanReversion: { signal: meanReversionSignal, confidence: meanReversionConfidence },
      marketMaker: { signal: makerSignal, confidence: makerConfidence },
      convergence, // Nash equilibrium stability
      agreements,
    };
  }, [recentPrices, currentPrice, prediction.direction, llmSignal.bias]);

  // 2. Nash Equilibrium Detection
  const equilibriumAnalysis = useMemo(() => {
    if (!agentAnalysis) return null;

    const { convergence, agreements } = agentAnalysis;

    // Stable equilibrium: high convergence + quality data + model confidence
    const stability = convergence * dataQualityScore * prediction.hybridConfidence;
    const isStable = stability > 0.45;

    // Equilibrium type
    let equilibriumType = "UNSTABLE";
    if (stability > 0.7) equilibriumType = "STRONGLY STABLE";
    else if (stability > 0.5) equilibriumType = "STABLE";
    else if (stability > 0.35) equilibriumType = "WEAKLY STABLE";

    // Opportunity detection: when equilibrium breaks
    const breakChance = 1 - stability;
    const opportunityRank = agreements >= 3 ? "HIGH" : agreements === 2 ? "MEDIUM" : "LOW";

    return {
      stability,
      isStable,
      equilibriumType,
      breakChance,
      opportunityRank,
    };
  }, [agentAnalysis, dataQualityScore, prediction.hybridConfidence]);

  // 3. Strategic Position Sizing (Kelly Criterion + Minimax)
  const positionSizing = useMemo(() => {
    if (!agentAnalysis || !equilibriumAnalysis) return null;

    const winRate = prediction.hybridConfidence;
    const lossRate = 1 - winRate;
    const expectedReturn = (prediction.finalPrice - currentPrice) / currentPrice;

    // Simplified Kelly: f* = (bp - q) / b, where b = profit/loss ratio, p = win prob, q = loss prob
    const profitLossRatio = Math.abs(expectedReturn);
    const kellyFraction = Math.max(0, (profitLossRatio * winRate - lossRate) / profitLossRatio);

    // Minimax: minimize worst-case loss (conservative)
    const minimaxFraction = Math.min(0.5, winRate - 0.25); // 0.25 is a safety buffer

    // Recommended sizing (blended)
    const recommendedSize = Math.min(kellyFraction, minimaxFraction) * 0.85; // 85% of optimal
    const maxLossIfWrong = currentPrice * recommendedSize * 0.05; // 5% stop loss

    // Risk-adjusted position
    const riskProfile = equilibriumAnalysis.isStable ? "AGGRESSIVE" : "CONSERVATIVE";
    const adjustedSize = riskProfile === "AGGRESSIVE" ? recommendedSize : recommendedSize * 0.6;

    return {
      kelly: kellyFraction,
      minimax: minimaxFraction,
      recommended: recommendedSize,
      adjusted: adjustedSize,
      maxLossIfWrong,
      riskProfile,
      expectedReturn: (expectedReturn * 100).toFixed(2),
    };
  }, [agentAnalysis, equilibriumAnalysis, prediction, currentPrice]);

  // 4. Volatility Opportunity Signal
  const volatilityOpportunity = useMemo(() => {
    if (recentPrices.length < 10) return null;

    const recentVol = calculateVolatility(recentPrices.slice(-10));
    const historicalVol = calculateVolatility(recentPrices.slice(-50));

    const volRatio = historicalVol > 0 ? recentVol / historicalVol : 1;
    const isVolExpanding = volRatio > 1.2;
    const isVolContracting = volRatio < 0.8;

    // Opportunity: expand when vol is low, contract when vol is high
    let opportunity = "NEUTRAL";
    if (isVolContracting && (agentAnalysis?.convergence ?? 0) > 0.5) opportunity = "LOW_VOL_SETUP";
    if (isVolExpanding && prediction.hybridConfidence > 0.6) opportunity = "HIGH_VOL_TRADE";

    return {
      recent: recentVol,
      historical: historicalVol,
      ratio: volRatio,
      trend: isVolExpanding ? "EXPANDING" : isVolContracting ? "CONTRACTING" : "NEUTRAL",
      opportunity,
    };
  }, [recentPrices, agentAnalysis, prediction.hybridConfidence]);

  // 5. Ensemble Model Weighting
  const ensembleWeights = useMemo(() => {
    const wRec = prediction.weights as Record<string, number>;
    const weights = {
      arima: prediction.weights.arima * (agentAnalysis?.convergence ?? 0.5),
      garch: wRec["garch"] ? wRec["garch"] * (volatilityOpportunity?.ratio ?? 1) : 0.15,
      hmm: prediction.weights.hmm * (equilibriumAnalysis?.stability ?? 0.5),
      entropy: prediction.weights.entropy * dataQualityScore,
      hurst: prediction.weights.hurst * (agentAnalysis?.convergence ?? 0.5),
      neural: prediction.weights.neural * prediction.hybridConfidence,
      llm: llmSignal.confidence,
      indicators: prediction.weights.indicators
        ? prediction.weights.indicators * (agentAnalysis?.convergence ?? 0.5)
        : 0.12,
    };

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const normalized = Object.entries(weights).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: total > 0 ? ((value / total) * 100).toFixed(1) : "0.0",
      }),
      {} as Record<string, string>,
    );

    return normalized;
  }, [
    prediction.weights,
    agentAnalysis,
    equilibriumAnalysis,
    volatilityOpportunity,
    dataQualityScore,
    llmSignal.confidence,
    prediction.hybridConfidence,
  ]);

  // 6. Overall Strategic Signal — Hybrid model + technical indicator fusion
  const strategicSignal = useMemo(() => {
    if (!agentAnalysis || !equilibriumAnalysis || !positionSizing) return null;

    // --- Hybrid model directional score, signed in [-1, 1] ---
    const expectedReturn = (prediction.finalPrice - currentPrice) / Math.max(1e-9, currentPrice);
    const sigmaPct = Math.max(1e-9, prediction.garch.sigma / Math.max(1e-9, currentPrice));
    const modelDirScore = Math.max(-1, Math.min(1, expectedReturn / (sigmaPct * 2)));
    const regimeBias = prediction.hmm.stateProbs[2] - prediction.hmm.stateProbs[0]; // bull - bear
    const modelScore = 0.6 * modelDirScore + 0.4 * regimeBias;

    // --- Technical indicator score, signed in [-1, 1] ---
    // indicators.bias already aggregates VWAP-z, EMA slope, MACD
    const techBias = Math.max(-1, Math.min(1, prediction.indicators.bias));
    const momentumPush =
      agentAnalysis.momentum.signal === "long"
        ? 0.5
        : agentAnalysis.momentum.signal === "short"
          ? -0.5
          : 0;
    const meanRevPush =
      agentAnalysis.meanReversion.signal === "long"
        ? 0.25
        : agentAnalysis.meanReversion.signal === "short"
          ? -0.25
          : 0;
    const techScore = Math.max(
      -1,
      Math.min(1, 0.6 * techBias + 0.3 * momentumPush + 0.1 * meanRevPush),
    );

    // --- Fused signed score (hybrid 55%, technicals 45%) ---
    const fusedScore = 0.55 * modelScore + 0.45 * techScore;
    const agreement = Math.sign(modelScore) === Math.sign(techScore) && Math.sign(modelScore) !== 0;

    // --- Market regime: Bullish / Bearish / Sideways ---
    let marketRegime: "BULLISH" | "BEARISH" | "SIDEWAYS" = "SIDEWAYS";
    if (fusedScore > 0.18) marketRegime = "BULLISH";
    else if (fusedScore < -0.18) marketRegime = "BEARISH";

    // Confidence-weighted gate for actionable trade
    const components = {
      convergence: agentAnalysis.convergence,
      equilibrium: equilibriumAnalysis.stability,
      confidence: prediction.hybridConfidence,
      dataQuality: dataQualityScore,
    };
    const compositeScore =
      Object.values(components).reduce((a, b) => a + b, 0) / Object.keys(components).length;

    // --- BUY / SELL / HOLD recommendation ---
    // Require: clear direction (|fused| > 0.18), reasonable confidence,
    // and ideally model + technicals agreeing.
    let recommendation: "BUY" | "SELL" | "HOLD" | "AVOID" = "HOLD";
    const actionGate = compositeScore > 0.55 && Math.abs(fusedScore) > 0.18;
    const strongGate = compositeScore > 0.65 && Math.abs(fusedScore) > 0.3 && agreement;
    if (compositeScore < 0.35) recommendation = "AVOID";
    else if (strongGate || actionGate) {
      recommendation = fusedScore > 0 ? "BUY" : "SELL";
    }

    const signalStrength = Math.min(1, Math.abs(fusedScore) * 0.6 + (compositeScore - 0.5) * 0.8);

    return {
      recommendation,
      marketRegime,
      fusedScore,
      modelScore,
      techScore,
      agreement,
      compositeScore,
      signalStrength: Math.max(0, signalStrength),
      components,
    };
  }, [
    agentAnalysis,
    equilibriumAnalysis,
    positionSizing,
    prediction.finalPrice,
    prediction.garch.sigma,
    prediction.hmm.stateProbs,
    prediction.indicators.bias,
    prediction.hybridConfidence,
    currentPrice,
    dataQualityScore,
  ]);

  if (
    !agentAnalysis ||
    !equilibriumAnalysis ||
    !positionSizing ||
    !volatilityOpportunity ||
    !strategicSignal
  ) {
    return (
      <div className="panel p-4 text-sm text-muted-foreground">
        <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        Computing strategic analysis…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Strategic Signal */}
      <Alert
        className={`border-2 ${
          strategicSignal.recommendation === "BUY"
            ? "border-bull bg-bull/10"
            : strategicSignal.recommendation === "SELL"
              ? "border-bear bg-bear/10"
              : "border-border"
        }`}
      >
        <AlertDescription className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Strategic Recommendation
              </div>
              <div
                className="text-lg font-display font-bold"
                style={{
                  color:
                    strategicSignal.recommendation === "BUY"
                      ? "var(--bull)"
                      : strategicSignal.recommendation === "SELL"
                        ? "var(--bear)"
                        : "var(--foreground)",
                }}
              >
                {strategicSignal.recommendation}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Hybrid model + technical indicators{" "}
                {strategicSignal.agreement ? "✓ agree" : "⚠ diverge"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Market Outlook
              </div>
              <div
                className="text-lg font-display font-bold"
                style={{
                  color:
                    strategicSignal.marketRegime === "BULLISH"
                      ? "var(--bull)"
                      : strategicSignal.marketRegime === "BEARISH"
                        ? "var(--bear)"
                        : "var(--foreground)",
                }}
              >
                {strategicSignal.marketRegime}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Strength {(strategicSignal.signalStrength * 100).toFixed(0)}%
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-card p-1.5 rounded border border-border/50">
              <div className="uppercase text-muted-foreground text-[8px]">Hybrid Model Score</div>
              <div
                className={`font-bold ${strategicSignal.modelScore > 0 ? "text-bull" : strategicSignal.modelScore < 0 ? "text-bear" : "text-foreground"}`}
              >
                {strategicSignal.modelScore > 0 ? "+" : ""}
                {(strategicSignal.modelScore * 100).toFixed(0)}
              </div>
            </div>
            <div className="bg-card p-1.5 rounded border border-border/50">
              <div className="uppercase text-muted-foreground text-[8px]">Technicals Score</div>
              <div
                className={`font-bold ${strategicSignal.techScore > 0 ? "text-bull" : strategicSignal.techScore < 0 ? "text-bear" : "text-foreground"}`}
              >
                {strategicSignal.techScore > 0 ? "+" : ""}
                {(strategicSignal.techScore * 100).toFixed(0)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            {Object.entries(strategicSignal.components).map(([key, value]) => (
              <div key={key} className="bg-card p-1.5 rounded border border-border/50">
                <div className="uppercase text-muted-foreground text-[8px]">{key}</div>
                <div className="font-bold text-foreground">
                  {(typeof value === "number" ? value * 100 : 0).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </AlertDescription>
      </Alert>

      {/* Multi-Agent & Nash Equilibrium */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="panel p-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Multi-Agent Signals
          </h3>
          <div className="space-y-2.5 text-[11px]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-muted-foreground">Momentum Trader</div>
                <div className="font-mono text-[9px] text-primary/70">
                  {agentAnalysis.momentum.signal.toUpperCase()}
                </div>
              </div>
              <div className="text-right font-semibold">
                {(agentAnalysis.momentum.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-muted-foreground">Mean-Reversion Trader</div>
                <div className="font-mono text-[9px] text-primary/70">
                  {agentAnalysis.meanReversion.signal.toUpperCase()}
                </div>
              </div>
              <div className="text-right font-semibold">
                {(agentAnalysis.meanReversion.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-muted-foreground">Market Maker</div>
                <div className="font-mono text-[9px] text-primary/70">
                  {agentAnalysis.marketMaker.signal.toUpperCase()}
                </div>
              </div>
              <div className="text-right font-semibold">
                {(agentAnalysis.marketMaker.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div className="border-t border-border pt-2 mt-2">
              <div className="flex items-center justify-between font-semibold">
                <div className="text-muted-foreground">Consensus</div>
                <div>{agentAnalysis.agreements}/4 agents aligned</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="panel p-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Nash Equilibrium
          </h3>
          <div className="space-y-3 text-[11px]">
            <div>
              <div className="text-muted-foreground mb-1">Equilibrium State</div>
              <div
                className={`px-2 py-1 rounded text-[10px] font-semibold w-fit ${
                  equilibriumAnalysis.isStable ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"
                }`}
              >
                {equilibriumAnalysis.equilibriumType}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-muted-foreground text-[9px] mb-0.5">Stability Score</div>
                <div className="text-lg font-bold">
                  {(equilibriumAnalysis.stability * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[9px] mb-0.5">Break Probability</div>
                <div className="text-lg font-bold">
                  {(equilibriumAnalysis.breakChance * 100).toFixed(0)}%
                </div>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Opportunity Rank</div>
              <div className="font-semibold">{equilibriumAnalysis.opportunityRank}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Position Sizing & Volatility Opportunity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="panel p-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Strategic Position Sizing
          </h3>
          <div className="space-y-2.5 text-[11px]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-muted-foreground text-[9px] mb-1">Kelly Fraction</div>
                <div className="text-sm font-bold">{(positionSizing.kelly * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[9px] mb-1">Minimax (Safe)</div>
                <div className="text-sm font-bold text-primary">
                  {(positionSizing.minimax * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="border-t border-border pt-2">
              <div className="text-muted-foreground mb-1">Recommended Size</div>
              <div className="text-lg font-bold">{(positionSizing.adjusted * 100).toFixed(1)}%</div>
              <div className="text-[9px] text-muted-foreground mt-1">
                Risk: {positionSizing.riskProfile} | Expected: {positionSizing.expectedReturn}%
              </div>
              <div className="text-[9px] text-bear mt-1">
                Max loss: ${positionSizing.maxLossIfWrong.toFixed(2)}
              </div>
            </div>
          </div>
        </Card>

        <Card className="panel p-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Volatility Opportunity
          </h3>
          <div className="space-y-2.5 text-[11px]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-muted-foreground text-[9px] mb-1">Recent Vol</div>
                <div className="font-mono text-sm font-bold">
                  {(volatilityOpportunity.recent * 100).toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[9px] mb-1">Historical Vol</div>
                <div className="font-mono text-sm font-bold">
                  {(volatilityOpportunity.historical * 100).toFixed(2)}%
                </div>
              </div>
            </div>
            <div className="border-t border-border pt-2">
              <div className="flex items-center justify-between mb-2">
                <div className="text-muted-foreground">Vol Ratio</div>
                <div className="font-bold">{volatilityOpportunity.ratio.toFixed(2)}x</div>
              </div>
              <div className="px-2 py-1 rounded text-[10px] font-semibold w-fit bg-card border border-border">
                {volatilityOpportunity.trend}
              </div>
              <div className="text-[9px] text-primary font-semibold mt-2">
                Setup: {volatilityOpportunity.opportunity}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Physics-Based Model Confidence Scores */}
      <div className="space-y-3">
        <Card className="panel p-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Physics-Based Model Confidence Scores
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-[10px]">
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">ARIMA(2,1,1)</div>
              <div className="text-sm font-bold text-foreground">
                {((prediction.weights.arima || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Shock-driven recursion</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">GARCH(1,1)</div>
              <div className="text-sm font-bold text-foreground">
                {(((prediction.weights as Record<string, number>)["garch"] || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Vol persistence</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">HMM Regime</div>
              <div className="text-sm font-bold text-foreground">
                {((prediction.weights.hmm || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Bull/bear drift</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">Entropy</div>
              <div className="text-sm font-bold text-foreground">
                {((prediction.weights.entropy || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Noise damping</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">Hurst</div>
              <div className="text-sm font-bold text-foreground">
                {((prediction.weights.hurst || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Trending factor</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">Neural Network</div>
              <div className="text-sm font-bold text-foreground">
                {((prediction.weights.neural || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Pattern learning</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">LLM Sentiment</div>
              <div className="text-sm font-bold text-foreground">
                {((prediction.weights.llm || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">News bias</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">Indicators</div>
              <div className="text-sm font-bold text-foreground">
                {((prediction.weights.indicators || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Technical signals</div>
            </div>
          </div>
        </Card>

        <Card className="panel p-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Advanced Physics Models (Stochastic Bounds & Filters)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 text-[10px]">
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">
                SSL (Stochastic)
              </div>
              <div className="text-sm font-bold text-foreground">95% Band</div>
              <div className="text-[8px] text-muted-foreground mt-0.5">μT ± 1.96σ√T Itô</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">Hamiltonian</div>
              <div className="text-sm font-bold text-foreground">Energy</div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Velocity bias</div>
            </div>
            <div className="bg-card p-2 rounded border border-border/50">
              <div className="uppercase text-[8px] text-muted-foreground mb-1">Kalman Filter</div>
              <div className="text-sm font-bold text-foreground">Pre-Filter</div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Micro-noise removal</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Strategy Rationale */}
      <Card className="panel p-4 bg-card/50">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Strategic Rationale
        </h3>
        <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1.5">
          <p>
            <span className="text-foreground font-semibold">Convergence:</span>{" "}
            {agentAnalysis.agreements}/4 market agents aligned, indicating{" "}
            {equilibriumAnalysis.isStable ? "stable" : "unstable"} equilibrium.
          </p>
          <p>
            <span className="text-foreground font-semibold">Volatility:</span> Recent volatility is{" "}
            {volatilityOpportunity.ratio.toFixed(2)}x historical, suggesting{" "}
            {volatilityOpportunity.trend.toLowerCase()} market regime.
          </p>
          <p>
            <span className="text-foreground font-semibold">Position:</span>{" "}
            {positionSizing.riskProfile} sizing ({(positionSizing.adjusted * 100).toFixed(1)}%)
            recommended given {equilibriumAnalysis.opportunityRank.toLowerCase()} opportunity rank.
          </p>
          {llmSignal.rationale && (
            <p>
              <span className="text-foreground font-semibold">Sentiment:</span>{" "}
              {llmSignal.rationale}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance);
}
