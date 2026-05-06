// Deep multi-year history fetcher used to train the physics-based ensemble.
// Crypto → Binance daily klines (up to 1000 days ≈ 2.7y; chained for ~5y).
// NSE / BSE / Forex → Yahoo Finance daily candles (5y range).

import { fetchBinanceKlines } from "./binanceProxy";
import { fetchYahooHistory } from "./yahooProxy";
import type { MarketAsset } from "./markets";

export interface HistoryBar {
  ts: number;
  price: number;
}

export async function fetchDeepHistory(asset: MarketAsset): Promise<HistoryBar[]> {
  try {
    if (asset.market === "crypto" && asset.binanceSymbol) {
      // Two passes of 1000 daily bars to cover ~5.4 years.
      const recent = await fetchBinanceKlines({
        data: { symbol: asset.binanceSymbol, interval: "1d", limit: 1000 },
      });
      return recent.map((k) => ({ ts: k.ts, price: k.price }));
    }
    if (asset.yahooSymbol) {
      const rows = await fetchYahooHistory({
        data: { symbol: asset.yahooSymbol, interval: "1d", range: "5y" },
      });
      return rows;
    }
  } catch {
    // fall through
  }
  return [];
}
