/**
 * Mean Reversion Sniper Strategy - V2 (Fixed)
 * 
 * PREVIOUS ISSUES:
 * - 24.3% win rate, -45% P&L (worst performer)
 * - Threshold too low (1.5%)
 * - RSI not extreme enough
 * - Weak trend filter
 * 
 * FIXES:
 * - Increased deviation threshold to 3%
 * - RSI must be truly extreme (<25 / >75)
 * - Strong trend filter using multiple EMAs
 * - Only strong candlestick patterns accepted
 * - Added EMA200 confirmation (price must be near support/resistance)
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

interface DeviationAnalysis {
  deviation: number;
  isExtended: boolean;
  direction: 'overbought' | 'oversold' | 'normal';
  extensionStrength: number;
}

function analyzeDeviation(price: number, ema21: number | null): DeviationAnalysis {
  if (!ema21) {
    return { deviation: 0, isExtended: false, direction: 'normal', extensionStrength: 0 };
  }
  
  const deviation = ((price - ema21) / ema21) * 100;
  // INCREASED: Threshold from 1.5% to 3% - only trigger on real extensions
  const threshold = 3.0;
  
  if (deviation > threshold) {
    return {
      deviation,
      isExtended: true,
      direction: 'overbought',
      extensionStrength: deviation - threshold,
    };
  }
  
  if (deviation < -threshold) {
    return {
      deviation,
      isExtended: true,
      direction: 'oversold',
      extensionStrength: Math.abs(deviation) - threshold,
    };
  }
  
  return { deviation, isExtended: false, direction: 'normal', extensionStrength: 0 };
}

interface ReversalPattern {
  isReversal: boolean;
  type: 'bullish' | 'bearish' | null;
  pattern: string;
  strength: number;
}

function detectReversalPattern(candles: OHLCVData[], expectedDirection: 'bullish' | 'bearish'): ReversalPattern {
  if (candles.length < 3) {
    return { isReversal: false, type: null, pattern: 'Insufficient data', strength: 0 };
  }
  
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  
  const currentBody = current.close - current.open;
  const prevBody = prev.close - prev.open;
  const currentRange = current.high - current.low;
  
  // Only accept STRONG patterns (removed weak "simple reversal" pattern)
  
  if (expectedDirection === 'bullish') {
    // Bullish engulfing - current green must FULLY engulf previous red
    if (currentBody > 0 && prevBody < 0 && 
        current.open <= prev.close && current.close >= prev.open &&
        currentBody > Math.abs(prevBody) * 1.0) {
      return { isReversal: true, type: 'bullish', pattern: 'Bullish Engulfing', strength: 85 };
    }
    
    // Strong hammer (very long lower wick, tiny body)
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    const bodySize = Math.abs(currentBody);
    if (currentRange > 0 && 
        lowerWick >= bodySize * 2 && 
        upperWick < bodySize * 0.5 &&
        lowerWick / currentRange > 0.65) {
      return { isReversal: true, type: 'bullish', pattern: 'Hammer', strength: 80 };
    }
    
    // Morning star (3 candle pattern) - strict version
    const prev2Body = prev2.close - prev2.open;
    const prevBodySize = Math.abs(prevBody);
    if (prev2Body < 0 && // First: big red
        prevBodySize < Math.abs(prev2Body) * 0.25 && // Second: tiny body (doji-like)
        currentBody > 0 && // Third: big green
        currentBody > Math.abs(prev2Body) * 0.5) { // Green at least 50% of red
      return { isReversal: true, type: 'bullish', pattern: 'Morning Star', strength: 90 };
    }
    
    // NO simple reversal pattern - too weak
  } else {
    // Bearish engulfing
    if (currentBody < 0 && prevBody > 0 && 
        current.open >= prev.close && current.close <= prev.open &&
        Math.abs(currentBody) > prevBody * 1.0) {
      return { isReversal: true, type: 'bearish', pattern: 'Bearish Engulfing', strength: 85 };
    }
    
    // Strong shooting star
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const bodySize = Math.abs(currentBody);
    if (currentRange > 0 && 
        upperWick >= bodySize * 2 && 
        lowerWick < bodySize * 0.5 &&
        upperWick / currentRange > 0.65) {
      return { isReversal: true, type: 'bearish', pattern: 'Shooting Star', strength: 80 };
    }
    
    // Evening star
    const prev2Body = prev2.close - prev2.open;
    const prevBodySize = Math.abs(prevBody);
    if (prev2Body > 0 && // First: big green
        prevBodySize < prev2Body * 0.25 && // Second: tiny body
        currentBody < 0 && // Third: big red
        Math.abs(currentBody) > prev2Body * 0.5) {
      return { isReversal: true, type: 'bearish', pattern: 'Evening Star', strength: 90 };
    }
  }
  
  return { isReversal: false, type: null, pattern: 'No strong pattern', strength: 0 };
}

// NEW: Much stricter trend detection
function isTrending(emas: { values: Record<number, number | null>; slopes: Record<number, number | null> }): boolean {
  const slope9 = emas.slopes[9];
  const slope21 = emas.slopes[21];
  const slope50 = emas.slopes[50];
  
  // Check if EMAs are stacked (trending)
  const ema9 = emas.values[9];
  const ema21 = emas.values[21];
  const ema50 = emas.values[50];
  
  if (!ema9 || !ema21 || !ema50) return false;
  
  // Bull stack: 9 > 21 > 50 with positive slopes
  const bullStack = ema9 > ema21 && ema21 > ema50;
  const bullSlopes = slope9 !== null && slope21 !== null && slope9 > 0.3 && slope21 > 0.2;
  
  // Bear stack: 9 < 21 < 50 with negative slopes
  const bearStack = ema9 < ema21 && ema21 < ema50;
  const bearSlopes = slope9 !== null && slope21 !== null && slope9 < -0.3 && slope21 < -0.2;
  
  // If EMAs are stacked AND slopes confirm = TRENDING, avoid mean reversion
  if ((bullStack && bullSlopes) || (bearStack && bearSlopes)) {
    return true;
  }
  
  // Also check for steep short-term slope (momentum)
  if (slope9 !== null && Math.abs(slope9) > 1.5) {
    return true;
  }
  
  return false;
}

// NEW: Check if EMA200 provides support/resistance
function hasEmaSupport(
  price: number, 
  emas: { values: Record<number, number | null> },
  direction: 'bullish' | 'bearish'
): boolean {
  const ema100 = emas.values[100];
  const ema200 = emas.values[200];
  
  if (!ema100 && !ema200) return true; // Not enough data, give benefit of doubt
  
  if (direction === 'bullish') {
    // For bullish reversal, price should be near or above EMA100/200 (support)
    // Don't try to catch falling knives way below all EMAs
    if (ema200 && price < ema200 * 0.95) return false; // More than 5% below EMA200
    if (ema100 && price < ema100 * 0.92) return false; // More than 8% below EMA100
  } else {
    // For bearish reversal, price should be near or below EMA100/200 (resistance)
    if (ema200 && price > ema200 * 1.05) return false; // More than 5% above EMA200
    if (ema100 && price > ema100 * 1.08) return false; // More than 8% above EMA100
  }
  
  return true;
}

// NEW: Check for exhaustion signs
function hasExhaustionSign(candles: OHLCVData[], direction: 'bullish' | 'bearish'): boolean {
  if (candles.length < 3) return false;
  
  const recent = candles.slice(-3);
  
  if (direction === 'bullish') {
    // Look for decreasing red candle size (selling exhaustion)
    const bodies = recent.map(c => c.close - c.open);
    if (bodies[0] < 0 && bodies[1] < 0 && bodies[2] < 0) {
      // All red but getting smaller = exhaustion
      if (Math.abs(bodies[2]) < Math.abs(bodies[1]) && Math.abs(bodies[1]) < Math.abs(bodies[0])) {
        return true;
      }
    }
  } else {
    // Look for decreasing green candle size (buying exhaustion)
    const bodies = recent.map(c => c.close - c.open);
    if (bodies[0] > 0 && bodies[1] > 0 && bodies[2] > 0) {
      if (bodies[2] < bodies[1] && bodies[1] < bodies[0]) {
        return true;
      }
    }
  }
  
  return false;
}

export const meanReversion: Strategy = {
  id: 'mean-reversion',
  name: 'Mean Reversion Sniper',
  description: 'Catch overextended moves snapping back to EMA21 with strict reversal confirmation',
  category: 'reversal',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, rsi, atr, volume } = indicators;
    
    const ema21 = emas.values[21];
    const deviation = analyzeDeviation(price, ema21);
    
    // Gate 1: Must be extended (now 3% threshold instead of 1.5%)
    if (!deviation.isExtended) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Price within normal range of EMA21'] };
    }
    
    // Gate 2: No trading in trending markets (stricter check)
    if (isTrending(emas)) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: ['⚠️ Trending market - mean reversion disabled'] 
      };
    }
    
    const expectedDirection = deviation.direction === 'oversold' ? 'bullish' : 'bearish';
    
    // Gate 3: Must have EMA support/resistance
    if (!hasEmaSupport(price, emas, expectedDirection)) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['⚠️ Too far from major EMA support/resistance'],
      };
    }
    
    // Gate 4: REQUIRE strong reversal pattern (no weak patterns)
    const pattern = detectReversalPattern(candles, expectedDirection);
    if (!pattern.isReversal || pattern.type !== expectedDirection) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: [`Extended ${deviation.deviation.toFixed(1)}% but no reversal pattern yet`],
      };
    }
    
    // Passed all gates - now score the signal
    const reasons: string[] = [];
    let score = 0;
    
    reasons.push(`Price ${deviation.deviation.toFixed(1)}% from EMA21 (${deviation.direction})`);
    reasons.push(`✓ ${pattern.pattern} confirmed`);
    
    // Base score from extension + pattern
    score += Math.min(deviation.extensionStrength * 8, 25); // Extension
    score += pattern.strength * 0.4; // Pattern (max ~36 pts)
    
    // RSI confirmation (STRICTER: <25 or >75)
    if (rsi !== null) {
      if (deviation.direction === 'oversold' && rsi < 25) {
        score += 25;
        reasons.push(`RSI extreme oversold (${rsi.toFixed(0)})`);
      } else if (deviation.direction === 'overbought' && rsi > 75) {
        score += 25;
        reasons.push(`RSI extreme overbought (${rsi.toFixed(0)})`);
      } else if (deviation.direction === 'oversold' && rsi < 35) {
        score += 12;
        reasons.push(`RSI oversold (${rsi.toFixed(0)})`);
      } else if (deviation.direction === 'overbought' && rsi > 65) {
        score += 12;
        reasons.push(`RSI overbought (${rsi.toFixed(0)})`);
      } else {
        // RSI not confirming - reduce score
        score -= 10;
        reasons.push(`⚠️ RSI not extreme (${rsi.toFixed(0)})`);
      }
    }
    
    // Volume on reversal candle
    if (volume.ratio > 1.5) {
      score += 15;
      reasons.push('High volume confirms reversal');
    } else if (volume.ratio > 1.2) {
      score += 8;
      reasons.push('Above-average volume');
    }
    
    // Exhaustion signs (bonus)
    if (hasExhaustionSign(candles, expectedDirection)) {
      score += 10;
      reasons.push('✓ Exhaustion pattern visible');
    }
    
    // Minimum score threshold increased
    if (score < 55) {
      return {
        type: 'NEUTRAL',
        strength: Math.round(score),
        reasons: [...reasons, '⚠️ Signal not strong enough'],
      };
    }
    
    // Calculate levels
    const isLong = deviation.direction === 'oversold';
    const signal: SignalType = score >= 80 
      ? (isLong ? 'STRONG_LONG' : 'STRONG_SHORT')
      : (isLong ? 'LONG' : 'SHORT');
    
    // Target is the mean (EMA21)
    const target = ema21 || (isLong ? price * 1.025 : price * 0.975);
    
    // Stop beyond the recent extreme with tighter ATR multiplier
    const atrStop = atr ? atr * 0.8 : price * 0.012;
    let stop: number;
    
    if (isLong) {
      const recentLow = Math.min(...candles.slice(-5).map(c => c.low));
      stop = Math.min(recentLow * 0.997, price - atrStop);
    } else {
      const recentHigh = Math.max(...candles.slice(-5).map(c => c.high));
      stop = Math.max(recentHigh * 1.003, price + atrStop);
    }
    
    return {
      type: signal,
      strength: Math.min(Math.max(Math.round(score), 0), 100),
      entry: price,
      stop,
      target,
      reasons,
    };
  },
};
