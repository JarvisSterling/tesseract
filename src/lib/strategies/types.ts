/**
 * Tesseract Strategy Engine - Type Definitions
 */

export type SignalType = 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';
export type StrategyCategory = 'swing' | 'scalp' | 'breakout' | 'reversal';

export interface StrategySignal {
  type: SignalType;
  strength: number; // 0-100
  entry?: number;   // Suggested entry price
  stop?: number;    // Suggested stop loss
  target?: number;  // Suggested take profit
  reasons: string[];
}

export interface StrategyResult {
  id: string;
  name: string;
  category: StrategyCategory;
  signal: StrategySignal;
  timestamp: number;
}

export interface OHLCVData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface EMAData {
  values: Record<number, number | null>; // period -> value
  series: Record<number, number[]>;       // period -> historical series
  slopes: Record<number, number | null>;  // period -> slope %
}

export interface IndicatorData {
  emas: EMAData;
  rsi: number | null;
  rsiSeries: number[];
  atr: number | null;
  volume: {
    current: number;
    average: number;
    ratio: number;
  };
}

export interface StrategyInput {
  symbol: string;
  price: number;
  candles: OHLCVData[];
  indicators: IndicatorData;
  timeframe: string;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  category: StrategyCategory;
  timeframes: string[]; // Recommended timeframes
  evaluate: (input: StrategyInput) => StrategySignal;
}
