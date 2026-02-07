/**
 * Volume Breakout Strategy V2
 * 
 * ISOLATED CALCULATIONS - does not share indicators with other strategies
 * 
 * V2 IMPROVEMENTS:
 * - ADX filter: Only trade in trending markets (ADX > 25)
 * - Higher volume threshold: 2.5x average (was 2x)
 * - Better R:R: 3:1 target (was 2.5:1)
 * - Trend alignment required: EMA stack must confirm direction
 * - Strong close required: Close in top/bottom 30% of candle
 * 
 * Based on 365-day analysis showing:
 * - Win rate degrades from 45% (7d) to 27% (365d)
 * - Older period (180-365d) caused -87.8% P&L
 * - Strategy fails in ranging/choppy markets
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

function calcSMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcATR(candles: OHLCVData[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;
  
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate ADX (Average Directional Index)
 * ADX > 25 = trending market
 * ADX < 20 = ranging/choppy market
 */
function calcADX(candles: OHLCVData[], period: number = 14): number | null {
  if (candles.length < period * 2) return null;
  
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;
    
    // True Range
    const trVal = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    tr.push(trVal);
    
    // Directional Movement
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    
    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }
    
    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }
  
  if (tr.length < period) return null;
  
  // Smoothed averages
  const smoothedTR = calcEMA(tr, period);
  const smoothedPlusDM = calcEMA(plusDM, period);
  const smoothedMinusDM = calcEMA(minusDM, period);
  
  // DI+ and DI-
  const dx: number[] = [];
  for (let i = period - 1; i < smoothedTR.length; i++) {
    const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
    const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
    const diDiff = Math.abs(plusDI - minusDI);
    const diSum = plusDI + minusDI;
    dx.push(diSum > 0 ? (diDiff / diSum) * 100 : 0);
  }
  
  if (dx.length < period) return null;
  
  // ADX is smoothed DX
  const adx = calcEMA(dx, period);
  return adx[adx.length - 1];
}

// ============================================
// VOLUME ANALYSIS
// ============================================

interface VolumeAnalysis {
  currentVolume: number;
  avgVolume: number;
  volumeRatio: number;
  volumeIncreasing: boolean;
  volumeSpike: boolean;
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
  
  const lastThree = volumes.slice(-3);
  const volumeIncreasing = lastThree.length === 3 && 
    lastThree[2] > lastThree[1] && lastThree[1] > lastThree[0];
  
  // V2: Higher threshold - 2.5x instead of 2x
  const volumeSpike = volumeRatio >= 2.5;
  
  return { currentVolume, avgVolume, volumeRatio, volumeIncreasing, volumeSpike };
}

// ============================================
// PRICE BREAKOUT DETECTION
// ============================================

interface PriceBreakout {
  isBreakout: boolean;
  direction: 'up' | 'down' | null;
  strength: number;
  closePosition: number;
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
  
  const candleRange = current.high - current.low;
  const closePosition = candleRange > 0 
    ? (current.close - current.low) / candleRange 
    : 0.5;
  
  if (current.close > highestHigh) {
    const strength = range > 0 ? (current.close - highestHigh) / range * 100 : 0;
    return { isBreakout: true, direction: 'up', strength, closePosition };
  }
  
  if (current.close < lowestLow) {
    const strength = range > 0 ? (lowestLow - current.close) / range * 100 : 0;
    return { isBreakout: true, direction: 'down', strength, closePosition };
  }
  
  return { isBreakout: false, direction: null, strength: 0, closePosition };
}

// ============================================
// MAIN STRATEGY
// ============================================

export const volumeBreakout: Strategy = {
  id: 'volume-breakout',
  name: 'Volume Breakout',
  description: 'V2: High-volume breakouts with ADX trend filter and isolated indicators',
  category: 'breakout',
  timeframes: ['15m', '1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles } = input;
    
    if (candles.length < 50) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    // ============================================
    // ISOLATED INDICATOR CALCULATIONS
    // ============================================
    const closes = candles.map(c => c.close);
    
    // Own EMA calculations
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);
    
    const currentEma9 = ema9[ema9.length - 1];
    const currentEma21 = ema21[ema21.length - 1];
    const currentEma50 = ema50[ema50.length - 1];
    
    // Own RSI
    const rsi = calcRSI(closes, 14);
    
    // Own ATR
    const atr = calcATR(candles, 14);
    
    // Own ADX - KEY FILTER FOR V2
    const adx = calcADX(candles, 14);
    
    // ============================================
    // ADX TREND FILTER (V2 KEY IMPROVEMENT)
    // ============================================
    if (adx === null || adx < 25) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`Market not trending (ADX: ${adx?.toFixed(1) || 'N/A'} < 25)`] 
      };
    }
    
    // ============================================
    // VOLUME & BREAKOUT ANALYSIS
    // ============================================
    const volumeAnalysis = analyzeVolume(candles);
    const priceBreakout = analyzePriceBreakout(candles, 20);
    
    if (!priceBreakout.isBreakout) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['No price breakout detected'] };
    }
    
    const direction = priceBreakout.direction!;
    const reasons: string[] = [];
    let score = 0;
    
    reasons.push(`${direction === 'up' ? '📈' : '📉'} ${direction.toUpperCase()} breakout | ADX: ${adx.toFixed(1)}`);
    
    // ============================================
    // V2: STRICTER VOLUME REQUIREMENT
    // ============================================
    if (!volumeAnalysis.volumeSpike && volumeAnalysis.volumeRatio < 2.0) {
      return { 
        type: 'NEUTRAL', 
        strength: 0, 
        reasons: [`Volume too low (${volumeAnalysis.volumeRatio.toFixed(1)}x < 2.0x required)`] 
      };
    }
    
    // Base score
    score += 25;
    
    // Volume scoring
    if (volumeAnalysis.volumeSpike) {
      score += 30;
      reasons.push(`🔥 Volume SPIKE: ${volumeAnalysis.volumeRatio.toFixed(1)}x`);
    } else if (volumeAnalysis.volumeRatio >= 2.0) {
      score += 20;
      reasons.push(`Volume: ${volumeAnalysis.volumeRatio.toFixed(1)}x`);
    }
    
    if (volumeAnalysis.volumeIncreasing) {
      score += 10;
      reasons.push('Volume building');
    }
    
    // ============================================
    // V2: REQUIRE TREND ALIGNMENT (EMA STACK)
    // ============================================
    const emaBullish = price > currentEma9 && currentEma9 > currentEma21 && currentEma21 > currentEma50;
    const emaBearish = price < currentEma9 && currentEma9 < currentEma21 && currentEma21 < currentEma50;
    
    if (direction === 'up') {
      if (emaBullish) {
        score += 20;
        reasons.push('✓ EMA stack bullish');
      } else if (price > currentEma21) {
        score += 10;
        reasons.push('Price above EMA21');
      } else {
        return { type: 'NEUTRAL', strength: 0, reasons: ['Breakout against EMA trend'] };
      }
    } else {
      if (emaBearish) {
        score += 20;
        reasons.push('✓ EMA stack bearish');
      } else if (price < currentEma21) {
        score += 10;
        reasons.push('Price below EMA21');
      } else {
        return { type: 'NEUTRAL', strength: 0, reasons: ['Breakout against EMA trend'] };
      }
    }
    
    // ============================================
    // V2: REQUIRE STRONG CLOSE POSITION
    // ============================================
    if (direction === 'up' && priceBreakout.closePosition < 0.70) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Weak close - need close in top 30%'] };
    }
    if (direction === 'down' && priceBreakout.closePosition > 0.30) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Weak close - need close in bottom 30%'] };
    }
    
    score += 15;
    reasons.push('Strong close position');
    
    // RSI confirmation
    if (rsi !== null) {
      if (direction === 'up' && rsi >= 75) {
        score -= 15;
        reasons.push('⚠️ RSI overbought');
      } else if (direction === 'down' && rsi <= 25) {
        score -= 15;
        reasons.push('⚠️ RSI oversold');
      } else {
        score += 5;
      }
    }
    
    // ============================================
    // SIGNAL GENERATION WITH BETTER R:R
    // ============================================
    let signal: SignalType = 'NEUTRAL';
    let stop: number | undefined;
    let target: number | undefined;
    
    // V2: Higher threshold for entry
    if (score >= 60) {
      signal = score >= 80 
        ? (direction === 'up' ? 'STRONG_LONG' : 'STRONG_SHORT')
        : (direction === 'up' ? 'LONG' : 'SHORT');
      
      const atrValue = atr || price * 0.015;
      
      if (direction === 'up') {
        const breakoutLevel = Math.max(...candles.slice(-21, -1).map(c => c.high));
        stop = Math.max(breakoutLevel * 0.995, price - atrValue * 1.2);
        // V2: 3:1 R:R instead of 2.5:1
        target = price + (Math.abs(price - stop) * 3.0);
      } else {
        const breakoutLevel = Math.min(...candles.slice(-21, -1).map(c => c.low));
        stop = Math.min(breakoutLevel * 1.005, price + atrValue * 1.2);
        target = price - (Math.abs(stop - price) * 3.0);
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
