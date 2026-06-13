
-- Drop overly permissive public write policies; reads stay public.
DROP POLICY IF EXISTS "Anyone can insert predictions" ON public.predictions;
DROP POLICY IF EXISTS "Anyone can insert outcomes" ON public.prediction_outcomes;
DROP POLICY IF EXISTS "Anyone can insert weights" ON public.model_weights;
DROP POLICY IF EXISTS "Anyone can upsert weights" ON public.model_weights;
DROP POLICY IF EXISTS "Anyone can update weights" ON public.model_weights;
DROP POLICY IF EXISTS "Anyone can insert news" ON public.news_sentiment_cache;

-- Revoke anon/authenticated write privileges; service_role retains full access.
REVOKE INSERT, UPDATE, DELETE ON public.predictions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.prediction_outcomes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.model_weights FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.news_sentiment_cache FROM anon, authenticated;

GRANT ALL ON public.predictions TO service_role;
GRANT ALL ON public.prediction_outcomes TO service_role;
GRANT ALL ON public.model_weights TO service_role;
GRANT ALL ON public.news_sentiment_cache TO service_role;
