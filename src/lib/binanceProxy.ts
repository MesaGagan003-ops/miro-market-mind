// Server-side proxy for Binance public REST endpoints.
// The browser cannot call api.binance.com directly:
//  - CORS is not allowed by Binance
//  - Binance geo-blocks many cloud / CDN IP ranges with HTTP 451
// Running the fetch on the edge worker avoids both issues.

import { createServerFn } from "@tanstack/react-start";
import { fetchYahooHistory } from "./yahooProxy";

// Cache for CoinGecko `/coins/list` to avoid repeated lookups on the edge.
const coinGeckoListCache: { ts: number; data?: Array<{ id: string; symbol: string; name: string }> } = { ts: 0 };
const coinGeckoPriceCache: Map<string, { ts: number; price: number }> = new Map();
const coinGeckoMarketChartCache: Map<string, { ts: number; data: Array<{ ts: number; price: number }> }> = new Map();
const binancePriceCache: Map<string, { ts: number; price: number }> = new Map();

function normalizeCoinGeckoId(symbolOrId: string) {
  const value = symbolOrId.replace(/USDT$/i, "").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  if (value === "btc") return "bitcoin";
  if (value === "eth") return "ethereum";
  if (value === "usdc") return "usd-coin";
  if (value === "usdt") return "tether";
  return value;
}

// CoinGecko's free tier updates ~every 30-60s. A 10-minute cache was making
// the UI feel minutes behind real markets. Drop to 8s so polling actually
// returns fresh prices while still respecting CoinGecko rate limits.
function getCachedCoinGeckoPrice(id: string, maxAgeMs = 8_000) {
  const cached = coinGeckoPriceCache.get(id);
  if (!cached) return null;
  return Date.now() - cached.ts <= maxAgeMs ? cached : null;
}

function setCachedCoinGeckoPrice(id: string, price: number) {
  coinGeckoPriceCache.set(id, { ts: Date.now(), price });
}

function getCachedCoinGeckoHistory(id: string, maxAgeMs = 60 * 60_000) {
  const cached = coinGeckoMarketChartCache.get(id);
  if (!cached) return null;
  return Date.now() - cached.ts <= maxAgeMs ? cached : null;
}

function setCachedCoinGeckoHistory(id: string, data: Array<{ ts: number; price: number }>) {
  coinGeckoMarketChartCache.set(id, { ts: Date.now(), data });
}

async function findCoinGeckoId(symbol: string): Promise<string | null> {
  const s = normalizeCoinGeckoId(symbol);
  // Fast-path: common tokens map directly by id
  if (s === "bitcoin" || s === "ethereum" || s === "usd-coin" || s === "tether") return s;

  // If we have a recent cache (10m), use it
  const now = Date.now();
  if (!coinGeckoListCache.data || now - coinGeckoListCache.ts > 10 * 60_000) {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/coins/list", {
        headers: { "User-Agent": "QuantumEdge/1.0" },
      });
      if (res.ok) {
        const list = (await res.json()) as Array<{ id: string; symbol: string; name: string }>;
        coinGeckoListCache.data = list;
        coinGeckoListCache.ts = now;
      }
    } catch {
      // ignore — we'll fall back to simple heuristic below
    }
  }

  const list = coinGeckoListCache.data;
  if (list) {
    const bySymbol = list.find((c) => c.symbol.toLowerCase() === s);
    if (bySymbol) return bySymbol.id;
    // try contains
    const partial = list.find((c) => c.id.toLowerCase().includes(s));
    if (partial) return partial.id;
  }

  return null;
}

async function fallbackBinanceToCoinGecko(symbol: string, limit?: number) {
  const cgId = (await findCoinGeckoId(symbol)) ?? normalizeCoinGeckoId(symbol);
  const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    cgId,
  )}&vs_currencies=usd`;
  const cgRes = await fetch(cgUrl, { headers: { "User-Agent": "QuantumEdge/1.0" } });
  if (cgRes.ok) {
    const cj = await cgRes.json();
    const price = cj?.[cgId]?.usd;
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      binancePriceCache.set(symbol, { ts: Date.now(), price });
      return { price, ts: Date.now() };
    }
  }

  const marketChartFallback = (await fetchCoinGeckoMarketChart({ data: { id: cgId, days: 1 } })) as Array<{
    ts: number;
    price: number;
  }>;
  if (limit && marketChartFallback.length > limit) {
    return marketChartFallback.slice(-limit);
  }

  const last = marketChartFallback[marketChartFallback.length - 1];
  if (last?.price) {
    binancePriceCache.set(symbol, { ts: Date.now(), price: last.price });
    return { price: last.price, ts: last.ts };
  }

  return null;
}

async function fallbackBinanceToYahoo(symbol: string, limit?: number) {
  const yahooSymbol = `${symbol.replace(/USDT$/i, "")}-USD`;
  const rows = await fetchYahooHistory({
    data: { symbol: yahooSymbol, interval: "1m", range: "1d" },
  });
  if (rows.length === 0) return null;

  if (limit && rows.length > limit) {
    return rows.slice(-limit);
  }

  const last = rows[rows.length - 1];
  if (last?.price) {
    binancePriceCache.set(symbol, { ts: Date.now(), price: last.price });
    return { price: last.price, ts: last.ts };
  }

  return null;
}

export const fetchBinanceKlines = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { symbol?: string; interval?: string; limit?: number };
    return {
      symbol: String(i.symbol ?? "BTCUSDT").toUpperCase(),
      interval: String(i.interval ?? "1m"),
      limit: Math.max(10, Math.min(1000, Number(i.limit ?? 240))),
    };
  })
  .handler(async ({ data }) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${data.symbol}&interval=${data.interval}&limit=${data.limit}`;
    const res = await fetch(url, { headers: { "User-Agent": "QuantumEdge/1.0" } });

    // If Binance fails for any reason, try Yahoo Finance first and CoinGecko second.
    if (!res.ok) {
      try {
        const fallback = (await fallbackBinanceToYahoo(data.symbol, data.limit)) ?? (await fallbackBinanceToCoinGecko(data.symbol, data.limit));
        if (fallback && Array.isArray(fallback)) {
          return fallback;
        }
      } catch {
        // fall through to throw original Binance error below
      }

      throw new Error(`Binance klines ${res.status}`);
    }

    const arr = (await res.json()) as Array<unknown[]>;
    return arr.map((k) => ({ ts: k[0] as number, price: parseFloat(k[4] as string) }));
  });

export const fetchBinancePrice = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { symbol?: string };
    return { symbol: String(i.symbol ?? "BTCUSDT").toUpperCase() };
  })
  .handler(async ({ data }) => {
    const cached = binancePriceCache.get(data.symbol);
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${data.symbol}`;
    const res = await fetch(url, { headers: { "User-Agent": "QuantumEdge/1.0" } });

    if (!res.ok) {
      try {
        const fallback = (await fallbackBinanceToYahoo(data.symbol)) ?? (await fallbackBinanceToCoinGecko(data.symbol));
        if (fallback && !Array.isArray(fallback)) return fallback;
      } catch {
        // fall through to cached/original error below
      }

      if (cached?.price) return { price: cached.price, ts: cached.ts };

      throw new Error(`Binance ticker ${res.status}`);
    }

    const j = (await res.json()) as { price: string };
    const price = parseFloat(j.price);
    if (Number.isFinite(price) && price > 0) {
      binancePriceCache.set(data.symbol, { ts: Date.now(), price });
      return { price, ts: Date.now() };
    }

    const fallback = (await fallbackBinanceToYahoo(data.symbol)) ?? (await fallbackBinanceToCoinGecko(data.symbol));
    if (fallback) return fallback;
    if (cached?.price) return { price: cached.price, ts: cached.ts };
    throw new Error(`Binance ticker invalid payload for ${data.symbol}`);
  });

export const fetchCoinGeckoPrice = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { id?: string };
    return { id: String(i.id ?? "bitcoin").trim().toLowerCase() };
  })
  .handler(async ({ data }) => {
    const cached = getCachedCoinGeckoPrice(data.id);
    if (cached) return { price: cached.price, ts: cached.ts };

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      data.id,
    )}&vs_currencies=usd&include_last_updated_at=true`;
    const res = await fetch(url, { headers: { "User-Agent": "QuantumEdge/1.0" } });
    if (!res.ok) {
      if (res.status === 429 || res.status === 451) {
        const cachedFallbackHistory = getCachedCoinGeckoHistory(data.id);
        if (cachedFallbackHistory && cachedFallbackHistory.data.length > 0) {
          const last = cachedFallbackHistory.data[cachedFallbackHistory.data.length - 1];
          if (last?.price) {
            setCachedCoinGeckoPrice(data.id, last.price);
            return { price: last.price, ts: last.ts };
          }
        }
        const cachedFallback = getCachedCoinGeckoPrice(data.id);
        if (cachedFallback) return { price: cachedFallback.price, ts: cachedFallback.ts };
      }
      throw new Error(`CoinGecko simple/price ${res.status}`);
    }
    const j = (await res.json()) as Record<string, { usd?: number; last_updated_at?: number }>;
    const price = j?.[data.id]?.usd;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`CoinGecko simple/price invalid payload for ${data.id}`);
    }
    const updatedSec = j?.[data.id]?.last_updated_at;
    setCachedCoinGeckoPrice(data.id, price);
    return { price, ts: (updatedSec ? updatedSec * 1000 : Date.now()) as number };
  });

export const fetchCoinGeckoMarketChart = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { id?: string; days?: number };
    return {
      id: String(i.id ?? "bitcoin").trim().toLowerCase(),
      days: Math.max(1, Math.min(365, Number(i.days ?? 1))),
    };
  })
  .handler(async ({ data }) => {
    const cached = getCachedCoinGeckoHistory(data.id);
    if (cached) return cached.data;

    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      data.id,
    )}/market_chart?vs_currency=usd&days=${data.days}`;
    const res = await fetch(url, { headers: { "User-Agent": "QuantumEdge/1.0" } });
    if (!res.ok) {
      throw new Error(`CoinGecko market_chart ${res.status}`);
    }
    const j = (await res.json()) as { prices?: Array<[number, number]> };
    const prices = Array.isArray(j.prices) ? j.prices : [];
    const mapped = prices
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(([ts, price]) => ({ ts: Math.floor(ts), price }));
    setCachedCoinGeckoHistory(data.id, mapped);
    return mapped;
  });
