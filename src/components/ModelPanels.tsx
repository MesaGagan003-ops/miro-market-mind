import type { HybridResult } from "@/lib/physics/hybrid";
import { HMM_STATE_LABELS } from "@/lib/physics/hmm";

export interface RegimeHistoryEntry {
  state: 0 | 1 | 2;
  startedAt: number;
}

interface Props {
  result: HybridResult;
  currentPrice: number;
  minutes: number;
  regimeHistory: RegimeHistoryEntry[];
}

export function ModelPanels({ result, regimeHistory }: Props) {
  const arima = result.arima ?? {
    c: 0,
    phi: 0,
    phi2: 0,
    theta: 0,
    residualStd: 0,
    driftPerStep: 0,
  };
  const garch = result.garch ?? { omega: 0, alpha: 0, beta: 0, sigma: 0, sigmaReturn: 0 };
  const hmm = result.hmm ?? {
    dominantState: 1,
    stateProbs: [0.33, 0.34, 0.33],
    transitionMatrix: [
      [0.7, 0.2, 0.1],
      [0.2, 0.6, 0.2],
      [0.1, 0.2, 0.7],
    ],
    emIterations: 0,
    logLik: 0,
    viterbiSamples: 0,
  };
  const entropy = result.entropy ?? { H: 0, edge: 0, upRatio: 0 };
  const hurst = result.hurst ?? { H: 0.5, regime: "random" };
  const hamiltonian = result.hamiltonian ?? { H: 0, KE: 0, PE: 0, velocity: 0 };
  const ssl = result.ssl ?? { upper: 0, lower: 0, reachableRange: 0, dTV: 0, meanSpeed: 0, tightness: 0 };
  const kalman = result.kalman ?? { snr: 0, velocity: 0 };
  const jump = result.jump ?? { lambda: 0, jumpFraction: 0, pUp: 0, recentJump: null };
  const hawkes = result.hawkes ?? {
    branching: 0,
    currentIntensity: 0,
    cascadeProbability: 0,
    isClusterRegime: false,
  };
  const wavelet = result.wavelet ?? { dominantScale: 0, trendSlope: 0 };
  const te = result.transferEntropy ?? { selfTE: 0, crossTE: null };
  const multifractal = result.multifractal ?? { width: 0, regimeShiftRisk: "low" };
  const fokkerPlanck = result.fokkerPlanck ?? { mean: 0, bands: [{ lower: 0, upper: 0 }, { lower: 0, upper: 0 }, { lower: 0, upper: 0 }] };

  const garchOmega = Number(garch.omega ?? 0);
  const garchAlpha = Number(garch.alpha ?? 0);
  const garchBeta = Number(garch.beta ?? 0);
  const garchSigma = Number(garch.sigma ?? 0);
  const fpBand = fokkerPlanck.bands?.[2] ?? { lower: 0, upper: 0 };
  const fpLower = Number(fpBand.lower ?? 0);
  const fpUpper = Number(fpBand.upper ?? 0);

  const hamiltonianH = Number(hamiltonian.H ?? 0);
  const hamiltonianKE = Number(hamiltonian.KE ?? 0);
  const hamiltonianPE = Number(hamiltonian.PE ?? 0);
  const hamiltonianVelocity = Number(hamiltonian.velocity ?? 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <RegimeDurationForecast hmm={hmm} regimeHistory={regimeHistory} />

      {/* === Phase B Tier 1+2 physics summary === */}
      <Panel
        title="Phase B Physics (Tier 1+2)"
        accent="var(--primary)"
        subtitle="Kalman · Jump-Diffusion · Hawkes · Fokker–Planck · Wavelet · Transfer Entropy · Multifractal"
        full
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          <Row label="Kalman SNR" value={kalman.snr.toFixed(2)} />
          <Row label="Kalman velocity" value={signedPrice(kalman.velocity)} />
          <Row label="Jump rate λ (per step)" value={jump.lambda.toFixed(4)} />
          <Row label="Jump variance share" value={`${(jump.jumpFraction * 100).toFixed(1)}%`} />
          <Row label="P(up jump)" value={`${(jump.pUp * 100).toFixed(0)}%`} />
          <Row label="Hawkes branching n=α/β" value={hawkes.branching.toFixed(3)} />
          <Row label="Hawkes intensity λ(t)" value={hawkes.currentIntensity.toFixed(4)} />
          <Row
            label="P(cascade in 10 steps)"
            value={`${(hawkes.cascadeProbability * 100).toFixed(1)}%`}
          />
          <Row label="Wavelet dominant scale" value={`2^${wavelet.dominantScale + 1} bars`} />
          <Row label="Wavelet trend slope" value={`${(wavelet.trendSlope * 100).toFixed(3)}%`} />
          <Row label="Transfer entropy (self)" value={te.selfTE.toFixed(3)} />
          <Row
            label="Transfer entropy (cross)"
            value={te.crossTE != null ? te.crossTE.toFixed(3) : "—"}
          />
          <Row label="Multifractal width Δh" value={multifractal.width.toFixed(3)} />
          <Row label="Regime-shift risk" value={multifractal.regimeShiftRisk.toUpperCase()} />
          <Row label="Fokker–Planck mean" value={formatPrice(fokkerPlanck.mean)} />
          <Row
            label="FP 90% band"
            value={`${formatPrice(fokkerPlanck.bands[2].lower)} – ${formatPrice(fokkerPlanck.bands[2].upper)}`}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
          {hawkes.isClusterRegime
            ? "⚠ CLUSTER REGIME — Hawkes self-excitation high; expect more jumps soon."
            : multifractal.regimeShiftRisk === "high"
              ? "⚠ REGIME SHIFT WARNING — multifractal width spiked; ARIMA confidence reduced."
              : jump.jumpFraction > 0.4
                ? "Fat-tail regime — jump variance dominates diffusion. Hybrid drift includes Kou compound-Poisson term."
                : "Diffusion-dominated regime — Gaussian assumption holds; full ensemble engaged."}
        </p>
      </Panel>

      <Panel
        title="ARIMA(2,1,1)"
        accent="var(--arima)"
        subtitle="y'ₜ = c + φ₁·y'ₜ₋₁ + φ₂·y'ₜ₋₂ + θ·εₜ₋₁ + εₜ"
      >
        <Row label="Drift c" value={signedPrice(arima.c)} />
        <Row label="φ₁ (AR lag-1)" value={arima.phi.toFixed(3)} />
        <Row label="φ₂ (AR lag-2)" value={(arima.phi2 ?? 0).toFixed(3)} />
        <Row label="θ (MA shock)" value={arima.theta.toFixed(3)} />
        <Row label="Long-run drift / step" value={signedPrice(arima.driftPerStep)} />
        <Row label="Residual σ" value={formatPrice(arima.residualStd)} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          Two-lag autoregressive memory captures momentum + mean-reversion together. Recursive
          forecast samples ε ~ N(0, σ_resid) per step — that's the wiggle.
        </p>
      </Panel>

      <Panel title="GARCH(1,1)" accent="var(--garch)" subtitle="σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁">
        <Row label="ω (baseline)" value={garchOmega.toExponential(2)} />
        <Row label="α (shock reactivity)" value={garchAlpha.toFixed(3)} />
        <Row label="β (volatility memory)" value={garchBeta.toFixed(3)} />
        <Row label="α + β (persistence)" value={(garchAlpha + garchBeta).toFixed(3)} />
        <Row label="1σ band" value={`±${formatPrice(garchSigma)}`} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          {garchAlpha + garchBeta > 0.95
            ? "Persistent — once volatility spikes it lingers."
            : garchAlpha > garchBeta
              ? "Spiky — reacts fast to shocks then calms."
              : "Sluggish — slow to react but trends long."}
        </p>
      </Panel>

      <Panel
        title="Hidden Markov Model"
        accent="var(--hmm)"
        subtitle="Baum-Welch EM + Viterbi over 3 latent regimes"
        full
      >
        <div className="grid grid-cols-3 gap-2 mb-3 text-[10px]">
          <div className="rounded border border-border px-2 py-1.5">
            <div className="text-muted-foreground uppercase">EM iterations</div>
            <div className="text-foreground font-mono font-semibold">{hmm.emIterations ?? 0}</div>
          </div>
          <div className="rounded border border-border px-2 py-1.5">
            <div className="text-muted-foreground uppercase">Log-likelihood</div>
            <div className="text-foreground font-mono font-semibold">
              {(hmm.logLik ?? 0).toFixed(1)}
            </div>
          </div>
          <div className="rounded border border-border px-2 py-1.5">
            <div className="text-muted-foreground uppercase">Viterbi length</div>
            <div className="text-foreground font-mono font-semibold">{hmm.viterbiSamples ?? 0}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Current state probabilities
            </div>
            {hmm.stateProbs.map((p, i) => (
              <div key={i} className="mb-1.5">
                <div className="flex justify-between text-xs mb-0.5">
                  <span
                    className={
                      i === hmm.dominantState
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground"
                    }
                  >
                    {HMM_STATE_LABELS[i]}
                  </span>
                  <span className="text-foreground font-mono">{(p * 100).toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${p * 100}%`,
                      background:
                        i === 0 ? "var(--bear)" : i === 2 ? "var(--bull)" : "var(--entropy)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Transition matrix P(sₜ | sₜ₋₁) — re-estimated by EM
            </div>
            <TransitionMatrix matrix={hmm.transitionMatrix} />
          </div>
        </div>
      </Panel>

      <Panel title="Shannon Entropy" accent="var(--entropy)" subtitle="H(X) = −Σ p(xᵢ) log₂ p(xᵢ)">
        <div className="text-3xl font-display font-bold text-foreground">
          H = {entropy.H.toFixed(3)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Edge ≈ {(entropy.edge * 100).toFixed(1)}% &nbsp;·&nbsp; Up-ratio{" "}
          {(entropy.upRatio * 100).toFixed(0)}%
        </div>
        <div className="mt-2 h-1.5 bg-muted rounded overflow-hidden">
          <div className="h-full bg-entropy" style={{ width: `${entropy.H * 100}%` }} />
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {entropy.H > 0.85
            ? "High — chaotic, near-random walk. Don't overtrade."
            : entropy.H > 0.6
              ? "Medium — transitional, regime shifting."
              : "Low — trending, organized. Strong signal."}
        </div>
      </Panel>

      <Panel
        title="Hurst Exponent"
        accent="var(--entropy)"
        subtitle="Trend persistence (R/S analysis)"
      >
        <div className="text-3xl font-display font-bold text-foreground">
          H = {hurst.H.toFixed(3)}
        </div>
        <div className="text-xs text-muted-foreground mt-1 capitalize">
          Regime:{" "}
          <span className="text-foreground font-semibold">{hurst.regime.replace("_", " ")}</span>
        </div>
        <div className="mt-2 h-1.5 bg-muted rounded overflow-hidden relative">
          <div
            className="h-full"
            style={{ width: `${hurst.H * 100}%`, background: "var(--entropy)" }}
          />
          <div className="absolute top-0 bottom-0 w-px bg-foreground/40" style={{ left: "50%" }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
          {hurst.H > 0.55
            ? "Trending — ARIMA drift trusted, deviation kept."
            : hurst.H < 0.45
              ? "Mean-reverting — path pulled harder back to spot."
              : "Random walk — limited predictability."}
        </p>
      </Panel>

      <Panel title="Hamiltonian Energy" accent="var(--garch)" subtitle="H = ½v² + ½(ΔP/P)²">
        <Row label="Total energy H" value={hamiltonianH.toExponential(2)} />
        <Row label="Kinetic (velocity²)" value={hamiltonianKE.toExponential(2)} />
        <Row label="Potential (Δ from MA)" value={hamiltonianPE.toExponential(2)} />
        <Row
          label="Velocity (log-ret/step)"
          value={`${hamiltonianVelocity >= 0 ? "+" : ""}${(hamiltonianVelocity * 100).toFixed(3)}%`}
        />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          {hamiltonianKE > hamiltonianPE
            ? "High kinetic — strong momentum, room to run."
            : "High potential — stretched from mean, reversion risk."}
        </p>
      </Panel>

      {/* Quantum Speed Limit panel removed per request. */}

      <Panel title="Stochastic Speed Limit" accent="var(--ssl)" subtitle="Master-equation bound">
        <Row label="Upper bound" value={formatPrice(Number(ssl.upper ?? 0))} />
        <Row label="Lower bound" value={formatPrice(Number(ssl.lower ?? 0))} />
        <Row label="Reachable range" value={`±${formatPrice(Number(ssl.reachableRange ?? 0) / 2)}`} />
        <Row label="D_TV (prob. distance)" value={Number(ssl.dTV ?? 0).toFixed(3)} />
        <Row label="⟨v⟩ (mean speed)" value={Number(ssl.meanSpeed ?? 0).toFixed(4)} />
        <Row label="Tightness Q" value={Number(ssl.tightness ?? 0).toFixed(2)} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          τ ≥ D_TV / ⟨v⟩ (Master Equation, regime probabilities). Q→1 means the system is following
          a near-optimal geodesic in probability space; Q≪1 means the bound has slack.
        </p>
      </Panel>
    </div>
  );
}

function RegimeDurationForecast({
  hmm,
  regimeHistory,
}: {
  hmm: HybridResult["hmm"];
  regimeHistory: RegimeHistoryEntry[];
}) {
  const currentState = hmm.dominantState;
  const stateLabels = ["Bear", "Sideways", "Bull"];
  const stateNames = ["Bearish", "Sideways", "Bullish"];
  const stateColors = ["var(--bear)", "var(--entropy)", "var(--bull)"];
  const currentColor = stateColors[currentState];
  const selfTransition = hmm.transitionMatrix[currentState]?.[currentState] ?? 0;
  const continuePct = Math.max(0, Math.min(100, selfTransition * 100));
  const flipPct = Math.max(0, 100 - continuePct);
  const expectedDuration =
    selfTransition >= 1 ? Number.POSITIVE_INFINITY : 1 / Math.max(1e-6, 1 - selfTransition);
  const historySegments = (() => {
    const segments =
      regimeHistory.length > 0
        ? [...regimeHistory]
        : [{ state: currentState, startedAt: Date.now() }];
    if (segments[segments.length - 1].state !== currentState) {
      segments.push({ state: currentState, startedAt: Date.now() });
    }
    return segments;
  })();

  const currentSegment = historySegments[historySegments.length - 1];
  const elapsedBars = currentSegment
    ? Math.max(0, (Date.now() - currentSegment.startedAt) / 60_000)
    : 0;

  const historyWidths = historySegments.map((segment, index) => {
    const nextStart = historySegments[index + 1]?.startedAt ?? Date.now();
    return Math.max(0.25, nextStart - segment.startedAt);
  });
  const totalHistory = historyWidths.reduce((a, b) => a + b, 0) || 1;

  return (
    <Panel
      title="Regime Duration Forecast"
      accent={currentColor}
      subtitle="HMM transition matrix · expected duration · live regime history"
      full
    >
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Current regime
              </div>
              <div
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-semibold"
                style={{
                  boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${currentColor} 18%, transparent)`,
                }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: currentColor }} />
                <span className="text-foreground">{stateNames[currentState]}</span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Already lasted
              </div>
              <div className="text-sm font-semibold text-foreground font-mono">
                {elapsedBars.toFixed(elapsedBars < 10 ? 1 : 0)} bars ·{" "}
                {elapsedBars.toFixed(elapsedBars < 10 ? 1 : 0)} min
              </div>
            </div>
          </div>

          <div className="rounded border border-border/60 bg-card/40 p-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">Continue vs flip</span>
              <span className="font-mono text-foreground">
                {continuePct.toFixed(0)}% / {flipPct.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/70">
              <div
                className="h-full rounded-full"
                style={{ width: `${continuePct}%`, background: currentColor }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
              <span>Continues</span>
              <span>Flips</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {stateLabels.map((label, index) => {
              const pii = hmm.transitionMatrix[index]?.[index] ?? 0;
              const duration = ppiToDuration(pii);
              return (
                <div key={label} className="rounded border border-border/60 bg-card/35 p-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: stateColors[index] }}
                    />
                  </div>
                  <div className="text-sm font-semibold text-foreground font-mono">
                    {formatDuration(duration)} bars
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Pii {(pii * 100).toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground uppercase tracking-wider">
                Expected remaining duration
              </span>
              <span className="font-mono text-foreground">
                {formatDuration(expectedDuration)} bars
              </span>
            </div>
            <div className="rounded border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] text-muted-foreground leading-relaxed">
                Calculated from the HMM self-transition probability: duration = 1 / (1 - Pii)
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground uppercase tracking-wider">Regime history</span>
              <span className="text-muted-foreground">Recent switches</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full border border-border/60 bg-muted/60 flex">
              {historySegments.map((segment, index) => {
                const nextStart = historySegments[index + 1]?.startedAt ?? Date.now();
                const width = Math.max(0.25, nextStart - segment.startedAt);
                const pct = (width / totalHistory) * 100;
                return (
                  <div
                    key={`${segment.startedAt}-${index}`}
                    title={`${stateNames[segment.state]} · ${formatDuration(width / 60_000)} bars`}
                    className="h-full"
                    style={{ width: `${pct}%`, background: stateColors[segment.state] }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              {stateNames.map((label, index) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: stateColors[index] }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ppiToDuration(pii: number) {
  if (pii >= 1) return Number.POSITIVE_INFINITY;
  return 1 / Math.max(1e-6, 1 - pii);
}

function formatDuration(v: number) {
  if (!Number.isFinite(v)) return "∞";
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

function TransitionMatrix({ matrix }: { matrix: number[][] }) {
  const labels = ["Bear", "Neutral", "Bull"];
  return (
    <div className="overflow-hidden rounded border border-border">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="bg-muted/40">
            <th className="px-2 py-1 text-left text-muted-foreground font-normal">from \ to</th>
            {labels.map((l) => (
              <th key={l} className="px-2 py-1 text-right text-muted-foreground font-normal">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-2 py-1 text-muted-foreground">{labels[i]}</td>
              {row.map((v, j) => {
                const intensity = Math.min(1, v * 1.2);
                return (
                  <td
                    key={j}
                    className="px-2 py-1 text-right text-foreground"
                    style={{
                      background: `color-mix(in oklab, var(--hmm) ${intensity * 35}%, transparent)`,
                    }}
                  >
                    {(v * 100).toFixed(0)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  accent,
  children,
  full,
}: {
  title: string;
  subtitle?: string;
  accent: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div
      className={`panel p-4 ${full ? "lg:col-span-2" : ""}`}
      style={{ borderTop: `2px solid ${accent}` }}
    >
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <h3 className="font-display font-semibold text-sm text-foreground">{title}</h3>
        {subtitle && (
          <span className="text-[10px] text-muted-foreground font-mono">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function formatPrice(v: number): string {
  if (Math.abs(v) >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  if (Math.abs(v) >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

function signedPrice(v: number): string {
  const s = v >= 0 ? "+" : "−";
  return `${s}${formatPrice(Math.abs(v))}`;
}
