/**
 * Cascade Dashboard - Main Analyzer
 * Combines all technical analysis modules
 */

import {
  calculateAllEMAs,
  calculateAllSlopes,
  calculatePriceVsEMAs,
  detectStack,
  detectTrend,
  calculateRSI,
  calculateATR,
  analyzeVolume,
  EMAPeriod,
  TIMEFRAMES,
  OHLCV,
} from './ema';

import {
  calculateConfluence,
  detectRegime,
  generateTradeSignal,
  detectReversal,
  TimeframeData,
  ConfluenceResult,
  RegimeResult,
  TradeSignalResult,
  ReversalResult,
  TradeSignal,
  StackType,
} from './signals';

import {
  fetchKlines,
  fetchPrices,
  SYMBOL_NAMES,
} from './binance';

// ============================================
// TYPES
// ============================================

export interface CryptoAnalysis {
  symbol: string;
  name: string;
  price: number;
  timeframes: Record<string, TimeframeData>;
  confluence: ConfluenceResult;
  regime: RegimeResult;
  tradeSignal: TradeSignalResult;
  reversal: ReversalResult;
  rsi: Record<string, number | null>;
  atr: Record<string, { value: number | null; percent: number | null }>;
  volume: Record<string, { ratio: number; trend: string }>;
  slopes: Record<string, Record<EMAPeriod, number | null>>;
  keyLevels: {
    supports: number[];
    resistances: number[];
  };
  recentPrices: number[];
  updatedAt: number;
}

interface AnalyzerState {
  signals: Record<string, TradeSignal>;
  rsi: Record<string, number | null>;
  rsiByTf: Record<string, Record<string, number | null>>;
  prices: Record<string, number>;
  signalAge: Record<string, number>;
  volumeRatio: Record<string, number | null>;
  recentHigh: Record<string, number>;
  recentLow: Record<string, number>;
}

// ============================================
// KEY LEVEL DETECTION
// ============================================

function findKeyLevels(
  candles: OHLCV[],
  currentPrice: number,
  emas?: Record<EMAPeriod, number | null>
): { supports: number[]; resistances: number[] } {
  if (candles.length < 10) {
    return { supports: [], resistances: [] };
  }
  
  const levels: { price: number; strength: number }[] = [];
  const tolerance = currentPrice * 0.005; // 0.5% tolerance for clustering
  
  // 1. Find swing highs/lows
  for (let i = 2; i < candles.length - 2; i++) {
    const candle = candles[i];
    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];
    
    // Swing high
    if (candle.high > prev1.high && candle.high > prev2.high &&
        candle.high > next1.high && candle.high > next2.high) {
      levels.push({ price: candle.high, strength: 30 });
    }
    
    // Swing low
    if (candle.low < prev1.low && candle.low < prev2.low &&
        candle.low < next1.low && candle.low < next2.low) {
      levels.push({ price: candle.low, strength: 30 });
    }
  }
  
  // 2. Add EMA levels
  if (emas) {
    for (const period of [21, 50, 100, 200] as EMAPeriod[]) {
      const ema = emas[period];
      if (ema !== null) {
        const weight = period >= 100 ? 1.3 : period >= 50 ? 1.1 : 1;
        levels.push({ price: ema, strength: 25 * weight });
      }
    }
  }
  
  // 3. Add psychological levels
  const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
  for (const mult of [0.5, 1, 2, 5, 10]) {
    const level = magnitude * mult;
    if (level > currentPrice * 0.5 && level < currentPrice * 2) {
      levels.push({ price: level, strength: 20 });
    }
  }
  
  // 4. Cluster levels
  const clustered: { price: number; strength: number; touches: number }[] = [];
  
  for (const level of levels.sort((a, b) => a.price - b.price)) {
    const existing = clustered.find(c => Math.abs(c.price - level.price) < tolerance);
    if (existing) {
      existing.touches++;
      existing.strength += level.strength * 0.5;
      existing.price = (existing.price * (existing.touches - 1) + level.price) / existing.touches;
    } else {
      clustered.push({ ...level, touches: 1 });
    }
  }
  
  // 5. Separate into supports/resistances
  const supports = clustered
    .filter(l => l.price < currentPrice)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5)
    .map(l => l.price)
    .sort((a, b) => b - a); // Closest first
  
  const resistances = clustered
    .filter(l => l.price > currentPrice)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5)
    .map(l => l.price)
    .sort((a, b) => a - b); // Closest first
  
  return { supports, resistances };
}

// ============================================
// MAIN ANALYZER
// ============================================

/**
 * Analyze a single cryptocurrency
 */
export async function analyzeCrypto(
  symbol: string,
  currentPrice: number,
  state: AnalyzerState
): Promise<CryptoAnalysis> {
  const baseSymbol = symbol.replace('USDT', '');
  const name = SYMBOL_NAMES[symbol] || baseSymbol;
  
  const timeframes: Record<string, TimeframeData> = {};
  const rsiData: Record<string, number | null> = {};
  const atrData: Record<string, { value: number | null; percent: number | null }> = {};
  const volumeData: Record<string, { ratio: number; trend: string }> = {};
  const slopeData: Record<string, Record<EMAPeriod, number | null>> = {};
  let recentPrices: number[] = [];
  let mainKlines: OHLCV[] = [];
  let mainEmas: Record<EMAPeriod, number | null> = {} as any;
  
  // Analyze each timeframe
  for (const tf of TIMEFRAMES) {
    try {
      const klines = await fetchKlines(symbol, tf.interval, tf.limit);
      if (klines.length < 50) continue;
      
      const prices = klines.map(k => k.close);
      const volumes = klines.map(k => k.volume);
      
      // Calculate EMAs
      const emas = calculateAllEMAs(prices);
      const priceVsEma = calculatePriceVsEMAs(currentPrice, emas);
      const stack = detectStack(emas);
      const trend = detectTrend(currentPrice, emas);
      
      timeframes[tf.label] = { emas, priceVsEma, stack, trend };
      
      // Calculate slopes
      slopeData[tf.label] = calculateAllSlopes(prices);
      
      // RSI for key timeframes
      if (['15m', '1h', '4h', '1d'].includes(tf.label)) {
        rsiData[tf.label] = calculateRSI(prices);
        
        const atr = calculateATR(klines);
        atrData[tf.label] = {
          value: atr,
          percent: atr && currentPrice > 0 ? (atr / currentPrice) * 100 : null,
        };
        
        const vol = analyzeVolume(volumes);
        volumeData[tf.label] = { ratio: vol.ratio, trend: vol.trend };
      }
      
      // Store 1h data for detailed analysis
      if (tf.label === '1h') {
        recentPrices = prices.slice(-50);
        mainKlines = klines;
        mainEmas = emas;
      }
      
      // Store 4h for key levels
      if (tf.label === '4h') {
        mainKlines = klines;
        mainEmas = emas;
      }
    } catch (error) {
      console.error(`Error analyzing ${symbol} ${tf.label}:`, error);
    }
  }
  
  // Calculate confluence
  const confluence = calculateConfluence(timeframes as any);
  
  // Detect regime (using 4h or 1h)
  const regimeTimeframe = timeframes['4h'] || timeframes['1h'];
  const regime = regimeTimeframe
    ? detectRegime(regimeTimeframe.emas)
    : { regime: 'ranging' as const, strength: 0, description: 'Insufficient data' };
  
  // Find key levels
  const keyLevels = findKeyLevels(mainKlines, currentPrice, mainEmas);
  
  // Get previous state
  const prevSignal = state.signals[baseSymbol] || null;
  const prevRsi = state.rsi[baseSymbol];
  const prevPrice = state.prices[baseSymbol];
  const signalAge = state.signalAge[baseSymbol] || 0;
  const volumeRatio = volumeData['1h']?.ratio ?? null;
  const priceChange = prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : null;
  
  // Generate trade signal
  const tradeSignal = generateTradeSignal(
    confluence,
    regime,
    rsiData['1h'] ?? null,
    slopeData['1h'] || ({} as any),
    timeframes['1h']?.priceVsEma || ({} as any),
    prevSignal,
    { prevRsi, volumeRatio, priceChange, signalAge }
  );
  
  // Get all stacks for reversal detection
  const stacks: Record<string, StackType> = {};
  for (const [tf, data] of Object.entries(timeframes)) {
    stacks[tf] = data.stack;
  }
  
  // Detect reversal
  const reversal = detectReversal(
    rsiData,
    timeframes['1h']?.priceVsEma || ({} as any),
    stacks,
    slopeData['1h'] || ({} as any),
    currentPrice,
    {
      prevRsiByTf: state.rsiByTf[baseSymbol],
      prevPrice,
      recentHigh: state.recentHigh[baseSymbol],
      recentLow: state.recentLow[baseSymbol],
      volumeRatio: volumeRatio ?? undefined,
      prevVolumeRatio: state.volumeRatio[baseSymbol] ?? undefined,
    }
  );
  
  return {
    symbol: baseSymbol,
    name,
    price: currentPrice,
    timeframes: timeframes as any,
    confluence,
    regime,
    tradeSignal,
    reversal,
    rsi: rsiData,
    atr: atrData,
    volume: volumeData,
    slopes: slopeData,
    keyLevels,
    recentPrices,
    updatedAt: Date.now(),
  };
}

/**
 * Analyze multiple cryptocurrencies
 */
export async function analyzeMultiple(
  symbols: string[],
  state: AnalyzerState
): Promise<CryptoAnalysis[]> {
  const prices = await fetchPrices();
  const results: CryptoAnalysis[] = [];
  
  for (const symbol of symbols) {
    const price = prices[symbol];
    if (!price) continue;
    
    try {
      const analysis = await analyzeCrypto(symbol, price, state);
      results.push(analysis);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`Failed to analyze ${symbol}:`, error);
    }
  }
  
  return results;
}

/**
 * Create a fresh analyzer state
 */
export function createAnalyzerState(): AnalyzerState {
  return {
    signals: {},
    rsi: {},
    rsiByTf: {},
    prices: {},
    signalAge: {},
    volumeRatio: {},
    recentHigh: {},
    recentLow: {},
  };
}

/**
 * Update state after analysis
 */
export function updateState(
  state: AnalyzerState,
  analyses: CryptoAnalysis[]
): AnalyzerState {
  const newState = { ...state };
  
  for (const analysis of analyses) {
    const symbol = analysis.symbol;
    const prevSignal = state.signals[symbol];
    const currentSignal = analysis.tradeSignal.signal;
    
    newState.signals[symbol] = currentSignal;
    newState.rsi[symbol] = analysis.rsi['1h'] ?? null;
    newState.rsiByTf[symbol] = analysis.rsi;
    newState.prices[symbol] = analysis.price;
    newState.volumeRatio[symbol] = analysis.volume['1h']?.ratio ?? null;
    
    // Track highs/lows
    const prevHigh = state.recentHigh[symbol];
    const prevLow = state.recentLow[symbol];
    newState.recentHigh[symbol] = prevHigh ? Math.max(prevHigh * 0.99, analysis.price) : analysis.price;
    newState.recentLow[symbol] = prevLow ? Math.min(prevLow * 1.01, analysis.price) : analysis.price;
    
    // Track signal age
    if (prevSignal === currentSignal) {
      newState.signalAge[symbol] = (state.signalAge[symbol] || 0) + 1;
    } else {
      newState.signalAge[symbol] = 0;
    }
  }
  
  return newState;
}

// ============================================
// EXPORTS
// ============================================

export default {
  analyzeCrypto,
  analyzeMultiple,
  createAnalyzerState,
  updateState,
};
