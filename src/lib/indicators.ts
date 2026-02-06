/**
 * Technical Indicators Library
 * Shared calculations for both live analysis and backtesting
 */

import { OHLCVData, IndicatorData, EMAData, MACDData } from './strategies/types';

export const EMA_PERIODS = [9, 21, 50, 100, 200];

// ============================================
// EMA CALCULATIONS
// ============================================

export function calcEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
  }
  return ema;
}

export function calcEMASeries(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const series: number[] = [];
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  series.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
    series.push(ema);
  }
  return series;
}

export function calcSlope(series: number[], lookback = 5): number | null {
  if (series.length < lookback + 1) return null;
  const curr = series[series.length - 1];
  const prev = series[series.length - 1 - lookback];
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

export function buildEMAData(prices: number[]): EMAData {
  const values: Record<number, number | null> = {};
  const series: Record<number, number[]> = {};
  const slopes: Record<number, number | null> = {};
  
  for (const period of EMA_PERIODS) {
    values[period] = calcEMA(prices, period);
    series[period] = calcEMASeries(prices, period);
    slopes[period] = calcSlope(series[period]);
  }
  
  return { values, series, slopes };
}

// ============================================
// RSI CALCULATIONS
// ============================================

export function calcRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
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
  return 100 - (100 / (1 + avgGain / avgLoss));
}

export function calcRSISeries(prices: number[], period = 14): number[] {
  const series: number[] = [];
  if (prices.length < period + 1) return series;
  
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  
  series.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
  
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
    series.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
  }
  
  return series;
}

// ============================================
// ATR (Average True Range)
// ============================================

export function calcATR(candles: OHLCVData[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }
  
  if (trueRanges.length < period) return null;
  
  // First ATR is simple average
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Wilder's smoothing for subsequent values
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  
  return atr;
}

// ============================================
// MACD
// ============================================

export function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9): MACDData | null {
  if (prices.length < slow + signal) return null;
  
  const emaFast = calcEMASeries(prices, fast);
  const emaSlow = calcEMASeries(prices, slow);
  
  if (emaFast.length < signal || emaSlow.length < signal) return null;
  
  const macdLine: number[] = [];
  const offset = emaSlow.length - emaFast.length;
  
  for (let i = 0; i < emaSlow.length; i++) {
    const fastIdx = i - offset;
    if (fastIdx >= 0 && fastIdx < emaFast.length) {
      macdLine.push(emaFast[fastIdx] - emaSlow[i]);
    }
  }
  
  if (macdLine.length < signal) return null;
  
  const signalLine = calcEMASeries(macdLine, signal);
  if (signalLine.length === 0) return null;
  
  const currentMACD = macdLine[macdLine.length - 1];
  const currentSignal = signalLine[signalLine.length - 1];
  const histogram = currentMACD - currentSignal;
  
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (histogram > 0 && currentMACD > 0) trend = 'bullish';
  else if (histogram < 0 && currentMACD < 0) trend = 'bearish';
  
  return { macd: currentMACD, signal: currentSignal, histogram, trend };
}

// ============================================
// VOLUME ANALYSIS
// ============================================

export function calcVolumeAnalysis(volumes: number[], lookback = 20): { current: number; average: number; ratio: number } {
  if (volumes.length === 0) {
    return { current: 0, average: 0, ratio: 1 };
  }
  
  const current = volumes[volumes.length - 1] || 0;
  const avgSlice = volumes.slice(-lookback);
  const average = avgSlice.length > 0 ? avgSlice.reduce((a, b) => a + b, 0) / avgSlice.length : 0;
  const ratio = average > 0 ? current / average : 1;
  
  return { current, average, ratio };
}

// ============================================
// BUILD FULL INDICATOR DATA
// ============================================

export function buildIndicators(candles: OHLCVData[]): IndicatorData {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  
  return {
    emas: buildEMAData(closes),
    rsi: calcRSI(closes),
    rsiSeries: calcRSISeries(closes),
    atr: calcATR(candles),
    macd: calcMACD(closes),
    volume: calcVolumeAnalysis(volumes),
  };
}
