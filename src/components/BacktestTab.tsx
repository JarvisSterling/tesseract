'use client';

import { useState, useCallback } from 'react';
import { 
  Play, Loader2, TrendingUp, TrendingDown, Target, AlertTriangle,
  Trophy, Skull, Clock, BarChart3, Zap
} from 'lucide-react';

interface BacktestTrade {
  id: string;
  symbol: string;
  strategyId: string;
  strategyName: string;
  direction: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  outcome: 'win' | 'loss' | 'breakeven';
  pnlPercent: number;
  holdingPeriodHours: number;
}

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
  period: string;
  startDate: string;
  endDate: string;
  totalCandles: number;
  trades: BacktestTrade[];
  strategyStats: StrategyStats[];
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

interface AggregatedResult {
  totalSymbols: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlPercent: number;
  avgPnlPerTrade: number;
  bestStrategy: string;
  strategyRankings: {
    strategyId: string;
    strategyName: string;
    totalTrades: number;
    winRate: number;
    totalPnlPercent: number;
  }[];
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'];

export function BacktestTab() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BacktestResult[] | null>(null);
  const [aggregated, setAggregated] = useState<AggregatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);

  const runBacktest = useCallback(async () => {
    if (selectedSymbols.length === 0) {
      setError('Select at least one symbol');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: selectedSymbols, days }),
      });

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'Backtest failed');
      }

      setResults(json.data.individual);
      setAggregated(json.data.aggregated);
      setActiveResultIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run backtest');
    } finally {
      setLoading(false);
    }
  }, [selectedSymbols, days]);

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const activeResult = results?.[activeResultIndex];

  return (
    <div className="space-y-6">
      {/* Config Panel */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 size={16} className="text-indigo-400" />
          Backtest Configuration
        </h3>

        {/* Symbol Selection */}
        <div className="mb-4">
          <label className="text-xs text-zinc-400 block mb-2">Symbols (max 5)</label>
          <div className="flex flex-wrap gap-2">
            {SYMBOLS.map(symbol => (
              <button
                key={symbol}
                onClick={() => toggleSymbol(symbol)}
                disabled={!selectedSymbols.includes(symbol) && selectedSymbols.length >= 5}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedSymbols.includes(symbol)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed'
                }`}
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>

        {/* Period Selection */}
        <div className="mb-4">
          <label className="text-xs text-zinc-400 block mb-2">Backtest Period</label>
          <div className="flex gap-2">
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  days === d
                    ? 'bg-purple-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Run Button */}
        <button
          onClick={runBacktest}
          disabled={loading || selectedSymbols.length === 0}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-indigo-500 hover:to-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Running Backtest...
            </>
          ) : (
            <>
              <Play size={18} />
              Run Backtest
            </>
          )}
        </button>

        {error && (
          <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {aggregated && (
        <>
          {/* Overall Stats */}
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Target size={16} className="text-emerald-400" />
              Overall Results ({aggregated.totalSymbols} symbols, {days} days)
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Trades"
                value={aggregated.totalTrades.toString()}
                icon={<BarChart3 size={16} />}
                color="text-blue-400"
              />
              <StatCard
                label="Win Rate"
                value={`${aggregated.winRate.toFixed(1)}%`}
                icon={aggregated.winRate >= 50 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                color={aggregated.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}
              />
              <StatCard
                label="Total P&L"
                value={`${aggregated.totalPnlPercent >= 0 ? '+' : ''}${aggregated.totalPnlPercent.toFixed(2)}%`}
                icon={aggregated.totalPnlPercent >= 0 ? <Trophy size={16} /> : <Skull size={16} />}
                color={aggregated.totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}
              />
              <StatCard
                label="Best Strategy"
                value={aggregated.bestStrategy}
                icon={<Zap size={16} />}
                color="text-amber-400"
              />
            </div>
          </div>

          {/* Strategy Rankings */}
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Trophy size={16} className="text-amber-400" />
              Strategy Leaderboard
            </h3>

            <div className="space-y-2">
              {aggregated.strategyRankings.map((strat, i) => (
                <div
                  key={strat.strategyId}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    i === 0 ? 'bg-amber-500/10 border border-amber-500/30' :
                    strat.totalPnlPercent >= 0 ? 'bg-zinc-800/50' : 'bg-rose-500/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      i === 0 ? 'bg-amber-500 text-black' :
                      i === 1 ? 'bg-zinc-400 text-black' :
                      i === 2 ? 'bg-amber-700 text-white' :
                      'bg-zinc-700 text-zinc-300'
                    }`}>
                      {i + 1}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-white">{strat.strategyName}</div>
                      <div className="text-[10px] text-zinc-500">
                        {strat.totalTrades} trades • {strat.winRate.toFixed(0)}% win rate
                      </div>
                    </div>
                  </div>
                  <div className={`text-sm font-mono font-bold ${
                    strat.totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {strat.totalPnlPercent >= 0 ? '+' : ''}{strat.totalPnlPercent.toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Individual Symbol Results */}
          {results && results.length > 0 && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-4">Per-Symbol Breakdown</h3>

              {/* Symbol Tabs */}
              <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                {results.map((result, i) => (
                  <button
                    key={result.symbol}
                    onClick={() => setActiveResultIndex(i)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                      i === activeResultIndex
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {result.symbol}
                    <span className={`ml-2 text-xs ${
                      result.overall.totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {result.overall.totalPnlPercent >= 0 ? '+' : ''}{result.overall.totalPnlPercent.toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>

              {/* Active Symbol Stats */}
              {activeResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <MiniStat label="Trades" value={activeResult.overall.totalTrades} />
                    <MiniStat label="Wins" value={activeResult.overall.wins} color="text-emerald-400" />
                    <MiniStat label="Losses" value={activeResult.overall.losses} color="text-rose-400" />
                    <MiniStat label="Win Rate" value={`${activeResult.overall.winRate.toFixed(0)}%`} />
                    <MiniStat label="Max DD" value={`-${activeResult.overall.maxDrawdownPercent.toFixed(1)}%`} color="text-rose-400" />
                  </div>

                  {/* Equity Curve */}
                  {activeResult.equityCurve.length > 0 && (
                    <div className="bg-zinc-800/50 rounded-lg p-4">
                      <div className="text-xs text-zinc-400 mb-2">Equity Curve</div>
                      <div className="h-32 flex items-end gap-0.5">
                        {activeResult.equityCurve.slice(-50).map((point, i, arr) => {
                          const min = Math.min(...arr.map(p => p.equity));
                          const max = Math.max(...arr.map(p => p.equity));
                          const range = max - min || 1;
                          const height = ((point.equity - min) / range) * 100;
                          const isUp = point.equity >= 10000;
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded-t ${isUp ? 'bg-emerald-500' : 'bg-rose-500'}`}
                              style={{ height: `${Math.max(height, 2)}%` }}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                        <span>$10,000</span>
                        <span>${activeResult.equityCurve[activeResult.equityCurve.length - 1]?.equity.toFixed(0) || '10,000'}</span>
                      </div>
                    </div>
                  )}

                  {/* Recent Trades */}
                  <div>
                    <div className="text-xs text-zinc-400 mb-2">Recent Trades</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {activeResult.trades.slice(-10).reverse().map(trade => (
                        <div
                          key={trade.id}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                            trade.outcome === 'win' ? 'bg-emerald-500/10' : 'bg-rose-500/10'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              trade.direction === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                            }`}>
                              {trade.direction.toUpperCase()}
                            </span>
                            <span className="text-zinc-400">{trade.strategyName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500">
                              {trade.holdingPeriodHours.toFixed(0)}h
                            </span>
                            <span className={`font-mono font-bold ${
                              trade.outcome === 'win' ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                              {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && !results && (
        <div className="text-center py-12 text-zinc-500">
          <BarChart3 size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-sm">Configure and run a backtest to see results</p>
          <p className="text-xs text-zinc-600 mt-1">Tests your strategies against historical data</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  icon, 
  color 
}: { 
  label: string; 
  value: string; 
  icon: React.ReactNode; 
  color: string;
}) {
  return (
    <div className="bg-zinc-800/50 rounded-xl p-4">
      <div className={`${color} mb-2`}>{icon}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function MiniStat({ 
  label, 
  value, 
  color = 'text-white' 
}: { 
  label: string; 
  value: string | number; 
  color?: string;
}) {
  return (
    <div className="bg-zinc-800/30 rounded-lg p-2 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}
