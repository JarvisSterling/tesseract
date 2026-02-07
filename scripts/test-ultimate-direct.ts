/**
 * Direct test of Ultimate Strategy against real data
 * Fetches from Binance.US and runs backtest locally
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { runBacktest, Candle } from '../src/lib/backtest';

const BINANCE_US_API = 'https://api.binance.us/api/v3';

async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `${BINANCE_US_API}/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  
  return data.map((k: any) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function main() {
  console.log('=== ULTIMATE STRATEGY DIRECT TEST ===\n');
  console.log('Fetching 30 days of BTC data from Binance.US...\n');
  
  // Fetch 30 days of data (30 * 24 = 720 1h candles)
  const [candles1h, candles4h] = await Promise.all([
    fetchCandles('BTC', '1h', 900),  // Extra for warmup
    fetchCandles('BTC', '4h', 200),
  ]);
  
  console.log(`Got ${candles1h.length} 1h candles, ${candles4h.length} 4h candles\n`);
  
  // Run backtest
  console.log('Running backtest...\n');
  const result = runBacktest('BTC', candles1h, candles4h, {
    startEquity: 10000,
    positionSizePercent: 2,
    maxOpenPositions: 3,
    minSignalStrength: 45,
  });
  
  console.log('=== RESULTS (30 days, BTC) ===\n');
  console.log('Strategy Rankings:\n');
  
  // Sort by P&L
  const sorted = [...result.strategyStats].sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
  
  for (const stat of sorted) {
    const emoji = stat.totalPnlPercent >= 0 ? '✅' : '❌';
    console.log(`${emoji} ${stat.strategyName}`);
    console.log(`   Trades: ${stat.totalTrades} | Win: ${stat.winRate.toFixed(0)}% | P&L: ${stat.totalPnlPercent >= 0 ? '+' : ''}${stat.totalPnlPercent.toFixed(2)}%`);
  }
  
  // Check specifically for Ultimate
  const ultimate = result.strategyStats.find(s => s.strategyId === 'ultimate');
  if (ultimate) {
    console.log('\n🎯 ULTIMATE STRATEGY FOUND!');
    console.log(`   Trades: ${ultimate.totalTrades}`);
    console.log(`   Win Rate: ${ultimate.winRate.toFixed(1)}%`);
    console.log(`   P&L: ${ultimate.totalPnlPercent >= 0 ? '+' : ''}${ultimate.totalPnlPercent.toFixed(2)}%`);
    console.log(`   Profit Factor: ${ultimate.profitFactor.toFixed(2)}`);
  } else {
    console.log('\n⚠️ Ultimate Strategy not found in results');
    console.log('Available strategies:', result.strategyStats.map(s => s.strategyId).join(', '));
  }
}

main().catch(console.error);
