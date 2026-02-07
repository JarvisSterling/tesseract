/**
 * Crossover Cascade Strategy V3 - TREND PULLBACK
 * 
 * PROBLEM WITH V2:
 * - 17% win rate (way too low)
 * - Trading crossovers = entering late
 * - Move often exhausted by time EMAs cross
 * 
 * V3 REDESIGN - Trend Pullback Strategy:
 * - Wait for ESTABLISHED trend (9 > 21 > 50 for bull)
 * - Enter on PULLBACKS to 21 EMA (dynamic support)
 * - Don't chase - wait for price to come to us
 * - Stop below structure, target continuation
 * 
 * This is how pros use EMAs - not crossover trading!
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

// ============================================
// ISOLATED INDICATOR CALCULATIONS
// ============================================

function calcEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
  }
  return ema;
}

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
  
  for (let i = period + 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atr = (atr * (period - 1) + tr) / period;
  }
  
  return atr;
}

function calcRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ============================================
// TREND ANALYSIS
// ============================================

interface TrendInfo {
  direction: 'bull' | 'bear' | null;
  strength: number;  // 0-100
  aligned: boolean;  // All EMAs in order
  trendAge: number;  // How many bars trend has been valid
}

function analyzeTrend(
  ema9Series: number[],
  ema21Series: number[],
  ema50Series: number[],
  price: number
): TrendInfo {
  if (ema9Series.length < 10 || ema21Series.length < 10 || ema50Series.length < 10) {
    return { direction: null, strength: 0, aligned: false, trendAge: 0 };
  }
  
  const ema9 = ema9Series[ema9Series.length - 1];
  const ema21 = ema21Series[ema21Series.length - 1];
  const ema50 = ema50Series[ema50Series.length - 1];
  
  // Check alignment
  const bullAligned = ema9 > ema21 && ema21 > ema50;
  const bearAligned = ema9 < ema21 && ema21 < ema50;
  
  if (!bullAligned && !bearAligned) {
    return { direction: null, strength: 0, aligned: false, trendAge: 0 };
  }
  
  const direction = bullAligned ? 'bull' : 'bear';
  
  // Calculate trend age (how long has alignment been valid)
  let trendAge = 0;
  for (let i = 1; i <= 50; i++) {
    const idx9 = ema9Series.length - i;
    const idx21 = ema21Series.length - i;
    const idx50 = ema50Series.length - i;
    
    if (idx9 < 0 || idx21 < 0 || idx50 < 0) break;
    
    const e9 = ema9Series[idx9];
    const e21 = ema21Series[idx21];
    const e50 = ema50Series[idx50];
    
    const aligned = direction === 'bull' 
      ? (e9 > e21 && e21 > e50)
      : (e9 < e21 && e21 < e50);
    
    if (aligned) trendAge++;
    else break;
  }
  
  // Trend strength based on EMA spread and age
  const spread9_21 = Math.abs(ema9 - ema21) / ema21 * 100;
  const spread21_50 = Math.abs(ema21 - ema50) / ema50 * 100;
  
  let strength = 0;
  strength += Math.min(spread9_21 * 10, 30);  // Up to 30 points for 9/21 spread
  strength += Math.min(spread21_50 * 5, 30);   // Up to 30 points for 21/50 spread
  strength += Math.min(trendAge * 2, 40);      // Up to 40 points for trend age
  
  return {
    direction,
    strength: Math.min(strength, 100),
    aligned: true,
    trendAge
  };
}

// ============================================
// PULLBACK DETECTION
// ============================================

interface PullbackInfo {
  isPullback: boolean;
  quality: number;     // 0-100
  depth: number;       // How far price pulled back
  touchedEMA: boolean; // Did price touch the key EMA
}

function detectPullback(
  candles: OHLCVData[],
  ema21Series: number[],
  ema50Series: number[],
  direction: 'bull' | 'bear'
): PullbackInfo {
  if (candles.length < 10 || ema21Series.length < 10) {
    return { isPullback: false, quality: 0, depth: 0, touchedEMA: false };
  }
  
  const price = candles[candles.length - 1].close;
  const ema21 = ema21Series[ema21Series.length - 1];
  const ema50 = ema50Series[ema50Series.length - 1];
  
  // For bullish trend: price should be near or touching 21 EMA from above
  // For bearish trend: price should be near or touching 21 EMA from below
  
  const distanceToEMA21 = Math.abs(price - ema21) / ema21 * 100;
  const priceAboveEMA21 = price > ema21;
  const priceBelowEMA21 = price < ema21;
  
  // Check recent price action for pullback pattern
  const recentLows = candles.slice(-5).map(c => c.low);
  const recentHighs = candles.slice(-5).map(c => c.high);
  const prevPrice = candles[candles.length - 2].close;
  
  let isPullback = false;
  let quality = 0;
  let touchedEMA = false;
  
  if (direction === 'bull') {
    // Bullish pullback: price pulled back toward 21 EMA
    // Recent low touched or came close to 21 EMA
    const minLow = Math.min(...recentLows);
    const lowToEMA = (minLow - ema21) / ema21 * 100;
    
    touchedEMA = lowToEMA <= 0.5 && lowToEMA >= -1.0;  // Within 0.5% above to 1% below
    
    // Price should be recovering (current close > prev close or current close > current low)
    const recovering = price > prevPrice || price > candles[candles.length - 1].low * 1.002;
    
    // Current price should still be above 21 EMA (holding support)
    const aboveSupport = price >= ema21 * 0.99;  // Allow 1% tolerance
    
    if (touchedEMA && recovering && aboveSupport) {
      isPullback = true;
      quality = 70;
      
      // Bonus for bouncing right off EMA
      if (Math.abs(lowToEMA) < 0.3) quality += 20;
      
      // Bonus for strong bounce candle
      const currentCandle = candles[candles.length - 1];
      if (currentCandle.close > currentCandle.open) quality += 10;
    } else if (distanceToEMA21 <= 1.5 && price > ema21) {
      // Near but not touching - still valid but lower quality
      isPullback = true;
      quality = 50;
    }
    
  } else {
    // Bearish pullback: price pulled back toward 21 EMA from below
    const maxHigh = Math.max(...recentHighs);
    const highToEMA = (ema21 - maxHigh) / ema21 * 100;
    
    touchedEMA = highToEMA <= 0.5 && highToEMA >= -1.0;
    
    const recovering = price < prevPrice || price < candles[candles.length - 1].high * 0.998;
    const belowResistance = price <= ema21 * 1.01;
    
    if (touchedEMA && recovering && belowResistance) {
      isPullback = true;
      quality = 70;
      
      if (Math.abs(highToEMA) < 0.3) quality += 20;
      
      const currentCandle = candles[candles.length - 1];
      if (currentCandle.close < currentCandle.open) quality += 10;
    } else if (distanceToEMA21 <= 1.5 && price < ema21) {
      isPullback = true;
      quality = 50;
    }
  }
  
  return {
    isPullback,
    quality: Math.min(quality, 100),
    depth: distanceToEMA21,
    touchedEMA
  };
}

// ============================================
// MAIN STRATEGY
// ============================================

export const crossoverCascade: Strategy = {
  id: 'crossover-cascade',
  name: 'Crossover Cascade',
  description: 'V3: Trend pullback entries on 21 EMA support/resistance',
  category: 'swing',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles } = input;
    
    if (candles.length < 60) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    const closes = candles.map(c => c.close);
    
    // Isolated EMA calculations
    const ema9Series = calcEMASeries(closes, 9);
    const ema21Series = calcEMASeries(closes, 21);
    const ema50Series = calcEMASeries(closes, 50);
    
    // Isolated ATR
    const atr = calcATR(candles, 14);
    
    if (!atr) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data for ATR'] };
    }
    
    // Step 1: Check for established trend
    const trend = analyzeTrend(ema9Series, ema21Series, ema50Series, price);
    
    if (!trend.direction || !trend.aligned) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['No clear trend - EMAs not aligned'] };
    }
    
    // Require mature trend (at least 5 bars of alignment)
    if (trend.trendAge < 5) {
      return { type: 'NEUTRAL', strength: 0, reasons: [`Trend too young (${trend.trendAge} bars)`] };
    }
    
    const reasons: string[] = [];
    reasons.push(`${trend.direction === 'bull' ? '📈' : '📉'} ${trend.direction.toUpperCase()} trend (${trend.trendAge} bars)`);
    
    // Step 2: Check for pullback to 21 EMA
    const pullback = detectPullback(candles, ema21Series, ema50Series, trend.direction);
    
    if (!pullback.isPullback) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`${trend.direction.toUpperCase()} trend active - waiting for pullback to 21 EMA`] 
      };
    }
    
    reasons.push(`Pullback detected (quality: ${pullback.quality}%)`);
    if (pullback.touchedEMA) {
      reasons.push('✓ Price touched 21 EMA');
    }
    
    // Step 3: RSI confirmation (not overbought/oversold against trend)
    const rsi = calcRSI(closes, 14);
    
    if (rsi !== null) {
      if (trend.direction === 'bull') {
        if (rsi > 75) {
          return { type: 'NEUTRAL', strength: 0, reasons: [...reasons, '⚠️ RSI overbought - skip'] };
        }
        if (rsi < 45) {
          reasons.push(`RSI ${rsi.toFixed(0)} - good entry zone`);
        }
      } else {
        if (rsi < 25) {
          return { type: 'NEUTRAL', strength: 0, reasons: [...reasons, '⚠️ RSI oversold - skip'] };
        }
        if (rsi > 55) {
          reasons.push(`RSI ${rsi.toFixed(0)} - good entry zone`);
        }
      }
    }
    
    // Step 4: Volume check
    const volumes = candles.slice(-21, -1).map(c => c.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const currentVolume = candles[candles.length - 1].volume;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    
    // We want moderate volume on pullbacks, not low volume
    if (volumeRatio < 0.5) {
      return { type: 'NEUTRAL', strength: 0, reasons: [...reasons, '⚠️ Volume too low'] };
    }
    
    // Calculate score
    let score = 40;  // Base score for valid setup
    score += pullback.quality * 0.3;  // Up to 30 from pullback quality
    score += Math.min(trend.strength * 0.2, 20);  // Up to 20 from trend strength
    if (pullback.touchedEMA) score += 10;
    
    // Volume bonus
    if (volumeRatio >= 1.0) {
      score += 5;
      reasons.push(`Volume: ${volumeRatio.toFixed(1)}x avg`);
    }
    
    // ============================================
    // SIGNAL GENERATION
    // ============================================
    
    const ema21 = ema21Series[ema21Series.length - 1];
    const ema50 = ema50Series[ema50Series.length - 1];
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    if (score >= 55) {
      signal = score >= 75 
        ? (trend.direction === 'bull' ? 'STRONG_LONG' : 'STRONG_SHORT')
        : (trend.direction === 'bull' ? 'LONG' : 'SHORT');
      
      // Stop below 50 EMA (structure-based)
      // Target: 2x risk for good R:R
      
      if (trend.direction === 'bull') {
        // Stop just below 50 EMA or 1.5 ATR below entry, whichever is closer
        const emaStop = ema50 * 0.99;  // 1% below 50 EMA
        const atrStop = price - (atr * 1.5);
        stop = Math.max(emaStop, atrStop);  // Use the closer (tighter) stop
        
        const risk = price - stop;
        target = price + (risk * 2.0);  // 2:1 R:R
      } else {
        const emaStop = ema50 * 1.01;
        const atrStop = price + (atr * 1.5);
        stop = Math.min(emaStop, atrStop);
        
        const risk = stop - price;
        target = price - (risk * 2.0);
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
