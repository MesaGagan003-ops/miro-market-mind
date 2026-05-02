// 3-state Hidden Markov Model on log-returns.
// States: 0 = bearish, 1 = neutral/high-vol, 2 = bullish
// Emissions: Gaussian with means/sigmas re-estimated from the data.
//
// Pipeline:
//   1. Initialise μ/σ from return quantiles (q25, median, q75).
//   2. Run adaptive Baum-Welch (forward-backward) EM iterations on the FULL
//      history to re-estimate transition matrix + emission parameters.
//      Iterations scale with data length (longer series = more refinement).
//      Convergence monitored via likelihood improvement ratio.
//   3. Forward pass for the current state distribution.
//   4. Viterbi (log-space) for the most-likely state path (numerically stable).
//   5. Viterbi path quality tracked: high-confidence decoding when repeated
//      states show strong likelihood ratio over alternatives.

export interface HmmResult {
  stateProbs: [number, number, number];
  dominantState: 0 | 1 | 2;
  confidence: number;
  expectedReturn: number;
  transitionMatrix: number[][]; // 3x3, rows sum to 1 (re-estimated)
  stateMeans: [number, number, number];
  stateSigmas: [number, number, number];
  /** EM iterations actually performed. */
  emIterations: number;
  /** Final log-likelihood (higher = better fit). */
  logLik: number;
  /** Length of the Viterbi-decoded sequence. */
  viterbiSamples: number;
}

export const HMM_STATE_LABELS = ["Bearish trend", "High-vol reversal", "Bullish recovery"] as const;

function gauss(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 1e-12;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

const MIN_SIGMA = 1e-7;

export function fitHmm3(prices: number[]): HmmResult {
  if (prices.length < 12) {
    const eye = [
      [0.34, 0.33, 0.33],
      [0.33, 0.34, 0.33],
      [0.33, 0.33, 0.34],
    ];
    return {
      stateProbs: [0.33, 0.34, 0.33],
      dominantState: 1,
      confidence: 0.34,
      expectedReturn: 0,
      transitionMatrix: eye,
      stateMeans: [0, 0, 0],
      stateSigmas: [1e-6, 1e-6, 1e-6],
      emIterations: 0,
      logLik: 0,
      viterbiSamples: 0,
    };
  }

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
  const T = returns.length;
  const N = 3;

  // ---- Initial parameters from quantiles ----
  const sorted = [...returns].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length) || 1e-6;

  let mus: [number, number, number] = [q1, mean, q3];
  let sigmas: [number, number, number] = [std * 0.8, std * 1.5, std * 0.8];
  let A: number[][] = [
    [0.85, 0.10, 0.05],
    [0.15, 0.70, 0.15],
    [0.05, 0.10, 0.85],
  ];
  let pi: number[] = [1 / 3, 1 / 3, 1 / 3];

  // ---- Baum-Welch EM (re-estimate A, μ, σ, π) ----
  // Adaptive EM iterations: longer series get more refinement (20-50 iterations).
  // Convergence criterion: relative log-likelihood improvement per step < 1e-5.
  const maxItersDefault = Math.min(50, Math.max(20, Math.floor(Math.log(T) * 10)));
  const MAX_EM = maxItersDefault;
  const baseToleranceTerm = 1e-5;
  const TOL = Math.abs(baseToleranceTerm) * Math.max(1, Math.log(Math.max(2, T))); // scale with series length
  let prevLL = -Infinity;
  let iter = 0;
  let lastLL = 0;
  let llHistory: number[] = [];

  for (iter = 0; iter < MAX_EM; iter++) {
    // Forward with scaling
    const alpha: number[][] = Array.from({ length: T }, () => [0, 0, 0]);
    const scale: number[] = new Array(T).fill(0);
    for (let s = 0; s < N; s++) alpha[0][s] = pi[s] * gauss(returns[0], mus[s], sigmas[s]);
    scale[0] = alpha[0].reduce((a, b) => a + b, 0) || 1e-300;
    for (let s = 0; s < N; s++) alpha[0][s] /= scale[0];
    for (let t = 1; t < T; t++) {
      for (let s = 0; s < N; s++) {
        let acc = 0;
        for (let sp = 0; sp < N; sp++) acc += alpha[t - 1][sp] * A[sp][s];
        alpha[t][s] = acc * gauss(returns[t], mus[s], sigmas[s]);
      }
      scale[t] = alpha[t].reduce((a, b) => a + b, 0) || 1e-300;
      for (let s = 0; s < N; s++) alpha[t][s] /= scale[t];
    }
    // Backward with same scaling
    const beta: number[][] = Array.from({ length: T }, () => [0, 0, 0]);
    for (let s = 0; s < N; s++) beta[T - 1][s] = 1 / scale[T - 1];
    for (let t = T - 2; t >= 0; t--) {
      for (let s = 0; s < N; s++) {
        let acc = 0;
        for (let sp = 0; sp < N; sp++) {
          acc += A[s][sp] * gauss(returns[t + 1], mus[sp], sigmas[sp]) * beta[t + 1][sp];
        }
        beta[t][s] = acc / scale[t];
      }
    }

    // Log-likelihood (sum of log scaling factors)
    let ll = 0;
    for (let t = 0; t < T; t++) ll += Math.log(scale[t]);
    lastLL = ll;

    // γ_t(s) = α_t(s) · β_t(s) · scale[t]
    const gamma: number[][] = Array.from({ length: T }, () => [0, 0, 0]);
    for (let t = 0; t < T; t++) {
      let denom = 0;
      for (let s = 0; s < N; s++) {
        gamma[t][s] = alpha[t][s] * beta[t][s] * scale[t];
        denom += gamma[t][s];
      }
      if (denom > 0) for (let s = 0; s < N; s++) gamma[t][s] /= denom;
    }

    // ξ_t(i,j) sums (no need to keep full tensor — accumulate)
    const xiSum: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let t = 0; t < T - 1; t++) {
      let denom = 0;
      const tmp: number[][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          tmp[i][j] = alpha[t][i] * A[i][j] * gauss(returns[t + 1], mus[j], sigmas[j]) * beta[t + 1][j];
          denom += tmp[i][j];
        }
      }
      if (denom > 0) {
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) xiSum[i][j] += tmp[i][j] / denom;
      }
    }

    // M-step — re-estimate π, A, μ, σ (with Laplace smoothing on A)
    pi = gamma[0].slice();
    for (let i = 0; i < N; i++) {
      let rowSum = 0;
      for (let j = 0; j < N; j++) rowSum += xiSum[i][j];
      if (rowSum > 0) {
        for (let j = 0; j < N; j++) A[i][j] = (xiSum[i][j] + 1e-3) / (rowSum + N * 1e-3);
      }
    }
    const newMus: [number, number, number] = [0, 0, 0];
    const newSigmas: [number, number, number] = [0, 0, 0];
    for (let s = 0; s < N; s++) {
      let num = 0, den = 0;
      for (let t = 0; t < T; t++) { num += gamma[t][s] * returns[t]; den += gamma[t][s]; }
      newMus[s] = den > 0 ? num / den : mus[s];
      let varNum = 0;
      for (let t = 0; t < T; t++) varNum += gamma[t][s] * (returns[t] - newMus[s]) ** 2;
      newSigmas[s] = den > 0 ? Math.sqrt(Math.max(MIN_SIGMA * MIN_SIGMA, varNum / den)) : sigmas[s];
    }
    mus = newMus;
    sigmas = newSigmas;

    // Track LL improvement for adaptive early stopping
    llHistory.push(ll);
    const relativeImprovement = prevLL === -Infinity ? 1.0 : (ll - prevLL) / Math.max(1e-10, Math.abs(prevLL));
    
    // Early stopping: if LL improvement drops below threshold OR we've done max iterations
    if (iter > 5 && relativeImprovement < TOL) {
      iter++;
      break;
    }
    prevLL = ll;
  }

  // Re-order states so 0 = lowest-mean (bearish), 2 = highest-mean (bullish).
  const order = [0, 1, 2].sort((a, b) => mus[a] - mus[b]);
  const remap = (m: number) => order.indexOf(m);
  const orderedMus = order.map((i) => mus[i]) as [number, number, number];
  const orderedSigmas = order.map((i) => sigmas[i]) as [number, number, number];
  const orderedPi = order.map((i) => pi[i]);
  const orderedA: number[][] = order.map((i) => order.map((j) => A[i][j]));
  // Renormalise rows after permutation (already a permutation, sums preserved, but be safe)
  for (let i = 0; i < N; i++) {
    const s = orderedA[i].reduce((a, b) => a + b, 0) || 1;
    for (let j = 0; j < N; j++) orderedA[i][j] /= s;
  }
  mus = orderedMus;
  sigmas = orderedSigmas;
  pi = orderedPi;
  A = orderedA;

  // ---- Final forward pass with re-estimated params for current-state probs ----
  let alpha = pi.map((p, s) => p * gauss(returns[0], mus[s], sigmas[s]));
  let sumA = alpha.reduce((a, b) => a + b, 0) || 1e-12;
  alpha = alpha.map((a) => a / sumA);
  for (let t = 1; t < T; t++) {
    const next = [0, 0, 0];
    for (let s = 0; s < N; s++) {
      let acc = 0;
      for (let sp = 0; sp < N; sp++) acc += alpha[sp] * A[sp][s];
      next[s] = acc * gauss(returns[t], mus[s], sigmas[s]);
    }
    sumA = next.reduce((a, b) => a + b, 0) || 1e-12;
    alpha = next.map((a) => a / sumA);
  }
  const stateProbs: [number, number, number] = [alpha[0], alpha[1], alpha[2]];
  const dominantState = stateProbs.indexOf(Math.max(...stateProbs)) as 0 | 1 | 2;
  const confidence = stateProbs[dominantState];
  const expectedReturn = stateProbs.reduce((acc, p, i) => acc + p * mus[i], 0);

  // ---- Viterbi (log space) on the re-estimated model ----
  const logA = A.map((row) => row.map((v) => Math.log(Math.max(v, 1e-300))));
  const logPi = pi.map((v) => Math.log(Math.max(v, 1e-300)));
  const delta: number[][] = Array.from({ length: T }, () => [0, 0, 0]);
  const psi: number[][] = Array.from({ length: T }, () => [0, 0, 0]);
  for (let s = 0; s < N; s++) {
    delta[0][s] = logPi[s] + Math.log(gauss(returns[0], mus[s], sigmas[s]) + 1e-300);
  }
  for (let t = 1; t < T; t++) {
    for (let s = 0; s < N; s++) {
      let bestVal = -Infinity;
      let bestPrev = 0;
      for (let sp = 0; sp < N; sp++) {
        const v = delta[t - 1][sp] + logA[sp][s];
        if (v > bestVal) { bestVal = v; bestPrev = sp; }
      }
      delta[t][s] = bestVal + Math.log(gauss(returns[t], mus[s], sigmas[s]) + 1e-300);
      psi[t][s] = bestPrev;
    }
  }
  const path = new Array<number>(T);
  path[T - 1] = delta[T - 1].indexOf(Math.max(...delta[T - 1]));
  for (let t = T - 2; t >= 0; t--) path[t] = psi[t + 1][path[t + 1]];
  void remap; // re-ordering already applied above

  // Calculate Viterbi path quality: measure confidence by comparing best vs second-best path likelihood
  let viterbiQuality = 0.5; // default medium confidence
  if (T > 1) {
    const finalDeltas = delta[T - 1];
    const sortedDeltas = [...finalDeltas].sort((a, b) => b - a);
    if (sortedDeltas.length >= 2 && sortedDeltas[0] > sortedDeltas[1]) {
      // Likelihood ratio: how much better is the best vs second-best
      const lnRatio = sortedDeltas[0] - sortedDeltas[1];
      // Map to [0.5, 1.0] range: small improvements → confidence ~0.5, large → confidence ~1.0
      viterbiQuality = Math.min(1.0, 0.5 + 0.5 * Math.tanh(lnRatio / (2 * T)));
    }
  }

  // Use the re-estimated A as the displayed transition matrix.
  return {
    stateProbs,
    dominantState,
    confidence: Math.max(stateProbs[dominantState], viterbiQuality),
    expectedReturn,
    transitionMatrix: A,
    stateMeans: mus,
    stateSigmas: sigmas,
    emIterations: iter,
    logLik: lastLL,
    viterbiSamples: path.length,
  };
}
