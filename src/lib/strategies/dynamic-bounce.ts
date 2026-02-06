/**
 * Dynamic Bounce Strategy (Scalping)
 * 
 * CONCEPT: In trending markets, EMAs act as dynamic support (uptrend) or
 * resistance (downtrend). Price "bounces" off these levels predictably.
 * 
 * MATHEMATICS:
 * - Trend direction: Price vs EMA200
 * - Bounce zone: Price within 0.5% of EMA21 or EMA50
 * - Bounce confirmation: Bullish/bearish candle pattern at zone
 * 
 * LOGIC:
 * - Uptrend (price > EMA200): Look for bounces OFF EMA21/50 (support)
 * - Downtrend (price < EMA200): Look for rejections AT EMA21/50 (resistance)
 * - Confirm with RSI not at extremes (room to move)
 * 
 * KEY INSIGHT:
 * - ONLY trade bounces WITH the trend
 * - Counter-trend bounces have much lower win rate
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

function detectTrend(price: number, ema200: number | null): 'up' | 'down' | 'neutral' {
  if (!ema200) return 'neutral';
  
  const distance = ((price - ema200) / ema200) * 100;
  
  if (distance > 2) return 'up';
  if (distance < -2) return 'down';
  return 'neutral';
}

function detectBounceZone(
  price: number,
  emas: Record<number, number | null>,
  trend: 'up' | 'down'
): { inZone: boolean; level: number; emaUsed: number; distance: number } {
  const ema21 = emas[21];
  const ema50 = emas[50];
  
  if (!ema21 || !ema50) {
    return { inZone: false, level: 0, emaUsed: 0, distance: 100 };
  }
  
  const distToEma21 = ((price - ema21) / ema21) * 100;
  const distToEma50 = ((price - ema50) / ema50) * 100;
  
  // In uptrend: price should be AT or SLIGHTLY BELOW the EMA (touching support)
  // In downtrend: price should be AT or SLIGHTLY ABOVE the EMA (touching resistance)
  
  if (trend === 'up') {
    // Look for price touching EMA21 from above
    if (distToEma21 >= -0.5 && distToEma21 <= 1.0) {
      return { inZone: true, level: ema21, emaUsed: 21, distance: distToEma21 };
    }
    // Or EMA50 as deeper support
    if (distToEma50 >= -0.5 && distToEma50 <= 1.0) {
      return { inZone: true, level: ema50, emaUsed: 50, distance: distToEma50 };
    }
  } else if (trend === 'down') {
    // Look for price touching EMA21 from below
    if (distToEma21 >= -1.0 && distToEma21 <= 0.5) {
      return { inZone: true, level: ema21, emaUsed: 21, distance: distToEma21 };
    }
    if (distToEma50 >= -1.0 && distToEma50 <= 0.5) {
      return { inZone: true, level: ema50, emaUsed: 50, distance: distToEma50 };
    }
  }
  
  return { inZone: false, level: 0, emaUsed: 0, distance: Math.min(Math.abs(distToEma21), Math.abs(distToEma50)) };
}

function detectCandlePattern(
  candles: OHLCVData[],
  trend: 'up' | 'down'
): { isBounce: boolean; strength: number; pattern: string } {
  if (candles.length < 3) {
    return { isBounce: false, strength: 0, pattern: 'insufficient data' };
  }
  
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  
  const currentBody = current.close - current.open;
  const currentRange = current.high - current.low;
  const bodyRatio = Math.abs(currentBody) / currentRange;
  
  const prevBody = prev.close - prev.open;
  
  if (trend === 'up') {
    // Looking for bullish reversal candles at support
    
    // Bullish engulfing
    if (currentBody > 0 && prevBody < 0 && currentBody > Math.abs(prevBody)) {
      return { isBounce: true, strength: 90, pattern: 'Bullish engulfing' };
    }
    
    // Hammer (small body, long lower wick)
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    if (lowerWick > 2 * Math.abs(currentBody) && lowerWick > upperWick * 2) {
      return { isBounce: true, strength: 80, pattern: 'Hammer' };
    }
    
    // Simple bullish candle after red
    if (currentBody > 0 && prevBody < 0) {
      return { isBounce: true, strength: 60, pattern: 'Bullish reversal candle' };
    }
    
    // Strong bullish candle
    if (currentBody > 0 && bodyRatio > 0.6) {
      return { isBounce: true, strength: 50, pattern: 'Strong bullish candle' };
    }
    
  } else if (trend === 'down') {
    // Looking for bearish reversal candles at resistance
    
    // Bearish engulfing
    if (currentBody < 0 && prevBody > 0 && Math.abs(currentBody) > prevBody) {
      return { isBounce: true, strength: 90, pattern: 'Bearish engulfing' };
    }
    
    // Shooting star (small body, long upper wick)
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    if (upperWick > 2 * Math.abs(currentBody) && upperWick > lowerWick * 2) {
      return { isBounce: true, strength: 80, pattern: 'Shooting star' };
    }
    
    // Simple bearish candle after green
    if (currentBody < 0 && prevBody > 0) {
      return { isBounce: true, strength: 60, pattern: 'Bearish reversal candle' };
    }
    
    // Strong bearish candle
    if (currentBody < 0 && bodyRatio > 0.6) {
      return { isBounce: true, strength: 50, pattern: 'Strong bearish candle' };
    }
  }
  
  return { isBounce: false, strength: 0, pattern: 'No pattern' };
}

function calculateRSIFilter(rsi: number | null, trend: 'up' | 'down'): number {
  if (rsi === null) return 50;
  
  if (trend === 'up') {
    // For long bounces, RSI should NOT be overbought (room to run up)
    if (rsi >= 30 && rsi <= 55) return 100; // Ideal zone
    if (rsi > 55 && rsi <= 65) return 70;
    if (rsi > 65 && rsi <= 70) return 40;
    if (rsi > 70) return 10; // Overbought, avoid
    if (rsi < 30) return 60; // Oversold at support, good
  } else {
    // For short bounces, RSI should NOT be oversold
    if (rsi >= 45 && rsi <= 70) return 100;
    if (rsi >= 35 && rsi < 45) return 70;
    if (rsi >= 30 && rsi < 35) return 40;
    if (rsi < 30) return 10; // Oversold, avoid shorting
    if (rsi > 70) return 60; // Overbought at resistance, good
  }
  
  return 50;
}

export const dynamicBounce: Strategy = {
  id: 'dynamic-bounce',
  name: 'Dynamic Bounce',
  description: 'Scalp strategy: Trade bounces off EMA support/resistance in trending markets',
  category: 'scalp',
  timeframes: ['5m', '15m', '1h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, rsi, atr } = indicators;
    
    const trend = detectTrend(price, emas.values[200]);
    
    if (trend === 'neutral') {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['No clear trend - Dynamic Bounce requires trending market'],
      };
    }
    
    const bounceZone = detectBounceZone(price, emas.values, trend);
    
    if (!bounceZone.inZone) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: [`Price not at EMA bounce zone (${bounceZone.distance.toFixed(1)}% away)`],
      };
    }
    
    const candlePattern = detectCandlePattern(candles, trend);
    const rsiScore = calculateRSIFilter(rsi, trend);
    
    const reasons: string[] = [];
    reasons.push(`${trend === 'up' ? 'Uptrend' : 'Downtrend'} detected`);
    reasons.push(`Price at EMA${bounceZone.emaUsed} ${trend === 'up' ? 'support' : 'resistance'}`);
    
    if (candlePattern.isBounce) {
      reasons.push(`Pattern: ${candlePattern.pattern}`);
    }
    
    if (!candlePattern.isBounce) {
      return {
        type: 'NEUTRAL',
        strength: Math.round(rsiScore * 0.3),
        reasons: [...reasons, 'Waiting for bounce confirmation candle'],
      };
    }
    
    // Calculate final score
    const zoneScore = 100 - Math.abs(bounceZone.distance) * 20; // Closer = better
    const finalScore = (zoneScore * 0.3) + (candlePattern.strength * 0.4) + (rsiScore * 0.3);
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    // Scalping uses tighter ATR multiplier
    const atrStop = atr ? atr * 0.8 : price * 0.01;
    
    if (finalScore >= 70) {
      signal = trend === 'up' ? 'STRONG_LONG' : 'STRONG_SHORT';
      // Tight ATR-based stops for scalping
      if (trend === 'up') {
        stop = Math.max(price - atrStop, bounceZone.level * 0.995);
        target = price + (atrStop * 1.5); // Quick 1.5:1 scalp target
      } else {
        stop = Math.min(price + atrStop, bounceZone.level * 1.005);
        target = price - (atrStop * 1.5);
      }
    } else if (finalScore >= 50) {
      signal = trend === 'up' ? 'LONG' : 'SHORT';
      if (trend === 'up') {
        stop = Math.max(price - atrStop, bounceZone.level * 0.99);
        target = price + atrStop; // 1:1 for lower confidence
      } else {
        stop = Math.min(price + atrStop, bounceZone.level * 1.01);
        target = price - atrStop;
      }
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
