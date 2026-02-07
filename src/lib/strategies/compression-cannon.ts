/**
 * Compression Cannon Strategy V2 - COMPLETE REDESIGN
 * 
 * PROBLEM WITH V1:
 * - 24.1% win rate, -37% P&L (365d)
 * - EMA bandwidth is not true volatility compression
 * - Too many false breakouts
 * 
 * V2 DESIGN:
 * 1. ATR COMPRESSION: ATR must be below 20-period average (true volatility squeeze)
 * 2. PRICE RANGE: Tight price range (high-low) over lookback period
 * 3. EXPLOSIVE BREAKOUT: Candle must be larger than recent average
 * 4. VOLUME SURGE: Required 1.5x+ volume on breakout
 * 5. MOMENTUM: EMA slope must confirm direction
 * 
 * Isolated calculations - no shared indicators
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

// ============================================
// ISOLATED INDICATOR CALCULATIONS
// ============================================

function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      ema.push(data[0]);
    } else {
      ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
  }
  
  return ema;
}

function calcATRSeries(candles: OHLCVData[], period: number = 14): number[] {
  const atr: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atr.push(candles[i].high - candles[i].low);
      continue;
    }
    
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    
    if (atr.length < period) {
      atr.push(tr);
    } else {
      atr.push((atr[atr.length - 1] * (period - 1) + tr) / period);
    }
  }
  
  return atr;
}

// ============================================
// ATR COMPRESSION DETECTION
// ============================================

interface CompressionState {
  isCompressed: boolean;
  compressionRatio: number;  // current ATR / average ATR (< 1 = compressed)
  currentATR: number;
  avgATR: number;
  priceRange: number;        // High-low range over lookback
  priceRangePercent: number; // Range as % of price
}

function detectATRCompression(candles: OHLCVData[], atrSeries: number[]): CompressionState {
  const lookback = 20;
  
  if (candles.length < lookback + 10 || atrSeries.length < lookback + 10) {
    return { isCompressed: false, compressionRatio: 1, currentATR: 0, avgATR: 0, priceRange: 0, priceRangePercent: 0 };
  }
  
  // Current ATR (average of last 5)
  const recentATR = atrSeries.slice(-5);
  const currentATR = recentATR.reduce((a, b) => a + b, 0) / recentATR.length;
  
  // Historical ATR (20-period lookback, excluding last 5)
  const historicalATR = atrSeries.slice(-lookback - 5, -5);
  const avgATR = historicalATR.reduce((a, b) => a + b, 0) / historicalATR.length;
  
  const compressionRatio = avgATR > 0 ? currentATR / avgATR : 1;
  
  // Price range over last 10 candles
  const recentCandles = candles.slice(-10);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const priceRange = Math.max(...highs) - Math.min(...lows);
  const midPrice = (Math.max(...highs) + Math.min(...lows)) / 2;
  const priceRangePercent = (priceRange / midPrice) * 100;
  
  // Compression detected if:
  // 1. ATR is 30%+ below average
  // 2. Price range is tight (< 5%)
  const isCompressed = compressionRatio < 0.7 && priceRangePercent < 5;
  
  return {
    isCompressed,
    compressionRatio,
    currentATR,
    avgATR,
    priceRange,
    priceRangePercent
  };
}

// ============================================
// BREAKOUT DETECTION
// ============================================

interface BreakoutSignal {
  isBreakout: boolean;
  direction: 'up' | 'down' | null;
  candleSize: number;        // Current candle range
  avgCandleSize: number;     // Average candle range
  explosionRatio: number;    // Current / average (> 1.5 = explosive)
  volumeRatio: number;
}

function detectExplosiveBreakout(candles: OHLCVData[], compression: CompressionState): BreakoutSignal {
  if (candles.length < 15) {
    return { isBreakout: false, direction: null, candleSize: 0, avgCandleSize: 0, explosionRatio: 1, volumeRatio: 1 };
  }
  
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  // Current candle size
  const candleSize = current.high - current.low;
  
  // Average candle size (last 10, excluding current)
  const recentCandles = candles.slice(-11, -1);
  const avgCandleSize = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / recentCandles.length;
  
  const explosionRatio = avgCandleSize > 0 ? candleSize / avgCandleSize : 1;
  
  // Volume ratio
  const volumes = candles.slice(-21, -1).map(c => c.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeRatio = avgVolume > 0 ? current.volume / avgVolume : 1;
  
  // Breakout conditions:
  // 1. Candle is 1.5x+ larger than average (explosive move)
  // 2. Clear directional close
  // 3. Breaks out of recent range
  
  if (explosionRatio < 1.5) {
    return { isBreakout: false, direction: null, candleSize, avgCandleSize, explosionRatio, volumeRatio };
  }
  
  // Direction based on candle close
  const body = current.close - current.open;
  const bodyRatio = Math.abs(body) / candleSize;
  
  // Need strong body (> 50% of candle)
  if (bodyRatio < 0.5) {
    return { isBreakout: false, direction: null, candleSize, avgCandleSize, explosionRatio, volumeRatio };
  }
  
  // Check if breaking out of compression range
  const rangeHigh = Math.max(...candles.slice(-10, -1).map(c => c.high));
  const rangeLow = Math.min(...candles.slice(-10, -1).map(c => c.low));
  
  let direction: 'up' | 'down' | null = null;
  
  if (body > 0 && current.close > rangeHigh) {
    direction = 'up';
  } else if (body < 0 && current.close < rangeLow) {
    direction = 'down';
  }
  
  return {
    isBreakout: direction !== null,
    direction,
    candleSize,
    avgCandleSize,
    explosionRatio,
    volumeRatio
  };
}

// ============================================
// MOMENTUM CONFIRMATION
// ============================================

function checkMomentum(closes: number[], direction: 'up' | 'down'): { aligned: boolean; strength: number } {
  if (closes.length < 25) {
    return { aligned: false, strength: 0 };
  }
  
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  
  const currentEma9 = ema9[ema9.length - 1];
  const currentEma21 = ema21[ema21.length - 1];
  const prevEma9 = ema9[ema9.length - 2];
  const price = closes[closes.length - 1];
  
  // EMA9 slope (positive = rising)
  const ema9Slope = ((currentEma9 - prevEma9) / prevEma9) * 100;
  
  if (direction === 'up') {
    // Bullish: price > EMA9 and EMA9 rising
    const aligned = price > currentEma9 && ema9Slope > 0;
    const strength = aligned ? Math.min(Math.abs(ema9Slope) * 50, 100) : 0;
    return { aligned, strength };
  } else {
    // Bearish: price < EMA9 and EMA9 falling
    const aligned = price < currentEma9 && ema9Slope < 0;
    const strength = aligned ? Math.min(Math.abs(ema9Slope) * 50, 100) : 0;
    return { aligned, strength };
  }
}

// ============================================
// MAIN STRATEGY
// ============================================

export const compressionCannon: Strategy = {
  id: 'compression-cannon',
  name: 'Compression Cannon',
  description: 'V2: ATR compression followed by explosive breakout',
  category: 'breakout',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles } = input;
    
    if (candles.length < 50) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    const closes = candles.map(c => c.close);
    const atrSeries = calcATRSeries(candles, 14);
    
    // Step 1: Detect ATR compression
    const compression = detectATRCompression(candles, atrSeries);
    
    if (!compression.isCompressed) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`No compression (ATR ratio: ${compression.compressionRatio.toFixed(2)}, Range: ${compression.priceRangePercent.toFixed(1)}%)`] 
      };
    }
    
    // Step 2: Detect explosive breakout
    const breakout = detectExplosiveBreakout(candles, compression);
    
    if (!breakout.isBreakout) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`Compression detected (ATR ${(compression.compressionRatio * 100).toFixed(0)}% of avg) - waiting for explosive move`] 
      };
    }
    
    const direction = breakout.direction!;
    const reasons: string[] = [];
    let score = 0;
    
    reasons.push(`${direction === 'up' ? '🚀' : '💥'} EXPLOSIVE ${direction.toUpperCase()} breakout!`);
    reasons.push(`ATR compressed to ${(compression.compressionRatio * 100).toFixed(0)}% of average`);
    
    // Base score for compression + breakout
    score += 40;
    
    // Step 3: Explosion strength
    if (breakout.explosionRatio >= 2.5) {
      score += 25;
      reasons.push(`Candle ${breakout.explosionRatio.toFixed(1)}x larger than average`);
    } else if (breakout.explosionRatio >= 2.0) {
      score += 20;
      reasons.push(`Candle ${breakout.explosionRatio.toFixed(1)}x average`);
    } else {
      score += 10;
    }
    
    // Step 4: Volume confirmation
    if (breakout.volumeRatio < 1.5) {
      // No volume = likely false breakout
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`Breakout rejected: Volume ${breakout.volumeRatio.toFixed(1)}x (need 1.5x+)`] 
      };
    }
    
    if (breakout.volumeRatio >= 2.0) {
      score += 20;
      reasons.push(`🔥 Volume surge: ${breakout.volumeRatio.toFixed(1)}x`);
    } else {
      score += 10;
      reasons.push(`Volume: ${breakout.volumeRatio.toFixed(1)}x`);
    }
    
    // Step 5: Momentum alignment
    const momentum = checkMomentum(closes, direction);
    
    if (!momentum.aligned) {
      score -= 15;
      reasons.push('⚠️ Momentum not aligned');
    } else {
      score += 15;
      reasons.push('✓ Momentum confirmed');
    }
    
    // ============================================
    // SIGNAL GENERATION
    // ============================================
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    if (score >= 60) {
      signal = score >= 80 
        ? (direction === 'up' ? 'STRONG_LONG' : 'STRONG_SHORT')
        : (direction === 'up' ? 'LONG' : 'SHORT');
      
      const currentATR = atrSeries[atrSeries.length - 1];
      
      // Stop at opposite end of compression range + small buffer
      const rangeHigh = Math.max(...candles.slice(-10, -1).map(c => c.high));
      const rangeLow = Math.min(...candles.slice(-10, -1).map(c => c.low));
      
      if (direction === 'up') {
        stop = rangeLow - (currentATR * 0.3);
        // Target: 3x risk for explosive moves
        const risk = price - stop;
        target = price + (risk * 3);
      } else {
        stop = rangeHigh + (currentATR * 0.3);
        const risk = stop - price;
        target = price - (risk * 3);
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
