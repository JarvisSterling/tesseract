'use client';

import { useMemo, useRef, useEffect } from 'react';
import { createChart, ColorType, IChartApi, AreaSeries, HistogramSeries } from 'lightweight-charts';
import { TrendingUp, TrendingDown, Target, Percent, Clock, Award, AlertTriangle } from 'lucide-react';
import { TrackedSignal, calculateStrategyStats, StrategyStats } from '@/lib/signalTracker';

interface StatsTabProps {
  signals: TrackedSignal[];
}

// ============================================
// EQUITY CURVE CHART
// ============================================

function EquityCurve({ signals }: { signals: TrackedSignal[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  const equityData = useMemo(() => {
    // Sort closed signals by close time
    const closed = signals
      .filter(s => s.status === 'CLOSED' && s.closedAt && s.pnlPercent !== undefined)
      .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
    
    if (closed.length === 0) return [];
    
    let cumulative = 100; // Start at 100%
    return closed.map(s => {
      cumulative += s.pnlPercent || 0;
      return {
        time: Math.floor((s.closedAt || 0) / 1000) as any,
        value: cumulative,
      };
    });
  }, [signals]);
  
  useEffect(() => {
    if (!containerRef.current || equityData.length < 2) return;
    
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1aa',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      rightPriceScale: {
        borderColor: '#27272a',
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
      },
      crosshair: {
        mode: 1,
      },
    });
    
    chartRef.current = chart;
    
    const isUp = equityData[equityData.length - 1].value >= 100;
    const color = isUp ? '#10b981' : '#f43f5e';
    
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}40`,
      bottomColor: 'transparent',
      lineWidth: 2,
    });
    
    series.setData(equityData);
    chart.timeScale().fitContent();
    
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: 250,
        });
      }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [equityData]);
  
  if (equityData.length < 2) {
    return (
      <div className="h-[250px] flex items-center justify-center text-zinc-500 text-sm">
        Need at least 2 closed trades to show equity curve
      </div>
    );
  }
  
  return <div ref={containerRef} className="w-full h-[250px]" />;
}

// ============================================
// P&L HISTOGRAM
// ============================================

function PnLHistogram({ signals }: { signals: TrackedSignal[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  const histogramData = useMemo(() => {
    const closed = signals
      .filter(s => s.status === 'CLOSED' && s.closedAt && s.pnlPercent !== undefined)
      .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
    
    return closed.map(s => ({
      time: Math.floor((s.closedAt || 0) / 1000) as any,
      value: s.pnlPercent || 0,
      color: (s.pnlPercent || 0) >= 0 ? '#10b981' : '#f43f5e',
    }));
  }, [signals]);
  
  useEffect(() => {
    if (!containerRef.current || histogramData.length < 1) return;
    
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1aa',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      rightPriceScale: {
        borderColor: '#27272a',
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
      },
    });
    
    chartRef.current = chart;
    
    const series = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'percent',
      },
    });
    
    series.setData(histogramData);
    chart.timeScale().fitContent();
    
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: 150,
        });
      }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [histogramData]);
  
  if (histogramData.length < 1) {
    return (
      <div className="h-[150px] flex items-center justify-center text-zinc-500 text-sm">
        No closed trades yet
      </div>
    );
  }
  
  return <div ref={containerRef} className="w-full h-[150px]" />;
}

// ============================================
// STAT CARD
// ============================================

function StatCard({ 
  icon, 
  label, 
  value, 
  subValue,
  color = 'text-white',
  bgColor = 'bg-zinc-800/50'
}: { 
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  color?: string;
  bgColor?: string;
}) {
  return (
    <div className={`${bgColor} rounded-xl p-4 border border-zinc-700/30`}>
      <div className="flex items-center gap-2 text-zinc-500 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      {subValue && <div className="text-[10px] text-zinc-500 mt-0.5">{subValue}</div>}
    </div>
  );
}

// ============================================
// STRATEGY ROW
// ============================================

function StrategyRow({ stats, rank }: { stats: StrategyStats; rank: number }) {
  const isProfit = stats.totalPnlPercent >= 0;
  
  return (
    <tr className={`border-b border-zinc-800/30 ${isProfit ? 'bg-emerald-500/5' : 'bg-rose-500/5'}`}>
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <span className={`
            w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
            ${rank === 1 ? 'bg-amber-500 text-black' : 
              rank === 2 ? 'bg-zinc-400 text-black' : 
              rank === 3 ? 'bg-amber-700 text-white' : 'bg-zinc-700 text-zinc-400'}
          `}>
            {rank}
          </span>
          <span className="text-sm font-medium text-white">{stats.strategyName}</span>
        </div>
      </td>
      <td className="py-3 px-3 text-center">
        <span className="text-sm font-mono text-zinc-300">{stats.totalTrades}</span>
      </td>
      <td className="py-3 px-3 text-center">
        <span className="text-sm font-mono text-emerald-400">{stats.wins}</span>
      </td>
      <td className="py-3 px-3 text-center">
        <span className="text-sm font-mono text-rose-400">{stats.losses}</span>
      </td>
      <td className="py-3 px-3 text-center">
        <span className={`text-sm font-mono font-bold ${stats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {stats.winRate.toFixed(1)}%
        </span>
      </td>
      <td className="py-3 px-3 text-center">
        <span className="text-sm font-mono text-emerald-400">+{stats.avgWinPercent.toFixed(2)}%</span>
      </td>
      <td className="py-3 px-3 text-center">
        <span className="text-sm font-mono text-rose-400">-{stats.avgLossPercent.toFixed(2)}%</span>
      </td>
      <td className="py-3 px-3 text-center">
        <span className={`text-sm font-mono ${stats.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
        </span>
      </td>
      <td className="py-3 px-3 text-right">
        <span className={`text-sm font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isProfit ? '+' : ''}{stats.totalPnlPercent.toFixed(2)}%
        </span>
      </td>
    </tr>
  );
}

// ============================================
// MAIN STATS TAB
// ============================================

export function StatsTab({ signals }: StatsTabProps) {
  const closedSignals = signals.filter(s => s.status === 'CLOSED');
  const stats = useMemo(() => calculateStrategyStats(signals), [signals]);
  
  // Calculate overall stats
  const overallStats = useMemo(() => {
    const wins = closedSignals.filter(s => s.outcome === 'WIN');
    const losses = closedSignals.filter(s => s.outcome === 'LOSS');
    const totalPnl = closedSignals.reduce((sum, s) => sum + (s.pnlPercent || 0), 0);
    const winRate = closedSignals.length > 0 ? (wins.length / closedSignals.length) * 100 : 0;
    
    const avgWin = wins.length > 0 
      ? wins.reduce((sum, s) => sum + (s.pnlPercent || 0), 0) / wins.length 
      : 0;
    const avgLoss = losses.length > 0 
      ? Math.abs(losses.reduce((sum, s) => sum + (s.pnlPercent || 0), 0) / losses.length)
      : 0;
    
    const profitFactor = avgLoss > 0 ? (wins.length * avgWin) / (losses.length * avgLoss) : 
                         wins.length > 0 ? Infinity : 0;
    
    // Calculate max drawdown
    let peak = 100;
    let maxDrawdown = 0;
    let cumulative = 100;
    
    const sortedClosed = [...closedSignals].sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
    for (const s of sortedClosed) {
      cumulative += s.pnlPercent || 0;
      if (cumulative > peak) peak = cumulative;
      const drawdown = ((peak - cumulative) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    // Average trade duration
    const avgDuration = closedSignals.length > 0
      ? closedSignals.reduce((sum, s) => sum + ((s.closedAt || 0) - s.openedAt), 0) / closedSignals.length
      : 0;
    const avgDurationHours = avgDuration / (1000 * 60 * 60);
    
    return {
      totalTrades: closedSignals.length,
      openTrades: signals.filter(s => s.status === 'OPEN').length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgWin,
      avgLoss,
      totalPnl,
      profitFactor,
      maxDrawdown,
      avgDurationHours,
      bestTrade: closedSignals.reduce((best, s) => (s.pnlPercent || 0) > (best?.pnlPercent || -Infinity) ? s : best, null as TrackedSignal | null),
      worstTrade: closedSignals.reduce((worst, s) => (s.pnlPercent || 0) < (worst?.pnlPercent || Infinity) ? s : worst, null as TrackedSignal | null),
    };
  }, [signals, closedSignals]);
  
  if (signals.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <Target size={48} className="mx-auto mb-4 opacity-20" />
        <p className="text-lg font-medium">No Trading Data Yet</p>
        <p className="text-sm mt-1">Stats will appear once strategies start firing signals</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard
          icon={<Target size={14} />}
          label="Total Trades"
          value={overallStats.totalTrades}
          subValue={`${overallStats.openTrades} open`}
        />
        <StatCard
          icon={<Percent size={14} />}
          label="Win Rate"
          value={`${overallStats.winRate.toFixed(1)}%`}
          subValue={`${overallStats.wins}W / ${overallStats.losses}L`}
          color={overallStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="Total P&L"
          value={`${overallStats.totalPnl >= 0 ? '+' : ''}${overallStats.totalPnl.toFixed(2)}%`}
          color={overallStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatCard
          icon={<Award size={14} />}
          label="Profit Factor"
          value={overallStats.profitFactor === Infinity ? '∞' : overallStats.profitFactor.toFixed(2)}
          subValue="Gross W / Gross L"
          color={overallStats.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatCard
          icon={<AlertTriangle size={14} />}
          label="Max Drawdown"
          value={`-${overallStats.maxDrawdown.toFixed(1)}%`}
          color="text-rose-400"
        />
        <StatCard
          icon={<Clock size={14} />}
          label="Avg Duration"
          value={overallStats.avgDurationHours < 1 
            ? `${(overallStats.avgDurationHours * 60).toFixed(0)}m`
            : `${overallStats.avgDurationHours.toFixed(1)}h`
          }
        />
      </div>
      
      {/* Best/Worst Trades */}
      {(overallStats.bestTrade || overallStats.worstTrade) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {overallStats.bestTrade && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold mb-1">
                🏆 Best Trade
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white font-bold">{overallStats.bestTrade.symbol}</span>
                  <span className="text-zinc-500 text-sm ml-2">{overallStats.bestTrade.strategyName}</span>
                </div>
                <span className="text-emerald-400 font-mono font-bold text-lg">
                  +{overallStats.bestTrade.pnlPercent?.toFixed(2)}%
                </span>
              </div>
            </div>
          )}
          {overallStats.worstTrade && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
              <div className="text-[10px] text-rose-400 uppercase tracking-wider font-semibold mb-1">
                💀 Worst Trade
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white font-bold">{overallStats.worstTrade.symbol}</span>
                  <span className="text-zinc-500 text-sm ml-2">{overallStats.worstTrade.strategyName}</span>
                </div>
                <span className="text-rose-400 font-mono font-bold text-lg">
                  {overallStats.worstTrade.pnlPercent?.toFixed(2)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            📈 Equity Curve
          </h3>
          <EquityCurve signals={signals} />
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            📊 Trade P&L Distribution
          </h3>
          <PnLHistogram signals={signals} />
        </div>
      </div>
      
      {/* Strategy Leaderboard */}
      {stats.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-white">🏆 Strategy Leaderboard</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-2 px-3 text-[10px] text-zinc-500 font-semibold">Strategy</th>
                  <th className="text-center py-2 px-3 text-[10px] text-zinc-500 font-semibold">Trades</th>
                  <th className="text-center py-2 px-3 text-[10px] text-zinc-500 font-semibold">Wins</th>
                  <th className="text-center py-2 px-3 text-[10px] text-zinc-500 font-semibold">Losses</th>
                  <th className="text-center py-2 px-3 text-[10px] text-zinc-500 font-semibold">Win Rate</th>
                  <th className="text-center py-2 px-3 text-[10px] text-zinc-500 font-semibold">Avg Win</th>
                  <th className="text-center py-2 px-3 text-[10px] text-zinc-500 font-semibold">Avg Loss</th>
                  <th className="text-center py-2 px-3 text-[10px] text-zinc-500 font-semibold">Profit Factor</th>
                  <th className="text-right py-2 px-3 text-[10px] text-zinc-500 font-semibold">Total P&L</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => (
                  <StrategyRow key={s.strategyId} stats={s} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
