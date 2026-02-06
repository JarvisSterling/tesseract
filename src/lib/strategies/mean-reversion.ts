/**
 * Mean Reversion Sniper Strategy
 * 
 * CONCEPT: Price tends to revert to its mean (moving average).
 * When price extends too far from the mean, it's like a rubber band
 * stretched too tight — it snaps back.
 * 
 * MATHEMATICS:
 * - Deviation = (Price - EMA21) / EMA21 * 100
 * - Oversold: Deviation < -3% (price too far below EMA)
 * - Overbought: Deviation > +3% (price too far above EMA)
 * - Entry: Extreme deviation + reversal candle pattern
 * 
 * SIGNALS:
 * - Long: Price >3% below EMA21 + bullish reversal candle + RSI < 35
 * - Short: Price >3% above EMA21 + bearish reversal candle + RSI > 65
 * 
 * KEY INSIGHT:
 * - Works best in ranging/choppy markets
 * - Avoid during strong trends (can stay extended)
 * - Target is the mean (EMA21), not beyond
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

interface DeviationAnalysis {
  deviation: number; // % from EMA21
  isExtended: boolean;
  direction: 'overbought' | 'oversold' | 'normal';
  extensionStrength: number; // How far past threshold
}

function analyzeDeviation(price: number, ema21: number | null): DeviationAnalysis {
  if (!ema21) {
    return { deviation: 0, isExtended: false, direction: 'normal', extensionStrength: 0 };
  }
  
  const deviation = ((price - ema21) / ema21) * 100;
  const threshold = 1.5; // 1.5% deviation triggers signal (crypto is volatile)
  
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
  
  if (expectedDirection === 'bullish') {
    // Bullish engulfing
    if (currentBody > 0 && prevBody < 0 && currentBody > Math.abs(prevBody) * 0.8) {
      return { isReversal: true, type: 'bullish', pattern: 'Bullish Engulfing', strength: 90 };
    }
    
    // Hammer (long lower wick)
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    if (currentRange > 0 && lowerWick / currentRange > 0.6 && upperWick / currentRange < 0.1) {
      return { isReversal: true, type: 'bullish', pattern: 'Hammer', strength: 80 };
    }
    
    // Morning star (3 candle pattern)
    const prev2Body = prev2.close - prev2.open;
    if (prev2Body < 0 && Math.abs(prevBody) < Math.abs(prev2Body) * 0.3 && currentBody > 0) {
      return { isReversal: true, type: 'bullish', pattern: 'Morning Star', strength: 85 };
    }
    
    // Simple bullish candle after red
    if (currentBody > 0 && prevBody < 0) {
      return { isReversal: true, type: 'bullish', pattern: 'Bullish Reversal', strength: 50 };
    }
  } else {
    // Bearish engulfing
    if (currentBody < 0 && prevBody > 0 && Math.abs(currentBody) > prevBody * 0.8) {
      return { isReversal: true, type: 'bearish', pattern: 'Bearish Engulfing', strength: 90 };
    }
    
    // Shooting star (long upper wick)
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    if (currentRange > 0 && upperWick / currentRange > 0.6 && lowerWick / currentRange < 0.1) {
      return { isReversal: true, type: 'bearish', pattern: 'Shooting Star', strength: 80 };
    }
    
    // Evening star
    const prev2Body = prev2.close - prev2.open;
    if (prev2Body > 0 && Math.abs(prevBody) < prev2Body * 0.3 && currentBody < 0) {
      return { isReversal: true, type: 'bearish', pattern: 'Evening Star', strength: 85 };
    }
    
    // Simple bearish candle after green
    if (currentBody < 0 && prevBody > 0) {
      return { isReversal: true, type: 'bearish', pattern: 'Bearish Reversal', strength: 50 };
    }
  }
  
  return { isReversal: false, type: null, pattern: 'No pattern', strength: 0 };
}

function isTrending(emas: { values: Record<number, number | null>; slopes: Record<number, number | null> }): boolean {
  // Only avoid VERY strong trends where mean reversion is dangerous
  const slope21 = emas.slopes[21];
  const slope50 = emas.slopes[50];
  
  // Very steep slope on both EMAs = strong trend, avoid
  const steepSlope21 = slope21 !== null && Math.abs(slope21) > 2;
  const steepSlope50 = slope50 !== null && Math.abs(slope50) > 1.5;
  
  return steepSlope21 && steepSlope50;
}

export const meanReversion: Strategy = {
  id: 'mean-reversion',
  name: 'Mean Reversion Sniper',
  description: 'Catch overextended moves snapping back to EMA21 with reversal confirmation',
  category: 'reversal',
  timeframes: ['15m', '1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, rsi, atr, volume } = indicators;
    
    const ema21 = emas.values[21];
    const deviation = analyzeDeviation(price, ema21);
    
    if (!deviation.isExtended) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Price within normal range of EMA21'] };
    }
    
    // Check if market is strongly trending (avoid mean reversion in trends)
    if (isTrending(emas)) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: ['⚠️ Strong trend detected - mean reversion risky'] 
      };
    }
    
    const reasons: string[] = [];
    let score = 0;
    
    // Determine expected reversal direction
    const expectedDirection = deviation.direction === 'oversold' ? 'bullish' : 'bearish';
    const pattern = detectReversalPattern(candles, expectedDirection);
    
    reasons.push(`Price ${deviation.deviation.toFixed(1)}% from EMA21 (${deviation.direction})`);
    
    // Base score for extension
    score += Math.min(deviation.extensionStrength * 10, 30);
    
    // Pattern confirmation increases confidence
    if (pattern.isReversal && pattern.type === expectedDirection) {
      score += pattern.strength * 0.5;
      reasons.push(`✓ ${pattern.pattern} detected`);
    } else {
      // No perfect pattern but still extended - give partial score
      score += 15;
      reasons.push('⏳ Extended - watching for reversal confirmation');
    }
    
    // RSI confirmation
    if (rsi !== null) {
      if (deviation.direction === 'oversold' && rsi < 35) {
        score += 20;
        reasons.push(`RSI oversold (${rsi.toFixed(0)})`);
      } else if (deviation.direction === 'overbought' && rsi > 65) {
        score += 20;
        reasons.push(`RSI overbought (${rsi.toFixed(0)})`);
      } else if (deviation.direction === 'oversold' && rsi < 45) {
        score += 10;
      } else if (deviation.direction === 'overbought' && rsi > 55) {
        score += 10;
      }
    }
    
    // Volume on reversal candle
    if (volume.ratio > 1.3) {
      score += 10;
      reasons.push('Volume confirms reversal');
    }
    
    // Calculate levels
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    const atrStop = atr ? atr * 1.0 : price * 0.015; // Tighter stops for reversals
    
    if (score >= 50) {
      const isLong = deviation.direction === 'oversold';
      signal = score >= 70 
        ? (isLong ? 'STRONG_LONG' : 'STRONG_SHORT')
        : (isLong ? 'LONG' : 'SHORT');
      
      // Target is the mean (EMA21)
      target = ema21 || (isLong ? price * 1.025 : price * 0.975);
      
      // Stop beyond the recent extreme
      if (isLong) {
        const recentLow = Math.min(...candles.slice(-5).map(c => c.low));
        stop = Math.min(recentLow * 0.995, price - atrStop);
      } else {
        const recentHigh = Math.max(...candles.slice(-5).map(c => c.high));
        stop = Math.max(recentHigh * 1.005, price + atrStop);
      }
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
