import { hybridPredict } from "./hybrid";

interface WorkerMsg {
  id: string;
  prices: number[];
  steps: number;
  options?: any;
}

self.addEventListener("message", (ev: MessageEvent<WorkerMsg>) => {
  const { id, prices, steps, options } = ev.data;
  try {
    const res = hybridPredict(prices, steps, options);
    // Serialize only the data needed by the UI (functions/closures are not transferable)
    const serial = {
      forecast: res.forecast,
      finalPrice: res.finalPrice,
      direction: res.direction,
      currentSignal: res.currentSignal,
      futureSignal: res.futureSignal,
      hybridConfidence: res.hybridConfidence,
      weights: res.weights,
      garch: { sigma: res.garch.sigma, sigmaReturn: res.garch.sigmaReturn },
      // Tier-1+2 features
      kalman: { snr: res.kalman.snr, velocity: res.kalman.velocity },
      jump: {
        lambda: res.jump.lambda,
        jumpFraction: res.jump.jumpFraction,
        pUp: res.jump.pUp,
        recentJump: res.jump.recentJump ?? null,
      },
      hawkes: {
        branching: res.hawkes.branching,
        currentIntensity: res.hawkes.currentIntensity,
        cascadeProbability: res.hawkes.cascadeProbability,
        isClusterRegime: res.hawkes.isClusterRegime,
      },
      wavelet: { dominantScale: res.wavelet.dominantScale, trendSlope: res.wavelet.trendSlope },
      transferEntropy: { selfTE: res.transferEntropy.selfTE, crossTE: res.transferEntropy.crossTE },
      multifractal: { width: res.multifractal.width, regimeShiftRisk: res.multifractal.regimeShiftRisk },
      fokkerPlanck: { mean: res.fokkerPlanck.mean, bands: res.fokkerPlanck.bands },
      // Entropy, ARIMA, Hamiltonian
      entropy: { H: res.entropy.H, edge: res.entropy.edge, upRatio: res.entropy.upRatio },
      arima: {
        c: res.arima.c,
        phi: res.arima.phi,
        phi2: res.arima.phi2,
        theta: res.arima.theta,
        driftPerStep: res.arima.driftPerStep,
        residualStd: res.arima.residualStd,
      },
      hamiltonian: { H: res.hamiltonian.H, KE: res.hamiltonian.KE, PE: res.hamiltonian.PE, velocity: res.hamiltonian.velocity },
      hmm: {
        dominantState: res.hmm.dominantState,
        stateProbs: res.hmm.stateProbs,
        confidence: (res.hmm as any).confidence ?? 0,
        stateMeans: (res.hmm as any).stateMeans ?? [],
      },
      hurst: { regime: res.hurst.regime, H: res.hurst.H },
      neural: { confidence: res.neural.confidence, forecast: res.neural.forecast },
      indicators: { bias: res.indicators.bias },
      ssl: res.ssl,
    };
    // Post serializable result
    // @ts-ignore - Worker global
    self.postMessage({ id, result: serial });
  } catch (err) {
    // @ts-ignore - Worker global
    self.postMessage({ id, error: String(err) });
  }
});
