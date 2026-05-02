// ARIMA(2,1,1) — second-order AR + first-order MA on differenced prices.
//   y'_t = c + φ₁·y'_{t-1} + φ₂·y'_{t-2} + θ₁·ε_{t-1} + ε_t
// where y'_t = Y_t - Y_{t-1}  (d=1, first difference).
//
// Fit:
//   1. Difference the price series.
//   2. Coarse grid-search (φ₁, φ₂, θ₁) by minimising SSE of the one-step-ahead
//      prediction recursion, then a local refine pass around the best point.
//   3. Estimate residual σ from the best-fit residuals.
//
// Forecast:
//   Recursive — at each step we sample a fresh shock ε_t ~ N(0, σ_resid)
//   so the projected path has realistic *wiggles* instead of a smooth line.

export interface ArimaResult {
  c: number;          // drift constant
  phi: number;        // AR(1) coefficient (φ₁)
  phi2: number;       // AR(2) coefficient (φ₂)
  theta: number;      // MA(1) coefficient
  residualStd: number;
  driftPerStep: number; // long-run expected change per step = c / (1 - φ₁ - φ₂)
  forecast: (steps: number, lastPrice: number, seed?: number) => number[];
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function diff(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] - series[i - 1]);
  return out;
}

// Score a candidate (c, φ₁, φ₂, θ) by SSE of the one-step prediction recursion.
function scoreSSE(
  d: number[],
  c: number,
  phi1: number,
  phi2: number,
  theta: number,
): { sse: number; resid: number[] } {
  const resid: number[] = [];
  let prev1 = d[1] ?? 0; // y'_{t-1}
  let prev2 = d[0] ?? 0; // y'_{t-2}
  let prevE = 0;
  let sse = 0;
  for (let t = 2; t < d.length; t++) {
    const pred = c + phi1 * prev1 + phi2 * prev2 + theta * prevE;
    const err = d[t] - pred;
    sse += err * err;
    resid.push(err);
    prev2 = prev1;
    prev1 = d[t];
    prevE = err;
  }
  return { sse, resid };
}

export function fitArima211(prices: number[]): ArimaResult {
  if (prices.length < 10) {
    return {
      c: 0, phi: 0, phi2: 0, theta: 0, residualStd: 0, driftPerStep: 0,
      forecast: (steps, last) => Array(steps).fill(last),
    };
  }
  const d = diff(prices);
  const meanD = d.reduce((a, b) => a + b, 0) / d.length;

  // Coarse grid search; AR coefficients constrained to the stationarity
  // triangle |φ₂| < 1, φ₁ + φ₂ < 1, φ₂ - φ₁ < 1.
  let best = { sse: Infinity, c: meanD, phi1: 0, phi2: 0, theta: 0 };
  for (let phi1 = -0.9; phi1 <= 0.9; phi1 += 0.15) {
    for (let phi2 = -0.8; phi2 <= 0.8; phi2 += 0.15) {
      if (Math.abs(phi2) >= 0.98) continue;
      if (phi1 + phi2 >= 0.98) continue;
      if (phi2 - phi1 >= 0.98) continue;
      for (let theta = -0.9; theta <= 0.9; theta += 0.15) {
        const c = meanD * (1 - phi1 - phi2);
        const { sse } = scoreSSE(d, c, phi1, phi2, theta);
        if (sse < best.sse) best = { sse, c, phi1, phi2, theta };
      }
    }
  }
  // Local refine
  const step = 0.03;
  for (let dp1 = -0.12; dp1 <= 0.12; dp1 += step) {
    for (let dp2 = -0.12; dp2 <= 0.12; dp2 += step) {
      for (let dt = -0.12; dt <= 0.12; dt += step) {
        const phi1 = Math.max(-0.98, Math.min(0.98, best.phi1 + dp1));
        const phi2 = Math.max(-0.98, Math.min(0.98, best.phi2 + dp2));
        if (phi1 + phi2 >= 0.98 || phi2 - phi1 >= 0.98) continue;
        const theta = Math.max(-0.98, Math.min(0.98, best.theta + dt));
        const c = meanD * (1 - phi1 - phi2);
        const { sse } = scoreSSE(d, c, phi1, phi2, theta);
        if (sse < best.sse) best = { sse, c, phi1, phi2, theta };
      }
    }
  }

  const { resid } = scoreSSE(d, best.c, best.phi1, best.phi2, best.theta);
  const residualStd = Math.sqrt(
    resid.reduce((a, b) => a + b * b, 0) / Math.max(1, resid.length),
  ) || 1e-9;

  const denom = 1 - best.phi1 - best.phi2;
  const driftPerStep = Math.abs(denom) > 1e-6 ? best.c / denom : best.c;

  const forecast = (steps: number, lastPrice: number, seed = 1) => {
    const rng = mulberry32(seed || 1);
    const out: number[] = [];
    let p = lastPrice;
    let prev1 = d[d.length - 1] ?? 0;
    let prev2 = d[d.length - 2] ?? 0;
    let prevE = resid[resid.length - 1] ?? 0;
    const shockCap = 3 * residualStd;
    for (let i = 0; i < steps; i++) {
      let eps = gaussian(rng) * residualStd;
      if (eps > shockCap) eps = shockCap;
      else if (eps < -shockCap) eps = -shockCap;
      const yPrime =
        best.c + best.phi1 * prev1 + best.phi2 * prev2 + best.theta * prevE + eps;
      p += yPrime;
      out.push(p);
      prev2 = prev1;
      prev1 = yPrime;
      prevE = eps;
    }
    return out;
  };

  return {
    c: best.c,
    phi: best.phi1,
    phi2: best.phi2,
    theta: best.theta,
    residualStd,
    driftPerStep,
    forecast,
  };
}

// Explicit (2,1,1) model: d=1 (one difference), p=2 (AR order), q=1 (MA order).
// Second-order AR on differenced prices + first-order moving average term.
export const fitArima211Explicit = fitArima211;
// Backwards-compat alias so existing imports keep working.
export const fitArima111 = fitArima211;
