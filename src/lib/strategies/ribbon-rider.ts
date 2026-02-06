/**
 * Ribbon Rider Strategy (Swing Trading)
 * 
 * CONCEPT: When EMAs form a perfect "ribbon" (stacked in order), the trend
 * is strong and pullbacks to EMA21 offer high-probability entries.
 * 
 * LOGIC:
 * - Perfect bull stack: 9 > 21 > 50 > 100 > 200
 * - Price pulls back to EMA21 zone but holds above EMA50
 * - RSI between 40-60 (not overextended)
 * - Enter on bounce from EMA21
 * 
 * EXIT:
 * - Price closes below EMA50
 * - EMAs start to converge (ribbon compression)
 * 
 * MATHEMATICS:
 * - Stack perfection score: How cleanly EMAs are separated
 * - Pullback quality: Price proximity to EMA21 without breaking EMA50
 * - RSI filter: Sweet spot for continuation
 */

import { Strategy, StrategyInput, StrategySignal, SignalType } from './types';

const EMA_PERIODS = [9, 21, 50, 100, 200];

function calculateStackScore(emas: Record<number, number | null>, isBull: boolean): number {
  const values = EMA_PERIODS.map(p => emas[p]).filter((v): v is number => v !== null);
  if (values.length < 4) return 0;
  
  let perfectPairs = 0;
  const totalPairs = values.length - 1;
  
  for (let i = 0; i < values.length - 1; i++) {
    if (isBull && values[i] > values[i + 1]) perfectPairs++;
    if (!isBull && values[i] < values[i + 1]) perfectPairs++;
  }
  
  // Also check spacing - EMAs should be well separated, not compressed
  const spacing = Math.abs(values[0] - values[values.length - 1]) / values[values.length - 1] * 100;
  const spacingBonus = Math.min(spacing / 5, 1) * 20; // Up to 20 bonus points for good spacing
  
  return (perfectPairs / totalPairs) * 80 + spacingBonus;
}

function calculatePullbackScore(
  price: number, 
  ema21: number | null, 
  ema50: number | null,
  isBull: boolean
): number {
  if (!ema21 || !ema50) return 0;
  
  const distanceToEma21 = ((price - ema21) / ema21) * 100;
  const distanceToEma50 = ((price - ema50) / ema50) * 100;
  
  if (isBull) {
    // For bullish: price should be near EMA21 (within 2%) but above EMA50
    if (distanceToEma50 < 0) return 0; // Price below EMA50 = invalid
    if (distanceToEma21 > 3) return 0; // Too far from EMA21 = not a pullback
    
    // Sweet spot: 0-1.5% above EMA21
    if (distanceToEma21 >= 0 && distanceToEma21 <= 1.5) return 100;
    if (distanceToEma21 > 1.5 && distanceToEma21 <= 3) return 70;
    if (distanceToEma21 < 0 && distanceToEma21 >= -1) return 80; // Slight dip into EMA21
    
    return 30;
  } else {
    // For bearish: price should be near EMA21 from below
    if (distanceToEma50 > 0) return 0;
    if (distanceToEma21 < -3) return 0;
    
    if (distanceToEma21 <= 0 && distanceToEma21 >= -1.5) return 100;
    if (distanceToEma21 < -1.5 && distanceToEma21 >= -3) return 70;
    if (distanceToEma21 > 0 && distanceToEma21 <= 1) return 80;
    
    return 30;
  }
}

function calculateRSIScore(rsi: number | null, isBull: boolean): number {
  if (rsi === null) return 50; // Neutral if no RSI
  
  if (isBull) {
    // For bullish pullback entries, RSI 40-60 is ideal
    if (rsi >= 40 && rsi <= 60) return 100;
    if (rsi >= 30 && rsi < 40) return 80; // Slightly oversold, good
    if (rsi > 60 && rsi <= 70) return 60; // Getting extended
    if (rsi > 70) return 20; // Overbought, avoid
    if (rsi < 30) return 40; // Too oversold, might be breaking down
  } else {
    if (rsi >= 40 && rsi <= 60) return 100;
    if (rsi > 60 && rsi <= 70) return 80;
    if (rsi >= 30 && rsi < 40) return 60;
    if (rsi < 30) return 20;
    if (rsi > 70) return 40;
  }
  
  return 50;
}

export const ribbonRider: Strategy = {
  id: 'ribbon-rider',
  name: 'Ribbon Rider',
  description: 'Swing strategy: Enter on pullbacks to EMA21 when ribbon is perfectly stacked',
  category: 'swing',
  timeframes: ['1h', '4h', '1d'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, indicators } = input;
    const { emas, rsi, atr, volume } = indicators;
    
    // Check for bull stack
    const bullStackScore = calculateStackScore(emas.values, true);
    const bearStackScore = calculateStackScore(emas.values, false);
    
    const isBull = bullStackScore > bearStackScore && bullStackScore > 60;
    const isBear = bearStackScore > bullStackScore && bearStackScore > 60;
    
    if (!isBull && !isBear) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['No clear EMA ribbon formation'],
      };
    }
    
    const stackScore = isBull ? bullStackScore : bearStackScore;
    const pullbackScore = calculatePullbackScore(
      price, 
      emas.values[21], 
      emas.values[50], 
      isBull
    );
    const rsiScore = calculateRSIScore(rsi, isBull);
    
    // Weighted final score
    const finalScore = (stackScore * 0.4) + (pullbackScore * 0.4) + (rsiScore * 0.2);
    
    const reasons: string[] = [];
    
    if (stackScore >= 80) reasons.push(`Perfect ${isBull ? 'bullish' : 'bearish'} ribbon`);
    else if (stackScore >= 60) reasons.push(`Good ${isBull ? 'bullish' : 'bearish'} ribbon alignment`);
    
    if (pullbackScore >= 80) reasons.push('Price at EMA21 pullback zone');
    else if (pullbackScore >= 50) reasons.push('Price near EMA21');
    
    if (rsiScore >= 80) reasons.push('RSI in optimal zone');
    
    // Calculate stops and targets using ATR
    const ema50 = emas.values[50];
    const atrStop = atr ? atr * 1.5 : price * 0.02; // Default 2% if no ATR
    
    // Volume confirmation bonus
    if (volume.ratio > 1.3) {
      reasons.push(`Volume ${((volume.ratio - 1) * 100).toFixed(0)}% above average`);
    }
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    if (finalScore >= 75) {
      signal = isBull ? 'STRONG_LONG' : 'STRONG_SHORT';
      // Use ATR-based stops (1.5x ATR from entry)
      stop = isBull ? price - atrStop : price + atrStop;
      // Target: 2.5x risk-reward
      target = isBull ? price + (atrStop * 2.5) : price - (atrStop * 2.5);
    } else if (finalScore >= 55) {
      signal = isBull ? 'LONG' : 'SHORT';
      // Tighter stop for less confident signals
      stop = isBull ? Math.max(price - atrStop, ema50 ? ema50 * 0.995 : price * 0.98) 
                    : Math.min(price + atrStop, ema50 ? ema50 * 1.005 : price * 1.02);
      target = isBull ? price + (atrStop * 2) : price - (atrStop * 2);
    }
    
    return {
      type: signal,
      strength: Math.round(finalScore),
      entry: price,
      stop,
      target,
      reasons,
    };
  },
};
