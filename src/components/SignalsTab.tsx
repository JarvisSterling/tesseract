'use client';

import { useState, useMemo } from 'react';
import { 
  TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, 
  Trash2, Filter, ChevronDown, ChevronUp, RotateCcw
} from 'lucide-react';
import { 
  TrackedSignal, 
  StrategyStats, 
  calculateStrategyStats,
  clearAllSignals 
} from '@/lib/signalTracker';

interface SignalsTabProps {
  signals: TrackedSignal[];
  onClearSignals: () => void;
  currentPrices?: Record<string, number>;  // symbol -> current price
}

type FilterMode = 'all' | 'open' | 'wins' | 'losses';
type SortField = 'time' | 'pnl' | 'strategy';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function formatDuration(openedAt: number, closedAt?: number): string {
  const end = closedAt || Date.now();
  const duration = end - openedAt;
  const hours = Math.floor(duration / (1000 * 60 * 60));
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function SignalRow({ signal, currentPrice, allPrices }: { signal: TrackedSignal; currentPrice?: number; allPrices?: Record<string, number> }) {
  const isLong = signal.type.includes('LONG');
  const isStrong = signal.type.includes('STRONG');
  const isOpen = signal.status === 'OPEN';
  
  // Try to get current price - handle both "BTC" and "BTCUSDT" formats
  let resolvedPrice = currentPrice;
  if (!resolvedPrice && allPrices) {
    const baseSymbol = signal.symbol.replace('USDT', '');
    resolvedPrice = allPrices[baseSymbol] || allPrices[signal.symbol];
  }
  
  // Calculate live P&L for open positions
  let displayPnl = signal.pnlPercent;
  let isLivePnl = false;
  
  if (isOpen && resolvedPrice && signal.entry) {
    isLivePnl = true;
    if (isLong) {
      displayPnl = ((resolvedPrice - signal.entry) / signal.entry) * 100;
    } else {
      displayPnl = ((signal.entry - resolvedPrice) / signal.entry) * 100;
    }
  }
  
  return (
    <tr className={`
      border-b border-zinc-800/30 transition-colors
      ${isOpen ? 'bg-zinc-900/30' : ''}
      ${signal.outcome === 'WIN' ? 'bg-emerald-500/5' : ''}
      ${signal.outcome === 'LOSS' ? 'bg-rose-500/5' : ''}
    `}>
      {/* Status */}
      <td className="py-2 px-2">
        {isOpen ? (
          <Clock size={14} className="text-amber-400 animate-pulse" />
        ) : signal.outcome === 'WIN' ? (
          <CheckCircle size={14} className="text-emerald-400" />
        ) : (
          <XCircle size={14} className="text-rose-400" />
        )}
      </td>
      
      {/* Symbol + Direction */}
      <td className="py-2 px-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-white text-[11px]">
            {signal.symbol}
          </span>
          <span className={`
            px-1 py-0.5 rounded text-[9px] font-bold
            ${isLong 
              ? 'bg-emerald-500/20 text-emerald-400' 
              : 'bg-rose-500/20 text-rose-400'
            }
          `}>
            {isStrong && '⚡'}{isLong ? 'L' : 'S'}
          </span>
        </div>
      </td>
      
      {/* Strategy */}
      <td className="py-2 px-2">
        <span className="text-[10px] text-zinc-400">{signal.strategyName}</span>
      </td>
      
      {/* Confidence */}
      <td className="py-2 px-2 text-center">
        <span className={`
          text-[10px] font-mono font-bold px-1.5 py-0.5 rounded
          ${signal.strength >= 70 
            ? 'bg-emerald-500/20 text-emerald-400' 
            : signal.strength >= 50 
              ? 'bg-amber-500/20 text-amber-400' 
              : 'bg-zinc-500/20 text-zinc-400'
          }
        `}>
          {signal.strength}%
        </span>
      </td>
      
      {/* Entry */}
      <td className="py-2 px-2 text-right">
        <span className="text-[10px] font-mono text-zinc-300">
          ${signal.entry.toFixed(2)}
        </span>
      </td>
      
      {/* Stop */}
      <td className="py-2 px-2 text-right">
        <span className="text-[10px] font-mono text-rose-400/70">
          ${signal.stop.toFixed(2)}
        </span>
      </td>
      
      {/* Target */}
      <td className="py-2 px-2 text-right">
        <span className="text-[10px] font-mono text-emerald-400/70">
          ${signal.target.toFixed(2)}
        </span>
      </td>
      
      {/* P&L */}
      <td className="py-2 px-2 text-right">
        {displayPnl !== undefined ? (
          <div className="flex items-center justify-end gap-1">
            {isLivePnl && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Live" />
            )}
            <span className={`
              text-[11px] font-mono font-bold
              ${displayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            `}>
              {displayPnl >= 0 ? '+' : ''}{displayPnl.toFixed(2)}%
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-zinc-500">—</span>
        )}
      </td>
      
      {/* Duration */}
      <td className="py-2 px-2 text-right">
        <span className="text-[9px] text-zinc-500">
          {formatDuration(signal.openedAt, signal.closedAt)}
        </span>
      </td>
      
      {/* Time */}
      <td className="py-2 px-2 text-right">
        <span className="text-[9px] text-zinc-600">
          {formatTime(signal.openedAt)}
        </span>
      </td>
    </tr>
  );
}

function StrategyStatsCard({ stats }: { stats: StrategyStats }) {
  const isProfit = stats.totalPnlPercent >= 0;
  
  return (
    <div className={`
      p-3 rounded-xl border transition-all
      ${isProfit 
        ? 'bg-emerald-500/5 border-emerald-500/20' 
        : 'bg-rose-500/5 border-rose-500/20'
      }
    `}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-white">{stats.strategyName}</span>
        <span className={`
          text-sm font-mono font-bold
          ${isProfit ? 'text-emerald-400' : 'text-rose-400'}
        `}>
          {isProfit ? '+' : ''}{stats.totalPnlPercent.toFixed(1)}%
        </span>
      </div>
      
      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <div>
          <div className="text-zinc-500">Trades</div>
          <div className="text-white font-mono">{stats.totalTrades}</div>
        </div>
        <div>
          <div className="text-zinc-500">Win Rate</div>
          <div className={`font-mono ${stats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {stats.winRate.toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Avg Win</div>
          <div className="text-emerald-400 font-mono">+{stats.avgWinPercent.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-zinc-500">Avg Loss</div>
          <div className="text-rose-400 font-mono">-{stats.avgLossPercent.toFixed(1)}%</div>
        </div>
      </div>
      
      {stats.openPositions > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-800/50">
          <span className="text-[9px] text-amber-400">
            {stats.openPositions} open position{stats.openPositions > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}

export function SignalsTab({ signals, onClearSignals, currentPrices = {} }: SignalsTabProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ 
    field: 'time', 
    dir: 'desc' 
  });
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  
  const stats = useMemo(() => calculateStrategyStats(signals), [signals]);
  
  // Debug: Log price data - ALWAYS show
  const priceKeys = Object.keys(currentPrices);
  const openSignals = signals.filter(s => s.status === 'OPEN');
  const debugInfo = `Live prices: ${priceKeys.length} symbols [${priceKeys.slice(0, 5).join(', ')}${priceKeys.length > 5 ? '...' : ''}] | Open positions: ${openSignals.length}`;
  
  const filteredSignals = useMemo(() => {
    let result = [...signals];
    
    switch (filter) {
      case 'open':
        result = result.filter(s => s.status === 'OPEN');
        break;
      case 'wins':
        result = result.filter(s => s.outcome === 'WIN');
        break;
      case 'losses':
        result = result.filter(s => s.outcome === 'LOSS');
        break;
    }
    
    result.sort((a, b) => {
      let aVal: number, bVal: number;
      
      switch (sort.field) {
        case 'time':
          aVal = a.openedAt;
          bVal = b.openedAt;
          break;
        case 'pnl':
          aVal = a.pnlPercent ?? 0;
          bVal = b.pnlPercent ?? 0;
          break;
        case 'strategy':
          return sort.dir === 'asc' 
            ? a.strategyName.localeCompare(b.strategyName)
            : b.strategyName.localeCompare(a.strategyName);
        default:
          return 0;
      }
      
      return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    
    return result;
  }, [signals, filter, sort]);
  
  const openCount = signals.filter(s => s.status === 'OPEN').length;
  const closedCount = signals.filter(s => s.status === 'CLOSED').length;
  const winCount = signals.filter(s => s.outcome === 'WIN').length;
  const lossCount = signals.filter(s => s.outcome === 'LOSS').length;
  const totalPnl = signals.reduce((sum, s) => sum + (s.pnlPercent || 0), 0);
  
  return (
    <div className="space-y-4">
      {/* Debug Info - Always visible */}
      <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded font-mono">
        🔍 {debugInfo}
      </div>
      
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Open</div>
          <div className="text-xl font-bold text-amber-400">{openCount}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Closed</div>
          <div className="text-xl font-bold text-white">{closedCount}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Wins</div>
          <div className="text-xl font-bold text-emerald-400">{winCount}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Losses</div>
          <div className="text-xl font-bold text-rose-400">{lossCount}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total P&L</div>
          <div className={`text-xl font-bold font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(1)}%
          </div>
        </div>
      </div>
      
      {/* Strategy Leaderboard */}
      {stats.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Strategy Performance
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.map(s => (
              <StrategyStatsCard key={s.strategyId} stats={s} />
            ))}
          </div>
        </div>
      )}
      
      {/* Filters & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['all', 'open', 'wins', 'losses'] as FilterMode[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`
                px-2 py-1 text-[10px] font-medium rounded-lg transition-all
                ${filter === f 
                  ? 'bg-indigo-500 text-white' 
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }
              `}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        
        <div className="flex gap-2">
          {showConfirmClear ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-rose-400">Clear all?</span>
              <button
                onClick={() => {
                  onClearSignals();
                  setShowConfirmClear(false);
                }}
                className="px-2 py-1 text-[10px] bg-rose-500 text-white rounded-lg hover:bg-rose-600"
              >
                Yes
              </button>
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-2 py-1 text-[10px] bg-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-600"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirmClear(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-500 hover:text-rose-400 transition-colors"
            >
              <Trash2 size={12} />
              Clear
            </button>
          )}
        </div>
      </div>
      
      {/* Signals Table */}
      {filteredSignals.length > 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-2 px-2 w-8"></th>
                  <th className="text-left py-2 px-2 text-[10px] text-zinc-500 font-semibold">Asset</th>
                  <th className="text-left py-2 px-2 text-[10px] text-zinc-500 font-semibold">Strategy</th>
                  <th className="text-center py-2 px-2 text-[10px] text-zinc-500 font-semibold">Conf</th>
                  <th className="text-right py-2 px-2 text-[10px] text-zinc-500 font-semibold">Entry</th>
                  <th className="text-right py-2 px-2 text-[10px] text-zinc-500 font-semibold">Stop</th>
                  <th className="text-right py-2 px-2 text-[10px] text-zinc-500 font-semibold">Target</th>
                  <th className="text-right py-2 px-2 text-[10px] text-zinc-500 font-semibold">P&L</th>
                  <th className="text-right py-2 px-2 text-[10px] text-zinc-500 font-semibold">Duration</th>
                  <th className="text-right py-2 px-2 text-[10px] text-zinc-500 font-semibold">Opened</th>
                </tr>
              </thead>
              <tbody>
                {filteredSignals.map(signal => (
                  <SignalRow 
                    key={signal.id} 
                    signal={signal} 
                    currentPrice={currentPrices[signal.symbol]}
                    allPrices={currentPrices}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-zinc-500">
          <TrendingUp size={48} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">No signals yet</p>
          <p className="text-xs mt-1">Signals will appear here when strategies fire</p>
        </div>
      )}
    </div>
  );
}
