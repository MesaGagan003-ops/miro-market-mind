// Available prediction horizons (in number of "candles" = 1 minute each)
export interface Timeframe {
  id: string;
  label: string;
  minutes: number;
}

// Global tick rate used by chart resampling + horizon alignment.
// 1 tick = 1 second. Horizons and resolution timestamps snap to this grid so
// the prediction engine and accuracy tracker share the chart's timeline.
export const TICK_INTERVAL_MS = 1000;

/** Snap a timestamp (ms) up to the next tick boundary. */
export function snapToTick(ts: number): number {
  return Math.ceil(ts / TICK_INTERVAL_MS) * TICK_INTERVAL_MS;
}

/** Number of ticks contained in a horizon (in minutes). */
export function ticksForHorizon(minutes: number): number {
  return Math.max(1, Math.round((minutes * 60_000) / TICK_INTERVAL_MS));
}

/** Horizon length in ms, snapped to the tick grid. */
export function horizonMs(minutes: number): number {
  return ticksForHorizon(minutes) * TICK_INTERVAL_MS;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: "1m", label: "1 min", minutes: 1 },
  { id: "5m", label: "5 min", minutes: 5 },
  { id: "10m", label: "10 min", minutes: 10 },
  { id: "15m", label: "15 min", minutes: 15 },
  { id: "30m", label: "30 min", minutes: 30 },
  { id: "1h", label: "1 hour", minutes: 60 },
  { id: "2h", label: "2 hours", minutes: 120 },
  { id: "4h", label: "4 hours", minutes: 240 },
  { id: "5h", label: "5 hours", minutes: 300 },
  { id: "10h", label: "10 hours", minutes: 600 },
  { id: "1d", label: "1 day", minutes: 1440 },
  { id: "1w", label: "1 week", minutes: 60 * 24 * 7 },
];

