/**
 * Strategy Analysis Script
 * Runs backtests and identifies underperforming strategies
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

interface StrategyStats {
  strategyId: string;
  strategyName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
  totalPnlPercent: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  avgHoldingHours: number;
  expectancy: number;
}

interface BacktestResult {
  symbol: string;
  strategyStats: StrategyStats[];
  overall: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnlPercent: number;
    maxDrawdownPercent: number;
  };
}

async function runBacktest(symbols: string[], days: number): Promise<BacktestResult[]> {
  // Use deployed Vercel version with cache busting
  const timestamp = Date.now();
  const res = await fetch(`https://tesseract-black.vercel.app/api/backtest?t=${timestamp}`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify({ symbols, days }),
  });
  
  // Check if response is OK first
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API returned ${res.status}: ${text.slice(0, 200)}`);
  }
  
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }
  
  if (!json.success) throw new Error(json.error);
  return json.data.individual;
}

// Run backtests one symbol at a time to avoid timeout
async function runBacktestSequential(symbols: string[], days: number): Promise<BacktestResult[]> {
  const results: BacktestResult[] = [];
  
  for (const symbol of symbols) {
    console.log(`   Fetching ${symbol}...`);
    const timestamp = Date.now();
    const res = await fetch(`https://tesseract-black.vercel.app/api/backtest?symbol=${symbol}&days=${days}&t=${timestamp}&v=2`, {
      headers: { 
        'Cache-Control': 'no-cache',
      },
    });
    
    if (!res.ok) {
      console.log(`   ⚠️ ${symbol} failed: ${res.status}`);
      continue;
    }
    
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`   ⚠️ ${symbol} invalid JSON: ${text.slice(0, 100)}`);
      continue;
    }
    
    if (json.success && json.data) {
      results.push(json.data);
      console.log(`   ✓ ${symbol}: ${json.data.trades.length} trades`);
    } else {
      console.log(`   ⚠️ ${symbol} error: ${json.error}`);
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

async function analyze() {
  console.log('🔬 TESSERACT STRATEGY ANALYSIS\n');
  console.log('='.repeat(60));
  
  // Run 365d backtest - sequential to avoid Vercel timeouts
  const symbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
  const days = 365;
  console.log(`\n📊 Running ${days}-day backtest on: ${symbols.join(', ')}`);
  console.log('   (Sequential mode to avoid API timeouts)\n');
  
  const results = await runBacktestSequential(symbols, days);
  
  if (results.length === 0) {
    console.log('\n❌ No backtest data returned. API may be overloaded.');
    process.exit(1);
  }
  
  console.log(`\n✅ Got data for ${results.length}/${symbols.length} symbols\n`);
  
  // Aggregate strategy stats across all symbols
  const strategyAgg = new Map<string, {
    name: string;
    trades: number;
    wins: number;
    losses: number;
    totalPnl: number;
    winPnl: number;
    lossPnl: number;
    maxConsecLosses: number;
    holdingHours: number;
  }>();
  
  for (const result of results) {
    for (const stat of result.strategyStats) {
      const existing = strategyAgg.get(stat.strategyId) || {
        name: stat.strategyName,
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winPnl: 0,
        lossPnl: 0,
        maxConsecLosses: 0,
        holdingHours: 0,
      };
      
      existing.trades += stat.totalTrades;
      existing.wins += stat.wins;
      existing.losses += stat.losses;
      existing.totalPnl += stat.totalPnlPercent;
      existing.winPnl += stat.avgWinPercent * stat.wins;
      existing.lossPnl += stat.avgLossPercent * stat.losses;
      existing.maxConsecLosses = Math.max(existing.maxConsecLosses, stat.maxConsecutiveLosses);
      existing.holdingHours += stat.avgHoldingHours * stat.totalTrades;
      
      strategyAgg.set(stat.strategyId, existing);
    }
  }
  
  // Calculate final stats and sort by P&L
  const finalStats = Array.from(strategyAgg.entries())
    .map(([id, data]) => {
      const winRate = data.trades > 0 ? (data.wins / data.trades) * 100 : 0;
      const avgWin = data.wins > 0 ? data.winPnl / data.wins : 0;
      const avgLoss = data.losses > 0 ? data.lossPnl / data.losses : 0;
      const profitFactor = data.lossPnl > 0 ? data.winPnl / data.lossPnl : (data.winPnl > 0 ? Infinity : 0);
      const expectancy = data.trades > 0 ? data.totalPnl / data.trades : 0;
      const avgHolding = data.trades > 0 ? data.holdingHours / data.trades : 0;
      
      return {
        id,
        name: data.name,
        trades: data.trades,
        wins: data.wins,
        losses: data.losses,
        winRate,
        avgWin,
        avgLoss,
        totalPnl: data.totalPnl,
        profitFactor,
        expectancy,
        avgHolding,
        maxConsecLosses: data.maxConsecLosses,
      };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl);
  
  // Print results
  console.log('\n📈 STRATEGY RANKINGS (by Total P&L)\n');
  console.log('-'.repeat(100));
  console.log(
    'Rank'.padEnd(5) +
    'Strategy'.padEnd(25) +
    'Trades'.padStart(8) +
    'Win%'.padStart(8) +
    'AvgWin'.padStart(10) +
    'AvgLoss'.padStart(10) +
    'Total P&L'.padStart(12) +
    'PF'.padStart(8) +
    'Expect'.padStart(10)
  );
  console.log('-'.repeat(100));
  
  finalStats.forEach((stat, i) => {
    const emoji = stat.totalPnl >= 0 ? '✅' : '❌';
    console.log(
      `${i + 1}`.padEnd(5) +
      stat.name.padEnd(25) +
      `${stat.trades}`.padStart(8) +
      `${stat.winRate.toFixed(1)}%`.padStart(8) +
      `+${stat.avgWin.toFixed(2)}%`.padStart(10) +
      `-${stat.avgLoss.toFixed(2)}%`.padStart(10) +
      `${stat.totalPnl >= 0 ? '+' : ''}${stat.totalPnl.toFixed(2)}%`.padStart(12) +
      `${stat.profitFactor === Infinity ? '∞' : stat.profitFactor.toFixed(2)}`.padStart(8) +
      `${stat.expectancy >= 0 ? '+' : ''}${stat.expectancy.toFixed(2)}%`.padStart(10) +
      ` ${emoji}`
    );
  });
  
  // Identify underperformers (P&L-based, not win rate!)
  // A strategy can have 30% win rate and still be profitable with good R:R
  console.log('\n\n🔴 UNDERPERFORMING STRATEGIES (need fixing)\n');
  console.log('-'.repeat(80));
  
  const underperformers = finalStats.filter(s => 
    s.totalPnl < 0 || s.profitFactor < 1.0
  );
  
  if (underperformers.length === 0) {
    console.log('All strategies are profitable! 🎉');
  } else {
    for (const stat of underperformers) {
      console.log(`\n❌ ${stat.name} (${stat.id})`);
      console.log(`   • Total P&L: ${stat.totalPnl.toFixed(2)}%`);
      console.log(`   • Win Rate: ${stat.winRate.toFixed(1)}%`);
      console.log(`   • Avg Win/Loss: +${stat.avgWin.toFixed(2)}% / -${stat.avgLoss.toFixed(2)}%`);
      console.log(`   • Profit Factor: ${stat.profitFactor.toFixed(2)}`);
      console.log(`   • Max Consecutive Losses: ${stat.maxConsecLosses}`);
      console.log(`   • Avg Holding Time: ${stat.avgHolding.toFixed(1)}h`);
      
      // Analysis
      const issues: string[] = [];
      if (stat.profitFactor < 1) issues.push('PF < 1.0 - losing money on average');
      if (stat.avgLoss > stat.avgWin * 1.5) issues.push('R:R imbalanced - need tighter stops or wider targets');
      if (stat.maxConsecLosses > 10) issues.push('High drawdown risk - streak of losses');
      if (stat.trades < 10) issues.push('Low sample size - results may not be reliable');
      
      if (issues.length > 0) {
        console.log('   📋 Issues:');
        issues.forEach(issue => console.log(`      - ${issue}`));
      }
    }
  }
  
  // Top performers analysis (sorted by P&L, already done above)
  console.log('\n\n🟢 TOP PERFORMERS (best strategies)\n');
  console.log('-'.repeat(80));
  
  // Top 3 by P&L (they're already sorted)
  const topPerformers = finalStats.filter(s => s.totalPnl > 0 && s.profitFactor >= 1.1);
  for (const stat of topPerformers.slice(0, 3)) {
    console.log(`\n✅ ${stat.name}`);
    console.log(`   • P&L: +${stat.totalPnl.toFixed(2)}% | PF: ${stat.profitFactor.toFixed(2)} | Win Rate: ${stat.winRate.toFixed(1)}%`);
    console.log(`   • Edge: +${stat.expectancy.toFixed(2)}% per trade | Trades: ${stat.trades}`);
  }
  
  // Save results for reference
  const report = {
    timestamp: new Date().toISOString(),
    symbols,
    days: 90,
    strategies: finalStats,
    underperformers: underperformers.map(s => s.id),
    topPerformers: topPerformers.slice(0, 3).map(s => s.id),
  };
  
  const fs = await import('fs');
  fs.writeFileSync(
    'strategy-analysis.json',
    JSON.stringify(report, null, 2)
  );
  console.log('\n\n📁 Results saved to strategy-analysis.json');
}

analyze().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
