/**
 * Bollinger Squeeze Strategy
 * 
 * CONCEPT: When Bollinger Bands contract inside Keltner Channels, 
 * volatility is compressing like a coiled spring. The breakout
 * direction often produces explosive moves.
 * 
 * MATHEMATICS:
 * - Bollinger Bands: SMA(20) ± 2 * StdDev(20)
 * - Keltner Channels: EMA(20) ± 1.5 * ATR(10)
 * - Squeeze ON: BB inside KC (low volatility)
 * - Squeeze OFF: BB outside KC (volatility expanding)
 * 
 * SIGNALS:
 * - Wait for squeeze (BB inside KC)
 * - Enter when squeeze releases + momentum confirms direction
 * - Momentum = Rate of change of (close - SMA20)
 * 
 * KEY INSIGHT:
 * - The longer the squeeze, the more powerful the breakout
 * - Momentum histogram shows direction before price confirms
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

function calcSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcStdDev(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const squaredDiffs = slice.map(p => Math.pow(p - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / period);
}

function calcATRFromPrices(candles: OHLCVData[], period: number): number | null {
  if (candles.length < period + 1) return null;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }
  
  const recentTR = trueRanges.slice(-period);
  if (recentTR.length < period) return null;
  
  return recentTR.reduce((a, b) => a + b, 0) / period;
}

interface SqueezeState {
  isSqueezing: boolean;
  squeezeLength: number; // How many bars in squeeze
  momentum: number; // Direction indicator
  momentumIncreasing: boolean;
  bbWidth: number;
  kcWidth: number;
}

function analyzeSqueze(candles: OHLCVData[], ema20: number | null): SqueezeState {
  const closes = candles.map(c => c.close);
  const period = 20;
  
  // Bollinger Bands
  const sma20 = calcSMA(closes, period);
  const stdDev = calcStdDev(closes, period);
  
  // Keltner Channels
  const atr10 = calcATRFromPrices(candles, 10);
  
  if (!sma20 || !stdDev || !atr10 || !ema20) {
    return { isSqueezing: false, squeezeLength: 0, momentum: 0, momentumIncreasing: false, bbWidth: 0, kcWidth: 0 };
  }
  
  const bbUpper = sma20 + 2 * stdDev;
  const bbLower = sma20 - 2 * stdDev;
  const kcUpper = ema20 + 1.5 * atr10;
  const kcLower = ema20 - 1.5 * atr10;
  
  const bbWidth = (bbUpper - bbLower) / sma20 * 100;
  const kcWidth = (kcUpper - kcLower) / ema20 * 100;
  
  // Squeeze = BB inside KC
  const isSqueezing = bbLower > kcLower && bbUpper < kcUpper;
  
  // Count squeeze length (look back)
  let squeezeLength = 0;
  for (let i = closes.length - 1; i >= period && squeezeLength < 50; i--) {
    const histSMA = calcSMA(closes.slice(0, i + 1), period);
    const histStdDev = calcStdDev(closes.slice(0, i + 1), period);
    const histATR = calcATRFromPrices(candles.slice(0, i + 1), 10);
    
    if (!histSMA || !histStdDev || !histATR) break;
    
    const histBBLower = histSMA - 2 * histStdDev;
    const histBBUpper = histSMA + 2 * histStdDev;
    const histKCLower = histSMA - 1.5 * histATR;
    const histKCUpper = histSMA + 1.5 * histATR;
    
    if (histBBLower > histKCLower && histBBUpper < histKCUpper) {
      squeezeLength++;
    } else {
      break;
    }
  }
  
  // Momentum = current close - SMA20 (normalized)
  const currentClose = closes[closes.length - 1];
  const momentum = ((currentClose - sma20) / sma20) * 100;
  
  // Check if momentum is increasing
  const prevClose = closes[closes.length - 2];
  const prevMomentum = ((prevClose - sma20) / sma20) * 100;
  const momentumIncreasing = Math.abs(momentum) > Math.abs(prevMomentum);
  
  return { isSqueezing, squeezeLength, momentum, momentumIncreasing, bbWidth, kcWidth };
}

export const bollingerSqueeze: Strategy = {
  id: 'bollinger-squeeze',
  name: 'Bollinger Squeeze',
  description: 'Volatility squeeze detection: Enter when BB contracts inside KC, exit on expansion',
  category: 'breakout',
  timeframes: ['15m', '1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, atr, volume } = indicators;
    
    if (candles.length < 30) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data for squeeze analysis'] };
    }
    
    const ema20 = emas.values[21]; // Use EMA21 as proxy for EMA20
    const squeeze = analyzeSqueze(candles, ema20);
    
    const reasons: string[] = [];
    let score = 0;
    let direction: 'long' | 'short' | 'neutral' = 'neutral';
    
    // Currently in squeeze
    if (squeeze.isSqueezing) {
      reasons.push(`Squeeze active (${squeeze.squeezeLength} bars)`);
      
      // Longer squeeze = more potential energy
      if (squeeze.squeezeLength >= 10) {
        score += 20;
        reasons.push('Extended squeeze - high energy buildup');
      } else if (squeeze.squeezeLength >= 5) {
        score += 10;
      }
      
      // Momentum showing direction
      if (squeeze.momentum > 0.3 && squeeze.momentumIncreasing) {
        direction = 'long';
        score += 30;
        reasons.push('Bullish momentum building');
      } else if (squeeze.momentum < -0.3 && squeeze.momentumIncreasing) {
        direction = 'short';
        score += 30;
        reasons.push('Bearish momentum building');
      } else {
        reasons.push('⏳ Squeeze active - waiting for momentum direction');
      }
    } else {
      // Squeeze just released?
      if (squeeze.squeezeLength === 0 && squeeze.bbWidth > squeeze.kcWidth) {
        // Check momentum direction for breakout
        if (squeeze.momentum > 0.5) {
          direction = 'long';
          score += 50;
          reasons.push('🚀 Squeeze FIRED - Bullish breakout');
        } else if (squeeze.momentum < -0.5) {
          direction = 'short';
          score += 50;
          reasons.push('🚀 Squeeze FIRED - Bearish breakout');
        }
        
        // Volume confirmation
        if (volume.ratio > 1.5) {
          score += 20;
          reasons.push(`Volume surge: ${(volume.ratio * 100).toFixed(0)}% of avg`);
        }
      } else {
        return { type: 'NEUTRAL', strength: 0, reasons: ['No squeeze detected'] };
      }
    }
    
    // Trend alignment bonus
    const ema50 = emas.values[50];
    if (ema50) {
      if (direction === 'long' && price > ema50) {
        score += 15;
        reasons.push('Aligned with uptrend (above EMA50)');
      } else if (direction === 'short' && price < ema50) {
        score += 15;
        reasons.push('Aligned with downtrend (below EMA50)');
      }
    }
    
    // Calculate levels
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    const atrStop = atr ? atr * 1.5 : price * 0.02;
    
    if (direction !== 'neutral' && score >= 50) {
      signal = score >= 70 ? (direction === 'long' ? 'STRONG_LONG' : 'STRONG_SHORT')
                          : (direction === 'long' ? 'LONG' : 'SHORT');
      
      if (direction === 'long') {
        stop = price - atrStop;
        target = price + (atrStop * 3); // Squeezes can run far
      } else {
        stop = price + atrStop;
        target = price - (atrStop * 3);
      }
    }
    
    return {
      type: signal,
      strength: Math.min(score, 100),
      entry: signal !== 'NEUTRAL' ? price : undefined,
      stop,
      target,
      reasons,
    };
  },
};
