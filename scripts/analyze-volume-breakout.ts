/**
 * Deep Analysis of Volume Breakout Strategy
 * Understand why trades win vs lose
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

interface Trade {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  pnlPercent: number;
  holdingHours: number;
  won: boolean;
  // Context at entry
  rsi: number;
  volumeRatio: number;
  atr: number;
  ema21Slope: number;
  ema50Slope: number;
  priceVsEma21: number;
  priceVsEma50: number;
  strength: number;
}

interface BacktestDetailResponse {
  success: boolean;
  data: {
    individual: Array<{
      symbol: string;
      trades: Trade[];
    }>;
  };
}

async function fetchDetailedTrades(): Promise<Trade[]> {
  const symbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
  const days = 365;
  
  console.log(`Fetching ${days}-day trades for Volume Breakout...\n`);
  
  // Use the backtest API to get trade details
  const res = await fetch(`https://tesseract-black.vercel.app/api/backtest?t=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      symbols, 
      days,
      includeTradeDetails: true,
      strategyFilter: 'volume-breakout'
    }),
  });
  
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  
  // Extract Volume Breakout trades
  const allTrades: Trade[] = [];
  for (const result of json.data.individual) {
    const vbStats = result.strategyStats.find((s: any) => s.strategyId === 'volume-breakout');
    if (vbStats?.trades) {
      allTrades.push(...vbStats.trades.map((t: any) => ({
        ...t,
        symbol: result.symbol
      })));
    }
  }
  
  return allTrades;
}

async function analyzeFromStats() {
  // Since we don't have trade-level details, let's analyze the pattern
  // by comparing different time periods
  
  console.log('🔬 VOLUME BREAKOUT DEEP ANALYSIS\n');
  console.log('='.repeat(70));
  
  const periods = [7, 14, 30, 60, 90, 180, 365];
  const results: any[] = [];
  
  for (const days of periods) {
    const res = await fetch(`https://tesseract-black.vercel.app/api/backtest?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        symbols: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'], 
        days 
      }),
    });
    
    const json = await res.json();
    if (!json.success) continue;
    
    // Aggregate Volume Breakout stats
    let totalTrades = 0;
    let wins = 0;
    let totalPnl = 0;
    let winPnl = 0;
    let lossPnl = 0;
    
    for (const result of json.data.individual) {
      const vb = result.strategyStats.find((s: any) => s.strategyId === 'volume-breakout');
      if (vb) {
        totalTrades += vb.totalTrades;
        wins += vb.wins;
        totalPnl += vb.totalPnlPercent;
        winPnl += vb.avgWinPercent * vb.wins;
        lossPnl += vb.avgLossPercent * (vb.totalTrades - vb.wins);
      }
    }
    
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgWin = wins > 0 ? winPnl / wins : 0;
    const avgLoss = (totalTrades - wins) > 0 ? lossPnl / (totalTrades - wins) : 0;
    const pf = lossPnl > 0 ? winPnl / lossPnl : 0;
    const tradesPerDay = totalTrades / days;
    const pnlPerTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;
    
    results.push({
      days,
      totalTrades,
      wins,
      losses: totalTrades - wins,
      winRate,
      avgWin,
      avgLoss,
      totalPnl,
      pf,
      tradesPerDay,
      pnlPerTrade
    });
  }
  
  console.log('\n📊 VOLUME BREAKOUT BY TIME PERIOD\n');
  console.log('-'.repeat(100));
  console.log(
    'Period'.padEnd(10) +
    'Trades'.padStart(8) +
    'Wins'.padStart(8) +
    'Losses'.padStart(8) +
    'Win%'.padStart(8) +
    'AvgWin'.padStart(10) +
    'AvgLoss'.padStart(10) +
    'PnL'.padStart(12) +
    'PF'.padStart(8) +
    '/Day'.padStart(8)
  );
  console.log('-'.repeat(100));
  
  for (const r of results) {
    const emoji = r.totalPnl >= 0 ? '✅' : '❌';
    console.log(
      `${r.days}d`.padEnd(10) +
      `${r.totalTrades}`.padStart(8) +
      `${r.wins}`.padStart(8) +
      `${r.losses}`.padStart(8) +
      `${r.winRate.toFixed(1)}%`.padStart(8) +
      `+${r.avgWin.toFixed(2)}%`.padStart(10) +
      `-${r.avgLoss.toFixed(2)}%`.padStart(10) +
      `${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(1)}%`.padStart(12) +
      `${r.pf.toFixed(2)}`.padStart(8) +
      `${r.tradesPerDay.toFixed(1)}`.padStart(8) +
      ` ${emoji}`
    );
  }
  
  // Analyze the degradation
  console.log('\n\n📉 DEGRADATION ANALYSIS\n');
  console.log('-'.repeat(70));
  
  const r180 = results.find(r => r.days === 180);
  const r365 = results.find(r => r.days === 365);
  
  if (r180 && r365) {
    // The 180-365 period
    const periodTrades = r365.totalTrades - r180.totalTrades;
    const periodWins = r365.wins - r180.wins;
    const periodLosses = periodTrades - periodWins;
    const periodPnl = r365.totalPnl - r180.totalPnl;
    const periodWinRate = periodTrades > 0 ? (periodWins / periodTrades) * 100 : 0;
    
    console.log('Recent 180 days (0-180d):');
    console.log(`  Trades: ${r180.totalTrades}, Win Rate: ${r180.winRate.toFixed(1)}%, PnL: +${r180.totalPnl.toFixed(1)}%`);
    console.log(`  PF: ${r180.pf.toFixed(2)}`);
    
    console.log('\nOlder period (180-365d):');
    console.log(`  Trades: ${periodTrades}, Win Rate: ${periodWinRate.toFixed(1)}%, PnL: ${periodPnl.toFixed(1)}%`);
    
    console.log('\n🔍 DIAGNOSIS:');
    if (periodPnl < 0) {
      console.log('  The older 180-365d period is dragging down overall performance.');
      console.log('  This suggests the strategy performs poorly in certain market regimes.');
      
      if (periodWinRate < r180.winRate) {
        console.log(`  ⚠️ Win rate dropped from ${r180.winRate.toFixed(1)}% to ${periodWinRate.toFixed(1)}%`);
      }
    }
  }
  
  // Recommendations
  console.log('\n\n💡 RECOMMENDATIONS FOR VOLUME BREAKOUT\n');
  console.log('-'.repeat(70));
  console.log(`
1. MARKET REGIME FILTER
   - The strategy fails in certain market conditions (likely choppy/ranging)
   - Add: ADX filter (only trade when ADX > 25 = trending market)
   - Add: Volatility regime check (avoid low-vol consolidation periods)

2. TIGHTER ENTRY REQUIREMENTS
   - Current win rate: ~27%
   - Need: Higher volume threshold (2.5x instead of 2x)
   - Need: Stronger trend confirmation (EMA stack required)

3. BETTER RISK MANAGEMENT
   - Current: Avg win +2.1%, Avg loss -0.9% (R:R ~2.3:1)
   - With 27% win rate, need R:R > 3:1 to be profitable
   - Solution: Wider targets OR tighter stops

4. TIME-BASED FILTERS
   - Check if losses cluster at certain hours/days
   - Avoid trading during low-volume sessions

5. SYMBOL-SPECIFIC TUNING
   - Some symbols may perform better than others
   - Consider per-symbol parameter optimization
`);

  // Per-symbol breakdown
  console.log('\n📊 PER-SYMBOL BREAKDOWN (365d)\n');
  console.log('-'.repeat(70));
  
  const res = await fetch(`https://tesseract-black.vercel.app/api/backtest?t=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      symbols: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'], 
      days: 365 
    }),
  });
  
  const json = await res.json();
  if (json.success) {
    for (const result of json.data.individual) {
      const vb = result.strategyStats.find((s: any) => s.strategyId === 'volume-breakout');
      if (vb) {
        const emoji = vb.totalPnlPercent >= 0 ? '✅' : '❌';
        console.log(`${result.symbol}: ${vb.totalTrades} trades, ${(vb.wins/vb.totalTrades*100).toFixed(1)}% win rate, ${vb.totalPnlPercent >= 0 ? '+' : ''}${vb.totalPnlPercent.toFixed(1)}% PnL ${emoji}`);
      }
    }
  }
}

analyzeFromStats().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
