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
