/**
 * MACD Momentum Strategy
 * 
 * CONCEPT: MACD is a momentum oscillator that shows the relationship between
 * two EMAs. When MACD crosses its signal line, momentum is shifting.
 * 
 * MATHEMATICS:
 * - MACD Line = EMA(12) - EMA(26)
 * - Signal Line = EMA(9) of MACD Line
 * - Histogram = MACD - Signal (momentum acceleration)
 * 
 * SIGNALS:
 * - Bullish: MACD crosses above signal + histogram growing + price above EMA21
 * - Bearish: MACD crosses below signal + histogram shrinking + price below EMA21
 * 
 * KEY INSIGHT:
 * - Don't trade every crossover — require histogram expansion
 * - Best signals occur near zero line (fresh momentum)
 * - Volume should confirm the move
 */

import { Strategy, StrategyInput, StrategySignal, SignalType } from './types';

export const macdMomentum: Strategy = {
  id: 'macd-momentum',
  name: 'MACD Momentum',
  description: 'Momentum strategy using MACD crossovers with histogram confirmation',
  category: 'swing',
  timeframes: ['1h', '4h', '1d'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, indicators } = input;
    const { emas, macd, rsi, volume, atr } = indicators;
    
    if (!macd) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['MACD data not available'],
      };
    }
    
    const ema21 = emas.values[21];
    const ema50 = emas.values[50];
    const reasons: string[] = [];
    let score = 0;
    let direction: 'long' | 'short' | 'neutral' = 'neutral';
    
    // ============================================
    // MACD ANALYSIS
    // ============================================
    
    // Histogram direction (momentum acceleration)
    const histogramBullish = macd.histogram > 0;
    const histogramStrength = Math.abs(macd.histogram);
    
    // MACD position relative to zero
    const nearZero = Math.abs(macd.macd) < (price * 0.005); // Within 0.5% of price
    const aboveZero = macd.macd > 0;
    
    // Signal line crossover
    const bullishCrossover = macd.macd > macd.signal && macd.histogram > 0;
    const bearishCrossover = macd.macd < macd.signal && macd.histogram < 0;
    
    // ============================================
    // TREND CONTEXT
    // ============================================
    
    const priceAboveEma21 = ema21 ? price > ema21 : null;
    const priceAboveEma50 = ema50 ? price > ema50 : null;
    
    // ============================================
    // SIGNAL GENERATION
    // ============================================
    
    if (bullishCrossover) {
      direction = 'long';
      score += 30;
      reasons.push('MACD bullish crossover');
      
      // Histogram expanding (momentum building)
      if (histogramBullish) {
        score += 15;
        reasons.push('Histogram expanding');
      }
      
      // Best signals near zero line (fresh momentum)
      if (nearZero || !aboveZero) {
        score += 15;
        reasons.push('Fresh momentum from zero line');
      }
      
      // Trend alignment
      if (priceAboveEma21) {
        score += 10;
        reasons.push('Price above EMA21');
      }
      if (priceAboveEma50) {
        score += 10;
        reasons.push('Price above EMA50 (trend aligned)');
      }
      
      // Volume confirmation
      if (volume.ratio > 1.2) {
        score += 10;
        reasons.push(`Volume ${(volume.ratio * 100 - 100).toFixed(0)}% above average`);
      }
      
      // RSI not overbought
      if (rsi !== null && rsi < 70) {
        score += 5;
      } else if (rsi !== null && rsi > 75) {
        score -= 15;
        reasons.push('RSI overbought warning');
      }
      
    } else if (bearishCrossover) {
      direction = 'short';
      score += 30;
      reasons.push('MACD bearish crossover');
      
      // Histogram shrinking (momentum building down)
      if (!histogramBullish) {
        score += 15;
        reasons.push('Histogram contracting');
      }
      
      // Best signals near zero line
      if (nearZero || aboveZero) {
        score += 15;
        reasons.push('Fresh downward momentum from zero');
      }
      
      // Trend alignment
      if (priceAboveEma21 === false) {
        score += 10;
        reasons.push('Price below EMA21');
      }
      if (priceAboveEma50 === false) {
        score += 10;
        reasons.push('Price below EMA50 (trend aligned)');
      }
      
      // Volume confirmation
      if (volume.ratio > 1.2) {
        score += 10;
        reasons.push(`Selling volume ${(volume.ratio * 100 - 100).toFixed(0)}% above average`);
      }
      
      // RSI not oversold
      if (rsi !== null && rsi > 30) {
        score += 5;
      } else if (rsi !== null && rsi < 25) {
        score -= 15;
        reasons.push('RSI oversold warning');
      }
    } else {
      // No clear crossover - check for divergence or setup
      if (macd.trend === 'bullish' && histogramBullish && priceAboveEma21) {
        direction = 'long';
        score = 30;
        reasons.push('MACD bullish trend (waiting for entry)');
      } else if (macd.trend === 'bearish' && !histogramBullish && priceAboveEma21 === false) {
        direction = 'short';
        score = 30;
        reasons.push('MACD bearish trend (waiting for entry)');
      }
    }
    
    // ============================================
    // SIGNAL TYPE & LEVELS
    // ============================================
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    if (direction !== 'neutral' && score >= 50) {
      // Use ATR for dynamic stop-loss
      const atrStop = atr ? atr * 1.5 : price * 0.02;
      
      if (direction === 'long') {
        signal = score >= 75 ? 'STRONG_LONG' : 'LONG';
        stop = price - atrStop;
        target = price + (atrStop * 2.5); // 2.5:1 reward-risk
      } else {
        signal = score >= 75 ? 'STRONG_SHORT' : 'SHORT';
        stop = price + atrStop;
        target = price - (atrStop * 2.5);
      }
    }
    
    return {
      type: signal,
      strength: Math.min(score, 100),
      entry: signal !== 'NEUTRAL' ? price : undefined,
      stop,
      target,
      reasons: reasons.length > 0 ? reasons : ['No MACD signal'],
    };
  },
};
