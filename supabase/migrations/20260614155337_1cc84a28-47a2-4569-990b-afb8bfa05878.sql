GRANT SELECT ON public.predictions TO anon, authenticated;
GRANT SELECT ON public.prediction_outcomes TO anon, authenticated;
GRANT SELECT ON public.model_weights TO anon, authenticated;
GRANT SELECT ON public.news_sentiment_cache TO anon, authenticated;
GRANT ALL ON public.predictions TO service_role;
GRANT ALL ON public.prediction_outcomes TO service_role;
GRANT ALL ON public.model_weights TO service_role;
GRANT ALL ON public.news_sentiment_cache TO service_role;