/**
 * Cascade Dashboard - Signal Generation & Confluence Scoring
 */

import {
  EMAPeriod,
  TimeframeLabel,
  StackType,
  TrendType,
  calculateAllSlopes,
  EMA_PERIODS,
} from './ema';

// Re-export types that other modules need
export type { StackType, TrendType } from './ema';

// ============================================
// TYPES
// ============================================

export interface TimeframeData {
  emas: Record<EMAPeriod, number | null>;
  priceVsEma: Record<EMAPeriod, number | null>;
  stack: StackType;
  trend: TrendType;
}

export interface ConfluenceResult {
  score: number;        // 0-100 (50 = neutral)
  signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  aligned: number;      // Number of aligned timeframes
  total: number;        // Total timeframes analyzed
}

export interface RegimeResult {
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile';
  strength: number;     // 0-100
  description: string;
}

export type TradeSignal = 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';

export interface TradeSignalResult {
  signal: TradeSignal;
  confidence: number;   // 0-100
  reasons: string[];
  warnings: string[];
}

export interface ReversalResult {
  type: 'none' | 'potential_top' | 'potential_bottom';
  risk: 'low' | 'medium' | 'high';
  score: number;
  signals: string[];
}

// ============================================
// CONFLUENCE SCORING
// ============================================

const TIMEFRAME_WEIGHTS: Record<string, number> = {
  '1m': 0.5,
  '3m': 0.5,
  '5m': 0.75,
  '15m': 1,
  '30m': 1.5,
  '1h': 2,
  '4h': 3,
  '1d': 3,
  '1w': 2,
};

/**
 * Calculate multi-timeframe confluence score
 * Returns 0-100 where 50 = neutral, >50 = bullish, <50 = bearish
 */
export function calculateConfluence(
  timeframes: Record<TimeframeLabel, TimeframeData>
): ConfluenceResult {
  let bullScore = 0;
  let bearScore = 0;
  let totalWeight = 0;
  let aligned = 0;
  
  for (const [tf, data] of Object.entries(timeframes)) {
    const weight = TIMEFRAME_WEIGHTS[tf] || 1;
    totalWeight += weight;
    
    // Double points for trend + stack alignment
    if (data.trend === 'bullish' && data.stack === 'bull') {
      bullScore += 2 * weight;
      aligned++;
    } else if (data.trend === 'bullish' || data.stack === 'bull') {
      bullScore += weight;
    } else if (data.trend === 'bearish' && data.stack === 'bear') {
      bearScore += 2 * weight;
      aligned++;
    } else if (data.trend === 'bearish' || data.stack === 'bear') {
      bearScore += weight;
    }
  }
  
  // Score 0-100 with 50 as neutral
  const score = Math.round(50 + ((bullScore - bearScore) / (2 * totalWeight)) * 50);
  
  // Determine signal
  let signal: ConfluenceResult['signal'];
  if (score >= 80) signal = 'strong_buy';
  else if (score >= 60) signal = 'buy';
  else if (score <= 20) signal = 'strong_sell';
  else if (score <= 40) signal = 'sell';
  else signal = 'neutral';
  
  return {
    score: Math.max(0, Math.min(100, score)),
    signal,
    aligned,
    total: Object.keys(timeframes).length,
  };
}

// ============================================
// MARKET REGIME DETECTION
// ============================================

/**
 * Detect market regime based on EMA structure
 */
export function detectRegime(
  emas: Record<EMAPeriod, number | null>
): RegimeResult {
  const ema9 = emas[9];
  const ema21 = emas[21];
  const ema50 = emas[50];
  const ema200 = emas[200];
  
  if (!ema9 || !ema21 || !ema50) {
    return {
      regime: 'ranging',
      strength: 0,
      description: 'Insufficient data',
    };
  }
  
  // Calculate EMA spread (volatility indicator)
  const spread = (Math.abs((ema9 - ema21) / ema21) * 100) +
                 (Math.abs((ema21 - ema50) / ema50) * 100);
  
  // Tight EMAs = ranging
  if (spread < 1) {
    return {
      regime: 'ranging',
      strength: Math.round((1 - spread) * 100),
      description: 'EMAs compressed - consolidation phase',
    };
  }
  
  // Check for proper stack
  const isBullStack = ema9 > ema21 && ema21 > ema50 && (!ema200 || ema50 > ema200);
  const isBearStack = ema9 < ema21 && ema21 < ema50 && (!ema200 || ema50 < ema200);
  
  if (isBullStack && spread > 2) {
    return {
      regime: 'trending_up',
      strength: Math.min(100, Math.round(spread * 20)),
      description: 'Strong uptrend - EMAs properly stacked',
    };
  }
  
  if (isBearStack && spread > 2) {
    return {
      regime: 'trending_down',
      strength: Math.min(100, Math.round(spread * 20)),
      description: 'Strong downtrend - EMAs properly stacked',
    };
  }
  
  if (spread > 5) {
    return {
      regime: 'volatile',
      strength: Math.min(100, Math.round(spread * 10)),
      description: 'High volatility - wide EMA spread',
    };
  }
  
  return {
    regime: 'ranging',
    strength: 50,
    description: 'Mixed signals - no clear trend',
  };
}

// ============================================
// TRADE SIGNAL GENERATION
// ============================================

interface SignalContext {
  prevRsi?: number | null;
  volumeRatio?: number | null;
  priceChange?: number | null;
  signalAge?: number;
}

/**
 * Generate trade signal with confidence score
 */
export function generateTradeSignal(
  confluence: ConfluenceResult,
  regime: RegimeResult,
  rsi: number | null,
  slopes: Record<EMAPeriod, number | null>,
  priceVsEma: Record<EMAPeriod, number | null>,
  prevSignal: TradeSignal | null,
  context: SignalContext = {}
): TradeSignalResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let bullScore = 0;
  let bearScore = 0;
  
  const { prevRsi, volumeRatio, priceChange, signalAge } = context;
  
  // 1. CONFLUENCE SCORING
  if (confluence.score >= 70) {
    bullScore += 30;
    reasons.push('Strong HTF confluence (bullish)');
  } else if (confluence.score >= 55) {
    bullScore += 15;
    reasons.push('Moderate MTF confluence (bullish)');
  } else if (confluence.score <= 30) {
    bearScore += 30;
    reasons.push('Strong HTF confluence (bearish)');
  } else if (confluence.score <= 45) {
    bearScore += 15;
    reasons.push('Moderate MTF confluence (bearish)');
  }
  
  // 2. REGIME SCORING
  if (regime.regime === 'trending_up') {
    bullScore += 25;
    reasons.push('Uptrend regime');
  } else if (regime.regime === 'trending_down') {
    bearScore += 25;
    reasons.push('Downtrend regime');
  } else if (regime.regime === 'ranging') {
    warnings.push('Ranging market - avoid trading');
  } else if (regime.regime === 'volatile') {
    warnings.push('High volatility - reduce size');
  }
  
  // 3. RSI ANALYSIS
  if (rsi !== null) {
    // RSI reversal detection
    if (prevRsi !== null && prevRsi !== undefined) {
      if (rsi > prevRsi && prevRsi < 35 && rsi < 40) {
        bullScore += 20;
        reasons.push('RSI reversing up from oversold');
      } else if (rsi < prevRsi && prevRsi > 65 && rsi > 60) {
        bearScore += 20;
        reasons.push('RSI reversing down from overbought');
      }
    }
    
    // Current RSI zones
    if (rsi < 30) {
      bullScore += 5;
      warnings.push('RSI oversold - wait for reversal confirmation');
    } else if (rsi < 45 && rsi > 35) {
      bullScore += 8;
      reasons.push('RSI neutral-bullish zone');
    } else if (rsi > 70) {
      bearScore += 5;
      warnings.push('RSI overbought - wait for reversal confirmation');
    } else if (rsi > 55 && rsi < 65) {
      bearScore += 8;
      reasons.push('RSI neutral-bearish zone');
    }
  }
  
  // 4. EMA SLOPE (MOMENTUM)
  const slope21 = slopes[21];
  const slope50 = slopes[50];
  
  if (slope21 !== null && slope50 !== null) {
    if (slope21 > 0.3 && slope50 > 0) {
      bullScore += 15;
      reasons.push('EMAs rising (momentum up)');
    } else if (slope21 > 0) {
      bullScore += 8;
    } else if (slope21 < -0.3 && slope50 < 0) {
      bearScore += 15;
      reasons.push('EMAs falling (momentum down)');
    } else if (slope21 < 0) {
      bearScore += 8;
    }
  }
  
  // 5. PRICE VS EMA
  const pve21 = priceVsEma[21];
  const pve50 = priceVsEma[50];
  
  if (pve21 !== null && priceChange !== null && priceChange !== undefined) {
    // Bounce off EMA21
    if (pve21 > 0 && pve21 < 2 && priceChange > 0) {
      bullScore += 15;
      reasons.push('Price bouncing off EMA21 support');
    } else if (pve21 < 0 && pve21 > -2 && priceChange < 0) {
      bearScore += 15;
      reasons.push('Price breaking below EMA21');
    }
    
    // Extended warnings
    if (pve21 > 5) {
      warnings.push('Price extended above EMA21 - wait for pullback');
    } else if (pve21 < -5) {
      warnings.push('Price extended below EMA21 - wait for bounce');
    }
  }
  
  // Both EMAs alignment
  if (pve21 !== null && pve50 !== null) {
    if (pve21 > 0 && pve50 > 0 && pve50 < 5) {
      bullScore += 5;
      reasons.push('Price above both EMA21 & EMA50');
    } else if (pve21 < 0 && pve50 < 0 && pve50 > -5) {
      bearScore += 5;
      reasons.push('Price below both EMA21 & EMA50');
    }
  }
  
  // 6. VOLUME CONFIRMATION
  if (volumeRatio !== null && volumeRatio !== undefined) {
    if (volumeRatio > 1.5 && priceChange !== null && priceChange !== undefined) {
      if (priceChange > 0) {
        bullScore += 10;
        reasons.push('High volume on up move');
      } else if (priceChange < 0) {
        bearScore += 10;
        reasons.push('High volume on down move');
      }
    } else if (volumeRatio < 0.5) {
      warnings.push('Low volume - weak conviction');
    }
  }
  
  // 7. SIGNAL PERSISTENCE
  if (signalAge !== undefined && signalAge >= 3) {
    if (prevSignal === 'LONG' || prevSignal === 'STRONG_LONG') {
      bullScore += 5;
      reasons.push(`Bullish signal sustained (${signalAge} cycles)`);
    } else if (prevSignal === 'SHORT' || prevSignal === 'STRONG_SHORT') {
      bearScore += 5;
      reasons.push(`Bearish signal sustained (${signalAge} cycles)`);
    }
  }
  
  // CALCULATE FINAL SIGNAL
  const netScore = bullScore - bearScore;
  const totalScore = bullScore + bearScore;
  const confidence = totalScore > 0 ? Math.round(Math.abs(netScore) / totalScore * 100) : 0;
  
  // Determine signal with hysteresis (avoid flip-flopping)
  const wasBullish = prevSignal === 'LONG' || prevSignal === 'STRONG_LONG';
  const wasBearish = prevSignal === 'SHORT' || prevSignal === 'STRONG_SHORT';
  
  let signal: TradeSignal;
  
  if (netScore >= 50) {
    signal = 'STRONG_LONG';
  } else if (netScore >= 25) {
    signal = wasBearish && netScore < 40 ? 'NEUTRAL' : 'LONG';
  } else if (netScore <= -50) {
    signal = 'STRONG_SHORT';
  } else if (netScore <= -25) {
    signal = wasBullish && netScore > -40 ? 'NEUTRAL' : 'SHORT';
  } else {
    // In neutral zone, prefer previous direction if close
    if (wasBullish && netScore > -15) signal = 'LONG';
    else if (wasBearish && netScore < 15) signal = 'SHORT';
    else signal = 'NEUTRAL';
  }
  
  return { signal, confidence, reasons, warnings };
}

// ============================================
// REVERSAL DETECTION
// ============================================

interface ReversalContext {
  prevRsiByTf?: Record<string, number | null>;
  prevPrice?: number;
  recentHigh?: number;
  recentLow?: number;
  volumeRatio?: number;
  prevVolumeRatio?: number;
}

/**
 * Detect potential trend reversals
 */
export function detectReversal(
  rsi: Record<string, number | null>,
  priceVsEma: Record<EMAPeriod, number | null>,
  stacks: Record<string, StackType>,
  slopes: Record<EMAPeriod, number | null>,
  price: number,
  context: ReversalContext = {}
): ReversalResult {
  const signals: string[] = [];
  let topScore = 0;
  let bottomScore = 0;
  
  const {
    prevRsiByTf,
    prevPrice,
    recentHigh,
    recentLow,
    volumeRatio,
    prevVolumeRatio,
  } = context;
  
  const rsi1h = rsi['1h'];
  const rsi4h = rsi['4h'];
  const rsi15m = rsi['15m'];
  
  // 1. RSI DIVERGENCE
  if (prevRsiByTf && recentHigh && prevPrice) {
    const prevRsi1h = prevRsiByTf['1h'];
    if (rsi1h !== null && prevRsi1h !== null && prevRsi1h !== undefined) {
      // Bearish divergence: price up, RSI down
      if (price >= prevPrice && rsi1h < prevRsi1h && rsi1h > 60) {
        topScore += 30;
        signals.push('📉 RSI bearish divergence (price up, RSI down)');
      }
      // Bullish divergence: price down, RSI up
      if (price <= prevPrice && rsi1h > prevRsi1h && rsi1h < 40) {
        bottomScore += 30;
        signals.push('📈 RSI bullish divergence (price down, RSI up)');
      }
    }
  }
  
  // 2. MULTI-TF OVERBOUGHT/OVERSOLD
  let obCount = 0;
  let osCount = 0;
  
  if (rsi15m !== null && rsi15m > 70) obCount++;
  if (rsi1h !== null && rsi1h > 70) obCount++;
  if (rsi4h !== null && rsi4h > 70) obCount++;
  
  if (rsi15m !== null && rsi15m < 30) osCount++;
  if (rsi1h !== null && rsi1h < 30) osCount++;
  if (rsi4h !== null && rsi4h < 30) osCount++;
  
  if (obCount >= 2) {
    topScore += 25;
    signals.push(`Multi-TF overbought (${obCount} timeframes)`);
  }
  if (osCount >= 2) {
    bottomScore += 25;
    signals.push(`Multi-TF oversold (${osCount} timeframes)`);
  }
  
  // 3. VOLUME DIVERGENCE
  if (volumeRatio !== undefined && prevVolumeRatio !== undefined) {
    if (prevPrice && price > prevPrice && volumeRatio < prevVolumeRatio && volumeRatio < 0.8) {
      topScore += 20;
      signals.push('Volume declining on rally (exhaustion)');
    }
    if (prevPrice && price < prevPrice && volumeRatio < prevVolumeRatio && volumeRatio < 0.8) {
      bottomScore += 20;
      signals.push('Volume declining on selloff (capitulation ending)');
    }
  }
  
  // 4. EXTENDED PRICE
  const pve21 = priceVsEma[21];
  const pve50 = priceVsEma[50];
  const pve100 = priceVsEma[100];
  
  let extendedAbove = 0;
  let extendedBelow = 0;
  
  if (pve21 !== null && pve21 > 3) extendedAbove++;
  if (pve50 !== null && pve50 > 5) extendedAbove++;
  if (pve100 !== null && pve100 > 8) extendedAbove++;
  
  if (pve21 !== null && pve21 < -3) extendedBelow++;
  if (pve50 !== null && pve50 < -5) extendedBelow++;
  if (pve100 !== null && pve100 < -8) extendedBelow++;
  
  if (extendedAbove >= 3) {
    topScore += 25;
    signals.push(`Extended above ${extendedAbove} EMAs (mean reversion due)`);
  }
  if (extendedBelow >= 3) {
    bottomScore += 25;
    signals.push(`Extended below ${extendedBelow} EMAs (mean reversion due)`);
  }
  
  // 5. EMA SLOPE FLATTENING
  const slope21 = slopes[21];
  
  if (slope21 !== null) {
    if (slope21 > 0 && slope21 < 0.3) {
      topScore += 10;
      signals.push('EMA21 slope flattening (momentum slowing)');
    }
    if (slope21 < 0 && slope21 > -0.3) {
      bottomScore += 10;
      signals.push('EMA21 slope flattening (selling exhaustion)');
    }
  }
  
  // 6. LOWER TF DIVERGENCE
  if (stacks['15m'] === 'bear' && (stacks['1h'] === 'bull' || stacks['4h'] === 'bull')) {
    topScore += 15;
    signals.push('Lower TF (15m) turning bearish');
  }
  if (stacks['15m'] === 'bull' && (stacks['1h'] === 'bear' || stacks['4h'] === 'bear')) {
    bottomScore += 15;
    signals.push('Lower TF (15m) turning bullish');
  }
  
  // DETERMINE RESULT
  const maxScore = Math.max(topScore, bottomScore);
  
  if (maxScore < 25) {
    return { type: 'none', risk: 'low', score: 0, signals: [] };
  }
  
  const type = topScore > bottomScore ? 'potential_top' : 'potential_bottom';
  const relevantSignals = type === 'potential_top'
    ? signals.filter(s => !s.includes('oversold') && !s.includes('below') && !s.includes('bullish'))
    : signals.filter(s => !s.includes('overbought') && !s.includes('above') && !s.includes('bearish'));
  
  return {
    type,
    risk: maxScore >= 70 ? 'high' : maxScore >= 45 ? 'medium' : 'low',
    score: maxScore,
    signals: relevantSignals,
  };
}

// ============================================
// EXPORTS
// ============================================

export default {
  calculateConfluence,
  detectRegime,
  generateTradeSignal,
  detectReversal,
};
