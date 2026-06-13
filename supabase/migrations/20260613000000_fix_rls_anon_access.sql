-- Fix RLS policies for MIRO tables so the anon (public) key can read AND write.
-- The original migration only created SELECT + INSERT policies.
-- The adaptive learning layer also needs UPDATE (for model_weights upsert)
-- and anon role needs explicit GRANTs because Supabase's default security
-- revokes table privileges from anon/authenticated until you grant them.

-- ─────────────────────────────────────────
-- 1. predictions
-- ─────────────────────────────────────────
GRANT SELECT, INSERT ON public.predictions TO anon, authenticated;

-- Drop stale policies if they exist so we can recreate cleanly
DROP POLICY IF EXISTS "Predictions are public read" ON public.predictions;
DROP POLICY IF EXISTS "Anyone can insert predictions" ON public.predictions;

CREATE POLICY "Predictions are public read"
  ON public.predictions FOR SELECT USING (true);

CREATE POLICY "Anyone can insert predictions"
  ON public.predictions FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────
-- 2. prediction_outcomes
-- ─────────────────────────────────────────
GRANT SELECT, INSERT ON public.prediction_outcomes TO anon, authenticated;

DROP POLICY IF EXISTS "Outcomes are public read" ON public.prediction_outcomes;
DROP POLICY IF EXISTS "Anyone can insert outcomes" ON public.prediction_outcomes;

CREATE POLICY "Outcomes are public read"
  ON public.prediction_outcomes FOR SELECT USING (true);

CREATE POLICY "Anyone can insert outcomes"
  ON public.prediction_outcomes FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────
-- 3. model_weights  (needs UPDATE for the EMA upsert)
-- ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.model_weights TO anon, authenticated;

DROP POLICY IF EXISTS "Weights are public read" ON public.model_weights;
DROP POLICY IF EXISTS "Anyone can upsert weights" ON public.model_weights;
DROP POLICY IF EXISTS "Anyone can update weights" ON public.model_weights;

CREATE POLICY "Weights are public read"
  ON public.model_weights FOR SELECT USING (true);

CREATE POLICY "Anyone can insert weights"
  ON public.model_weights FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update weights"
  ON public.model_weights FOR UPDATE USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────
-- 4. news_sentiment_cache
-- ─────────────────────────────────────────
GRANT SELECT, INSERT ON public.news_sentiment_cache TO anon, authenticated;

DROP POLICY IF EXISTS "News cache public read" ON public.news_sentiment_cache;
DROP POLICY IF EXISTS "Anyone can insert news" ON public.news_sentiment_cache;

CREATE POLICY "News cache public read"
  ON public.news_sentiment_cache FOR SELECT USING (true);

CREATE POLICY "Anyone can insert news"
  ON public.news_sentiment_cache FOR INSERT WITH CHECK (true);
