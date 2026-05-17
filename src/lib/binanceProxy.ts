// Server-side proxy for Binance public REST endpoints.
// The browser cannot call api.binance.com directly:
//  - CORS is not allowed by Binance
//  - Binance geo-blocks many cloud / CDN IP ranges with HTTP 451
// Running the fetch on the edge worker avoids both issues.

import { createServerFn } from "@tanstack/react-start";

// Cache for CoinGecko `/coins/list` to avoid repeated lookups on the edge.
const coinGeckoListCache: { ts: number; data?: Array<{ id: string; symbol: string; name: string }> } = { ts: 0 };

async function findCoinGeckoId(symbol: string): Promise<string | null> {
  const s = symbol.replace(/USDT$/i, "").toLowerCase();
  // Fast-path: common tokens map directly by id
  if (s === "btc") return "bitcoin";
  if (s === "eth") return "ethereum";
  if (s === "usdc") return "usd-coin";
  if (s === "usdt") return "tether";

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

    // If Binance geo-blocks (451) try a CoinGecko market_chart fallback.
    if (!res.ok) {
      if (res.status === 451) {
        try {
          const cgId = (await findCoinGeckoId(data.symbol)) ?? data.symbol.replace(/USDT$/i, "").toLowerCase();
          // days estimate: cover at least `limit` minutes -> days = ceil(limit / 1440)
          const days = Math.max(1, Math.ceil(data.limit / 1440));
          const cgUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`;
          const cgRes = await fetch(cgUrl, { headers: { "User-Agent": "QuantumEdge/1.0" } });
          if (cgRes.ok) {
            const cj = await cgRes.json();
            const prices = (cj.prices ?? []) as Array<[number, number]>;
            // Return up to `limit` most recent points mapped to Tick-like shape.
            const sliced = prices.slice(-data.limit);
            return sliced.map(([ts, price]) => ({ ts: Math.floor(ts), price }));
          }
        } catch (err) {
          // fall through to throw original Binance error below
        }
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
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${data.symbol}`;
    const res = await fetch(url, { headers: { "User-Agent": "QuantumEdge/1.0" } });

    // Binance may geo-block (HTTP 451) for some cloud/CDN IP ranges. In that
    // case, try a lightweight CoinGecko fallback so the UI can still show a
    // live-ish price instead of failing outright.
    if (!res.ok) {
      if (res.status === 451) {
        try {
          const base = data.symbol.replace(/USDT$/i, "").toLowerCase();
          const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
            base,
          )}&vs_currencies=usd`;
          const cgRes = await fetch(cgUrl, { headers: { "User-Agent": "QuantumEdge/1.0" } });
          if (cgRes.ok) {
            const cj = await cgRes.json();
            const price = cj?.[base]?.usd;
            if (typeof price === "number") return { price, ts: Date.now() };
          }
        } catch (err) {
          // fall through to throw the original Binance error below
        }
      }

      throw new Error(`Binance ticker ${res.status}`);
    }

    const j = (await res.json()) as { price: string };
    return { price: parseFloat(j.price), ts: Date.now() };
  });
