/**
 * Crossover Cascade Strategy (Momentum Trading)
 * 
 * CONCEPT: Single EMA crossovers produce many false signals. But when
 * multiple EMAs cross in sequence (a "cascade"), it confirms real momentum.
 * 
 * MATHEMATICS:
 * - Track when EMA9 crosses EMA21
 * - Then when EMA21 crosses EMA50
 * - Cascade = multiple crosses within N bars
 * - Filter: All crossing EMAs must have positive slopes
 * 
 * LOGIC:
 * - Bull cascade: 9 crosses above 21, 21 crosses above 50 (or all above 50)
 * - All EMAs should be rising (positive slopes)
 * - Volume should confirm momentum
 * 
 * KEY INSIGHT:
 * - The "stale" crossover problem: crosses that happened long ago are weak
 * - Fresh cascade (within 5-10 bars) = strong signal
 */

import { Strategy, StrategyInput, StrategySignal, SignalType } from './types';

interface CrossoverInfo {
  crossed: boolean;
  barsAgo: number;
  direction: 'bull' | 'bear';
}

function detectCrossover(
  fastSeries: number[],
  slowSeries: number[],
  lookback: number = 10
): CrossoverInfo {
  if (fastSeries.length < lookback + 1 || slowSeries.length < lookback + 1) {
    return { crossed: false, barsAgo: 0, direction: 'bull' };
  }
  
  const len = Math.min(fastSeries.length, slowSeries.length);
  
  for (let i = 1; i <= lookback; i++) {
    const idx = len - i;
    const prevIdx = idx - 1;
    
    if (prevIdx < 0) break;
    
    const fastNow = fastSeries[idx];
    const fastPrev = fastSeries[prevIdx];
    const slowNow = slowSeries[idx];
    const slowPrev = slowSeries[prevIdx];
    
    // Bullish crossover: fast crosses above slow
    if (fastPrev <= slowPrev && fastNow > slowNow) {
      return { crossed: true, barsAgo: i, direction: 'bull' };
    }
    
    // Bearish crossover: fast crosses below slow
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      return { crossed: true, barsAgo: i, direction: 'bear' };
    }
  }
  
  return { crossed: false, barsAgo: 0, direction: 'bull' };
}

function calculateCascadeScore(
  cross9_21: CrossoverInfo,
  cross21_50: CrossoverInfo,
  direction: 'bull' | 'bear'
): { score: number; isCascade: boolean; freshness: number } {
  // Both must have crossed in same direction
  if (!cross9_21.crossed && !cross21_50.crossed) {
    return { score: 0, isCascade: false, freshness: 0 };
  }
  
  if (cross9_21.crossed && cross21_50.crossed) {
    if (cross9_21.direction !== direction || cross21_50.direction !== direction) {
      return { score: 0, isCascade: false, freshness: 0 };
    }
    
    // Full cascade! Score based on freshness
    const avgBarsAgo = (cross9_21.barsAgo + cross21_50.barsAgo) / 2;
    const freshness = Math.max(0, 100 - avgBarsAgo * 10); // Newer = better
    
    return { 
      score: 60 + freshness * 0.4, 
      isCascade: true, 
      freshness 
    };
  }
  
  // Only one crossover - partial signal
  const cross = cross9_21.crossed ? cross9_21 : cross21_50;
  if (cross.direction !== direction) {
    return { score: 0, isCascade: false, freshness: 0 };
  }
  
  const freshness = Math.max(0, 100 - cross.barsAgo * 10);
  return { 
    score: 30 + freshness * 0.2, 
    isCascade: false, 
    freshness 
  };
}

function calculateMomentumScore(
  slopes: Record<number, number | null>,
  direction: 'bull' | 'bear'
): number {
  const slope9 = slopes[9];
  const slope21 = slopes[21];
  const slope50 = slopes[50];
  
  let score = 0;
  let validSlopes = 0;
  
  const checkSlope = (slope: number | null, weight: number) => {
    if (slope === null) return;
    validSlopes++;
    
    if (direction === 'bull' && slope > 0.3) {
      score += weight * (Math.min(slope / 2, 1)); // Normalize strong slopes
    } else if (direction === 'bear' && slope < -0.3) {
      score += weight * (Math.min(Math.abs(slope) / 2, 1));
    }
  };
  
  checkSlope(slope9, 40);
  checkSlope(slope21, 35);
  checkSlope(slope50, 25);
  
  return validSlopes > 0 ? (score / validSlopes) * 100 : 0;
}

function getCurrentAlignment(
  emas: Record<number, number | null>,
  direction: 'bull' | 'bear'
): { aligned: boolean; score: number } {
  const ema9 = emas[9];
  const ema21 = emas[21];
  const ema50 = emas[50];
  
  if (!ema9 || !ema21 || !ema50) {
    return { aligned: false, score: 0 };
  }
  
  if (direction === 'bull') {
    const aligned = ema9 > ema21 && ema21 > ema50;
    const score = aligned ? 100 : (ema9 > ema21 ? 50 : 0);
    return { aligned, score };
  } else {
    const aligned = ema9 < ema21 && ema21 < ema50;
    const score = aligned ? 100 : (ema9 < ema21 ? 50 : 0);
    return { aligned, score };
  }
}

export const crossoverCascade: Strategy = {
  id: 'crossover-cascade',
  name: 'Crossover Cascade',
  description: 'Momentum strategy: Enter on confirmed multi-EMA crossover cascades',
  category: 'swing',
  timeframes: ['1h', '4h', '1d'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, indicators } = input;
    const { emas, volume } = indicators;
    
    const series9 = emas.series[9] || [];
    const series21 = emas.series[21] || [];
    const series50 = emas.series[50] || [];
    
    // Detect crossovers
    const cross9_21 = detectCrossover(series9, series21, 10);
    const cross21_50 = detectCrossover(series21, series50, 10);
    
    // Determine primary direction based on current alignment
    const bullAlignment = getCurrentAlignment(emas.values, 'bull');
    const bearAlignment = getCurrentAlignment(emas.values, 'bear');
    
    const direction: 'bull' | 'bear' = bullAlignment.score > bearAlignment.score ? 'bull' : 'bear';
    
    const cascadeResult = calculateCascadeScore(cross9_21, cross21_50, direction);
    const momentumScore = calculateMomentumScore(emas.slopes, direction);
    const alignmentScore = direction === 'bull' ? bullAlignment.score : bearAlignment.score;
    
    const reasons: string[] = [];
    
    if (cascadeResult.isCascade) {
      reasons.push(`${direction === 'bull' ? 'Bullish' : 'Bearish'} cascade detected`);
      reasons.push(`Freshness: ${cascadeResult.freshness.toFixed(0)}%`);
    } else if (cascadeResult.score > 0) {
      reasons.push(`Partial ${direction} crossover`);
    }
    
    if (momentumScore > 50) {
      reasons.push(`Strong ${direction} momentum (slopes aligned)`);
    }
    
    // No cascade and no momentum
    if (cascadeResult.score < 30 && momentumScore < 30) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['No crossover cascade - waiting for momentum'],
      };
    }
    
    // Volume confirmation
    let volumeBonus = 0;
    if (volume.ratio >= 1.5) {
      volumeBonus = 15;
      reasons.push(`Volume confirmation: ${volume.ratio.toFixed(1)}x`);
    }
    
    // Final score
    const finalScore = (cascadeResult.score * 0.4) + (momentumScore * 0.3) + (alignmentScore * 0.3) + volumeBonus;
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    const ema21 = emas.values[21];
    const ema50 = emas.values[50];
    
    if (finalScore >= 70 && cascadeResult.isCascade) {
      signal = direction === 'bull' ? 'STRONG_LONG' : 'STRONG_SHORT';
      if (ema21) stop = direction === 'bull' ? ema21 * 0.98 : ema21 * 1.02;
      target = direction === 'bull' ? price * 1.06 : price * 0.94;
    } else if (finalScore >= 50) {
      signal = direction === 'bull' ? 'LONG' : 'SHORT';
      if (ema50) stop = direction === 'bull' ? ema50 * 0.98 : ema50 * 1.02;
      target = direction === 'bull' ? price * 1.04 : price * 0.96;
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
