// Live tick stream.  Browser cannot call api.binance.com directly (CORS + geo-block 451)
// nor open the public WebSocket from many cloud regions, so we proxy Binance through
// a TanStack Start server function and poll at ~1s for near-tick cadence.

import { fetchBinancePrice, fetchBinanceKlines } from "./binanceProxy";
import { fetchCoinGeckoMarketChart, fetchCoinGeckoPrice } from "./binanceProxy";
import { fetchForexHistory, fetchForexPrice } from "./forexProxy";
import { fetchYahooHistory } from "./yahooProxy";
import type { MarketAsset } from "./markets";
import type { RuntimeConfig } from "./runtimeConfig";

export interface Tick {
  price: number;
  ts: number;
  size?: number;
}

export type TickHandler = (tick: Tick) => void;
export type ProviderState = "live" | "fallback" | "failing";
export type ProviderStatusHandler = (status: {
  provider: string;
  state: ProviderState;
  detail?: string;
}) => void;

interface StreamOptions {
  runtimeConfig?: RuntimeConfig;
  onStatus?: ProviderStatusHandler;
}

export function subscribeBinance(
  symbol: string,
  onTick: TickHandler,
  opts?: StreamOptions,
  coinGeckoId?: string,
): () => void {
  let stopped = false;
  let lastPrice = 0;
  let lastFallbackPrice = 0;
  const poll = async () => {
    while (!stopped) {
      try {
        const t = await fetchBinancePrice({ data: { symbol } });
        if (t.price && t.price !== lastPrice) {
          lastPrice = t.price;
          onTick(t);
        } else if (t.price) {
          // still emit periodic ticks so model recomputes
          onTick(t);
        }
      } catch (e) {
        if (coinGeckoId) {
          try {
            const t = await fetchCoinGeckoPrice({ data: { id: coinGeckoId } });
            if (t.price && t.price !== lastFallbackPrice) {
              lastFallbackPrice = t.price;
              opts?.onStatus?.({ provider: "coingecko", state: "fallback", detail: symbol });
              onTick(t);
            } else if (t.price) {
              opts?.onStatus?.({ provider: "coingecko", state: "fallback", detail: symbol });
              onTick(t);
            }
            continue;
          } catch (fallbackError) {
            console.debug("[subscribeBinance] CoinGecko fallback failed", fallbackError);
          }
        }
        // Surface provider status so UI can display the failure
        try {
          opts?.onStatus?.({
            provider: "binance",
            state: "failing",
            detail: String((e as Error)?.message ?? e),
          });
        } catch (err) {
          console.debug("[subscribeBinance] onStatus handler failed", err);
        }
        console.error("[subscribeBinance] error", e);
      }
      // Binance ticker updates ~every 100ms upstream; 800ms is the sweet spot
      // between freshness and edge-function load.
      await new Promise((r) => setTimeout(r, 800));
    }
  };
  poll();
  return () => {
    stopped = true;
  };
}

// Yahoo Finance free intraday data lags ~1 min from market. Polling slower
// than the data refresh just adds perceived delay — 10s keeps us close to
// Yahoo's own refresh cadence without spamming.
const YAHOO_POLL_MS = 10_000;

export function subscribeCoinGecko(
  coinId: string,
  onTick: TickHandler,
  opts?: StreamOptions,
): () => void {
  let stopped = false;
  let failStreak = 0;
  const poll = async () => {
    while (!stopped) {
      try {
        const t = await fetchCoinGeckoPrice({ data: { id: coinId } });
        if (t.price) {
          failStreak = 0;
          opts?.onStatus?.({ provider: "coingecko", state: "live" });
          onTick(t);
        }
      } catch (e) {
        failStreak += 1;
        try {
          opts?.onStatus?.({
            provider: "coingecko",
            state: "failing",
            detail: String((e as Error)?.message ?? e),
          });
        } catch (err) {
          console.debug("[subscribeCoinGecko] onStatus handler failed", err);
        }
        // Avoid log storms in long-running sessions.
        if (failStreak <= 2 || failStreak % 10 === 0) {
          console.error("[subscribeCoinGecko] error", e);
        }
      }
      const waitMs = failStreak > 0 ? Math.min(60_000, 5_000 * (1 + failStreak)) : 2_000;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  };
  poll();
  return () => {
    stopped = true;
  };
}

// Seed with historical Binance klines via the server proxy
export async function fetchBinanceHistory(
  symbol: string,
  interval = "1m",
  limit = 200,
): Promise<Tick[]> {
  try {
    return await fetchBinanceKlines({ data: { symbol, interval, limit } });
  } catch {
    return [];
  }
}

export async function fetchCoinGeckoHistory(coinId: string, days = 1): Promise<Tick[]> {
  try {
    return await fetchCoinGeckoMarketChart({ data: { id: coinId, days } });
  } catch {
    return [];
  }
}

// Yahoo Finance polling for assets (free, delayed data).
// Primary data source for NSE/BSE indices and stocks.
function subscribeYahoo(symbol: string, onTick: TickHandler, opts?: StreamOptions): () => void {
  let stopped = false;
  let lastTs = 0;
  const poll = async () => {
    while (!stopped) {
      try {
        const rows = await fetchYahooHistory({
          data: { symbol, interval: "1m", range: "1d" },
        });
        const last = rows[rows.length - 1];
        if (last && last.ts !== lastTs) {
          lastTs = last.ts;
          opts?.onStatus?.({ provider: "yahoo", state: "live" });
          onTick({ ts: Date.now(), price: last.price });
        } else if (last) {
          onTick({ ts: Date.now(), price: last.price });
        }
      } catch (e) {
        try {
          opts?.onStatus?.({
            provider: "yahoo",
            state: "failing",
            detail: String((e as Error)?.message ?? e),
          });
        } catch (err) {
          console.debug("[subscribeYahoo] onStatus handler failed", err);
        }
        console.error("[subscribeYahoo] error", e);
      }
      await new Promise((r) => setTimeout(r, YAHOO_POLL_MS));
    }
  };
  poll();
  return () => {
    stopped = true;
  };
}

export function subscribeAsset(
  asset: MarketAsset,
  onTick: TickHandler,
  opts?: StreamOptions,
): () => void {
  if (asset.market === "crypto") {
    opts?.onStatus?.({ provider: asset.binanceSymbol ? "binance" : "coingecko", state: "live" });
    if (asset.binanceSymbol) return subscribeBinance(asset.binanceSymbol, onTick, opts, asset.id);
    return subscribeCoinGecko(asset.id, onTick, opts);
  }

  if (asset.market === "forex") {
    const base = asset.forexBase ?? "EUR";
    const quote = asset.forexQuote ?? "USD";
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try {
          const t = await fetchForexPrice({
            data: { base, quote, mode: "free", premiumApiKey: "" },
          });
          if (t.price > 0) {
            onTick(t);
            opts?.onStatus?.({
              provider: `forex:${(t as { provider?: string }).provider ?? "frankfurter"}`,
              state: "live",
            });
          }
        } catch (e) {
          opts?.onStatus?.({
            provider: "forex",
            state: "failing",
            detail: String((e as Error)?.message ?? e),
          });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    poll();
    return () => {
      stopped = true;
    };
  }

  // NSE/BSE: Use Yahoo Finance (free, delayed ticks)
  if (asset.market === "nse" || asset.market === "bse") {
    if (!asset.yahooSymbol) {
      opts?.onStatus?.({
        provider: asset.market === "bse" ? "BSE" : "NSE",
        state: "failing",
        detail: "No Yahoo symbol configured",
      });
      return () => {};
    }
    opts?.onStatus?.({
      provider: asset.market === "bse" ? "BSE:yahoo" : "NSE:yahoo",
      state: "live",
      detail: "Free delayed data",
    });
    return subscribeYahoo(asset.yahooSymbol, onTick, opts);
  }

  return () => {};
}

export async function fetchAssetHistory(
  asset: MarketAsset,
  limit = 240,
  opts?: StreamOptions,
): Promise<Tick[]> {
  if (asset.market === "crypto") {
    opts?.onStatus?.({
      provider: asset.binanceSymbol ? "binance" : "coingecko",
      state: "live",
      detail: "history",
    });
    if (asset.binanceSymbol) {
      const rows = await fetchBinanceHistory(asset.binanceSymbol, "1m", limit);
      if (rows.length > 0) return rows;
      const fallback = await fetchCoinGeckoHistory(asset.id, 1);
      if (fallback.length > 0) {
        opts?.onStatus?.({ provider: "coingecko", state: "fallback", detail: "history" });
      }
      return fallback;
    }
    return fetchCoinGeckoHistory(asset.id, 1);
  }

  if (asset.market === "forex") {
    const base = asset.forexBase ?? "EUR";
    const quote = asset.forexQuote ?? "USD";
    try {
      const rows = await fetchForexHistory({
        data: { base, quote, limit, mode: "free", premiumApiKey: "" },
      });
      opts?.onStatus?.({ provider: "forex-history", state: "live" });
      return rows;
    } catch (e) {
      opts?.onStatus?.({
        provider: "forex-history",
        state: "failing",
        detail: String((e as Error)?.message ?? e),
      });
      return [];
    }
  }

  // NSE/BSE: Use Yahoo Finance (free, delayed data)
  const exchange = asset.market === "bse" ? "BSE" : "NSE";
  if (!asset.yahooSymbol) {
    opts?.onStatus?.({
      provider: exchange,
      state: "failing",
      detail: "No Yahoo symbol configured",
    });
    return [];
  }
  opts?.onStatus?.({
    provider: `${exchange}:yahoo`,
    state: "live",
    detail: "history (free delayed)",
  });
  try {
    return await fetchYahooHistory({
      data: { symbol: asset.yahooSymbol, interval: "1m", range: "1d" },
    });
  } catch (e) {
    opts?.onStatus?.({
      provider: `${exchange}:yahoo`,
      state: "failing",
      detail: String((e as Error)?.message ?? e),
    });
    return [];
  }
}
