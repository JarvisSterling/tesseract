/**
 * Crossover Cascade Strategy V2 - FIXED R:R
 * 
 * PROBLEM WITH V1:
 * - 59% win rate but -6% P&L
 * - Avg win +4.00%, Avg loss -5.85% (inverted R:R!)
 * - Stop was EMA-based (too wide), target was fixed % (too tight)
 * 
 * V2 FIXES:
 * - ATR-based stops (consistent risk per trade)
 * - Target = 1.5x stop distance (positive R:R)
 * - Tighter entry requirements (only trade fresh cascades)
 * - Isolated calculations
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

// ============================================
// ISOLATED INDICATOR CALCULATIONS
// ============================================

function calcEMASeries(prices: number[], period: number): number[] {
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

function calcATR(candles: OHLCVData[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;
  
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atr += tr;
  }
  atr /= period;
  
  // Wilder's smoothing for rest
  for (let i = period + 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atr = (atr * (period - 1) + tr) / period;
  }
  
  return atr;
}

// ============================================
// CROSSOVER DETECTION
// ============================================

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

// ============================================
// CASCADE ANALYSIS
// ============================================

interface CascadeResult {
  isCascade: boolean;
  direction: 'bull' | 'bear' | null;
  score: number;
  freshness: number;
  aligned: boolean;
}

function analyzeCascade(
  series9: number[],
  series21: number[],
  series50: number[],
  price: number
): CascadeResult {
  const cross9_21 = detectCrossover(series9, series21, 8);  // V2: tighter lookback
  const cross21_50 = detectCrossover(series21, series50, 8);
  
  // Current values
  const ema9 = series9[series9.length - 1];
  const ema21 = series21[series21.length - 1];
  const ema50 = series50[series50.length - 1];
  
  if (!ema9 || !ema21 || !ema50) {
    return { isCascade: false, direction: null, score: 0, freshness: 0, aligned: false };
  }
  
  // Check current alignment
  const bullAligned = ema9 > ema21 && ema21 > ema50 && price > ema9;
  const bearAligned = ema9 < ema21 && ema21 < ema50 && price < ema9;
  
  // Determine direction
  let direction: 'bull' | 'bear' | null = null;
  if (bullAligned) direction = 'bull';
  else if (bearAligned) direction = 'bear';
  
  if (!direction) {
    return { isCascade: false, direction: null, score: 0, freshness: 0, aligned: false };
  }
  
  // Check for cascade (both crossovers in same direction)
  const bothCrossed = cross9_21.crossed && cross21_50.crossed;
  const sameDirection = cross9_21.direction === direction && cross21_50.direction === direction;
  const isCascade = bothCrossed && sameDirection;
  
  // Calculate freshness (newer = better)
  let freshness = 0;
  if (isCascade) {
    const avgBars = (cross9_21.barsAgo + cross21_50.barsAgo) / 2;
    freshness = Math.max(0, 100 - avgBars * 15);  // V2: penalize stale crossovers more
  } else if (cross9_21.crossed && cross9_21.direction === direction) {
    freshness = Math.max(0, 100 - cross9_21.barsAgo * 15);
  }
  
  // Score - V2.1: More generous scoring
  let score = 0;
  if (isCascade) {
    score = 45 + (freshness * 0.5);  // 45-95 for cascade
  } else if (cross9_21.crossed && cross9_21.direction === direction) {
    score = 35 + (freshness * 0.3);  // 35-65 for single crossover with 9/21
  }
  
  return {
    isCascade,
    direction,
    score,
    freshness,
    aligned: bullAligned || bearAligned
  };
}

// ============================================
// MOMENTUM CHECK
// ============================================

function checkMomentum(series9: number[], series21: number[], direction: 'bull' | 'bear'): number {
  if (series9.length < 5 || series21.length < 5) return 0;
  
  // Calculate slopes
  const ema9Now = series9[series9.length - 1];
  const ema9Prev = series9[series9.length - 5];
  const ema21Now = series21[series21.length - 1];
  const ema21Prev = series21[series21.length - 5];
  
  const slope9 = ((ema9Now - ema9Prev) / ema9Prev) * 100;
  const slope21 = ((ema21Now - ema21Prev) / ema21Prev) * 100;
  
  if (direction === 'bull') {
    if (slope9 > 0.5 && slope21 > 0.3) return 100;
    if (slope9 > 0.2 && slope21 > 0.1) return 70;
    if (slope9 > 0) return 40;
    return 0;
  } else {
    if (slope9 < -0.5 && slope21 < -0.3) return 100;
    if (slope9 < -0.2 && slope21 < -0.1) return 70;
    if (slope9 < 0) return 40;
    return 0;
  }
}

// ============================================
// MAIN STRATEGY
// ============================================

export const crossoverCascade: Strategy = {
  id: 'crossover-cascade',
  name: 'Crossover Cascade',
  description: 'V2: Multi-EMA crossover cascades with fixed R:R',
  category: 'swing',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles } = input;
    
    if (candles.length < 60) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    const closes = candles.map(c => c.close);
    
    // Isolated EMA calculations
    const series9 = calcEMASeries(closes, 9);
    const series21 = calcEMASeries(closes, 21);
    const series50 = calcEMASeries(closes, 50);
    
    // Isolated ATR
    const atr = calcATR(candles, 14);
    
    if (!atr) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data for ATR'] };
    }
    
    // Analyze cascade
    const cascade = analyzeCascade(series9, series21, series50, price);
    
    if (!cascade.direction || !cascade.aligned) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['No EMA alignment - waiting'] };
    }
    
    // V2.1: Allow partial crossover but penalize score
    // V2.1: Loosen freshness requirement
    
    const direction = cascade.direction;
    const reasons: string[] = [];
    let score = cascade.score;
    
    if (cascade.isCascade) {
      reasons.push(`${direction === 'bull' ? '📈' : '📉'} ${direction.toUpperCase()} cascade confirmed`);
    } else {
      reasons.push(`${direction === 'bull' ? '📈' : '📉'} ${direction.toUpperCase()} crossover (9/21)`);
    }
    reasons.push(`Freshness: ${cascade.freshness.toFixed(0)}%`);
    
    // Momentum confirmation
    const momentum = checkMomentum(series9, series21, direction);
    
    if (momentum < 40) {
      score -= 15;
      reasons.push('⚠️ Weak momentum');
    } else if (momentum >= 70) {
      score += 10;
      reasons.push('✓ Strong momentum');
    }
    
    // Volume check (from shared indicators since we're checking, not calculating)
    const volumes = candles.slice(-21, -1).map(c => c.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const currentVolume = candles[candles.length - 1].volume;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    
    if (volumeRatio >= 1.3) {
      score += 10;
      reasons.push(`Volume: ${volumeRatio.toFixed(1)}x`);
    }
    
    // ============================================
    // SIGNAL GENERATION WITH FIXED R:R
    // ============================================
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    // V2.1: Lower threshold since we're more selective elsewhere
    if (score >= 45) {
      signal = score >= 70 
        ? (direction === 'bull' ? 'STRONG_LONG' : 'STRONG_SHORT')
        : (direction === 'bull' ? 'LONG' : 'SHORT');
      
      // V2: ATR-based stop (consistent risk)
      const stopDistance = atr * 1.5;
      
      if (direction === 'bull') {
        stop = price - stopDistance;
        // V2: Target = 1.5x risk (guaranteed positive R:R)
        target = price + (stopDistance * 1.5);
      } else {
        stop = price + stopDistance;
        target = price - (stopDistance * 1.5);
      }
      
      const rr = Math.abs(target - price) / Math.abs(price - stop);
      reasons.push(`R:R ${rr.toFixed(1)}:1`);
    }
    
    return {
      type: signal,
      strength: Math.min(Math.max(score, 0), 100),
      entry: signal !== 'NEUTRAL' ? price : undefined,
      stop,
      target,
      reasons,
    };
  },
};
