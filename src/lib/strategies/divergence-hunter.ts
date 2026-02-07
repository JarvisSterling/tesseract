/**
 * Divergence Hunter Strategy - V4
 * 
 * V1: 57% win rate, -6.91% P&L (detection good, R:R bad)
 * V2-V3: Broke detection trying to fix R:R
 * V4: Restore V1 detection, only fix stop/target levels
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
  
  // Need at least 2 peaks/troughs to compare
  if (pricePeaks.length < 2 || slopePeaks.length < 2) {
    // Check troughs for bullish divergence
    if (priceTroughs.length >= 2 && slopeTroughs.length >= 2) {
      const [recentPriceLow, prevPriceLow] = priceTroughs;
      const [recentSlopeLow, prevSlopeLow] = slopeTroughs;
      
      // Regular bullish divergence: lower price low, higher slope low
      if (recentPriceLow.value < prevPriceLow.value && 
          recentSlopeLow.value > prevSlopeLow.value) {
        const rsiBonus = (rsi !== null && rsi < 35) ? 20 : 0;
        return {
          type: 'bullish',
          strength: 70 + rsiBonus,
          description: 'Price lower low but momentum higher low'
        };
      }
      
      // Hidden bullish: higher price low, lower slope low
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
  
  // Hidden bearish: lower price high, higher slope high
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
): { score: number; rsiConfirmed: boolean } {
  if (!divergence.type) return { score: 0, rsiConfirmed: false };
  
  let score = divergence.strength;
  let rsiConfirmed = false;
  
  // V5: RSI MUST be at extremes for regular divergences (key filter)
  if (rsi !== null) {
    if (divergence.type === 'bearish' && rsi > 65) {
      score += 20;
      rsiConfirmed = true;
    }
    if (divergence.type === 'bullish' && rsi < 35) {
      score += 20;
      rsiConfirmed = true;
    }
    // Hidden divergences are trend continuation - RSI in middle is fine
    if (divergence.type === 'hidden_bearish' && rsi > 40 && rsi < 70) {
      score += 15;
      rsiConfirmed = true;
    }
    if (divergence.type === 'hidden_bullish' && rsi > 30 && rsi < 60) {
      score += 15;
      rsiConfirmed = true;
    }
  }
  
  // Volume declining on divergence is classic confirmation
  if (volumeRatio < 0.8) score += 10;
  
  return { score: Math.min(score, 100), rsiConfirmed };
}

export const divergenceHunter: Strategy = {
  id: 'divergence-hunter',
  name: 'Divergence Hunter',
  description: 'Reversal strategy: Detect price/momentum divergences at extremes',
  category: 'reversal',
  timeframes: ['1h', '4h', '1d'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, rsi, atr, volume } = indicators;
    
    // Build price series from candles
    const prices = candles.map(c => c.close);
    
    // Build slope series from EMA21
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
    
    const { score: confirmationScore, rsiConfirmed } = calculateConfirmationScore(divergence, rsi, volume.ratio);
    
    // V5: REQUIRE RSI confirmation for regular divergences
    if (!rsiConfirmed && (divergence.type === 'bullish' || divergence.type === 'bearish')) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: [`Divergence detected but RSI (${rsi?.toFixed(0) || '?'}) not extreme enough`],
      };
    }
    
    const reasons: string[] = [];
    reasons.push(divergence.description);
    
    if (rsi !== null) {
      if (rsi > 65) reasons.push(`RSI overbought (${rsi.toFixed(0)})`);
      if (rsi < 35) reasons.push(`RSI oversold (${rsi.toFixed(0)})`);
    }
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    const ema21 = emas.values[21];
    
    // V5: ATR-based stops with minimum 2:1 R:R (improved from 1.5:1)
    const atrValue = atr || price * 0.02;
    
    if (confirmationScore >= 75) {
      if (divergence.type === 'bullish' || divergence.type === 'hidden_bullish') {
        signal = confirmationScore >= 85 ? 'STRONG_LONG' : 'LONG';
        
        // Stop: 1.5x ATR below entry (gives room to breathe)
        stop = price - (atrValue * 1.5);
        
        // V5: Target at least 2x the stop distance (better R:R)
        const stopDistance = price - stop;
        const minTarget = price + (stopDistance * 2.0);
        
        // If EMA21 is higher, use that; otherwise use min target
        if (ema21 && ema21 > minTarget) {
          target = ema21;
        } else {
          target = minTarget;
        }
        
      } else {
        signal = confirmationScore >= 85 ? 'STRONG_SHORT' : 'SHORT';
        
        // Stop: 1.5x ATR above entry
        stop = price + (atrValue * 1.5);
        
        // V5: Target at least 2x the stop distance (better R:R)
        const stopDistance = stop - price;
        const minTarget = price - (stopDistance * 2.0);
        
        // If EMA21 is lower, use that; otherwise use min target
        if (ema21 && ema21 < minTarget) {
          target = ema21;
        } else {
          target = minTarget;
        }
      }
    } else if (confirmationScore >= 60) {
      // V5: Require higher score for weaker signals, still 2:1 R:R
      if (divergence.type === 'bullish' || divergence.type === 'hidden_bullish') {
        signal = 'LONG';
        stop = price - (atrValue * 1.2);
        target = price + (atrValue * 2.4); // 2:1 R:R
      } else {
        signal = 'SHORT';
        stop = price + (atrValue * 1.2);
        target = price - (atrValue * 2.4); // 2:1 R:R
      }
    }
    
    if (signal !== 'NEUTRAL') {
      const rr = stop && target ? Math.abs(target - price) / Math.abs(price - stop) : 0;
      reasons.push(`R:R ${rr.toFixed(1)}:1`);
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
