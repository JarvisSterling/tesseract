/**
 * Cascade Dashboard - Binance API Integration
 */

import { OHLCV } from './ema';

// ============================================
// CONFIGURATION
// ============================================

const BINANCE_REST_URL = 'https://api.binance.com/api/v3';
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

// Top trading pairs (by volume)
export const TOP_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'XLMUSDT',
  'ETCUSDT', 'FILUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT',
];

// Symbol name mapping
export const SYMBOL_NAMES: Record<string, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  BNBUSDT: 'BNB',
  XRPUSDT: 'XRP',
  SOLUSDT: 'Solana',
  ADAUSDT: 'Cardano',
  DOGEUSDT: 'Dogecoin',
  AVAXUSDT: 'Avalanche',
  DOTUSDT: 'Polkadot',
  LINKUSDT: 'Chainlink',
  MATICUSDT: 'Polygon',
  LTCUSDT: 'Litecoin',
  UNIUSDT: 'Uniswap',
  ATOMUSDT: 'Cosmos',
  XLMUSDT: 'Stellar',
  ETCUSDT: 'Ethereum Classic',
  FILUSDT: 'Filecoin',
  APTUSDT: 'Aptos',
  ARBUSDT: 'Arbitrum',
  OPUSDT: 'Optimism',
};

// ============================================
// REST API
// ============================================

/**
 * Fetch current prices for all symbols
 */
export async function fetchPrices(): Promise<Record<string, number>> {
  const response = await fetch(`${BINANCE_REST_URL}/ticker/price`);
  const data = await response.json();
  
  const prices: Record<string, number> = {};
  
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.symbol && item.price) {
        prices[item.symbol] = parseFloat(item.price);
      }
    }
  }
  
  return prices;
}

/**
 * Fetch klines (OHLCV) data for a symbol
 */
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<OHLCV[]> {
  const url = `${BINANCE_REST_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (!Array.isArray(data)) return [];
  
  return data.map((candle: any[]) => ({
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
    volume: parseFloat(candle[5]),
  }));
}

/**
 * Fetch close prices only (faster for EMA calculation)
 */
export async function fetchClosePrices(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<number[]> {
  const klines = await fetchKlines(symbol, interval, limit);
  return klines.map(k => k.close);
}

/**
 * Fetch 24hr ticker data
 */
export async function fetch24hrTicker(symbol: string): Promise<{
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  quoteVolume: number;
} | null> {
  try {
    const response = await fetch(`${BINANCE_REST_URL}/ticker/24hr?symbol=${symbol}`);
    const data = await response.json();
    
    return {
      priceChange: parseFloat(data.priceChange),
      priceChangePercent: parseFloat(data.priceChangePercent),
      volume: parseFloat(data.volume),
      quoteVolume: parseFloat(data.quoteVolume),
    };
  } catch {
    return null;
  }
}

// ============================================
// WEBSOCKET
// ============================================

type PriceCallback = (symbol: string, price: number) => void;

interface WebSocketManager {
  connect: (symbols: string[]) => void;
  disconnect: () => void;
  subscribe: (callback: PriceCallback) => () => void;
}

/**
 * Create WebSocket manager for real-time price updates
 */
export function createWebSocketManager(): WebSocketManager {
  let ws: WebSocket | null = null;
  const callbacks: Set<PriceCallback> = new Set();
  let reconnectTimeout: NodeJS.Timeout | null = null;
  
  const connect = (symbols: string[]) => {
    if (ws) {
      ws.close();
    }
    
    // Create combined stream URL
    const streams = symbols.map(s => `${s.toLowerCase()}@trade`).join('/');
    ws = new WebSocket(`${BINANCE_WS_URL}/${streams}`);
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.s && data.p) {
          const symbol = data.s;
          const price = parseFloat(data.p);
          
          for (const callback of callbacks) {
            callback(symbol, price);
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };
    
    ws.onclose = () => {
      // Reconnect after 5 seconds
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(() => connect(symbols), 5000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };
  
  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  };
  
  const subscribe = (callback: PriceCallback): (() => void) => {
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  };
  
  return { connect, disconnect, subscribe };
}

// ============================================
// BATCH DATA FETCHING
// ============================================

interface SymbolData {
  symbol: string;
  prices: number[];
  klines: OHLCV[];
}

/**
 * Fetch data for multiple symbols with rate limiting
 */
export async function fetchMultipleSymbols(
  symbols: string[],
  interval: string,
  limit: number = 200,
  delayMs: number = 50
): Promise<Map<string, SymbolData>> {
  const results = new Map<string, SymbolData>();
  
  for (const symbol of symbols) {
    try {
      const klines = await fetchKlines(symbol, interval, limit);
      const prices = klines.map(k => k.close);
      
      results.set(symbol, { symbol, prices, klines });
      
      // Rate limiting
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      console.error(`Failed to fetch ${symbol}:`, error);
    }
  }
  
  return results;
}

// ============================================
// EXPORTS
// ============================================

export default {
  fetchPrices,
  fetchKlines,
  fetchClosePrices,
  fetch24hrTicker,
  fetchMultipleSymbols,
  createWebSocketManager,
  TOP_SYMBOLS,
  SYMBOL_NAMES,
};
