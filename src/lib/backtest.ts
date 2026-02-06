/**
 * Backtesting Engine
 * Runs strategies against historical data to evaluate performance
 */

import { evaluateStrategies, StrategyResult, StrategyInput, OHLCVData } from './strategies';
import { buildIndicators } from './indicators';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  strategyId: string;
  strategyName: string;
  direction: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  outcome: 'win' | 'loss' | 'breakeven';
  pnlPercent: number;
  holdingPeriodHours: number;
}

export interface StrategyBacktestStats {
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
  expectancy: number; // Expected P&L per trade
}

export interface BacktestResult {
  symbol: string;
  period: string;
  startDate: string;
  endDate: string;
  totalCandles: number;
  trades: BacktestTrade[];
  strategyStats: StrategyBacktestStats[];
  overall: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnlPercent: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    bestStrategy: string;
    worstStrategy: string;
  };
  equityCurve: { time: number; equity: number }[];
}

interface OpenPosition {
  strategyId: string;
  strategyName: string;
  direction: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  signalStrength: number;
}

/**
 * Run backtest on historical data
 */
export function runBacktest(
  symbol: string,
  candles1h: Candle[],
  candles4h: Candle[],
  options: {
    startEquity?: number;
    positionSizePercent?: number;
    maxOpenPositions?: number;
    minSignalStrength?: number;
  } = {}
): BacktestResult {
  const {
    startEquity = 10000,
    positionSizePercent = 2, // Risk 2% per trade
    maxOpenPositions = 5,
    minSignalStrength = 50,
  } = options;

  const trades: BacktestTrade[] = [];
  const openPositions: Map<string, OpenPosition> = new Map();
  const equityCurve: { time: number; equity: number }[] = [];
  
  let equity = startEquity;
  let peakEquity = startEquity;
  let maxDrawdown = 0;

  // We need enough candles for EMA200 to be valid
  const warmupPeriod = 200;
  
  if (candles1h.length < warmupPeriod + 50) {
    return createEmptyResult(symbol, candles1h);
  }

  // Process each 1h candle after warmup
  for (let i = warmupPeriod; i < candles1h.length; i++) {
    const currentCandle = candles1h[i];
    const historicalCandles1h = candles1h.slice(0, i + 1);
    
    // Find corresponding 4h candle
    const candle4hIndex = Math.floor(i / 4);
    const historicalCandles4h = candles4h.slice(0, candle4hIndex + 1);
    
    if (historicalCandles4h.length < 50) continue;

    // Check open positions for stop/target hits
    for (const [posKey, pos] of openPositions) {
      const isLong = pos.direction === 'long';
      let exitPrice: number | null = null;
      let outcome: 'win' | 'loss' = 'loss';

      // Check if stop was hit (use candle low/high)
      if (isLong && currentCandle.low <= pos.stopLoss) {
        exitPrice = pos.stopLoss;
        outcome = 'loss';
      } else if (!isLong && currentCandle.high >= pos.stopLoss) {
        exitPrice = pos.stopLoss;
        outcome = 'loss';
      }
      // Check if target was hit
      else if (isLong && currentCandle.high >= pos.takeProfit) {
        exitPrice = pos.takeProfit;
        outcome = 'win';
      } else if (!isLong && currentCandle.low <= pos.takeProfit) {
        exitPrice = pos.takeProfit;
        outcome = 'win';
      }

      if (exitPrice !== null) {
        const pnlPercent = isLong
          ? ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100
          : ((pos.entryPrice - exitPrice) / pos.entryPrice) * 100;

        const holdingHours = (currentCandle.time - pos.entryTime) / (1000 * 60 * 60);

        trades.push({
          id: `bt_${trades.length}`,
          symbol,
          strategyId: pos.strategyId,
          strategyName: pos.strategyName,
          direction: pos.direction,
          entryTime: pos.entryTime,
          entryPrice: pos.entryPrice,
          exitTime: currentCandle.time,
          exitPrice,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
          outcome,
          pnlPercent,
          holdingPeriodHours: holdingHours,
        });

        // Update equity
        const positionSize = equity * (positionSizePercent / 100);
        equity += positionSize * (pnlPercent / 100);

        openPositions.delete(posKey);
      }
    }

    // Track equity curve (every 4 hours)
    if (i % 4 === 0) {
      equityCurve.push({ time: currentCandle.time, equity });
      
      // Track max drawdown
      if (equity > peakEquity) {
        peakEquity = equity;
      }
      const drawdown = ((peakEquity - equity) / peakEquity) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Skip signal generation if we have max open positions
    if (openPositions.size >= maxOpenPositions) continue;

    // Run strategies on historical data
    try {
      const strategies = runStrategiesOnHistoricalData(
        symbol,
        historicalCandles1h,
        historicalCandles4h,
        currentCandle.close
      );

      // Look for new signals
      for (const strategy of strategies) {
        if (strategy.signal.type === 'NEUTRAL') continue;
        if (strategy.signal.strength < minSignalStrength) continue;
        if (!strategy.signal.entry || !strategy.signal.stop || !strategy.signal.target) continue;

        // Create position key
        const posKey = `${strategy.id}-${strategy.signal.type.includes('LONG') ? 'long' : 'short'}`;
        
        // Skip if we already have this position open
        if (openPositions.has(posKey)) continue;

        // Open new position
        openPositions.set(posKey, {
          strategyId: strategy.id,
          strategyName: strategy.name,
          direction: strategy.signal.type.includes('LONG') ? 'long' : 'short',
          entryTime: currentCandle.time,
          entryPrice: strategy.signal.entry,
          stopLoss: strategy.signal.stop,
          takeProfit: strategy.signal.target,
          signalStrength: strategy.signal.strength,
        });
      }
    } catch (e) {
      // Skip candles where strategy calculation fails
      continue;
    }
  }

  // Close any remaining open positions at last price
  const lastCandle = candles1h[candles1h.length - 1];
  for (const [posKey, pos] of openPositions) {
    const isLong = pos.direction === 'long';
    const pnlPercent = isLong
      ? ((lastCandle.close - pos.entryPrice) / pos.entryPrice) * 100
      : ((pos.entryPrice - lastCandle.close) / pos.entryPrice) * 100;

    trades.push({
      id: `bt_${trades.length}`,
      symbol,
      strategyId: pos.strategyId,
      strategyName: pos.strategyName,
      direction: pos.direction,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime: lastCandle.time,
      exitPrice: lastCandle.close,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      outcome: pnlPercent >= 0 ? 'win' : 'loss',
      pnlPercent,
      holdingPeriodHours: (lastCandle.time - pos.entryTime) / (1000 * 60 * 60),
    });
  }

  // Calculate strategy stats
  const strategyStats = calculateStrategyStats(trades);

  // Calculate overall stats
  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnlPercent, 0);

  // Find best/worst strategy
  const sortedStats = [...strategyStats].sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
  const bestStrategy = sortedStats[0]?.strategyName || 'N/A';
  const worstStrategy = sortedStats[sortedStats.length - 1]?.strategyName || 'N/A';

  // Calculate Sharpe ratio (simplified)
  const returns = trades.map(t => t.pnlPercent);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

  return {
    symbol,
    period: '1h',
    startDate: new Date(candles1h[warmupPeriod].time).toISOString(),
    endDate: new Date(candles1h[candles1h.length - 1].time).toISOString(),
    totalCandles: candles1h.length - warmupPeriod,
    trades,
    strategyStats,
    overall: {
      totalTrades: trades.length,
      wins,
      losses,
      winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
      totalPnlPercent: totalPnl,
      maxDrawdownPercent: maxDrawdown,
      sharpeRatio,
      bestStrategy,
      worstStrategy,
    },
    equityCurve,
  };
}

/**
 * Run strategies on historical candle data
 */
function runStrategiesOnHistoricalData(
  symbol: string,
  candles1h: Candle[],
  candles4h: Candle[],
  currentPrice: number
): StrategyResult[] {
  // Convert to OHLCV format
  const ohlcv1h: OHLCVData[] = candles1h.map(c => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    timestamp: c.time,
  }));
  
  const ohlcv4h: OHLCVData[] = candles4h.map(c => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    timestamp: c.time,
  }));
  
  // Build indicators
  const indicators1h = buildIndicators(ohlcv1h);
  const indicators4h = buildIndicators(ohlcv4h);
  
  // Create strategy input for 1h
  const input1h: StrategyInput = {
    symbol,
    price: currentPrice,
    candles: ohlcv1h,
    indicators: indicators1h,
    timeframe: '1h',
  };
  
  // Evaluate strategies
  const result1h = evaluateStrategies(input1h, { minStrength: 0 });
  
  // Optionally do multi-timeframe confirmation
  if (ohlcv4h.length > 50) {
    const input4h: StrategyInput = {
      symbol,
      price: currentPrice,
      candles: ohlcv4h,
      indicators: indicators4h,
      timeframe: '4h',
    };
    
    const result4h = evaluateStrategies(input4h, { minStrength: 0 });
    
    // Apply multi-timeframe confirmation
    return result1h.strategies.map(strat1h => {
      const strat4h = result4h.strategies.find(s => s.id === strat1h.id);
      
      if (!strat4h) return strat1h;
      
      const dir1h = strat1h.signal.type.includes('LONG') ? 'long' : 
                    strat1h.signal.type.includes('SHORT') ? 'short' : 'neutral';
      const dir4h = strat4h.signal.type.includes('LONG') ? 'long' : 
                    strat4h.signal.type.includes('SHORT') ? 'short' : 'neutral';
      
      // Both agree = boost
      if (dir1h === dir4h && dir1h !== 'neutral') {
        const boostedStrength = Math.min(strat1h.signal.strength + 15, 100);
        return {
          ...strat1h,
          signal: {
            ...strat1h.signal,
            strength: boostedStrength,
          },
        };
      }
      
      // Conflict = neutralize
      if (dir1h !== 'neutral' && dir4h !== 'neutral' && dir1h !== dir4h) {
        return {
          ...strat1h,
          signal: {
            ...strat1h.signal,
            type: 'NEUTRAL' as const,
            strength: 0,
          },
        };
      }
      
      // 4h neutral = reduce
      if (dir1h !== 'neutral' && dir4h === 'neutral') {
        return {
          ...strat1h,
          signal: {
            ...strat1h.signal,
            strength: Math.max(strat1h.signal.strength - 20, 0),
          },
        };
      }
      
      return strat1h;
    });
  }
  
  return result1h.strategies;
}

/**
 * Calculate per-strategy statistics
 */
function calculateStrategyStats(trades: BacktestTrade[]): StrategyBacktestStats[] {
  const statsMap = new Map<string, {
    trades: BacktestTrade[];
    wins: number;
    losses: number;
    totalWinPnl: number;
    totalLossPnl: number;
    consecutiveLosses: number;
    maxConsecutiveLosses: number;
    totalHoldingHours: number;
  }>();

  // Group trades by strategy
  for (const trade of trades) {
    if (!statsMap.has(trade.strategyId)) {
      statsMap.set(trade.strategyId, {
        trades: [],
        wins: 0,
        losses: 0,
        totalWinPnl: 0,
        totalLossPnl: 0,
        consecutiveLosses: 0,
        maxConsecutiveLosses: 0,
        totalHoldingHours: 0,
      });
    }

    const stats = statsMap.get(trade.strategyId)!;
    stats.trades.push(trade);
    stats.totalHoldingHours += trade.holdingPeriodHours;

    if (trade.outcome === 'win') {
      stats.wins++;
      stats.totalWinPnl += trade.pnlPercent;
      stats.consecutiveLosses = 0;
    } else {
      stats.losses++;
      stats.totalLossPnl += Math.abs(trade.pnlPercent);
      stats.consecutiveLosses++;
      if (stats.consecutiveLosses > stats.maxConsecutiveLosses) {
        stats.maxConsecutiveLosses = stats.consecutiveLosses;
      }
    }
  }

  // Build final stats
  const result: StrategyBacktestStats[] = [];

  for (const [strategyId, data] of statsMap) {
    const totalTrades = data.trades.length;
    const avgWinPercent = data.wins > 0 ? data.totalWinPnl / data.wins : 0;
    const avgLossPercent = data.losses > 0 ? data.totalLossPnl / data.losses : 0;
    const totalPnl = data.totalWinPnl - data.totalLossPnl;
    const profitFactor = data.totalLossPnl > 0 ? data.totalWinPnl / data.totalLossPnl : data.totalWinPnl > 0 ? Infinity : 0;
    const winRate = totalTrades > 0 ? (data.wins / totalTrades) * 100 : 0;
    const expectancy = totalTrades > 0 ? totalPnl / totalTrades : 0;

    result.push({
      strategyId,
      strategyName: data.trades[0]?.strategyName || strategyId,
      totalTrades,
      wins: data.wins,
      losses: data.losses,
      winRate,
      avgWinPercent,
      avgLossPercent,
      totalPnlPercent: totalPnl,
      profitFactor,
      maxConsecutiveLosses: data.maxConsecutiveLosses,
      avgHoldingHours: totalTrades > 0 ? data.totalHoldingHours / totalTrades : 0,
      expectancy,
    });
  }

  return result.sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
}

/**
 * Create empty result for insufficient data
 */
function createEmptyResult(symbol: string, candles: Candle[]): BacktestResult {
  return {
    symbol,
    period: '1h',
    startDate: candles.length > 0 ? new Date(candles[0].time).toISOString() : '',
    endDate: candles.length > 0 ? new Date(candles[candles.length - 1].time).toISOString() : '',
    totalCandles: candles.length,
    trades: [],
    strategyStats: [],
    overall: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlPercent: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      bestStrategy: 'N/A',
      worstStrategy: 'N/A',
    },
    equityCurve: [],
  };
}
