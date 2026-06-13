// Server functions for adaptive learning persistence.
// These use the admin client (service_role) so DB write policies can be
// locked down to service_role only. Input is strictly validated here.

import { createServerFn } from "@tanstack/react-start";

const MARKETS = new Set(["crypto", "forex", "nse", "bse", "stock", "us"]);
const DIRS = new Set(["up", "down", "flat"]);

function clamp(n: unknown, min: number, max: number, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function str(v: unknown, max = 64): string {
  return String(v ?? "")
    .slice(0, max)
    .replace(/[^a-zA-Z0-9_:.\-\/]/g, "");
}

function validateRecord(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  const market = str(i.market, 16).toLowerCase();
  const symbol = str(i.symbol, 32).toUpperCase();
  const timeframe = str(i.timeframe, 16);
  const direction = String(i.direction ?? "flat");
  if (!market || !symbol || !timeframe) throw new Error("missing keys");
  if (!MARKETS.has(market)) throw new Error("bad market");
  if (!DIRS.has(direction)) throw new Error("bad direction");
  const weights = (i.weights && typeof i.weights === "object" ? i.weights : {}) as Record<
    string,
    unknown
  >;
  const features = i.features && typeof i.features === "object" ? (i.features as object) : null;
  return {
    market,
    symbol,
    timeframe,
    spotPrice: clamp(i.spotPrice, 0, 1e12),
    predictedPrice: clamp(i.predictedPrice, 0, 1e12),
    direction: direction as "up" | "down" | "flat",
    horizonSeconds: Math.floor(clamp(i.horizonSeconds, 1, 60 * 60 * 24 * 30)),
    hybridConfidence: clamp(i.hybridConfidence, 0, 1),
    weights,
    features,
  };
}

export const recordPredictionServer = createServerFn({ method: "POST" })
  .inputValidator(validateRecord)
  .handler(async ({ data }): Promise<{ id: string | null }> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row, error } = await supabaseAdmin
        .from("predictions")
        .insert({
          market: data.market,
          symbol: data.symbol,
          timeframe: data.timeframe,
          spot_price: data.spotPrice,
          predicted_price: data.predictedPrice,
          direction: data.direction,
          horizon_seconds: data.horizonSeconds,
          hybrid_confidence: data.hybridConfidence,
          weights: data.weights as never,
          features: (data.features ?? null) as never,
          llm_bias: null,
          resolves_at: new Date(Date.now() + data.horizonSeconds * 1000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: row?.id ?? null };
    } catch (e) {
      console.warn("[learning.fn] record failed", e);
      return { id: null };
    }
  });

function validateOutcomes(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(i.outcomes) ? i.outcomes : [];
  const outcomes = arr.slice(0, 100).map((o) => {
    const r = (o ?? {}) as Record<string, unknown>;
    const dir = String(r.actual_direction ?? "flat");
    return {
      prediction_id: String(r.prediction_id ?? "").slice(0, 64),
      actual_price: clamp(r.actual_price, 0, 1e12),
      actual_direction: (DIRS.has(dir) ? dir : "flat") as "up" | "down" | "flat",
      direction_correct: Boolean(r.direction_correct),
      abs_error: clamp(r.abs_error, 0, 1e12),
      pct_error: clamp(r.pct_error, 0, 1e6),
      brier_score: clamp(r.brier_score, 0, 1),
    };
  });
  return { outcomes };
}

export const upsertOutcomesServer = createServerFn({ method: "POST" })
  .inputValidator(validateOutcomes)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (data.outcomes.length === 0) return { ok: true };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("prediction_outcomes")
        .upsert(data.outcomes, { onConflict: "prediction_id", ignoreDuplicates: true });
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn("[learning.fn] outcomes failed", e);
      return { ok: false };
    }
  });

function validateWeights(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  const market = str(i.market, 16).toLowerCase();
  const symbol = str(i.symbol, 32).toUpperCase();
  const timeframe = str(i.timeframe, 16);
  if (!market || !symbol || !timeframe) throw new Error("missing keys");
  if (!MARKETS.has(market)) throw new Error("bad market");
  return {
    market,
    symbol,
    timeframe,
    arima_w: clamp(i.arima_w, 0, 1),
    hmm_w: clamp(i.hmm_w, 0, 1),
    entropy_w: clamp(i.entropy_w, 0, 1),
    hurst_w: clamp(i.hurst_w, 0, 1),
    llm_w: clamp(i.llm_w, 0, 1),
    samples: Math.floor(clamp(i.samples, 0, 1e9)),
    recent_brier: clamp(i.recent_brier, 0, 1),
    recent_accuracy: clamp(i.recent_accuracy, 0, 1),
  };
}

export const upsertWeightsServer = createServerFn({ method: "POST" })
  .inputValidator(validateWeights)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("model_weights")
        .upsert(
          { ...data, updated_at: new Date().toISOString() },
          { onConflict: "market,symbol,timeframe" },
        );
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn("[learning.fn] weights failed", e);
      return { ok: false };
    }
  });
