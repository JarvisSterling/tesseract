/**
 * Volume Breakout Strategy V3 - COMPLETE REDESIGN
 * 
 * PROBLEM WITH V1/V2:
 * - 45% win rate at 7d degrades to 27% at 365d
 * - Catches false breakouts in choppy markets
 * - No consolidation detection = trading noise
 * 
 * V3 DESIGN PRINCIPLES:
 * 1. CONSOLIDATION FIRST: Must detect a clear range/squeeze before breakout
 * 2. CLEAN BREAK: Price must break AND close decisively outside range
 * 3. VOLUME SURGE: Volume must be 2x+ average on breakout
 * 4. CONFIRMATION: Wait for follow-through candle before entry
 * 5. STRUCTURE STOP: Stop at the breakout level (tight risk)
 * 6. MOMENTUM FILTER: EMAs must align with breakout direction
 * 
 * This is a COMPLETE REWRITE with isolated calculations.
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

function calcATR(candles: OHLCVData[], period: number = 14): number[] {
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
    
    if (i < period) {
      atr.push(tr);
    } else {
      // Smoothed ATR
      atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
  }
  
  return atr;
}

// ============================================
// CONSOLIDATION DETECTION
// ============================================

interface ConsolidationZone {
  detected: boolean;
  high: number;
  low: number;
  midpoint: number;
  range: number;
  rangePercent: number;
  duration: number;  // Number of candles in consolidation
  atrSqueeze: boolean;  // ATR is compressed
}

function detectConsolidation(candles: OHLCVData[], atr: number[]): ConsolidationZone {
  const lookback = 20;
  const minDuration = 5;
  
  if (candles.length < lookback + 5) {
    return { detected: false, high: 0, low: 0, midpoint: 0, range: 0, rangePercent: 0, duration: 0, atrSqueeze: false };
  }
  
  // Look at candles BEFORE the current one (consolidation should precede breakout)
  const consolidationCandles = candles.slice(-lookback - 1, -1);
  
  // Find high and low of the range
  const highs = consolidationCandles.map(c => c.high);
  const lows = consolidationCandles.map(c => c.low);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const range = rangeHigh - rangeLow;
  const midpoint = (rangeHigh + rangeLow) / 2;
  const rangePercent = (range / midpoint) * 100;
  
  // Check for ATR squeeze (current ATR < average ATR)
  const recentATR = atr.slice(-5);
  const olderATR = atr.slice(-lookback, -5);
  const avgRecentATR = recentATR.reduce((a, b) => a + b, 0) / recentATR.length;
  const avgOlderATR = olderATR.reduce((a, b) => a + b, 0) / olderATR.length;
  const atrSqueeze = avgRecentATR < avgOlderATR * 0.8;  // ATR compressed by 20%+
  
  // Count how many candles stayed within the range (with 10% tolerance)
  const tolerance = range * 0.1;
  let duration = 0;
  for (let i = consolidationCandles.length - 1; i >= 0; i--) {
    const c = consolidationCandles[i];
    if (c.high <= rangeHigh + tolerance && c.low >= rangeLow - tolerance) {
      duration++;
    } else {
      break;
    }
  }
  
  // Consolidation detected if:
  // 1. Range is tight (< 8% of price)
  // 2. Duration is at least 5 candles
  // 3. ATR is squeezed OR range is very tight
  const detected = rangePercent < 8 && duration >= minDuration && (atrSqueeze || rangePercent < 4);
  
  return {
    detected,
    high: rangeHigh,
    low: rangeLow,
    midpoint,
    range,
    rangePercent,
    duration,
    atrSqueeze
  };
}

// ============================================
// BREAKOUT DETECTION
// ============================================

interface BreakoutSignal {
  isBreakout: boolean;
  direction: 'up' | 'down' | null;
  breakoutStrength: number;  // How far past the level (% of range)
  volumeConfirmed: boolean;
  volumeRatio: number;
  closePosition: number;  // Where in candle the close is (0=low, 1=high)
}

function detectBreakout(
  candles: OHLCVData[],
  consolidation: ConsolidationZone
): BreakoutSignal {
  if (!consolidation.detected || candles.length < 2) {
    return { isBreakout: false, direction: null, breakoutStrength: 0, volumeConfirmed: false, volumeRatio: 1, closePosition: 0.5 };
  }
  
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  // Calculate volume ratio
  const volumes = candles.slice(-21, -1).map(c => c.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeRatio = avgVolume > 0 ? current.volume / avgVolume : 1;
  const volumeConfirmed = volumeRatio >= 2.0;
  
  // Close position within candle
  const candleRange = current.high - current.low;
  const closePosition = candleRange > 0 ? (current.close - current.low) / candleRange : 0.5;
  
  // Check for UPWARD breakout
  if (current.close > consolidation.high) {
    // Must close above the high (not just wick)
    // Previous candle should be inside range (confirming this is THE breakout)
    const prevInside = prev.close <= consolidation.high && prev.close >= consolidation.low;
    
    if (prevInside) {
      const breakoutStrength = ((current.close - consolidation.high) / consolidation.range) * 100;
      return {
        isBreakout: true,
        direction: 'up',
        breakoutStrength,
        volumeConfirmed,
        volumeRatio,
        closePosition
      };
    }
  }
  
  // Check for DOWNWARD breakout
  if (current.close < consolidation.low) {
    const prevInside = prev.close <= consolidation.high && prev.close >= consolidation.low;
    
    if (prevInside) {
      const breakoutStrength = ((consolidation.low - current.close) / consolidation.range) * 100;
      return {
        isBreakout: true,
        direction: 'down',
        breakoutStrength,
        volumeConfirmed,
        volumeRatio,
        closePosition
      };
    }
  }
  
  return { isBreakout: false, direction: null, breakoutStrength: 0, volumeConfirmed: false, volumeRatio, closePosition };
}

// ============================================
// MOMENTUM CONFIRMATION
// ============================================

interface MomentumCheck {
  aligned: boolean;
  ema9: number;
  ema21: number;
  ema50: number;
  trendStrength: number;
}

function checkMomentum(closes: number[], direction: 'up' | 'down'): MomentumCheck {
  if (closes.length < 50) {
    return { aligned: false, ema9: 0, ema21: 0, ema50: 0, trendStrength: 0 };
  }
  
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  
  const currentEma9 = ema9[ema9.length - 1];
  const currentEma21 = ema21[ema21.length - 1];
  const currentEma50 = ema50[ema50.length - 1];
  const price = closes[closes.length - 1];
  
  let aligned = false;
  let trendStrength = 0;
  
  if (direction === 'up') {
    // For bullish breakout: price > EMA9 > EMA21 is ideal
    // At minimum: price > EMA21
    if (price > currentEma21) {
      aligned = true;
      trendStrength = 50;
      
      if (price > currentEma9 && currentEma9 > currentEma21) {
        trendStrength = 75;
      }
      if (currentEma21 > currentEma50) {
        trendStrength = 100;
      }
    }
  } else {
    // For bearish breakout: price < EMA9 < EMA21 is ideal
    if (price < currentEma21) {
      aligned = true;
      trendStrength = 50;
      
      if (price < currentEma9 && currentEma9 < currentEma21) {
        trendStrength = 75;
      }
      if (currentEma21 < currentEma50) {
        trendStrength = 100;
      }
    }
  }
  
  return { aligned, ema9: currentEma9, ema21: currentEma21, ema50: currentEma50, trendStrength };
}

// ============================================
// MAIN STRATEGY
// ============================================

export const volumeBreakout: Strategy = {
  id: 'volume-breakout',
  name: 'Volume Breakout',
  description: 'V3: Consolidation breakouts with volume confirmation',
  category: 'breakout',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles } = input;
    
    if (candles.length < 50) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    const closes = candles.map(c => c.close);
    const atr = calcATR(candles, 14);
    
    // Step 1: Detect consolidation
    const consolidation = detectConsolidation(candles, atr);
    
    if (!consolidation.detected) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['No consolidation detected'] };
    }
    
    // Step 2: Detect breakout from consolidation
    const breakout = detectBreakout(candles, consolidation);
    
    if (!breakout.isBreakout) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`Consolidation zone: ${consolidation.rangePercent.toFixed(1)}% range, waiting for breakout`] 
      };
    }
    
    const direction = breakout.direction!;
    const reasons: string[] = [];
    let score = 0;
    
    // Base score for breakout from consolidation
    score += 30;
    reasons.push(`${direction === 'up' ? '📈' : '📉'} Breakout from ${consolidation.duration}-bar consolidation`);
    
    // Step 3: Volume confirmation (CRITICAL)
    if (!breakout.volumeConfirmed) {
      // Low volume breakout = likely false breakout
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`Breakout rejected: Volume ${breakout.volumeRatio.toFixed(1)}x (need 2x+)`] 
      };
    }
    
    score += 25;
    reasons.push(`🔥 Volume: ${breakout.volumeRatio.toFixed(1)}x average`);
    
    // Step 4: Breakout strength (how far past the level)
    if (breakout.breakoutStrength >= 50) {
      score += 15;
      reasons.push('Strong breakout extension');
    } else if (breakout.breakoutStrength >= 25) {
      score += 10;
      reasons.push('Solid breakout');
    } else {
      score += 5;
      reasons.push('Marginal breakout');
    }
    
    // Step 5: Close position (conviction)
    if (direction === 'up' && breakout.closePosition >= 0.7) {
      score += 10;
      reasons.push('Bullish close near highs');
    } else if (direction === 'down' && breakout.closePosition <= 0.3) {
      score += 10;
      reasons.push('Bearish close near lows');
    } else if ((direction === 'up' && breakout.closePosition < 0.5) || 
               (direction === 'down' && breakout.closePosition > 0.5)) {
      // Weak close = reduce score
      score -= 10;
      reasons.push('⚠️ Weak candle close');
    }
    
    // Step 6: Momentum alignment
    const momentum = checkMomentum(closes, direction);
    
    if (!momentum.aligned) {
      // Breakout against momentum = risky
      score -= 15;
      reasons.push('⚠️ Against EMA trend');
    } else {
      score += Math.round(momentum.trendStrength / 10);
      if (momentum.trendStrength >= 75) {
        reasons.push('✓ EMAs aligned');
      }
    }
    
    // Step 7: ATR squeeze bonus
    if (consolidation.atrSqueeze) {
      score += 10;
      reasons.push('ATR squeeze detected');
    }
    
    // ============================================
    // SIGNAL GENERATION
    // ============================================
    
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    // Higher threshold for entry
    if (score >= 55) {
      signal = score >= 75 
        ? (direction === 'up' ? 'STRONG_LONG' : 'STRONG_SHORT')
        : (direction === 'up' ? 'LONG' : 'SHORT');
      
      const currentATR = atr[atr.length - 1];
      
      if (direction === 'up') {
        // Stop just below consolidation low (structure-based)
        stop = consolidation.low - (currentATR * 0.3);
        // Target: 2.5x the risk
        const risk = price - stop;
        target = price + (risk * 2.5);
      } else {
        // Stop just above consolidation high
        stop = consolidation.high + (currentATR * 0.3);
        const risk = stop - price;
        target = price - (risk * 2.5);
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
