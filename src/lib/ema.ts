/**
 * Cascade EMA Dashboard - Core Technical Analysis Library
 * Reverse-engineered and improved from crypto-ema-dashboard
 */

// ============================================
// CONFIGURATION
// ============================================

export const EMA_PERIODS = [9, 21, 50, 100, 200] as const;
export type EMAPeriod = typeof EMA_PERIODS[number];

export const TIMEFRAMES = [
  { label: '1m', interval: '1m', limit: 100, weight: 0.5 },
  { label: '5m', interval: '5m', limit: 150, weight: 0.75 },
  { label: '15m', interval: '15m', limit: 200, weight: 1 },
  { label: '30m', interval: '30m', limit: 200, weight: 1.5 },
  { label: '1h', interval: '1h', limit: 250, weight: 2 },
  { label: '4h', interval: '4h', limit: 200, weight: 3 },
  { label: '1d', interval: '1d', limit: 200, weight: 3 },
  { label: '1w', interval: '1w', limit: 100, weight: 2 },
] as const;

export type TimeframeLabel = typeof TIMEFRAMES[number]['label'];

// ============================================
// EMA CALCULATION
// ============================================

/**
 * Calculate Exponential Moving Average
 * Uses standard EMA formula: EMA = (Price - EMA_prev) * k + EMA_prev
 * where k = 2 / (period + 1)
 */
export function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  
  const k = 2 / (period + 1); // Smoothing factor
  
  // Seed with SMA of first 'period' prices
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Calculate EMA for remaining prices
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
  }
  
  return ema;
}

/**
 * Calculate EMA series (all values, not just final)
 * Useful for slope calculation and charting
 */
export function calculateEMASeries(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  
  const k = 2 / (period + 1);
  const emas: number[] = [];
  
  // Seed with SMA
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emas.push(ema);
  
  // Calculate rest
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
    emas.push(ema);
  }
  
  return emas;
}

/**
 * Calculate all EMAs for given prices
 */
export function calculateAllEMAs(prices: number[]): Record<EMAPeriod, number | null> {
  const result: Record<number, number | null> = {};
  
  for (const period of EMA_PERIODS) {
    result[period] = calculateEMA(prices, period);
  }
  
  return result as Record<EMAPeriod, number | null>;
}

// ============================================
// EMA SLOPE (MOMENTUM)
// ============================================

/**
 * Calculate slope of EMA over lookback period
 * Returns percentage change
 */
export function calculateEMASlope(emaSeries: number[], lookback: number = 5): number | null {
  if (emaSeries.length < lookback + 1) return null;
  
  const current = emaSeries[emaSeries.length - 1];
  const previous = emaSeries[emaSeries.length - 1 - lookback];
  
  if (!previous || previous === 0) return null;
  
  return ((current - previous) / previous) * 100;
}

/**
 * Calculate slopes for all EMA periods
 */
export function calculateAllSlopes(
  prices: number[], 
  lookback: number = 5
): Record<EMAPeriod, number | null> {
  const result: Record<number, number | null> = {};
  
  for (const period of EMA_PERIODS) {
    const series = calculateEMASeries(prices, period);
    result[period] = calculateEMASlope(series, lookback);
  }
  
  return result as Record<EMAPeriod, number | null>;
}

// ============================================
// STACK DETECTION
// ============================================

export type StackType = 'bull' | 'bear' | 'mixed';

/**
 * Detect EMA stack alignment
 * BULL: 9 > 21 > 50 > 100 > 200 (fast above slow)
 * BEAR: 9 < 21 < 50 < 100 < 200 (fast below slow)
 * MIXED: Any other configuration
 */
export function detectStack(
  emas: Record<EMAPeriod, number | null>,
  periods: EMAPeriod[] = [9, 21, 50, 100, 200]
): StackType {
  const values = periods.map(p => emas[p]).filter((v): v is number => v !== null);
  
  if (values.length < 3) return 'mixed';
  
  let isBull = true;
  let isBear = true;
  
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] <= values[i + 1]) isBull = false;
    if (values[i] >= values[i + 1]) isBear = false;
  }
  
  return isBull ? 'bull' : isBear ? 'bear' : 'mixed';
}

/**
 * Calculate price position relative to EMAs
 * Returns percentage distance from each EMA
 */
export function calculatePriceVsEMAs(
  price: number,
  emas: Record<EMAPeriod, number | null>
): Record<EMAPeriod, number | null> {
  const result: Record<number, number | null> = {};
  
  for (const [period, ema] of Object.entries(emas)) {
    if (ema !== null && ema !== 0) {
      result[Number(period)] = ((price - ema) / ema) * 100;
    } else {
      result[Number(period)] = null;
    }
  }
  
  return result as Record<EMAPeriod, number | null>;
}

// ============================================
// TREND DETECTION
// ============================================

export type TrendType = 'bullish' | 'bearish' | 'neutral';

/**
 * Detect trend based on price vs key EMAs
 */
export function detectTrend(
  price: number,
  emas: Record<EMAPeriod, number | null>
): TrendType {
  const ema50 = emas[50];
  const ema200 = emas[200];
  
  if (ema50 === null || ema200 === null) return 'neutral';
  
  if (price > ema50 && price > ema200) return 'bullish';
  if (price < ema50 && price < ema200) return 'bearish';
  
  return 'neutral';
}

// ============================================
// RSI CALCULATION
// ============================================

/**
 * Calculate Relative Strength Index
 */
export function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;
  
  let avgGain = 0;
  let avgLoss = 0;
  
  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  
  avgGain /= period;
  avgLoss /= period;
  
  // Calculate smoothed RSI
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ============================================
// ATR CALCULATION
// ============================================

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculate Average True Range
 */
export function calculateATR(candles: OHLCV[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  // Calculate initial ATR as SMA
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Smooth with Wilder's method
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  
  return atr;
}

// ============================================
// VOLUME ANALYSIS
// ============================================

export interface VolumeAnalysis {
  current: number;
  average: number;
  ratio: number;
  trend: 'high' | 'normal' | 'low';
}

/**
 * Analyze volume relative to average
 */
export function analyzeVolume(volumes: number[], lookback: number = 20): VolumeAnalysis {
  if (volumes.length < lookback) {
    return { current: 0, average: 0, ratio: 0, trend: 'normal' };
  }
  
  const current = volumes[volumes.length - 1];
  const average = volumes.slice(-lookback).reduce((a, b) => a + b, 0) / lookback;
  const ratio = average > 0 ? current / average : 0;
  
  let trend: 'high' | 'normal' | 'low' = 'normal';
  if (ratio > 1.5) trend = 'high';
  else if (ratio < 0.5) trend = 'low';
  
  return { current, average, ratio, trend };
}

// ============================================
// EMA CROSSOVER DETECTION
// ============================================

export interface CrossoverSignal {
  type: 'golden_cross' | 'death_cross' | 'bullish_cross' | 'bearish_cross';
  fastPeriod: number;
  slowPeriod: number;
  barsAgo: number;
}

/**
 * Detect EMA crossovers
 */
export function detectCrossover(
  fastEMA: number[],
  slowEMA: number[],
  lookback: number = 10
): { crossed: boolean; type: 'bullish' | 'bearish' | null; barsAgo: number } {
  if (fastEMA.length < lookback + 1 || slowEMA.length < lookback + 1) {
    return { crossed: false, type: null, barsAgo: 0 };
  }
  
  const len = Math.min(fastEMA.length, slowEMA.length);
  
  for (let i = 1; i <= lookback; i++) {
    const idx = len - i;
    const prevIdx = idx - 1;
    
    if (prevIdx < 0) break;
    
    const fastNow = fastEMA[idx];
    const fastPrev = fastEMA[prevIdx];
    const slowNow = slowEMA[idx];
    const slowPrev = slowEMA[prevIdx];
    
    // Bullish crossover: fast crosses above slow
    if (fastPrev <= slowPrev && fastNow > slowNow) {
      return { crossed: true, type: 'bullish', barsAgo: i };
    }
    
    // Bearish crossover: fast crosses below slow
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      return { crossed: true, type: 'bearish', barsAgo: i };
    }
  }
  
  return { crossed: false, type: null, barsAgo: 0 };
}

// ============================================
// EXPORTS
// ============================================

export default {
  calculateEMA,
  calculateEMASeries,
  calculateAllEMAs,
  calculateEMASlope,
  calculateAllSlopes,
  detectStack,
  calculatePriceVsEMAs,
  detectTrend,
  calculateRSI,
  calculateATR,
  analyzeVolume,
  detectCrossover,
  EMA_PERIODS,
  TIMEFRAMES,
};
