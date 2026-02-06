import { NextRequest, NextResponse } from 'next/server';
import { runBacktest, Candle, BacktestResult } from '@/lib/backtest';

const BINANCE_US_API = 'https://api.binance.us/api/v3';

interface KlineResponse {
  0: number;  // Open time
  1: string;  // Open
  2: string;  // High
  3: string;  // Low
  4: string;  // Close
  5: string;  // Volume
  6: number;  // Close time
  7: string;  // Quote asset volume
  8: number;  // Number of trades
  9: string;  // Taker buy base asset volume
  10: string; // Taker buy quote asset volume
  11: string; // Ignore
}

async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<Candle[]> {
  const url = `${BINANCE_US_API}/klines?symbol=${symbol}USD&interval=${interval}&limit=${limit}`;
  
  const res = await fetch(url, { 
    next: { revalidate: 300 }, // Cache for 5 mins
    headers: { 'Accept': 'application/json' }
  });
  
  if (!res.ok) {
    // Try USDT pair if USD fails
    const usdtUrl = `${BINANCE_US_API}/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
    const usdtRes = await fetch(usdtUrl, { 
      next: { revalidate: 300 },
      headers: { 'Accept': 'application/json' }
    });
    
    if (!usdtRes.ok) {
      throw new Error(`Failed to fetch klines for ${symbol}`);
    }
    
    const data: KlineResponse[] = await usdtRes.json();
    return data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }
  
  const data: KlineResponse[] = await res.json();
  return data.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get('symbol') || 'BTC';
  const days = parseInt(searchParams.get('days') || '30');
  
  try {
    // Calculate how many candles we need
    // 1h candles: 24 per day
    // 4h candles: 6 per day
    const candles1hLimit = Math.min(days * 24 + 200, 1000); // +200 for warmup, max 1000
    const candles4hLimit = Math.min(days * 6 + 50, 500);
    
    // Fetch historical data
    const [candles1h, candles4h] = await Promise.all([
      fetchKlines(symbol, '1h', candles1hLimit),
      fetchKlines(symbol, '4h', candles4hLimit),
    ]);
    
    if (candles1h.length < 250) {
      return NextResponse.json({
        success: false,
        error: 'Insufficient historical data for backtest',
      }, { status: 400 });
    }
    
    // Run backtest
    const result = runBacktest(symbol, candles1h, candles4h, {
      startEquity: 10000,
      positionSizePercent: 2,
      maxOpenPositions: 3,
      minSignalStrength: 45,
    });
    
    return NextResponse.json({
      success: true,
      data: result,
    });
    
  } catch (error) {
    console.error('Backtest error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Backtest failed',
    }, { status: 500 });
  }
}

// Also support POST for batch backtesting
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbols = ['BTC', 'ETH', 'SOL'], days = 30 } = body;
    
    const results: BacktestResult[] = [];
    
    for (const symbol of symbols.slice(0, 5)) { // Max 5 symbols
      try {
        const candles1hLimit = Math.min(days * 24 + 200, 1000);
        const candles4hLimit = Math.min(days * 6 + 50, 500);
        
        const [candles1h, candles4h] = await Promise.all([
          fetchKlines(symbol, '1h', candles1hLimit),
          fetchKlines(symbol, '4h', candles4hLimit),
        ]);
        
        if (candles1h.length >= 250) {
          const result = runBacktest(symbol, candles1h, candles4h, {
            startEquity: 10000,
            positionSizePercent: 2,
            maxOpenPositions: 3,
            minSignalStrength: 45,
          });
          results.push(result);
        }
      } catch (e) {
        console.error(`Failed to backtest ${symbol}:`, e);
      }
    }
    
    // Aggregate results across all symbols
    const aggregated = aggregateResults(results);
    
    return NextResponse.json({
      success: true,
      data: {
        individual: results,
        aggregated,
      },
    });
    
  } catch (error) {
    console.error('Batch backtest error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Batch backtest failed',
    }, { status: 500 });
  }
}

function aggregateResults(results: BacktestResult[]) {
  if (results.length === 0) {
    return {
      totalSymbols: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlPercent: 0,
      avgPnlPerTrade: 0,
      bestStrategy: 'N/A',
      strategyRankings: [],
    };
  }
  
  // Combine all trades
  const allTrades = results.flatMap(r => r.trades);
  const wins = allTrades.filter(t => t.outcome === 'win').length;
  const losses = allTrades.filter(t => t.outcome === 'loss').length;
  const totalPnl = allTrades.reduce((sum, t) => sum + t.pnlPercent, 0);
  
  // Aggregate strategy stats
  const strategyMap = new Map<string, {
    name: string;
    trades: number;
    wins: number;
    pnl: number;
  }>();
  
  for (const result of results) {
    for (const stat of result.strategyStats) {
      const existing = strategyMap.get(stat.strategyId) || {
        name: stat.strategyName,
        trades: 0,
        wins: 0,
        pnl: 0,
      };
      existing.trades += stat.totalTrades;
      existing.wins += stat.wins;
      existing.pnl += stat.totalPnlPercent;
      strategyMap.set(stat.strategyId, existing);
    }
  }
  
  const strategyRankings = Array.from(strategyMap.entries())
    .map(([id, data]) => ({
      strategyId: id,
      strategyName: data.name,
      totalTrades: data.trades,
      winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
      totalPnlPercent: data.pnl,
    }))
    .sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
  
  return {
    totalSymbols: results.length,
    totalTrades: allTrades.length,
    wins,
    losses,
    winRate: allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0,
    totalPnlPercent: totalPnl,
    avgPnlPerTrade: allTrades.length > 0 ? totalPnl / allTrades.length : 0,
    bestStrategy: strategyRankings[0]?.strategyName || 'N/A',
    strategyRankings,
  };
}
