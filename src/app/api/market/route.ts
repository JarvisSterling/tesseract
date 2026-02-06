/**
 * Tesseract API - Market Data Endpoint
 * All analysis logic runs server-side (protected)
 */

import { NextResponse } from 'next/server';

// ============================================
// CONFIGURATION
// ============================================

// Use Binance.US API since Vercel servers are in the US
const BINANCE_API = 'https://api.binance.us/api/v3';

// Default symbols if none specified
const DEFAULT_SYMBOLS = [
  'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'AVAX',
  'DOT', 'LINK', 'MATIC', 'LTC', 'UNI', 'ATOM', 'APT'
];

// Known names for popular symbols
const SYMBOL_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', XRP: 'XRP',
  SOL: 'Solana', ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche',
  DOT: 'Polkadot', LINK: 'Chainlink', MATIC: 'Polygon', LTC: 'Litecoin',
  UNI: 'Uniswap', ATOM: 'Cosmos', APT: 'Aptos', SHIB: 'Shiba Inu',
  PEPE: 'Pepe', WIF: 'dogwifhat', BONK: 'Bonk', FLOKI: 'Floki',
  ARB: 'Arbitrum', OP: 'Optimism', INJ: 'Injective', SUI: 'Sui',
  SEI: 'Sei', TIA: 'Celestia', NEAR: 'NEAR', FTM: 'Fantom',
  ALGO: 'Algorand', XLM: 'Stellar', VET: 'VeChain', ICP: 'Internet Computer',
  FIL: 'Filecoin', AAVE: 'Aave', MKR: 'Maker', CRV: 'Curve',
  SNX: 'Synthetix', COMP: 'Compound', YFI: 'Yearn', SUSHI: 'SushiSwap',
  SAND: 'The Sandbox', MANA: 'Decentraland', AXS: 'Axie Infinity',
  ENS: 'Ethereum Name Service', LDO: 'Lido', RPL: 'Rocket Pool',
  GMX: 'GMX', DYDX: 'dYdX', GRT: 'The Graph', RNDR: 'Render',
  OCEAN: 'Ocean Protocol', FET: 'Fetch.ai', AGIX: 'SingularityNET',
};

const TIMEFRAMES = [
  { label: '1m', interval: '1m', limit: 200 },
  { label: '5m', interval: '5m', limit: 200 },
  { label: '15m', interval: '15m', limit: 200 },
  { label: '1h', interval: '1h', limit: 250 },
  { label: '4h', interval: '4h', limit: 200 },
  { label: '1d', interval: '1d', limit: 200 },
];

const EMA_PERIODS = [9, 21, 50, 100, 200];
const TF_WEIGHTS: Record<string, number> = { '1m': 0.5, '5m': 0.75, '15m': 1, '1h': 2, '4h': 3, '1d': 3 };

// ============================================
// CORE CALCULATIONS (SERVER-SIDE ONLY)
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

function calcRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
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
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcSlope(series: number[], lookback = 5): number | null {
  if (series.length < lookback + 1) return null;
  const curr = series[series.length - 1];
  const prev = series[series.length - 1 - lookback];
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function detectStack(emas: Record<number, number | null>): 'bull' | 'bear' | 'mixed' {
  const vals = EMA_PERIODS.map(p => emas[p]).filter((v): v is number => v !== null);
  if (vals.length < 3) return 'mixed';
  let bull = true, bear = true;
  for (let i = 0; i < vals.length - 1; i++) {
    if (vals[i] <= vals[i + 1]) bull = false;
    if (vals[i] >= vals[i + 1]) bear = false;
  }
  return bull ? 'bull' : bear ? 'bear' : 'mixed';
}

function calcConfluence(timeframes: Record<string, { stack: string; trend: string }>) {
  let bullScore = 0, bearScore = 0, totalWeight = 0;
  for (const [tf, data] of Object.entries(timeframes)) {
    const w = TF_WEIGHTS[tf] || 1;
    totalWeight += w;
    if (data.trend === 'bullish' && data.stack === 'bull') bullScore += 2 * w;
    else if (data.trend === 'bullish' || data.stack === 'bull') bullScore += w;
    else if (data.trend === 'bearish' && data.stack === 'bear') bearScore += 2 * w;
    else if (data.trend === 'bearish' || data.stack === 'bear') bearScore += w;
  }
  if (totalWeight === 0) return 50;
  const score = Math.round(50 + ((bullScore - bearScore) / (2 * totalWeight)) * 50);
  return Math.max(0, Math.min(100, score));
}

function generateSignal(
  confluence: number,
  rsi: number | null,
  slope21: number | null,
  priceVsEma21: number | null
): { signal: string; confidence: number; reasons: string[] } {
  let bull = 0, bear = 0;
  const reasons: string[] = [];

  // Confluence
  if (confluence >= 70) { bull += 30; reasons.push('Strong MTF confluence (bullish)'); }
  else if (confluence >= 55) { bull += 15; reasons.push('Moderate confluence (bullish)'); }
  else if (confluence <= 30) { bear += 30; reasons.push('Strong MTF confluence (bearish)'); }
  else if (confluence <= 45) { bear += 15; reasons.push('Moderate confluence (bearish)'); }

  // RSI
  if (rsi !== null) {
    if (rsi < 30) { bull += 15; reasons.push('RSI oversold'); }
    else if (rsi < 45) { bull += 8; }
    else if (rsi > 70) { bear += 15; reasons.push('RSI overbought'); }
    else if (rsi > 55) { bear += 8; }
  }

  // Slope
  if (slope21 !== null) {
    if (slope21 > 0.5) { bull += 15; reasons.push('EMA21 rising'); }
    else if (slope21 < -0.5) { bear += 15; reasons.push('EMA21 falling'); }
  }

  // Price vs EMA
  if (priceVsEma21 !== null) {
    if (priceVsEma21 > 0 && priceVsEma21 < 3) { bull += 10; reasons.push('Price above EMA21'); }
    else if (priceVsEma21 < 0 && priceVsEma21 > -3) { bear += 10; reasons.push('Price below EMA21'); }
  }

  const net = bull - bear;
  const total = bull + bear;
  const confidence = total > 0 ? Math.round(Math.abs(net) / total * 100) : 0;

  let signal = 'NEUTRAL';
  if (net >= 50) signal = 'STRONG_LONG';
  else if (net >= 25) signal = 'LONG';
  else if (net <= -50) signal = 'STRONG_SHORT';
  else if (net <= -25) signal = 'SHORT';

  return { signal, confidence, reasons };
}

// ============================================
// FETCH HELPERS
// ============================================

async function fetchWithRetry(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { 
        next: { revalidate: 30 },
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 100 * (i + 1)));
    }
  }
}

async function analyzeSymbol(
  baseSymbol: string,
  price: number,
  change24h: number
): Promise<any> {
  const usdSymbol = `${baseSymbol}USD`; // Binance.US uses USD pairs
  const tfData: Record<string, any> = {};
  let rsi1h: number | null = null;
  let slope21_1h: number | null = null;
  let priceVsEma21_1h: number | null = null;
  let recentPrices: number[] = [];

  // Fetch all timeframes in parallel
  const klinesPromises = TIMEFRAMES.map(async (tf) => {
    try {
      const klines = await fetchWithRetry(
        `${BINANCE_API}/klines?symbol=${usdSymbol}&interval=${tf.interval}&limit=${tf.limit}`
      );
      return { tf, klines };
    } catch {
      return { tf, klines: null };
    }
  });

  const klinesResults = await Promise.all(klinesPromises);

  for (const { tf, klines } of klinesResults) {
    if (!klines || !Array.isArray(klines) || klines.length < 50) continue;

    const closePrices = klines.map((k: any) => parseFloat(k[4]));
    
    // Calculate EMAs
    const emas: Record<number, number | null> = {};
    const priceVsEma: Record<number, number | null> = {};
    
    for (const period of EMA_PERIODS) {
      const ema = calcEMA(closePrices, period);
      emas[period] = ema;
      priceVsEma[period] = ema ? ((price - ema) / ema) * 100 : null;
    }

    const stack = detectStack(emas);
    const ema50 = emas[50];
    const ema200 = emas[200];
    const trend = ema50 && ema200
      ? (price > ema50 && price > ema200 ? 'bullish' : price < ema50 && price < ema200 ? 'bearish' : 'neutral')
      : 'neutral';

    tfData[tf.label] = { emas, priceVsEma, stack, trend };

    // Store 1h data for signal generation
    if (tf.label === '1h') {
      rsi1h = calcRSI(closePrices);
      const ema21Series = calcEMASeries(closePrices, 21);
      slope21_1h = calcSlope(ema21Series);
      priceVsEma21_1h = priceVsEma[21];
      recentPrices = closePrices.slice(-50);
    }
  }

  // Calculate confluence
  const confluence = calcConfluence(tfData);

  // Generate signal
  const signalData = generateSignal(confluence, rsi1h, slope21_1h, priceVsEma21_1h);

  return {
    symbol: baseSymbol,
    name: SYMBOL_NAMES[baseSymbol] || baseSymbol,
    price,
    priceChange24h: change24h,
    timeframes: tfData,
    confluence: {
      score: confluence,
      signal: confluence >= 60 ? 'buy' : confluence <= 40 ? 'sell' : 'neutral',
    },
    tradeSignal: signalData,
    rsi: { '1h': rsi1h },
    recentPrices,
  };
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  try {
    // Get symbols from query params or use defaults
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    const symbols = symbolsParam 
      ? symbolsParam.split(',').map(s => s.trim().toUpperCase())
      : DEFAULT_SYMBOLS;
    
    // Build USD symbol list for Binance.US
    const usdSymbols = symbols.map(s => `${s}USD`);
    
    // Fetch all prices and 24h changes in parallel
    const [pricesData, tickerData] = await Promise.all([
      fetchWithRetry(`${BINANCE_API}/ticker/price`),
      fetchWithRetry(`${BINANCE_API}/ticker/24hr`),
    ]);

    const prices: Record<string, number> = {};
    for (const item of pricesData) {
      prices[item.symbol] = parseFloat(item.price);
    }

    const changes: Record<string, number> = {};
    for (const item of tickerData) {
      changes[item.symbol] = parseFloat(item.priceChangePercent);
    }

    // Filter to only symbols that exist on Binance.US
    const availableSymbols = symbols.filter(s => prices[`${s}USD`]);

    // Analyze symbols in batches of 5 to avoid rate limits
    const results: any[] = [];
    const batchSize = 5;
    
    for (let i = 0; i < availableSymbols.length; i += batchSize) {
      const batch = availableSymbols.slice(i, i + batchSize);
      const batchPromises = batch.map(symbol => {
        const usdSymbol = `${symbol}USD`;
        const price = prices[usdSymbol];
        if (!price) return null;
        return analyzeSymbol(symbol, price, changes[usdSymbol] || 0);
      }).filter(Boolean);
      
      const batchResults = await Promise.all(batchPromises as Promise<any>[]);
      results.push(...batchResults.filter(Boolean));
      
      // Small delay between batches
      if (i + batchSize < availableSymbols.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      data: results,
    });
  } catch (error: any) {
    console.error('Market API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}

export const revalidate = 30; // Cache for 30 seconds
export const dynamic = 'force-dynamic';
