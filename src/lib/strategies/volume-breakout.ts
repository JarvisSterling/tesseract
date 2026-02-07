/**
 * Volume Breakout Strategy
 * 
 * CONCEPT: Volume precedes price. When volume surges significantly
 * above average while price breaks a key level, it signals
 * institutional participation and conviction.
 * 
 * MATHEMATICS:
 * - Volume Surge = Current Volume / SMA(Volume, 20)
 * - Price Breakout = Close above/below N-period high/low
 * - Conviction Score = Volume Surge * Price Momentum
 * 
 * SIGNALS:
 * - Bullish: 2x+ volume + new 20-period high + close in upper 25% of range
 * - Bearish: 2x+ volume + new 20-period low + close in lower 25% of range
 * 
 * KEY INSIGHT:
 * - High volume on breakout = institutions are buying/selling
 * - Low volume breakouts often fail (no conviction)
 * - The best breakouts have increasing volume bars
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

interface VolumeAnalysis {
  currentVolume: number;
  avgVolume: number;
  volumeRatio: number;
  volumeIncreasing: boolean; // 3 consecutive higher volume bars
  volumeSpike: boolean; // > 2x average
}

function analyzeVolume(candles: OHLCVData[]): VolumeAnalysis {
  const volumes = candles.map(c => c.volume);
  const period = 20;
  
  if (volumes.length < period) {
    return { currentVolume: 0, avgVolume: 0, volumeRatio: 1, volumeIncreasing: false, volumeSpike: false };
  }
  
  const avgVolume = volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
  
  // Check for 3 consecutive increasing volume bars
  const lastThree = volumes.slice(-3);
  const volumeIncreasing = lastThree.length === 3 && 
    lastThree[2] > lastThree[1] && lastThree[1] > lastThree[0];
  
  const volumeSpike = volumeRatio >= 2.0;
  
  return { currentVolume, avgVolume, volumeRatio, volumeIncreasing, volumeSpike };
}

interface PriceBreakout {
  isBreakout: boolean;
  direction: 'up' | 'down' | null;
  strength: number; // How far past the level
  closePosition: number; // 0-1, where in candle range the close is
}

function analyzePriceBreakout(candles: OHLCVData[], lookback: number = 20): PriceBreakout {
  if (candles.length < lookback + 1) {
    return { isBreakout: false, direction: null, strength: 0, closePosition: 0.5 };
  }
  
  const current = candles[candles.length - 1];
  const previous = candles.slice(-lookback - 1, -1);
  
  const highestHigh = Math.max(...previous.map(c => c.high));
  const lowestLow = Math.min(...previous.map(c => c.low));
  const range = highestHigh - lowestLow;
  
  // Where did the current candle close within its range?
  const candleRange = current.high - current.low;
  const closePosition = candleRange > 0 
    ? (current.close - current.low) / candleRange 
    : 0.5;
  
  // Bullish breakout: close above previous high
  if (current.close > highestHigh) {
    const strength = range > 0 ? (current.close - highestHigh) / range * 100 : 0;
    return { isBreakout: true, direction: 'up', strength, closePosition };
  }
  
  // Bearish breakout: close below previous low
  if (current.close < lowestLow) {
    const strength = range > 0 ? (lowestLow - current.close) / range * 100 : 0;
    return { isBreakout: true, direction: 'down', strength, closePosition };
  }
  
  return { isBreakout: false, direction: null, strength: 0, closePosition };
}

function calcMomentum(candles: OHLCVData[], period: number = 10): number {
  if (candles.length < period) return 0;
  
  const closes = candles.map(c => c.close);
  const current = closes[closes.length - 1];
  const past = closes[closes.length - period];
  
  return past > 0 ? ((current - past) / past) * 100 : 0;
}

export const volumeBreakout: Strategy = {
  id: 'volume-breakout',
  name: 'Volume Breakout',
  description: 'Enter on high-volume breakouts of key levels with institutional conviction',
  category: 'breakout',
  timeframes: ['15m', '1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, atr, rsi } = indicators;
    
    if (candles.length < 25) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    const volumeAnalysis = analyzeVolume(candles);
    const priceBreakout = analyzePriceBreakout(candles, 20);
    const momentum = calcMomentum(candles, 10);
    
    const reasons: string[] = [];
    let score = 0;
    
    // No breakout = no trade
    if (!priceBreakout.isBreakout) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['No price breakout detected'] };
    }
    
    const direction = priceBreakout.direction;
    reasons.push(`${direction === 'up' ? '📈' : '📉'} ${priceBreakout.direction?.toUpperCase()} breakout detected`);
    
    // Base score for breakout
    score += 25;
    
    // Volume is KEY
    if (volumeAnalysis.volumeSpike) {
      score += 35;
      reasons.push(`🔥 Volume SPIKE: ${volumeAnalysis.volumeRatio.toFixed(1)}x average`);
    } else if (volumeAnalysis.volumeRatio >= 1.5) {
      score += 20;
      reasons.push(`Volume elevated: ${volumeAnalysis.volumeRatio.toFixed(1)}x average`);
    } else if (volumeAnalysis.volumeRatio >= 1.2) {
      score += 10;
      reasons.push(`Volume above average: ${volumeAnalysis.volumeRatio.toFixed(1)}x`);
    } else {
      score -= 10;
      reasons.push('⚠️ Low volume breakout - reduced conviction');
    }
    
    // Increasing volume pattern
    if (volumeAnalysis.volumeIncreasing) {
      score += 15;
      reasons.push('Volume building (3 increasing bars)');
    }
    
    // Candle close position (conviction)
    if (direction === 'up' && priceBreakout.closePosition >= 0.75) {
      score += 10;
      reasons.push('Strong close near highs');
    } else if (direction === 'down' && priceBreakout.closePosition <= 0.25) {
      score += 10;
      reasons.push('Strong close near lows');
    }
    
    // Momentum confirmation
    if (direction === 'up' && momentum > 1) {
      score += 10;
      reasons.push(`Momentum: +${momentum.toFixed(1)}%`);
    } else if (direction === 'down' && momentum < -1) {
      score += 10;
      reasons.push(`Momentum: ${momentum.toFixed(1)}%`);
    }
    
    // EMA alignment
    const ema21 = emas.values[21];
    const ema50 = emas.values[50];
    if (ema21 && ema50) {
      if (direction === 'up' && price > ema21 && price > ema50) {
        score += 10;
        reasons.push('Price above key EMAs');
      } else if (direction === 'down' && price < ema21 && price < ema50) {
        score += 10;
        reasons.push('Price below key EMAs');
      }
    }
    
    // RSI not at extreme (room to run)
    if (rsi !== null) {
      if (direction === 'up' && rsi < 70) {
        score += 5;
      } else if (direction === 'up' && rsi >= 75) {
        score -= 10;
        reasons.push('⚠️ RSI overbought');
      } else if (direction === 'down' && rsi > 30) {
        score += 5;
      } else if (direction === 'down' && rsi <= 25) {
        score -= 10;
        reasons.push('⚠️ RSI oversold');
      }
    }
    
    // Calculate levels
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    const atrStop = atr ? atr * 1.2 : price * 0.015; // Tighter stop for breakouts
    
    if (score >= 50) {
      signal = score >= 75 
        ? (direction === 'up' ? 'STRONG_LONG' : 'STRONG_SHORT')
        : (direction === 'up' ? 'LONG' : 'SHORT');
      
      if (direction === 'up') {
        // Stop below breakout level
        const breakoutLevel = Math.max(...candles.slice(-21, -1).map(c => c.high));
        stop = Math.max(breakoutLevel * 0.995, price - atrStop);
        target = price + (atrStop * 2.5);
      } else {
        const breakoutLevel = Math.min(...candles.slice(-21, -1).map(c => c.low));
        stop = Math.min(breakoutLevel * 1.005, price + atrStop);
        target = price - (atrStop * 2.5);
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
