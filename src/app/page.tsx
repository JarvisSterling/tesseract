'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  RefreshCw, Volume2, VolumeX, ExternalLink, TrendingUp, TrendingDown, 
  Wifi, WifiOff, ArrowUpDown, Filter, ChevronUp, ChevronDown, BarChart3
} from 'lucide-react';
import { useBinanceWebSocket } from '@/hooks/useBinanceWebSocket';
import { MiniCandleChart } from '@/components/MiniCandleChart';
import { ChartModal } from '@/components/ChartModal';
import { TradingSessions } from '@/components/TradingSessions';
import { PairSelector, loadSavedPairs, DEFAULT_PAIRS } from '@/components/PairSelector';
import { StrategyBadges } from '@/components/StrategySignals';
import { TabNav, TabId } from '@/components/TabNav';
import { SignalsTab } from '@/components/SignalsTab';
import { StatsTab } from '@/components/StatsTab';
import { 
  TrackedSignal, 
  loadSignals, 
  saveSignals, 
  addSignal, 
  checkSignalOutcomes,
  clearAllSignals 
} from '@/lib/signalTracker';

// ============================================
// TYPES
// ============================================

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

interface TimeframeData {
  stack: 'bull' | 'bear' | 'mixed';
  priceVsEma: Record<number, number | null>;
  trend: string;
  emas?: Record<number, number | null>; // EMA values for live recalculation
}

interface CryptoData {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  timeframes: Record<string, TimeframeData>;
  confluence: { score: number; signal: string };
  tradeSignal: { signal: string; confidence: number; reasons: string[] };
  rsi: Record<string, number | null>;
  recentPrices: number[];
  strategies: StrategyResult[];
  volume?: { ratio: number; trend: 'high' | 'normal' | 'low' };
  atr?: { value: number | null; percent: number | null };
  livePrice?: number;
  liveChange24h?: number;
  liveEMAs?: Record<number, number>;
}

type SortField = 'symbol' | 'price' | 'change' | 'signal' | 'confluence' | 'rsi' | 'strategies' | 'volume' | 'atr' | 'heat';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'long' | 'short' | 'strong';

// ============================================
// CONSTANTS
// ============================================

const VISIBLE_TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const EMA_PERIODS = [9, 21, 50];

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

// Calculate live price vs EMA percentage
function calcLivePriceVsEma(ema: number | null | undefined, livePrice: number): number | null {
  if (!ema || ema === 0) return null;
  return ((livePrice - ema) / ema) * 100;
}

// Calculate live stack based on current price and EMAs
function calcLiveStack(emas: Record<number, number | null> | undefined, livePrice: number): 'bull' | 'bear' | 'mixed' {
  if (!emas) return 'mixed';
  const periods = [9, 21, 50, 100, 200];
  const values = periods.map(p => emas[p]).filter((v): v is number => v !== null);
  if (values.length < 3) return 'mixed';
  
  const allWithPrice = [livePrice, ...values];
  let bull = true, bear = true;
  for (let i = 0; i < allWithPrice.length - 1; i++) {
    if (allWithPrice[i] <= allWithPrice[i + 1]) bull = false;
    if (allWithPrice[i] >= allWithPrice[i + 1]) bear = false;
  }
  return bull ? 'bull' : bear ? 'bear' : 'mixed';
}

function getRSIColor(rsi: number | null): string {
  if (rsi === null) return 'text-zinc-500';
  if (rsi >= 70) return 'text-rose-400';
  if (rsi <= 30) return 'text-emerald-400';
  if (rsi >= 60) return 'text-orange-400';
  if (rsi <= 40) return 'text-teal-400';
  return 'text-zinc-300';
}

function getRSIBg(rsi: number | null): string {
  if (rsi === null) return 'bg-zinc-800';
  if (rsi >= 70) return 'bg-rose-500/20';
  if (rsi <= 30) return 'bg-emerald-500/20';
  return 'bg-zinc-800/50';
}

// ============================================
// COMPONENTS
// ============================================

function StackBadge({ stack }: { stack: 'bull' | 'bear' | 'mixed' }) {
  const styles = {
    bull: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    bear: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
    mixed: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30',
  };
  
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${styles[stack]}`}>
      {stack === 'bull' ? '▲' : stack === 'bear' ? '▼' : '●'}
    </span>
  );
}

function SignalBadge({ signal, confidence }: { signal: string; confidence: number }) {
  const isLong = signal.includes('LONG');
  const isShort = signal.includes('SHORT');
  const isStrong = signal.includes('STRONG');
  
  if (!isLong && !isShort) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-zinc-700/50 text-zinc-400 border border-zinc-600/30">
          WAIT
        </span>
      </div>
    );
  }
  
  const bgClass = isLong
    ? isStrong 
      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-500/25' 
      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
    : isStrong 
      ? 'bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-sm shadow-rose-500/25' 
      : 'bg-rose-500/20 text-rose-400 border border-rose-500/40';
  
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${bgClass}`}>
        {isStrong && '⚡'}{isLong ? 'LONG' : 'SHORT'}
      </span>
      <span className="text-[9px] text-zinc-500 font-mono">{confidence}%</span>
    </div>
  );
}

function RSIGauge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-600 text-xs">-</span>;
  
  const percentage = value;
  const isOverbought = value >= 70;
  const isOversold = value <= 30;
  
  return (
    <div className={`flex flex-col items-center gap-0.5 px-1.5 py-0.5 rounded ${getRSIBg(value)}`}>
      <span className={`text-xs font-mono ${getRSIColor(value)}`}>
        {value.toFixed(0)}
      </span>
      <div className="w-8 h-0.5 bg-zinc-700 rounded-full overflow-hidden">
        <div 
          className={`h-full transition-all ${
            isOverbought ? 'bg-rose-500' : isOversold ? 'bg-emerald-500' : 'bg-blue-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function PriceVsEMACell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-600 text-xs">-</span>;
  
  const absVal = Math.abs(value);
  const isPositive = value > 0;
  const isNoise = absVal < 0.5;
  const isExtended = absVal > 3;
  const isVeryExtended = absVal > 5;
  
  if (isNoise) {
    return <span className="text-zinc-500 text-xs font-mono">{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
  }
  
  let classes = 'text-xs font-mono px-1.5 py-0.5 rounded ';
  
  if (isVeryExtended) {
    classes += isPositive 
      ? 'bg-emerald-500/40 text-emerald-300 font-bold' 
      : 'bg-rose-500/40 text-rose-300 font-bold';
  } else if (isExtended) {
    classes += isPositive 
      ? 'bg-emerald-500/20 text-emerald-400' 
      : 'bg-rose-500/20 text-rose-400';
  } else {
    classes += isPositive ? 'text-emerald-400' : 'text-rose-400';
  }
  
  return (
    <span className={classes}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

function SortHeader({ 
  label, 
  field, 
  currentSort, 
  onSort 
}: { 
  label: string; 
  field: SortField; 
  currentSort: { field: SortField; dir: SortDir };
  onSort: (field: SortField) => void;
}) {
  const isActive = currentSort.field === field;
  
  return (
    <button 
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-[10px] font-semibold transition-colors ${
        isActive ? 'text-blue-400' : 'text-zinc-400 hover:text-white'
      }`}
    >
      {label}
      {isActive && (
        currentSort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
      )}
    </button>
  );
}

function FilterButton({ 
  label, 
  active, 
  count, 
  color, 
  onClick 
}: { 
  label: string; 
  active: boolean; 
  count: number; 
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active 
          ? `${color} text-white shadow-lg` 
          : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-white'
      }`}
    >
      {label}
      <span className={`px-1.5 py-0.5 rounded text-[10px] ${active ? 'bg-white/20' : 'bg-zinc-700'}`}>
        {count}
      </span>
    </button>
  );
}

function ConnectionStatus({ connected, lastUpdate }: { connected: boolean; lastUpdate: number }) {
  const timeSince = lastUpdate ? Math.floor((Date.now() - lastUpdate) / 1000) : null;
  
  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        connected 
          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' 
          : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
      }`}>
        {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
        <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
      </div>
      {connected && (
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      )}
    </div>
  );
}

// ============================================
// MAIN DASHBOARD
// ============================================

export default function Dashboard() {
  const [data, setData] = useState<CryptoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastApiUpdate, setLastApiUpdate] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [visibleTFs, setVisibleTFs] = useState(['5m', '15m', '1h', '4h']);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'confluence', dir: 'desc' });
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoData | null>(null);
  // Initialize watchlist synchronously from localStorage to prevent flash
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tesseract-watchlist');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return DEFAULT_PAIRS;
  });
  
  // Tab & Signal tracking state
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [trackedSignals, setTrackedSignals] = useState<TrackedSignal[]>([]);
  const processedSignalsRef = useRef<Set<string>>(new Set());
  
  // Load tracked signals on mount
  useEffect(() => {
    setTrackedSignals(loadSignals());
  }, []);
  
  // Sound alert for new signals
  const playAlertSound = useCallback(() => {
    if (typeof window !== 'undefined' && soundEnabled) {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkpOQhXZwaHN+iZGTkIV0bGZxfYmSk5CFdGxmcX2JkpOQhXRsZnF9iZKTkIV0bGZxfYmSk5CFdGxmcX2JkpOQhQ==');
      audio.volume = 0.3;
      audio.play().catch(() => {}); // Ignore errors
    }
  }, [soundEnabled]);
  
  // Track previous signal count for alert detection
  const prevSignalCountRef = useRef(0);
  
  // Load processed signals from localStorage to prevent re-tracking on refresh
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tesseract-processed-signals');
        if (saved) {
          const parsed = JSON.parse(saved);
          // Only load entries that are less than 30 minutes old
          const now = Date.now();
          const validEntries = Object.entries(parsed).filter(
            ([_, timestamp]) => now - (timestamp as number) < 30 * 60 * 1000
          );
          validEntries.forEach(([key]) => processedSignalsRef.current.add(key));
        }
      } catch {}
    }
  }, []);
  
  // WebSocket for real-time prices and EMAs
  const { prices: wsPrices, connected, lastUpdate: wsLastUpdate, initializeEMAs } = useBinanceWebSocket(watchlist);
  
  // Initialize EMAs from API data when it loads
  useEffect(() => {
    if (data.length > 0) {
      for (const crypto of data) {
        // Use 1h timeframe EMAs as the base for live updates
        const tfData = crypto.timeframes['1h'];
        if (tfData?.emas) {
          initializeEMAs(crypto.symbol, tfData.emas as Record<number, number>);
        }
      }
    }
  }, [data, initializeEMAs]);
  
  const fetchData = useCallback(async () => {
    if (watchlist.length === 0) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const res = await fetch(`/api/market?symbols=${watchlist.join(',')}`);
      const json = await res.json();
      
      if (!json.success) throw new Error(json.error);
      
      setData(json.data);
      setLastApiUpdate(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [watchlist]);
  
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData, watchlist]);
  
  // Merge API data with live WebSocket prices and EMAs
  const mergedData = useMemo(() => {
    return data.map(crypto => {
      const wsData = wsPrices[crypto.symbol];
      if (wsData) {
        // Merge live EMAs into each timeframe
        const updatedTimeframes = { ...crypto.timeframes };
        for (const tf of Object.keys(updatedTimeframes)) {
          if (updatedTimeframes[tf]?.emas && Object.keys(wsData.emas || {}).length > 0) {
            updatedTimeframes[tf] = {
              ...updatedTimeframes[tf],
              emas: { ...updatedTimeframes[tf].emas, ...wsData.emas },
            };
          }
        }
        
        return {
          ...crypto,
          livePrice: wsData.price,
          liveChange24h: wsData.priceChange24h,
          liveEMAs: wsData.emas,
          timeframes: updatedTimeframes,
        };
      }
      return crypto;
    });
  }, [data, wsPrices]);
  
  // Track new signals from strategies
  useEffect(() => {
    if (data.length === 0) return;
    
    for (const crypto of data) {
      if (!crypto.strategies) continue;
      
      for (const strategy of crypto.strategies) {
        // Only track non-neutral signals with entry/stop/target
        if (strategy.signal.type === 'NEUTRAL') continue;
        if (!strategy.signal.entry || !strategy.signal.stop || !strategy.signal.target) continue;
        
        // Create unique key for this signal
        const signalKey = `${crypto.symbol}-${strategy.id}-${strategy.signal.type}`;
        
        // Skip if already processed recently (within last 5 mins)
        if (processedSignalsRef.current.has(signalKey)) continue;
        
        // Add to processed set (expires after 30 mins to allow new signals)
        processedSignalsRef.current.add(signalKey);
        
        // Save to localStorage for persistence across refreshes
        try {
          const saved = localStorage.getItem('tesseract-processed-signals');
          const processed = saved ? JSON.parse(saved) : {};
          processed[signalKey] = Date.now();
          // Clean old entries (> 30 mins)
          const now = Date.now();
          const cleaned = Object.fromEntries(
            Object.entries(processed).filter(([_, ts]) => now - (ts as number) < 30 * 60 * 1000)
          );
          localStorage.setItem('tesseract-processed-signals', JSON.stringify(cleaned));
        } catch {}
        
        // Also set a timer to remove from memory after 30 mins
        setTimeout(() => {
          processedSignalsRef.current.delete(signalKey);
        }, 30 * 60 * 1000);
        
        // Track the signal
        const newSignal = addSignal({
          symbol: crypto.symbol,
          strategyId: strategy.id,
          strategyName: strategy.name,
          type: strategy.signal.type as TrackedSignal['type'],
          entry: strategy.signal.entry,
          stop: strategy.signal.stop,
          target: strategy.signal.target,
          strength: strategy.signal.strength,
          reasons: strategy.signal.reasons,
        });
        
        setTrackedSignals(prev => {
          // Check if already exists
          if (prev.some(s => s.id === newSignal.id)) return prev;
          // Play alert sound for new signal
          playAlertSound();
          return [...prev, newSignal];
        });
      }
    }
  }, [data]);
  
  // Check signal outcomes with live prices
  useEffect(() => {
    if (trackedSignals.length === 0 || Object.keys(wsPrices).length === 0) return;
    
    // Build price map
    const priceMap: Record<string, number> = {};
    for (const [symbol, data] of Object.entries(wsPrices)) {
      priceMap[symbol] = data.price;
    }
    
    // Also add API prices for assets without live data
    for (const crypto of mergedData) {
      if (!priceMap[crypto.symbol]) {
        priceMap[crypto.symbol] = crypto.price;
      }
    }
    
    const updatedSignals = checkSignalOutcomes(trackedSignals, priceMap);
    
    // Only update if something changed
    const hasChanges = updatedSignals.some((s, i) => 
      s.status !== trackedSignals[i]?.status
    );
    
    if (hasChanges) {
      setTrackedSignals(updatedSignals);
    }
  }, [trackedSignals, wsPrices, mergedData]);
  
  // Handle clear signals
  const handleClearSignals = useCallback(() => {
    clearAllSignals();
    setTrackedSignals([]);
    processedSignalsRef.current.clear();
  }, []);
  
  // Filter data
  const filteredData = useMemo(() => {
    return mergedData.filter(crypto => {
      if (filter === 'all') return true;
      if (filter === 'long') return crypto.tradeSignal.signal.includes('LONG');
      if (filter === 'short') return crypto.tradeSignal.signal.includes('SHORT');
      if (filter === 'strong') return crypto.tradeSignal.signal.includes('STRONG');
      return true;
    });
  }, [mergedData, filter]);
  
  // Sort data
  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      let aVal: number, bVal: number;
      
      switch (sort.field) {
        case 'symbol':
          return sort.dir === 'asc' 
            ? a.symbol.localeCompare(b.symbol) 
            : b.symbol.localeCompare(a.symbol);
        case 'price':
          aVal = a.livePrice ?? a.price;
          bVal = b.livePrice ?? b.price;
          break;
        case 'change':
          aVal = a.liveChange24h ?? a.priceChange24h;
          bVal = b.liveChange24h ?? b.priceChange24h;
          break;
        case 'signal':
          const signalOrder = { 'STRONG_LONG': 5, 'LONG': 4, 'NEUTRAL': 3, 'SHORT': 2, 'STRONG_SHORT': 1 };
          aVal = signalOrder[a.tradeSignal.signal as keyof typeof signalOrder] || 0;
          bVal = signalOrder[b.tradeSignal.signal as keyof typeof signalOrder] || 0;
          break;
        case 'confluence':
          aVal = a.confluence.score;
          bVal = b.confluence.score;
          break;
        case 'rsi':
          aVal = a.rsi['1h'] ?? 50;
          bVal = b.rsi['1h'] ?? 50;
          break;
        case 'strategies':
          // Sort by number of active strategy signals
          const aActive = (a.strategies || []).filter(s => s.signal.type !== 'NEUTRAL').length;
          const bActive = (b.strategies || []).filter(s => s.signal.type !== 'NEUTRAL').length;
          aVal = aActive;
          bVal = bActive;
          break;
        case 'volume':
          aVal = a.volume?.ratio ?? 1;
          bVal = b.volume?.ratio ?? 1;
          break;
        case 'atr':
          aVal = a.atr?.percent ?? 0;
          bVal = b.atr?.percent ?? 0;
          break;
        case 'heat':
          // Heat score = active strategies * avg strength + volume bonus + confluence
          const aStrategies = (a.strategies || []).filter(s => s.signal.type !== 'NEUTRAL');
          const bStrategies = (b.strategies || []).filter(s => s.signal.type !== 'NEUTRAL');
          const aAvgStrength = aStrategies.length > 0 ? aStrategies.reduce((sum, s) => sum + s.signal.strength, 0) / aStrategies.length : 0;
          const bAvgStrength = bStrategies.length > 0 ? bStrategies.reduce((sum, s) => sum + s.signal.strength, 0) / bStrategies.length : 0;
          aVal = (aStrategies.length * 20) + aAvgStrength + (a.volume?.ratio ?? 1) * 10 + (a.confluence.score - 50);
          bVal = (bStrategies.length * 20) + bAvgStrength + (b.volume?.ratio ?? 1) * 10 + (b.confluence.score - 50);
          break;
        default:
          return 0;
      }
      
      return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [filteredData, sort]);
  
  const handleSort = (field: SortField) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };
  
  // Stats
  const longCount = data.filter(d => d.tradeSignal.signal.includes('LONG')).length;
  const shortCount = data.filter(d => d.tradeSignal.signal.includes('SHORT')).length;
  const strongCount = data.filter(d => d.tradeSignal.signal.includes('STRONG')).length;
  
  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      {/* Chart Modal */}
      {selectedCrypto && (
        <ChartModal 
          crypto={selectedCrypto}
          livePrice={wsPrices[selectedCrypto.symbol]?.price}
          liveChange={wsPrices[selectedCrypto.symbol]?.priceChange24h}
          onClose={() => setSelectedCrypto(null)} 
        />
      )}
      
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0b]/95 backdrop-blur-xl border-b border-zinc-800/50">
        <div className="max-w-[2400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
                <span className="text-white text-lg font-black">T</span>
              </div>
              <div className="hidden sm:block">
                <span className="text-xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Tesseract
                </span>
                <span className="text-[10px] text-zinc-500 block -mt-0.5">Multi-Timeframe Analysis</span>
              </div>
            </div>
            
            {/* Connection + Stats */}
            <div className="flex items-center gap-4">
              <ConnectionStatus connected={connected} lastUpdate={wsLastUpdate} />
              
              <div className="hidden lg:flex items-center gap-2">
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <TrendingUp size={12} className="text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">{longCount}</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <TrendingDown size={12} className="text-rose-400" />
                  <span className="text-xs font-bold text-rose-400">{shortCount}</span>
                </div>
              </div>
            </div>
            
            {/* Controls */}
            <div className="flex items-center gap-2">
              {/* TF Toggles */}
              <div className="hidden md:flex items-center gap-1 bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                {VISIBLE_TFS.map(tf => (
                  <button
                    key={tf}
                    onClick={() => setVisibleTFs(prev =>
                      prev.includes(tf) ? prev.filter(t => t !== tf) : [...prev, tf]
                    )}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      visibleTFs.includes(tf)
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-2 rounded-lg transition-all ${
                  soundEnabled ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-2 rounded-lg text-zinc-500 hover:text-white transition-all"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
              
              {lastApiUpdate && (
                <span className="text-[10px] text-zinc-600 hidden lg:block pl-2 border-l border-zinc-800">
                  {lastApiUpdate}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>
      
      {/* Trading Sessions Bar */}
      <div className="max-w-[2400px] mx-auto px-4 pt-4">
        <TradingSessions />
      </div>
      
      {/* Tab Navigation */}
      <div className="max-w-[2400px] mx-auto px-4 pt-4">
        <TabNav 
          activeTab={activeTab} 
          onTabChange={setActiveTab}
          signalCount={trackedSignals.length}
          openSignalCount={trackedSignals.filter(s => s.status === 'OPEN').length}
        />
      </div>
      
      {/* Signals Tab */}
      {activeTab === 'signals' && (
        <div className="max-w-[2400px] mx-auto px-4 py-4">
          <SignalsTab 
            signals={trackedSignals} 
            onClearSignals={handleClearSignals}
          />
        </div>
      )}
      
      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <div className="max-w-[2400px] mx-auto px-4 py-4">
          <StatsTab signals={trackedSignals} />
        </div>
      )}
      
      {/* Dashboard Tab Content */}
      {activeTab === 'dashboard' && (
        <>
      {/* Watchlist Selector */}
      <div className="max-w-[2400px] mx-auto px-4 pt-4">
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Watchlist</span>
          </div>
          <PairSelector 
            selectedPairs={watchlist} 
            onPairsChange={setWatchlist} 
          />
        </div>
      </div>
      
      {/* Filters Bar */}
      <div className="border-b border-zinc-800/50 bg-zinc-900/30 mt-4">
        <div className="max-w-[2400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-zinc-500" />
              <FilterButton 
                label="All" 
                active={filter === 'all'} 
                count={data.length}
                color="bg-indigo-600"
                onClick={() => setFilter('all')} 
              />
              <FilterButton 
                label="Long" 
                active={filter === 'long'} 
                count={longCount}
                color="bg-emerald-600"
                onClick={() => setFilter('long')} 
              />
              <FilterButton 
                label="Short" 
                active={filter === 'short'} 
                count={shortCount}
                color="bg-rose-600"
                onClick={() => setFilter('short')} 
              />
              <FilterButton 
                label="Strong" 
                active={filter === 'strong'} 
                count={strongCount}
                color="bg-amber-600"
                onClick={() => setFilter('strong')} 
              />
            </div>
            
            <div className="text-xs text-zinc-500">
              Showing {sortedData.length} of {data.length} assets
            </div>
          </div>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="max-w-[2400px] mx-auto px-4 py-4">
        {error && (
          <div className="mb-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
            {error}
          </div>
        )}
        
        {loading && data.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw size={32} className="animate-spin text-indigo-500" />
          </div>
        )}
        
        {sortedData.length > 0 && (
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-2 px-3">
                      <SortHeader label="Asset" field="symbol" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2 w-[100px]">
                      <span className="text-[10px] text-zinc-400 font-semibold">Chart</span>
                    </th>
                    <th className="text-right py-2 px-3">
                      <SortHeader label="Price" field="price" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="24h" field="change" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="RSI" field="rsi" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="Signal" field="signal" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="Confluence" field="confluence" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="Strategies" field="strategies" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="Vol" field="volume" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="ATR%" field="atr" currentSort={sort} onSort={handleSort} />
                    </th>
                    <th className="text-center py-2 px-2">
                      <SortHeader label="🔥Heat" field="heat" currentSort={sort} onSort={handleSort} />
                    </th>
                    {visibleTFs.map(tf => (
                      <th key={tf} className="text-center py-2 px-2 border-l border-zinc-800/30" colSpan={EMA_PERIODS.length + 1}>
                        <span className="text-[10px] text-zinc-400 font-semibold">{tf}</span>
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-zinc-800/30 bg-zinc-900/50">
                    <th colSpan={11}></th>
                    {visibleTFs.map(tf => (
                      <th key={`${tf}-sub`} className="contents">
                        {EMA_PERIODS.map(period => (
                          <th key={`${tf}-${period}`} className="text-center text-[10px] text-zinc-500 py-2 px-1 first:border-l first:border-zinc-800/30">
                            EMA{period}
                          </th>
                        ))}
                        <th className="text-center text-[10px] text-zinc-500 py-2 px-1">Stack</th>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((crypto) => {
                    const isConfluent = (() => {
                      const stacks = visibleTFs.map(tf => crypto.timeframes[tf]?.stack);
                      if (stacks.every(s => s === 'bull')) return 'bull';
                      if (stacks.every(s => s === 'bear')) return 'bear';
                      return null;
                    })();
                    
                    const displayPrice = crypto.livePrice ?? crypto.price;
                    const displayChange = crypto.liveChange24h ?? crypto.priceChange24h;
                    
                    return (
                      <tr
                        key={crypto.symbol}
                        onClick={() => setSelectedCrypto(crypto)}
                        className={`
                          border-b border-zinc-800/20 hover:bg-zinc-800/40 transition-all cursor-pointer
                          ${isConfluent === 'bull' ? 'bg-emerald-500/5 hover:bg-emerald-500/10' : ''}
                          ${isConfluent === 'bear' ? 'bg-rose-500/5 hover:bg-rose-500/10' : ''}
                        `}
                      >
                        {/* Asset */}
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-[10px] font-bold">
                              {crypto.symbol.charAt(0)}
                            </div>
                            <div>
                              <div className="text-xs font-medium text-white flex items-center gap-1">
                                {crypto.symbol}
                                {isConfluent === 'bull' && <span className="text-emerald-400 text-[10px]">✨</span>}
                                {isConfluent === 'bear' && <span className="text-rose-400 text-[10px]">⚠️</span>}
                                <a
                                  href={`https://www.tradingview.com/chart/?symbol=BINANCE:${crypto.symbol}USDT`}
                                  target="_blank"
                                  rel="noopener"
                                  className="text-zinc-600 hover:text-blue-400 transition-colors"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <ExternalLink size={9} />
                                </a>
                              </div>
                              <div className="text-[10px] text-zinc-500">{crypto.name}</div>
                            </div>
                          </div>
                        </td>
                        
                        {/* Mini Chart - Click to open modal */}
                        <td 
                          className="py-1 px-2 cursor-pointer hover:bg-zinc-700/30 rounded transition-all"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedCrypto(crypto);
                          }}
                          title="Click to view chart"
                        >
                          <div 
                            className="pointer-events-none"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {crypto.recentPrices.length > 5 && (
                              <MiniCandleChart data={crypto.recentPrices} width={80} height={28} />
                            )}
                          </div>
                        </td>
                        
                        {/* Price */}
                        <td className="py-2 px-3 text-right">
                          <div className="text-xs font-mono text-white">
                            ${formatPrice(displayPrice)}
                          </div>
                          {crypto.livePrice && (
                            <div className="text-[9px] text-emerald-500/70 font-mono">● live</div>
                          )}
                        </td>
                        
                        {/* 24h Change */}
                        <td className="py-2 px-2 text-center">
                          <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                            displayChange >= 0 
                              ? 'text-emerald-400 bg-emerald-500/10' 
                              : 'text-rose-400 bg-rose-500/10'
                          }`}>
                            {displayChange >= 0 ? '+' : ''}{displayChange.toFixed(1)}%
                          </span>
                        </td>
                        
                        {/* RSI */}
                        <td className="py-2 px-2 text-center">
                          <RSIGauge value={crypto.rsi['1h']} />
                        </td>
                        
                        {/* Signal */}
                        <td className="py-2 px-2 text-center">
                          <SignalBadge signal={crypto.tradeSignal.signal} confidence={crypto.tradeSignal.confidence} />
                        </td>
                        
                        {/* Confluence */}
                        <td className="py-2 px-2 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`text-xs font-mono ${
                              crypto.confluence.score >= 60 ? 'text-emerald-400' :
                              crypto.confluence.score <= 40 ? 'text-rose-400' : 'text-zinc-400'
                            }`}>
                              {crypto.confluence.score}
                            </span>
                            <div className="w-8 h-0.5 bg-zinc-700 rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all ${
                                  crypto.confluence.score >= 60 ? 'bg-emerald-500' :
                                  crypto.confluence.score <= 40 ? 'bg-rose-500' : 'bg-zinc-500'
                                }`}
                                style={{ width: `${crypto.confluence.score}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        
                        {/* Strategies */}
                        <td className="py-2 px-2 text-center">
                          <StrategyBadges strategies={crypto.strategies || []} />
                        </td>
                        
                        {/* Volume */}
                        <td className="py-2 px-2 text-center">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            (crypto.volume?.ratio ?? 1) >= 1.5 
                              ? 'bg-amber-500/20 text-amber-400' 
                              : (crypto.volume?.ratio ?? 1) >= 1.0 
                                ? 'text-zinc-400' 
                                : 'text-zinc-600'
                          }`}>
                            {(crypto.volume?.ratio ?? 1).toFixed(1)}x
                          </span>
                        </td>
                        
                        {/* ATR% */}
                        <td className="py-2 px-2 text-center">
                          <span className={`text-[10px] font-mono ${
                            (crypto.atr?.percent ?? 0) >= 3 
                              ? 'text-rose-400' 
                              : (crypto.atr?.percent ?? 0) >= 1.5 
                                ? 'text-amber-400' 
                                : 'text-zinc-400'
                          }`}>
                            {crypto.atr?.percent?.toFixed(1) ?? '-'}%
                          </span>
                        </td>
                        
                        {/* Heat Score */}
                        <td className="py-2 px-2 text-center">
                          {(() => {
                            const activeStrats = (crypto.strategies || []).filter(s => s.signal.type !== 'NEUTRAL');
                            const avgStrength = activeStrats.length > 0 
                              ? activeStrats.reduce((sum, s) => sum + s.signal.strength, 0) / activeStrats.length 
                              : 0;
                            const heat = (activeStrats.length * 20) + avgStrength + ((crypto.volume?.ratio ?? 1) - 1) * 20 + (crypto.confluence.score - 50);
                            const isHot = heat >= 50;
                            const isWarm = heat >= 25;
                            return (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                isHot 
                                  ? 'bg-orange-500/20 text-orange-400' 
                                  : isWarm 
                                    ? 'bg-yellow-500/10 text-yellow-400' 
                                    : 'text-zinc-600'
                              }`}>
                                {isHot ? '🔥' : isWarm ? '🌡️' : ''}{Math.round(heat)}
                              </span>
                            );
                          })()}
                        </td>
                        
                        {/* Timeframes - Live Updated */}
                        {visibleTFs.map(tf => {
                          const tfData = crypto.timeframes[tf];
                          const hasLive = !!crypto.livePrice;
                          return (
                            <td key={`${crypto.symbol}-${tf}`} className="contents">
                              {EMA_PERIODS.map(period => {
                                // Recalculate with live price if available
                                const liveValue = hasLive && tfData?.emas?.[period]
                                  ? calcLivePriceVsEma(tfData.emas[period], displayPrice)
                                  : tfData?.priceVsEma[period] ?? null;
                                return (
                                  <td 
                                    key={`${crypto.symbol}-${tf}-${period}`} 
                                    className="py-2 px-1 text-center first:border-l first:border-zinc-800/20"
                                  >
                                    <PriceVsEMACell value={liveValue} />
                                  </td>
                                );
                              })}
                              <td className="py-2 px-2 text-center">
                                <StackBadge stack={
                                  hasLive && tfData?.emas 
                                    ? calcLiveStack(tfData.emas, displayPrice)
                                    : tfData?.stack || 'mixed'
                                } />
                              </td>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-zinc-600">
            Tesseract • Real-Time Multi-Timeframe Analysis • Not Financial Advice
          </p>
        </div>
      </div>
        </>
      )}
    </main>
  );
}
