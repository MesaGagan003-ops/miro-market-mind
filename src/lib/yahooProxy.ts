import { createServerFn } from "@tanstack/react-start";

type YahooPoint = { ts: number; price: number };

interface YahooChartResult {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
      meta?: { regularMarketPrice?: number };
    }>;
    error?: { code?: string; description?: string };
  };
}

const cache = new Map<string, { fetchedAt: number; rows: YahooPoint[] }>();
const inflight = new Map<string, Promise<YahooPoint[]>>();
const INTRADAY_INTERVALS = new Set(["1m", "2m", "5m", "15m", "30m", "60m", "90m"]);

function cacheKey(input: { symbol: string; interval: string; range: string }): string {
  return `${input.symbol}::${input.interval}::${input.range}`;
}

function ttlMs(interval: string, range: string): number {
  if (range === "1d" || INTRADAY_INTERVALS.has(interval)) return 60_000;
  if (range === "5d" || range === "1mo") return 5 * 60_000;
  return 15 * 60_000;
}

function parseInput(input: unknown): { symbol: string; interval: string; range: string } {
  const i = (input ?? {}) as { symbol?: string; interval?: string; range?: string };
  return {
    symbol: String(i.symbol ?? "BTC-USD").toUpperCase(),
    interval: String(i.interval ?? "1m"),
    range: String(i.range ?? "7d"),
  };
}

export const fetchYahooHistory = createServerFn({ method: "GET" })
  .inputValidator(parseInput)
  .handler(async ({ data }) => {
    const key = cacheKey(data);
    const now = Date.now();
    const cached = cache.get(key);
    const freshEnough = cached && now - cached.fetchedAt < ttlMs(data.interval, data.range);
    if (freshEnough) return cached.rows;

    const existing = inflight.get(key);
    if (existing) return existing;

    const request = (async () => {
      const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
      let lastError: string | null = null;

      for (const host of hosts) {
        try {
          const url = `${host}/v8/finance/chart/${encodeURIComponent(data.symbol)}?interval=${encodeURIComponent(data.interval)}&range=${encodeURIComponent(data.range)}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; MIRO/1.0)",
              Accept: "application/json,text/plain,*/*",
              "Accept-Language": "en-US,en;q=0.9",
              Pragma: "no-cache",
              "Cache-Control": "no-cache",
            },
          });
          if (!res.ok) {
            lastError = `Yahoo ${host} ${res.status}`;
            continue;
          }

          const j = (await res.json()) as YahooChartResult;
          const r = j.chart?.result?.[0];
          const ts = r?.timestamp ?? [];
          const close = r?.indicators?.quote?.[0]?.close ?? [];

          const out: YahooPoint[] = [];
          for (let i = 0; i < ts.length; i++) {
            const p = Number(close[i]);
            if (Number.isFinite(p) && p > 0) out.push({ ts: ts[i] * 1000, price: p });
          }

          if (out.length > 0) {
            cache.set(key, { fetchedAt: now, rows: out });
            return out;
          }
          lastError = `Yahoo ${host} returned empty history`;
        } catch (err) {
          lastError = String((err as Error)?.message ?? err);
        }
      }

      if (cached?.rows.length) {
        return cached.rows;
      }

      if (lastError) {
        console.warn(`[fetchYahooHistory] ${data.symbol} ${data.interval}/${data.range}: ${lastError}`);
      }
      return [] as YahooPoint[];
    })();

    inflight.set(key, request);
    try {
      return await request;
    } finally {
      inflight.delete(key);
    }
  });
