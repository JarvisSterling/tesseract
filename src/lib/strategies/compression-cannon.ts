/**
 * Compression Cannon Strategy (Breakout Trading)
 * 
 * CONCEPT: When EMAs compress (converge), volatility is contracting like a
 * coiled spring. This often precedes explosive directional moves.
 * 
 * MATHEMATICS:
 * - EMA Bandwidth = (EMA9 - EMA200) / EMA200 * 100
 * - When bandwidth falls below threshold, compression detected
 * - Direction determined by which way price breaks out
 * 
 * LOGIC:
 * - Detect compression: EMA bandwidth < 3%
 * - Wait for expansion: Price breaks above EMA9 (bull) or below EMA200 (bear)
 * - Confirm with volume surge
 * 
 * NOVEL ASPECT:
 * - Uses rate of compression change to predict imminent breakout
 * - Tighter compression = higher probability explosive move
 */

import { Strategy, StrategyInput, StrategySignal, SignalType } from './types';

function calculateBandwidth(emas: Record<number, number | null>): number | null {
  const ema9 = emas[9];
  const ema200 = emas[200];
  
  if (!ema9 || !ema200 || ema200 === 0) return null;
  
  return Math.abs(ema9 - ema200) / ema200 * 100;
}

function calculateCompressionScore(
  bandwidth: number | null,
  emaSeries: Record<number, number[]>
): { score: number; isCompressing: boolean; compressionRate: number } {
  if (bandwidth === null) {
    return { score: 0, isCompressing: false, compressionRate: 0 };
  }
  
  // Calculate historical bandwidth to detect compression trend
  const ema9Series = emaSeries[9] || [];
  const ema200Series = emaSeries[200] || [];
  
  if (ema9Series.length < 10 || ema200Series.length < 10) {
    // Not enough data, just use current bandwidth
    const score = bandwidth < 2 ? 100 : bandwidth < 3 ? 80 : bandwidth < 5 ? 50 : 0;
    return { score, isCompressing: bandwidth < 5, compressionRate: 0 };
  }
  
  // Calculate bandwidth 10 periods ago
  const len = Math.min(ema9Series.length, ema200Series.length);
  const oldEma9 = ema9Series[len - 10];
  const oldEma200 = ema200Series[len - 10];
  const oldBandwidth = Math.abs(oldEma9 - oldEma200) / oldEma200 * 100;
  
  const compressionRate = oldBandwidth - bandwidth; // Positive = compressing
  const isCompressing = compressionRate > 0.5;
  
  // Score based on current tightness + compression rate
  let score = 0;
  
  // Tightness score (0-60)
  if (bandwidth < 1.5) score += 60;
  else if (bandwidth < 2.5) score += 50;
  else if (bandwidth < 4) score += 30;
  else if (bandwidth < 6) score += 15;
  
  // Compression rate bonus (0-40)
  if (compressionRate > 2) score += 40;
  else if (compressionRate > 1) score += 30;
  else if (compressionRate > 0.5) score += 20;
  else if (compressionRate > 0) score += 10;
  
  return { score, isCompressing, compressionRate };
}

function detectBreakoutDirection(
  price: number,
  emas: Record<number, number | null>,
  candles: { close: number; high: number; low: number }[]
): { direction: 'bull' | 'bear' | null; strength: number } {
  const ema9 = emas[9];
  const ema21 = emas[21];
  const ema200 = emas[200];
  
  if (!ema9 || !ema21 || !ema200) {
    return { direction: null, strength: 0 };
  }
  
  // Check recent price action
  const recentCandles = candles.slice(-5);
  if (recentCandles.length < 3) return { direction: null, strength: 0 };
  
  const recentHighs = recentCandles.map(c => c.high);
  const recentLows = recentCandles.map(c => c.low);
  const maxHigh = Math.max(...recentHighs);
  const minLow = Math.min(...recentLows);
  
  // Bullish breakout: price above EMA9 and making new highs
  if (price > ema9 && price > ema21 && price >= maxHigh * 0.998) {
    const strength = ((price - ema9) / ema9) * 100;
    return { direction: 'bull', strength: Math.min(strength * 20, 100) };
  }
  
  // Bearish breakout: price below EMA200 and making new lows
  if (price < ema200 && price < ema21 && price <= minLow * 1.002) {
    const strength = ((ema200 - price) / ema200) * 100;
    return { direction: 'bear', strength: Math.min(strength * 20, 100) };
  }
  
  // No clear breakout yet
  return { direction: null, strength: 0 };
}

function calculateVolumeConfirmation(
  volumeRatio: number
): number {
  // Volume surge confirms breakout
  if (volumeRatio >= 2.0) return 100; // 2x average volume
  if (volumeRatio >= 1.5) return 80;
  if (volumeRatio >= 1.2) return 60;
  if (volumeRatio >= 1.0) return 40;
  return 20; // Low volume = weak breakout
}

export const compressionCannon: Strategy = {
  id: 'compression-cannon',
  name: 'Compression Cannon',
  description: 'Breakout strategy: Detect EMA compression, enter on explosive expansion',
  category: 'breakout',
  timeframes: ['15m', '1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, volume, atr } = indicators;
    
    const bandwidth = calculateBandwidth(emas.values);
    const { score: compressionScore, isCompressing, compressionRate } = 
      calculateCompressionScore(bandwidth, emas.series);
    
    const reasons: string[] = [];
    
    // Not in compression zone
    if (compressionScore < 30) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['EMAs not compressed - no setup'],
      };
    }
    
    if (bandwidth !== null) {
      reasons.push(`EMA bandwidth: ${bandwidth.toFixed(1)}%`);
    }
    if (isCompressing) {
      reasons.push(`Compression rate: ${compressionRate.toFixed(2)}%/period`);
    }
    
    // Check for breakout
    const ohlcCandles = candles.map(c => ({ 
      close: c.close, 
      high: c.high, 
      low: c.low 
    }));
    const breakout = detectBreakoutDirection(price, emas.values, ohlcCandles);
    
    if (!breakout.direction) {
      // Compression detected but no breakout yet - PREPARE signal
      return {
        type: 'NEUTRAL',
        strength: Math.round(compressionScore * 0.5),
        reasons: [...reasons, '⚠️ Compression detected - breakout imminent, wait for direction'],
      };
    }
    
    // Breakout in progress!
    const volumeScore = calculateVolumeConfirmation(volume.ratio);
    reasons.push(breakout.direction === 'bull' ? 'Bullish breakout' : 'Bearish breakout');
    
    if (volume.ratio >= 1.5) {
      reasons.push(`Volume surge: ${volume.ratio.toFixed(1)}x average`);
    }
    
    // Final score: compression quality + breakout strength + volume
    const finalScore = (compressionScore * 0.4) + (breakout.strength * 0.4) + (volumeScore * 0.2);
    
    const ema21 = emas.values[21];
    const atrStop = atr ? atr * 1.2 : price * 0.015; // Tighter stop for breakouts
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    if (finalScore >= 70) {
      signal = breakout.direction === 'bull' ? 'STRONG_LONG' : 'STRONG_SHORT';
      // ATR-based stop, but also consider EMA21 as support
      const emaStop = ema21 ? (breakout.direction === 'bull' ? ema21 * 0.995 : ema21 * 1.005) : null;
      stop = breakout.direction === 'bull' 
        ? Math.max(price - atrStop, emaStop || 0)
        : Math.min(price + atrStop, emaStop || Infinity);
      
      // Target: 3x risk (breakouts often run)
      target = breakout.direction === 'bull' 
        ? price + (atrStop * 3)
        : price - (atrStop * 3);
    } else if (finalScore >= 50) {
      signal = breakout.direction === 'bull' ? 'LONG' : 'SHORT';
      stop = breakout.direction === 'bull' ? price - atrStop : price + atrStop;
      target = breakout.direction === 'bull' 
        ? price + (atrStop * 2)
        : price - (atrStop * 2);
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
