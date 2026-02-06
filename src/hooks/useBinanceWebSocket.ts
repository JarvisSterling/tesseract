'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface TickerData {
  symbol: string;
  price: number;
  priceChange24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

// EMA periods we track
const EMA_PERIODS = [9, 21, 50, 100, 200];

// Calculate EMA multiplier
function getEMAMultiplier(period: number): number {
  return 2 / (period + 1);
}

// Update EMA with new price
function updateEMA(currentEMA: number, newPrice: number, period: number): number {
  const k = getEMAMultiplier(period);
  return (newPrice * k) + (currentEMA * (1 - k));
}

interface WebSocketState {
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

// Global Binance WebSocket (client-side runs in user's browser, not US-restricted)
const WS_URL = 'wss://stream.binance.com:9443/ws/!ticker@arr';

// Symbols we care about - USDT pairs on global Binance
const TRACKED_SYMBOLS = new Set([
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'APTUSDT',
]);

export interface LiveEMAs {
  [period: number]: number;
}

export interface LiveTickerData extends TickerData {
  emas: LiveEMAs;
  prevPrice?: number;
}

export function useBinanceWebSocket(initialEMAs?: Record<string, Record<string, LiveEMAs>>) {
  const [prices, setPrices] = useState<Record<string, LiveTickerData>>({});
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    lastUpdate: 0,
    error: null,
  });
  
  // Store EMAs that get updated with each tick
  const emasRef = useRef<Record<string, LiveEMAs>>({});
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  
  // Initialize EMAs from API data
  const initializeEMAs = useCallback((symbol: string, emas: LiveEMAs) => {
    emasRef.current[symbol] = { ...emas };
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🔌 Binance WebSocket connected');
        reconnectAttempts.current = 0;
        setState(s => ({ ...s, connected: true, error: null }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (Array.isArray(data)) {
            const updates: Record<string, LiveTickerData> = {};
            
            for (const ticker of data) {
              const symbol = ticker.s;
              if (TRACKED_SYMBOLS.has(symbol)) {
                const baseSymbol = symbol.replace('USDT', '');
                const newPrice = parseFloat(ticker.c);
                
                // Update EMAs if we have them initialized
                let updatedEMAs: LiveEMAs = emasRef.current[baseSymbol] || {};
                if (Object.keys(updatedEMAs).length > 0) {
                  const newEMAs: LiveEMAs = {};
                  for (const period of EMA_PERIODS) {
                    if (updatedEMAs[period] !== undefined) {
                      newEMAs[period] = updateEMA(updatedEMAs[period], newPrice, period);
                    }
                  }
                  emasRef.current[baseSymbol] = newEMAs;
                  updatedEMAs = newEMAs;
                }
                
                updates[baseSymbol] = {
                  symbol: baseSymbol,
                  price: newPrice,
                  priceChange24h: parseFloat(ticker.P),
                  high24h: parseFloat(ticker.h),
                  low24h: parseFloat(ticker.l),
                  volume24h: parseFloat(ticker.v),
                  emas: updatedEMAs,
                  prevPrice: prices[baseSymbol]?.price,
                };
              }
            }
            
            if (Object.keys(updates).length > 0) {
              setPrices(prev => ({ ...prev, ...updates }));
              setState(s => ({ ...s, lastUpdate: Date.now() }));
            }
          }
        } catch (e) {
          console.error('WebSocket parse error:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setState(s => ({ ...s, error: 'Connection error' }));
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setState(s => ({ ...s, connected: false }));
        wsRef.current = null;

        // Reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting reconnect...');
          connect();
        }, delay);
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      setState(s => ({ ...s, error: 'Failed to connect' }));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState(s => ({ ...s, connected: false }));
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    prices,
    connected: state.connected,
    lastUpdate: state.lastUpdate,
    error: state.error,
    reconnect: connect,
    initializeEMAs,
  };
}
