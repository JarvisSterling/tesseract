/**
 * Mean Reversion Sniper Strategy - V5 (Simplified)
 * 
 * V1-V4 HISTORY:
 * - V1: 24% win rate, -45% P&L (too loose)
 * - V2-V4: 0 trades (too strict)
 * 
 * V5 APPROACH: Start simple, prove it works, then add filters
 * - Lower deviation threshold to 2%
 * - Simpler trend filter
 * - No pattern requirement (just RSI + extension)
 * - Focus on extreme RSI for high-probability reversals
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

export const meanReversion: Strategy = {
  id: 'mean-reversion',
  name: 'Mean Reversion Sniper',
  description: 'Catch overextended moves snapping back to the mean',
  category: 'reversal',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, indicators } = input;
    const { emas, rsi, atr, volume } = indicators;
    
    const ema21 = emas.values[21];
    const ema50 = emas.values[50];
    
    // Need EMAs to work
    if (!ema21) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    // Calculate deviation from EMA21
    const deviation = ((price - ema21) / ema21) * 100;
    const absDeviation = Math.abs(deviation);
    
    // V6: Require 3% deviation minimum (more extreme = higher probability)
    if (absDeviation < 3.0) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Price within normal range'] };
    }
    
    const isOversold = deviation < 0;
    const isOverbought = deviation > 0;
    
    // Simple trend check: avoid trading against strong momentum
    const slope9 = emas.slopes[9];
    const slope21 = emas.slopes[21];
    
    // If short-term EMA is moving strongly in the direction of extension, skip
    // (catching a falling knife or shorting a rocket)
    if (isOversold && slope9 !== null && slope9 < -1.5) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Strong downward momentum - wait'] };
    }
    if (isOverbought && slope9 !== null && slope9 > 1.5) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Strong upward momentum - wait'] };
    }
    
    // Start scoring
    const reasons: string[] = [];
    let score = 0;
    
    reasons.push(`Price ${deviation.toFixed(1)}% from EMA21`);
    
    // Extension score (more extension = more potential snap back)
    score += Math.min(absDeviation * 10, 30);
    
    // V6: RSI MUST be extreme - this is the key filter
    if (rsi === null) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Need RSI data'] };
    }
    
    if (isOversold) {
      if (rsi >= 35) {
        return { type: 'NEUTRAL', strength: 0, reasons: [`RSI ${rsi.toFixed(0)} not oversold enough`] };
      }
      if (rsi < 20) {
        score += 40;
        reasons.push(`🔥 RSI extremely oversold (${rsi.toFixed(0)})`);
      } else if (rsi < 30) {
        score += 30;
        reasons.push(`RSI oversold (${rsi.toFixed(0)})`);
      } else {
        score += 20;
        reasons.push(`RSI low (${rsi.toFixed(0)})`);
      }
    } else {
      if (rsi <= 65) {
        return { type: 'NEUTRAL', strength: 0, reasons: [`RSI ${rsi.toFixed(0)} not overbought enough`] };
      }
      if (rsi > 80) {
        score += 40;
        reasons.push(`🔥 RSI extremely overbought (${rsi.toFixed(0)})`);
      } else if (rsi > 70) {
        score += 30;
        reasons.push(`RSI overbought (${rsi.toFixed(0)})`);
      } else {
        score += 20;
        reasons.push(`RSI high (${rsi.toFixed(0)})`);
      }
    }
    
    // Volume spike on potential reversal
    if (volume.ratio > 1.5) {
      score += 15;
      reasons.push('High volume');
    } else if (volume.ratio > 1.2) {
      score += 8;
    }
    
    // Price near a key EMA (EMA50/100/200) as support/resistance
    const ema100 = emas.values[100];
    const ema200 = emas.values[200];
    
    if (isOversold) {
      // Look for support from higher EMAs
      if (ema50 && price > ema50 * 0.98 && price < ema50 * 1.02) {
        score += 12;
        reasons.push('Near EMA50 support');
      }
      if (ema100 && price > ema100 * 0.97 && price < ema100 * 1.03) {
        score += 10;
        reasons.push('Near EMA100 support');
      }
      if (ema200 && price > ema200 * 0.96 && price < ema200 * 1.04) {
        score += 8;
        reasons.push('Near EMA200 support');
      }
    } else {
      // Look for resistance from higher EMAs
      if (ema50 && price > ema50 * 0.98 && price < ema50 * 1.02) {
        score += 12;
        reasons.push('Near EMA50 resistance');
      }
      if (ema100 && price > ema100 * 0.97 && price < ema100 * 1.03) {
        score += 10;
        reasons.push('Near EMA100 resistance');
      }
      if (ema200 && price > ema200 * 0.96 && price < ema200 * 1.04) {
        score += 8;
        reasons.push('Near EMA200 resistance');
      }
    }
    
    // V6: REQUIRE reversal candle confirmation (not just bonus)
    if (candles.length >= 2) {
      const current = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const currentBody = current.close - current.open;
      const prevBody = prev.close - prev.open;
      
      // Bullish reversal: need green candle after red
      if (isOversold) {
        if (currentBody > 0 && prevBody < 0) {
          score += 15;
          reasons.push('✓ Bullish reversal candle');
        } else if (currentBody <= 0) {
          return { type: 'NEUTRAL', strength: 0, reasons: ['Waiting for bullish reversal candle'] };
        }
      }
      // Bearish reversal: need red candle after green
      if (isOverbought) {
        if (currentBody < 0 && prevBody > 0) {
          score += 15;
          reasons.push('✓ Bearish reversal candle');
        } else if (currentBody >= 0) {
          return { type: 'NEUTRAL', strength: 0, reasons: ['Waiting for bearish reversal candle'] };
        }
      }
    } else {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient candle data'] };
    }
    
    // Need minimum score
    if (score < 40) {
      return {
        type: 'NEUTRAL',
        strength: Math.round(score),
        reasons: [...reasons, 'Signal not strong enough'],
      };
    }
    
    // Determine signal type
    const isStrong = score >= 65;
    let signal: SignalType;
    
    if (isOversold) {
      signal = isStrong ? 'STRONG_LONG' : 'LONG';
    } else {
      signal = isStrong ? 'STRONG_SHORT' : 'SHORT';
    }
    
    // Calculate levels
    const atrValue = atr || price * 0.015;
    
    // Target is EMA21 (the mean)
    const target = ema21;
    
    // Stop beyond recent extreme
    let stop: number;
    if (isOversold) {
      const recentLow = Math.min(...candles.slice(-5).map(c => c.low));
      stop = Math.min(recentLow * 0.995, price - atrValue * 1.2);
    } else {
      const recentHigh = Math.max(...candles.slice(-5).map(c => c.high));
      stop = Math.max(recentHigh * 1.005, price + atrValue * 1.2);
    }
    
    return {
      type: signal,
      strength: Math.min(Math.round(score), 100),
      entry: price,
      stop,
      target,
      reasons,
    };
  },
};
