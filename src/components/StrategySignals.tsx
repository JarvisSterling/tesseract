'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Target, TrendingUp, TrendingDown, Zap, BarChart3, GitBranch } from 'lucide-react';

interface StrategySignal {
  type: 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';
  strength: number;
  entry?: number;
  stop?: number;
  target?: number;
  reasons: string[];
}

interface StrategyResult {
  id: string;
  name: string;
  category: 'swing' | 'scalp' | 'breakout' | 'reversal';
  signal: StrategySignal;
}

interface StrategySignalsProps {
  strategies: StrategyResult[];
  compact?: boolean;
}

const STRATEGY_ICONS: Record<string, React.ReactNode> = {
  'ribbon-rider': <TrendingUp size={12} />,
  'compression-cannon': <Zap size={12} />,
  'dynamic-bounce': <BarChart3 size={12} />,
  'crossover-cascade': <GitBranch size={12} />,
  'divergence-hunter': <Target size={12} />,
};

const CATEGORY_COLORS: Record<string, string> = {
  swing: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  scalp: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  breakout: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  reversal: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
};

function SignalBadge({ signal }: { signal: StrategySignal }) {
  const isLong = signal.type.includes('LONG');
  const isShort = signal.type.includes('SHORT');
  const isStrong = signal.type.includes('STRONG');
  
  if (!isLong && !isShort) {
    return (
      <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-zinc-700/50 text-zinc-500">
        WAIT
      </span>
    );
  }
  
  const baseClass = isLong
    ? isStrong ? 'bg-emerald-500 text-white' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
    : isStrong ? 'bg-rose-500 text-white' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40';
  
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${baseClass}`}>
      {isStrong && '⚡'}{isLong ? 'LONG' : 'SHORT'}
    </span>
  );
}

function StrengthBar({ strength }: { strength: number }) {
  const color = strength >= 70 ? 'bg-emerald-500' : strength >= 50 ? 'bg-amber-500' : 'bg-zinc-600';
  
  return (
    <div className="flex items-center gap-1">
      <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all`}
          style={{ width: `${strength}%` }}
        />
      </div>
      <span className="text-[9px] text-zinc-500 w-6">{strength}%</span>
    </div>
  );
}

export function StrategySignals({ strategies, compact = false }: StrategySignalsProps) {
  const [expanded, setExpanded] = useState(false);
  
  // Filter to only show active signals
  const activeStrategies = strategies.filter(s => s.signal.type !== 'NEUTRAL');
  const hasSignals = activeStrategies.length > 0;
  
  // Get strongest signal for compact view
  const strongest = activeStrategies.reduce<StrategyResult | null>((best, curr) => {
    if (!best || curr.signal.strength > best.signal.strength) return curr;
    return best;
  }, null);
  
  if (compact) {
    return (
      <div className="flex flex-col gap-0.5">
        {hasSignals ? (
          <>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-500">{activeStrategies.length} active</span>
            </div>
            {strongest && (
              <div className="flex items-center gap-1">
                {STRATEGY_ICONS[strongest.id]}
                <SignalBadge signal={strongest.signal} />
              </div>
            )}
          </>
        ) : (
          <span className="text-[9px] text-zinc-600">No signals</span>
        )}
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-[10px] text-zinc-400 hover:text-white transition-colors"
      >
        <span className="font-semibold uppercase tracking-wider">
          Strategies ({activeStrategies.length}/{strategies.length} active)
        </span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      
      {/* Expanded view */}
      {expanded && (
        <div className="space-y-1.5">
          {strategies.map(strategy => (
            <div 
              key={strategy.id}
              className={`p-2 rounded-lg border ${
                strategy.signal.type !== 'NEUTRAL' 
                  ? 'bg-zinc-900/50 border-zinc-700/50' 
                  : 'bg-zinc-900/20 border-zinc-800/30 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400">
                    {STRATEGY_ICONS[strategy.id]}
                  </span>
                  <span className="text-[10px] font-medium text-white">
                    {strategy.name}
                  </span>
                  <span className={`px-1 py-0.5 text-[8px] rounded border ${CATEGORY_COLORS[strategy.category]}`}>
                    {strategy.category}
                  </span>
                </div>
                <SignalBadge signal={strategy.signal} />
              </div>
              
              <StrengthBar strength={strategy.signal.strength} />
              
              {strategy.signal.reasons.length > 0 && strategy.signal.type !== 'NEUTRAL' && (
                <div className="mt-1.5 space-y-0.5">
                  {strategy.signal.reasons.slice(0, 3).map((reason, i) => (
                    <div key={i} className="text-[9px] text-zinc-500 flex items-start gap-1">
                      <span className="text-zinc-600">•</span>
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Entry/Stop/Target */}
              {strategy.signal.entry && strategy.signal.type !== 'NEUTRAL' && (
                <div className="mt-1.5 flex gap-2 text-[9px]">
                  {strategy.signal.entry && (
                    <span className="text-zinc-400">
                      Entry: <span className="text-white">${strategy.signal.entry.toFixed(2)}</span>
                    </span>
                  )}
                  {strategy.signal.stop && (
                    <span className="text-zinc-400">
                      Stop: <span className="text-rose-400">${strategy.signal.stop.toFixed(2)}</span>
                    </span>
                  )}
                  {strategy.signal.target && (
                    <span className="text-zinc-400">
                      Target: <span className="text-emerald-400">${strategy.signal.target.toFixed(2)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Collapsed summary */}
      {!expanded && hasSignals && (
        <div className="flex flex-wrap gap-1">
          {activeStrategies.map(strategy => (
            <div 
              key={strategy.id}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/50 border border-zinc-800/50"
              title={`${strategy.name}: ${strategy.signal.type} (${strategy.signal.strength}%)`}
            >
              <span className="text-zinc-500">{STRATEGY_ICONS[strategy.id]}</span>
              <SignalBadge signal={strategy.signal} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact inline version for table cells
export function StrategyBadges({ strategies }: { strategies: StrategyResult[] }) {
  const activeStrategies = strategies.filter(s => s.signal.type !== 'NEUTRAL');
  
  if (activeStrategies.length === 0) {
    return <span className="text-[9px] text-zinc-600">—</span>;
  }
  
  // Group by direction
  const longs = activeStrategies.filter(s => s.signal.type.includes('LONG'));
  const shorts = activeStrategies.filter(s => s.signal.type.includes('SHORT'));
  
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex gap-0.5">
        {longs.length > 0 && (
          <span className="px-1 py-0.5 text-[9px] font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            {longs.length}🟢
          </span>
        )}
        {shorts.length > 0 && (
          <span className="px-1 py-0.5 text-[9px] font-bold rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
            {shorts.length}🔴
          </span>
        )}
      </div>
      <span className="text-[8px] text-zinc-600">{activeStrategies.length} signals</span>
    </div>
  );
}
