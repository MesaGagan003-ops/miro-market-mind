// Server-side proxy for Binance public REST endpoints.
// The browser cannot call api.binance.com directly:
//  - CORS is not allowed by Binance
//  - Binance geo-blocks many cloud / CDN IP ranges with HTTP 451
// Running the fetch on the edge worker avoids both issues.

import { createServerFn } from "@tanstack/react-start";

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
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
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
