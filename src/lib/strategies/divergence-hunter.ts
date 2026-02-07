/**
 * Divergence Hunter Strategy - V2 (Fixed R:R)
 * 
 * PROBLEM: V1 had 57% win rate but -6.91% P&L
 * - Avg win: +1.66% (too small)
 * - Avg loss: -2.23% (too big)
 * 
 * FIX: ATR-based stops + 2:1 R:R targets
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
    if (data[idx] > data[idx - 1] && data[idx] > data[idx + 1]) {
      peaks.push({ value: data[idx], index: i });
      if (peaks.length >= 2) break;
    }
  }
  return peaks;
}

function findRecentTroughs(data: number[], lookback: number = 20): PeakTrough[] {
  const troughs: PeakTrough[] = [];
  for (let i = 2; i < Math.min(data.length, lookback); i++) {
    const idx = data.length - 1 - i;
    if (idx < 1) break;
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
  
  // Check for bullish divergence first (troughs)
  if (priceTroughs.length >= 2 && slopeTroughs.length >= 2) {
    const [recentPriceLow, prevPriceLow] = priceTroughs;
    const [recentSlopeLow, prevSlopeLow] = slopeTroughs;
    
    // Regular bullish: lower price low, higher slope low
    if (recentPriceLow.value < prevPriceLow.value && 
        recentSlopeLow.value > prevSlopeLow.value) {
      const rsiBonus = (rsi !== null && rsi < 35) ? 20 : 0;
      return {
        type: 'bullish',
        strength: 70 + rsiBonus,
        description: 'Bullish divergence: price lower low, momentum higher low'
      };
    }
    
    // Hidden bullish: higher price low, lower slope low
    if (recentPriceLow.value > prevPriceLow.value && 
        recentSlopeLow.value < prevSlopeLow.value) {
      return {
        type: 'hidden_bullish',
        strength: 55,
        description: 'Hidden bullish divergence (trend continuation)'
      };
    }
  }
  
  // Check for bearish divergence (peaks)
  if (pricePeaks.length >= 2 && slopePeaks.length >= 2) {
    const [recentPriceHigh, prevPriceHigh] = pricePeaks;
    const [recentSlopeHigh, prevSlopeHigh] = slopePeaks;
    
    // Regular bearish: higher price high, lower slope high
    if (recentPriceHigh.value > prevPriceHigh.value && 
        recentSlopeHigh.value < prevSlopeHigh.value) {
      const rsiBonus = (rsi !== null && rsi > 65) ? 20 : 0;
      return {
        type: 'bearish',
        strength: 70 + rsiBonus,
        description: 'Bearish divergence: price higher high, momentum lower high'
      };
    }
    
    // Hidden bearish: lower price high, higher slope high
    if (recentPriceHigh.value < prevPriceHigh.value && 
        recentSlopeHigh.value > prevSlopeHigh.value) {
      return {
        type: 'hidden_bearish',
        strength: 55,
        description: 'Hidden bearish divergence (trend continuation)'
      };
    }
  }
  
  return { type: null, strength: 0, description: 'No divergence detected' };
}

export const divergenceHunter: Strategy = {
  id: 'divergence-hunter',
  name: 'Divergence Hunter',
  description: 'Detect price/momentum divergences for reversals',
  category: 'reversal',
  timeframes: ['1h', '4h', '1d'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, rsi, atr, volume } = indicators;
    
    const prices = candles.map(c => c.close);
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
        reasons: ['No divergence - momentum and price aligned'],
      };
    }
    
    // Score the divergence
    let score = divergence.strength;
    const reasons: string[] = [divergence.description];
    
    // RSI confirmation at extremes
    if (rsi !== null) {
      if (divergence.type === 'bearish' && rsi > 70) {
        score += 15;
        reasons.push(`RSI overbought (${rsi.toFixed(0)})`);
      } else if (divergence.type === 'bullish' && rsi < 30) {
        score += 15;
        reasons.push(`RSI oversold (${rsi.toFixed(0)})`);
      } else if (divergence.type.includes('hidden') && rsi > 40 && rsi < 60) {
        score += 10;
        reasons.push(`RSI neutral (${rsi.toFixed(0)}) - good for continuation`);
      }
    }
    
    // Volume declining confirms divergence
    if (volume.ratio < 0.8) {
      score += 8;
      reasons.push('Volume declining');
    }
    
    // Minimum score for signal
    if (score < 55) {
      return {
        type: 'NEUTRAL',
        strength: Math.round(score),
        reasons: [...reasons, 'Divergence too weak'],
      };
    }
    
    // Determine direction
    const isLong = divergence.type === 'bullish' || divergence.type === 'hidden_bullish';
    const isStrong = score >= 80;
    
    let signal: SignalType;
    if (isLong) {
      signal = isStrong ? 'STRONG_LONG' : 'LONG';
    } else {
      signal = isStrong ? 'STRONG_SHORT' : 'SHORT';
    }
    
    // V3 FIX: Wider stops (divergences need room to play out)
    // 1.8x ATR stops, 1.5:1 R:R targets
    const atrValue = atr || price * 0.015;
    const stopDistance = atrValue * 1.8; // Wider stops
    
    let stop: number;
    let target: number;
    
    if (isLong) {
      stop = price - stopDistance;
      target = price + (stopDistance * 1.5); // 1.5:1 R:R
    } else {
      stop = price + stopDistance;
      target = price - (stopDistance * 1.5); // 1.5:1 R:R
    }
    
    reasons.push(`R:R ratio 1.5:1`);
    
    return {
      type: signal,
      strength: Math.min(Math.round(score), 100),
      entry: price,
      stop,
      target,
      reasons,
    };
  },
};
