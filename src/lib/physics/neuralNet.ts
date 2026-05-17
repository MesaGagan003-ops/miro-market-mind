// Lightweight feed-forward neural network for next-return prediction.
//
// Architecture: 8 → 16 → 8 → 1 (tanh hidden, linear output).
// Trained with mini-batch SGD + momentum and full backpropagation on
// historical lagged-return / volatility / indicator features. Used by the
// hybrid ensemble as a 7th member; output is a directional return signal in
// roughly [-1, +1] (clipped) that the hybrid scales by σ.

export interface NeuralNetworkResult {
  forecast: number[]; // predicted return for next N steps (decayed)
  confidence: number; // [0, 1] sign-accuracy on a recent holdout window
  activation: number[]; // last output for debugging
  loss: number; // final MSE
}

const ARCH = [8, 16, 8, 1] as const;
const LR = 0.01;
const MOMENTUM = 0.9;
const MAX_EPOCHS_DEFAULT = 12;

interface Net {
  W: number[][][]; // W[l][j][i]
  b: number[][]; // b[l][j]
  vW: number[][][];
  vb: number[][];
}

function rand(): number {
  // Box-Muller would be overkill; uniform is fine for He init scaling.
  return Math.random() - 0.5;
}

function makeNet(): Net {
  const W: number[][][] = [];
  const b: number[][] = [];
  const vW: number[][][] = [];
  const vb: number[][] = [];
  for (let l = 0; l < ARCH.length - 1; l++) {
    const fanIn = ARCH[l];
    const fanOut = ARCH[l + 1];
    const scale = Math.sqrt(2 / fanIn);
    const Wl: number[][] = [];
    const vWl: number[][] = [];
    for (let j = 0; j < fanOut; j++) {
      const row: number[] = new Array(fanIn);
      const vrow: number[] = new Array(fanIn).fill(0);
      for (let i = 0; i < fanIn; i++) row[i] = rand() * 2 * scale;
      Wl.push(row);
      vWl.push(vrow);
    }
    W.push(Wl);
    vW.push(vWl);
    b.push(new Array(fanOut).fill(0));
    vb.push(new Array(fanOut).fill(0));
  }
  return { W, b, vW, vb };
}

function forward(net: Net, x: number[]): { acts: number[][]; pre: number[][] } {
  const acts: number[][] = [x];
  const pre: number[][] = [x];
  let cur = x;
  for (let l = 0; l < net.W.length; l++) {
    const out: number[] = new Array(net.W[l].length);
    const z: number[] = new Array(net.W[l].length);
    for (let j = 0; j < net.W[l].length; j++) {
      let s = net.b[l][j];
      const row = net.W[l][j];
      for (let i = 0; i < cur.length; i++) s += row[i] * cur[i];
      z[j] = s;
      // tanh hidden, linear output
      out[j] = l === net.W.length - 1 ? s : Math.tanh(s);
    }
    pre.push(z);
    acts.push(out);
    cur = out;
  }
  return { acts, pre };
}

function backprop(net: Net, x: number[], y: number): number {
  const { acts, pre } = forward(net, x);
  const L = net.W.length;
  // Output delta (linear unit, MSE loss): dL/dz = (yhat - y)
  const yhat = acts[L][0];
  const err = yhat - y;
  const deltas: number[][] = new Array(L);
  deltas[L - 1] = [err];
  for (let l = L - 2; l >= 0; l--) {
    const next = deltas[l + 1];
    const Wnext = net.W[l + 1];
    const z = pre[l + 1];
    const d: number[] = new Array(net.W[l].length).fill(0);
    for (let j = 0; j < d.length; j++) {
      let s = 0;
      for (let k = 0; k < next.length; k++) s += Wnext[k][j] * next[k];
      // tanh derivative: 1 - tanh(z)^2  → using activation a = tanh(z), 1-a^2
      const a = Math.tanh(z[j]);
      d[j] = s * (1 - a * a);
    }
    deltas[l] = d;
  }
  // Apply gradients with momentum
  for (let l = 0; l < L; l++) {
    const inAct = acts[l];
    for (let j = 0; j < net.W[l].length; j++) {
      const dj = deltas[l][j];
      for (let i = 0; i < inAct.length; i++) {
        const g = dj * inAct[i];
        net.vW[l][j][i] = MOMENTUM * net.vW[l][j][i] - LR * g;
        net.W[l][j][i] += net.vW[l][j][i];
      }
      net.vb[l][j] = MOMENTUM * net.vb[l][j] - LR * dj;
      net.b[l][j] += net.vb[l][j];
    }
  }
  return err * err;
}

function buildFeatures(
  returns: number[],
  vol: number[],
  feats: number[],
): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (let t = 4; t < returns.length - 1; t++) {
    X.push([
      returns[t - 1],
      returns[t - 2],
      returns[t - 3],
      returns[t - 4],
      vol[Math.min(t, vol.length - 1)] || 0,
      feats[Math.min(t, feats.length - 1)] || 0,
      Math.abs(returns[t - 1]),
      (returns[t - 1] + returns[t - 2]) * 0.5,
    ]);
    y.push(returns[t]);
  }
  return { X, y };
}

export function trainNetworkOnHistory(
  returns: number[],
  volatility: number[],
  features: number[],
  maxEpochs: number = MAX_EPOCHS_DEFAULT,
): NeuralNetworkResult {
  if (returns.length < 25) {
    return { forecast: [0, 0, 0, 0, 0], confidence: 0.3, activation: [0], loss: 1 };
  }
  const { X, y } = buildFeatures(returns, volatility, features);
  if (X.length < 10) {
    return { forecast: [0, 0, 0, 0, 0], confidence: 0.3, activation: [0], loss: 1 };
  }
  // Normalise targets to a reasonable scale so gradients aren't tiny.
  const yScale = Math.max(1e-6, Math.sqrt(y.reduce((a, b) => a + b * b, 0) / y.length));
  const yn = y.map((v) => v / yScale);

  // Train/holdout split — last 15% for confidence calc.
  const split = Math.max(1, Math.floor(X.length * 0.85));
  const Xtr = X.slice(0, split);
  const ytr = yn.slice(0, split);
  const Xho = X.slice(split);
  const yho = y.slice(split);

  const net = makeNet();
  let lastLoss = 0;
  let bestLoss = Infinity;
  let patience = 0;
  for (let epoch = 0; epoch < maxEpochs; epoch++) {
    // Shuffle indices
    const idx = Xtr.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let epochLoss = 0;
    for (const k of idx) epochLoss += backprop(net, Xtr[k], ytr[k]);
    epochLoss /= idx.length;
    lastLoss = epochLoss;
    if (epochLoss < bestLoss - 1e-5) {
      bestLoss = epochLoss;
      patience = 0;
    } else if (++patience >= 3) {
      break;
    }
  }

  // Holdout sign accuracy → confidence.
  let correct = 0;
  let total = 0;
  for (let i = 0; i < Xho.length; i++) {
    const pred = forward(net, Xho[i]).acts[ARCH.length - 1][0] * yScale;
    if (Math.abs(yho[i]) < 1e-9) continue;
    if (Math.sign(pred) === Math.sign(yho[i])) correct++;
    total++;
  }
  const confidence = total > 0 ? correct / total : 0.5;

  // Predict next return from the most recent feature row.
  const lastX = X[X.length - 1];
  const rawPred = forward(net, lastX).acts[ARCH.length - 1][0] * yScale;
  // Clip to a sane range relative to the training scale (avoid blow-up).
  const cap = 4 * yScale;
  const pred = Math.max(-cap, Math.min(cap, rawPred));
  const forecast: number[] = [pred];
  let cur = pred;
  for (let s = 1; s < 5; s++) {
    cur *= 0.7; // mean-reversion decay
    forecast.push(cur);
  }
  return { forecast, confidence, activation: [pred], loss: lastLoss };
}
