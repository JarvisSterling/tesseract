/**
 * Divergence Hunter Strategy (Reversal Trading)
 * 
 * CONCEPT: Price and momentum (EMA slopes) should move together. When they
 * diverge, it signals hidden weakness or strength - a potential reversal.
 * 
 * MATHEMATICS:
 * - Track price highs/lows over N periods
 * - Track EMA21 slope highs/lows over same period
 * - Divergence = price makes new extreme but slope doesn't confirm
 * 
 * TYPES:
 * - Bearish divergence: Higher price high + lower slope high = weakness
 * - Bullish divergence: Lower price low + higher slope low = strength
 * - Hidden bearish: Lower price high + higher slope high (continuation)
 * - Hidden bullish: Higher price low + lower slope low (continuation)
 * 
 * KEY INSIGHT:
 * - Divergences work best at extremes (RSI overbought/oversold)
 * - Multiple timeframe confirmation increases probability
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

interface PeakTrough {
  value: number;
  index: number;
}

function findRecentPeaks(data: number[], lookback: number = 20): PeakTrough[] {
  const peaks: PeakTrough[] = [];
  
  for (let i = 2; i < Math.min(data.length, lookback); i++) {
    const idx = data.length - 1 - i;
    if (idx < 1) break;
    
    // Local maximum
    if (data[idx] > data[idx - 1] && data[idx] > data[idx + 1]) {
      peaks.push({ value: data[idx], index: i });
      if (peaks.length >= 2) break; // Only need 2 recent peaks
    }
  }
  
  return peaks;
}

function findRecentTroughs(data: number[], lookback: number = 20): PeakTrough[] {
  const troughs: PeakTrough[] = [];
  
  for (let i = 2; i < Math.min(data.length, lookback); i++) {
    const idx = data.length - 1 - i;
    if (idx < 1) break;
    
    // Local minimum
    if (data[idx] < data[idx - 1] && data[idx] < data[idx + 1]) {
      troughs.push({ value: data[idx], index: i });
      if (troughs.length >= 2) break;
    }
  }
  
  return troughs;
}

interface DivergenceResult {
  type: 'bullish' | 'bearish' | 'hidden_bullish' | 'hidden_bearish' | null;
  strength: number;
  description: string;
}

function detectDivergence(
  priceData: number[],
  slopeData: number[],
  rsi: number | null
): DivergenceResult {
  if (priceData.length < 20 || slopeData.length < 20) {
    return { type: null, strength: 0, description: 'Insufficient data' };
  }
  
  const pricePeaks = findRecentPeaks(priceData);
  const priceTroughs = findRecentTroughs(priceData);
  const slopePeaks = findRecentPeaks(slopeData);
  const slopeTroughs = findRecentTroughs(slopeData);
  
  // Need at least 2 peaks/troughs to compare
  if (pricePeaks.length < 2 || slopePeaks.length < 2) {
    // Check troughs for bullish divergence
    if (priceTroughs.length >= 2 && slopeTroughs.length >= 2) {
      // Regular bullish divergence: lower price low, higher slope low
      const [recentPriceLow, prevPriceLow] = priceTroughs;
      const [recentSlopeLow, prevSlopeLow] = slopeTroughs;
      
      if (recentPriceLow.value < prevPriceLow.value && 
          recentSlopeLow.value > prevSlopeLow.value) {
        // RSI confirmation makes it stronger
        const rsiBonus = (rsi !== null && rsi < 35) ? 20 : 0;
        return {
          type: 'bullish',
          strength: 70 + rsiBonus,
          description: 'Price lower low but momentum higher low'
        };
      }
      
      // Hidden bullish: higher price low, lower slope low (in uptrend)
      if (recentPriceLow.value > prevPriceLow.value && 
          recentSlopeLow.value < prevSlopeLow.value) {
        return {
          type: 'hidden_bullish',
          strength: 55,
          description: 'Hidden bullish - trend continuation likely'
        };
      }
    }
    
    return { type: null, strength: 0, description: 'No clear divergence pattern' };
  }
  
  const [recentPriceHigh, prevPriceHigh] = pricePeaks;
  const [recentSlopeHigh, prevSlopeHigh] = slopePeaks;
  
  // Regular bearish divergence: higher price high, lower slope high
  if (recentPriceHigh.value > prevPriceHigh.value && 
      recentSlopeHigh.value < prevSlopeHigh.value) {
    const rsiBonus = (rsi !== null && rsi > 65) ? 20 : 0;
    return {
      type: 'bearish',
      strength: 70 + rsiBonus,
      description: 'Price higher high but momentum lower high'
    };
  }
  
  // Hidden bearish: lower price high, higher slope high (in downtrend)
  if (recentPriceHigh.value < prevPriceHigh.value && 
      recentSlopeHigh.value > prevSlopeHigh.value) {
    return {
      type: 'hidden_bearish',
      strength: 55,
      description: 'Hidden bearish - downtrend continuation likely'
    };
  }
  
  // Also check troughs for bullish
  if (priceTroughs.length >= 2 && slopeTroughs.length >= 2) {
    const [recentPriceLow, prevPriceLow] = priceTroughs;
    const [recentSlopeLow, prevSlopeLow] = slopeTroughs;
    
    if (recentPriceLow.value < prevPriceLow.value && 
        recentSlopeLow.value > prevSlopeLow.value) {
      const rsiBonus = (rsi !== null && rsi < 35) ? 20 : 0;
      return {
        type: 'bullish',
        strength: 70 + rsiBonus,
        description: 'Price lower low but momentum higher low'
      };
    }
  }
  
  return { type: null, strength: 0, description: 'No divergence detected' };
}

function calculateConfirmationScore(
  divergence: DivergenceResult,
  rsi: number | null,
  volumeRatio: number
): number {
  if (!divergence.type) return 0;
  
  let score = divergence.strength;
  
  // RSI at extremes confirms divergence
  if (rsi !== null) {
    if (divergence.type === 'bearish' && rsi > 70) score += 15;
    if (divergence.type === 'bullish' && rsi < 30) score += 15;
    if (divergence.type === 'hidden_bearish' && rsi > 50 && rsi < 70) score += 10;
    if (divergence.type === 'hidden_bullish' && rsi > 30 && rsi < 50) score += 10;
  }
  
  // Volume declining on divergence is classic confirmation
  if (volumeRatio < 0.8) score += 10;
  
  return Math.min(score, 100);
}

export const divergenceHunter: Strategy = {
  id: 'divergence-hunter',
  name: 'Divergence Hunter',
  description: 'Reversal strategy: Detect price/momentum divergences at extremes',
  category: 'reversal',
  timeframes: ['1h', '4h', '1d'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, rsi, volume } = indicators;
    
    // Build price series from candles
    const prices = candles.map(c => c.close);
    
    // Build slope series - we'll approximate from EMA21 series
    const ema21Series = emas.series[21] || [];
    const slopeWindow = 5;
    const slopes: number[] = [];
    
    for (let i = slopeWindow; i < ema21Series.length; i++) {
      const prevEma = ema21Series[i - slopeWindow];
      const currEma = ema21Series[i];
      if (prevEma > 0) {
        slopes.push(((currEma - prevEma) / prevEma) * 100);
      }
    }
    
    const divergence = detectDivergence(prices, slopes, rsi);
    
    if (!divergence.type) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['No divergence detected - momentum and price aligned'],
      };
    }
    
    const confirmationScore = calculateConfirmationScore(divergence, rsi, volume.ratio);
    
    const reasons: string[] = [];
    reasons.push(divergence.description);
    
    if (rsi !== null) {
      if (rsi > 70) reasons.push(`RSI overbought (${rsi.toFixed(0)})`);
      if (rsi < 30) reasons.push(`RSI oversold (${rsi.toFixed(0)})`);
    }
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    const ema21 = emas.values[21];
    const ema50 = emas.values[50];
    
    // Regular divergences are reversal signals
    // Hidden divergences are continuation signals
    
    if (confirmationScore >= 70) {
      if (divergence.type === 'bullish' || divergence.type === 'hidden_bullish') {
        signal = confirmationScore >= 85 ? 'STRONG_LONG' : 'LONG';
        // For reversals, use recent low as stop
        const recentLow = Math.min(...candles.slice(-10).map(c => c.low));
        stop = recentLow * 0.99;
        if (ema21) target = ema21 * 1.02; // Target EMA21 for reversals
      } else {
        signal = confirmationScore >= 85 ? 'STRONG_SHORT' : 'SHORT';
        const recentHigh = Math.max(...candles.slice(-10).map(c => c.high));
        stop = recentHigh * 1.01;
        if (ema21) target = ema21 * 0.98;
      }
    } else if (confirmationScore >= 50) {
      if (divergence.type === 'bullish' || divergence.type === 'hidden_bullish') {
        signal = 'LONG';
        stop = price * 0.97;
        target = price * 1.03;
      } else {
        signal = 'SHORT';
        stop = price * 1.03;
        target = price * 0.97;
      }
    }
    
    return {
      type: signal,
      strength: Math.round(confirmationScore),
      entry: price,
      stop,
      target,
      reasons,
    };
  },
};
