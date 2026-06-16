
-- Grant write access for anonymous learning pipeline
GRANT INSERT ON public.predictions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.prediction_outcomes TO anon, authenticated;
GRANT INSERT, UPDATE ON public.model_weights TO anon, authenticated;
GRANT INSERT ON public.news_sentiment_cache TO anon, authenticated;

CREATE POLICY "Predictions public insert" ON public.predictions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Outcomes public insert" ON public.prediction_outcomes
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Outcomes public update" ON public.prediction_outcomes
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Weights public insert" ON public.model_weights
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Weights public update" ON public.model_weights
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "News cache public insert" ON public.news_sentiment_cache
  FOR INSERT TO anon, authenticated WITH CHECK (true);
