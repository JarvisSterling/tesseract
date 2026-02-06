/**
 * Signal Tracker - Paper Trading System
 * Tracks strategy signals, monitors outcomes, calculates performance
 */

export interface TrackedSignal {
  id: string;
  symbol: string;
  strategyId: string;
  strategyName: string;
  type: 'LONG' | 'SHORT' | 'STRONG_LONG' | 'STRONG_SHORT';
  entry: number;
  stop: number;
  target: number;
  strength: number;
  reasons: string[];
  openedAt: number;
  closedAt?: number;
  closePrice?: number;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED';
}

export interface StrategyStats {
  strategyId: string;
  strategyName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
  totalPnlPercent: number;
  profitFactor: number;
  openPositions: number;
}

const STORAGE_KEY = 'tesseract-signals';
const MAX_SIGNALS = 500; // Keep last 500 signals

export function loadSignals(): TrackedSignal[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveSignals(signals: TrackedSignal[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Keep only last MAX_SIGNALS
    const trimmed = signals.slice(-MAX_SIGNALS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save signals:', e);
  }
}

export function generateSignalId(): string {
  return `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function addSignal(signal: Omit<TrackedSignal, 'id' | 'status' | 'openedAt'>): TrackedSignal {
  const signals = loadSignals();
  
  // Check if we already have an open signal for this symbol+strategy
  const existing = signals.find(
    s => s.symbol === signal.symbol && 
         s.strategyId === signal.strategyId && 
         s.status === 'OPEN'
  );
  
  if (existing) {
    // Don't duplicate - return existing
    return existing;
  }
  
  const newSignal: TrackedSignal = {
    ...signal,
    id: generateSignalId(),
    status: 'OPEN',
    openedAt: Date.now(),
  };
  
  signals.push(newSignal);
  saveSignals(signals);
  
  return newSignal;
}

export function updateSignalOutcome(
  signalId: string, 
  closePrice: number, 
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN'
): TrackedSignal | null {
  const signals = loadSignals();
  const idx = signals.findIndex(s => s.id === signalId);
  
  if (idx === -1) return null;
  
  const signal = signals[idx];
  const isLong = signal.type.includes('LONG');
  
  // Calculate P&L
  const pnlPercent = isLong 
    ? ((closePrice - signal.entry) / signal.entry) * 100
    : ((signal.entry - closePrice) / signal.entry) * 100;
  
  signals[idx] = {
    ...signal,
    status: 'CLOSED',
    closedAt: Date.now(),
    closePrice,
    outcome,
    pnlPercent,
  };
  
  saveSignals(signals);
  return signals[idx];
}

export function checkSignalOutcomes(
  signals: TrackedSignal[], 
  prices: Record<string, number>
): TrackedSignal[] {
  let updated = false;
  
  const updatedSignals = signals.map(signal => {
    if (signal.status !== 'OPEN') return signal;
    
    const currentPrice = prices[signal.symbol];
    if (!currentPrice) return signal;
    
    const isLong = signal.type.includes('LONG');
    
    // Check if target hit
    if (isLong && currentPrice >= signal.target) {
      updated = true;
      const pnlPercent = ((signal.target - signal.entry) / signal.entry) * 100;
      return {
        ...signal,
        status: 'CLOSED' as const,
        closedAt: Date.now(),
        closePrice: signal.target,
        outcome: 'WIN' as const,
        pnlPercent,
      };
    }
    
    if (!isLong && currentPrice <= signal.target) {
      updated = true;
      const pnlPercent = ((signal.entry - signal.target) / signal.entry) * 100;
      return {
        ...signal,
        status: 'CLOSED' as const,
        closedAt: Date.now(),
        closePrice: signal.target,
        outcome: 'WIN' as const,
        pnlPercent,
      };
    }
    
    // Check if stop hit
    if (isLong && currentPrice <= signal.stop) {
      updated = true;
      const pnlPercent = ((signal.stop - signal.entry) / signal.entry) * 100;
      return {
        ...signal,
        status: 'CLOSED' as const,
        closedAt: Date.now(),
        closePrice: signal.stop,
        outcome: 'LOSS' as const,
        pnlPercent,
      };
    }
    
    if (!isLong && currentPrice >= signal.stop) {
      updated = true;
      const pnlPercent = ((signal.entry - signal.stop) / signal.entry) * 100;
      return {
        ...signal,
        status: 'CLOSED' as const,
        closedAt: Date.now(),
        closePrice: signal.stop,
        outcome: 'LOSS' as const,
        pnlPercent,
      };
    }
    
    return signal;
  });
  
  if (updated) {
    saveSignals(updatedSignals);
  }
  
  return updatedSignals;
}

export function calculateStrategyStats(signals: TrackedSignal[]): StrategyStats[] {
  const statsMap = new Map<string, StrategyStats>();
  
  for (const signal of signals) {
    if (!statsMap.has(signal.strategyId)) {
      statsMap.set(signal.strategyId, {
        strategyId: signal.strategyId,
        strategyName: signal.strategyName,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        winRate: 0,
        avgWinPercent: 0,
        avgLossPercent: 0,
        totalPnlPercent: 0,
        profitFactor: 0,
        openPositions: 0,
      });
    }
    
    const stats = statsMap.get(signal.strategyId)!;
    
    if (signal.status === 'OPEN') {
      stats.openPositions++;
    } else {
      stats.totalTrades++;
      stats.totalPnlPercent += signal.pnlPercent || 0;
      
      if (signal.outcome === 'WIN') {
        stats.wins++;
        stats.avgWinPercent += signal.pnlPercent || 0;
      } else if (signal.outcome === 'LOSS') {
        stats.losses++;
        stats.avgLossPercent += signal.pnlPercent || 0;
      } else {
        stats.breakeven++;
      }
    }
  }
  
  // Calculate averages and ratios
  for (const stats of statsMap.values()) {
    if (stats.totalTrades > 0) {
      stats.winRate = (stats.wins / stats.totalTrades) * 100;
    }
    if (stats.wins > 0) {
      stats.avgWinPercent = stats.avgWinPercent / stats.wins;
    }
    if (stats.losses > 0) {
      stats.avgLossPercent = Math.abs(stats.avgLossPercent / stats.losses);
    }
    
    // Profit factor = gross wins / gross losses
    const grossWins = stats.wins * stats.avgWinPercent;
    const grossLosses = stats.losses * stats.avgLossPercent;
    stats.profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  }
  
  return Array.from(statsMap.values()).sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
}

export function clearAllSignals(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
