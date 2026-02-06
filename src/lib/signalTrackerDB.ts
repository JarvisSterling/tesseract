/**
 * Signal Tracker - Database-backed Paper Trading System
 * Uses Supabase for persistence across devices/sessions
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

// Database row types
interface SignalRow {
  id: string;
  symbol: string;
  strategy: string;
  direction: 'long' | 'short';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  strength: number;
  status: 'active' | 'won' | 'lost' | 'closed';
  pnl_percent: number | null;
  opened_at: string;
  closed_at: string | null;
  close_price: number | null;
}

interface ProcessedSignalRow {
  id: string;
  signal_key: string;
  processed_at: string;
  expires_at: string;
}

// Singleton Supabase client
let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!url || !key) {
      throw new Error('Missing Supabase credentials');
    }
    
    supabase = createClient(url, key);
  }
  return supabase;
}

// Convert DB row to TrackedSignal
function rowToSignal(row: SignalRow, strategyName?: string): TrackedSignal {
  const isStrong = row.strength >= 70;
  const isLong = row.direction === 'long';
  
  let type: TrackedSignal['type'];
  if (isLong) {
    type = isStrong ? 'STRONG_LONG' : 'LONG';
  } else {
    type = isStrong ? 'STRONG_SHORT' : 'SHORT';
  }
  
  let outcome: TrackedSignal['outcome'] | undefined;
  if (row.status === 'won') outcome = 'WIN';
  else if (row.status === 'lost') outcome = 'LOSS';
  else if (row.status === 'closed') outcome = 'BREAKEVEN';
  
  return {
    id: row.id,
    symbol: row.symbol,
    strategyId: row.strategy,
    strategyName: strategyName || row.strategy.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type,
    entry: Number(row.entry_price),
    stop: Number(row.stop_loss),
    target: Number(row.take_profit),
    strength: Number(row.strength),
    reasons: [], // Not stored in DB for now
    openedAt: new Date(row.opened_at).getTime(),
    closedAt: row.closed_at ? new Date(row.closed_at).getTime() : undefined,
    closePrice: row.close_price ? Number(row.close_price) : undefined,
    outcome,
    pnlPercent: row.pnl_percent ? Number(row.pnl_percent) : undefined,
    status: row.status === 'active' ? 'OPEN' : 'CLOSED',
  };
}

// Convert TrackedSignal to DB row format
function signalToRow(signal: Omit<TrackedSignal, 'id' | 'status' | 'openedAt'>): Omit<SignalRow, 'id' | 'opened_at' | 'closed_at' | 'close_price' | 'pnl_percent'> {
  return {
    symbol: signal.symbol,
    strategy: signal.strategyId,
    direction: signal.type.includes('LONG') ? 'long' : 'short',
    entry_price: signal.entry,
    stop_loss: signal.stop,
    take_profit: signal.target,
    strength: signal.strength,
    status: 'active',
  };
}

export async function loadSignals(): Promise<TrackedSignal[]> {
  try {
    const { data, error } = await getSupabase()
      .from('signals')
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(500);
    
    if (error) throw error;
    return (data || []).map(row => rowToSignal(row as SignalRow));
  } catch (e) {
    console.error('Failed to load signals:', e);
    return [];
  }
}

export async function addSignal(signal: Omit<TrackedSignal, 'id' | 'status' | 'openedAt'>): Promise<TrackedSignal | null> {
  try {
    const db = getSupabase();
    
    // Check for existing open signal
    const { data: existing } = await db
      .from('signals')
      .select('*')
      .eq('symbol', signal.symbol)
      .eq('strategy', signal.strategyId)
      .eq('status', 'active')
      .limit(1);
    
    if (existing && existing.length > 0) {
      return rowToSignal(existing[0] as SignalRow, signal.strategyName);
    }
    
    // Insert new signal
    const row = signalToRow(signal);
    const { data, error } = await db
      .from('signals')
      .insert(row)
      .select()
      .single();
    
    if (error) throw error;
    return rowToSignal(data as SignalRow, signal.strategyName);
  } catch (e) {
    console.error('Failed to add signal:', e);
    return null;
  }
}

export async function closeSignal(
  signalId: string,
  closePrice: number,
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN',
  pnlPercent: number
): Promise<boolean> {
  try {
    const status = outcome === 'WIN' ? 'won' : outcome === 'LOSS' ? 'lost' : 'closed';
    
    const { error } = await getSupabase()
      .from('signals')
      .update({
        status,
        closed_at: new Date().toISOString(),
        close_price: closePrice,
        pnl_percent: pnlPercent,
      })
      .eq('id', signalId);
    
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Failed to close signal:', e);
    return false;
  }
}

// Check if a signal was already processed (deduplication)
export async function isSignalProcessed(signalKey: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    
    const { data, error } = await getSupabase()
      .from('processed_signals')
      .select('id')
      .eq('signal_key', signalKey)
      .gt('expires_at', now)
      .limit(1);
    
    if (error) throw error;
    return (data && data.length > 0);
  } catch (e) {
    console.error('Failed to check processed signal:', e);
    return false;
  }
}

// Mark a signal as processed
export async function markSignalProcessed(signalKey: string, expiryMinutes: number = 30): Promise<boolean> {
  try {
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
    
    const { error } = await getSupabase()
      .from('processed_signals')
      .upsert({
        signal_key: signalKey,
        processed_at: new Date().toISOString(),
        expires_at: expiresAt,
      }, {
        onConflict: 'signal_key',
      });
    
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Failed to mark signal processed:', e);
    return false;
  }
}

// Clean up expired processed signals
export async function cleanupExpiredSignals(): Promise<void> {
  try {
    const now = new Date().toISOString();
    
    await getSupabase()
      .from('processed_signals')
      .delete()
      .lt('expires_at', now);
  } catch (e) {
    console.error('Failed to cleanup expired signals:', e);
  }
}

// Check and close signals based on price movements
export async function checkSignalOutcomes(
  signals: TrackedSignal[],
  prices: Record<string, number>
): Promise<TrackedSignal[]> {
  const updates: Promise<void>[] = [];
  
  const updatedSignals = signals.map(signal => {
    if (signal.status !== 'OPEN') return signal;
    
    const currentPrice = prices[signal.symbol];
    if (!currentPrice) return signal;
    
    const isLong = signal.type.includes('LONG');
    
    // Check target hit
    if ((isLong && currentPrice >= signal.target) || (!isLong && currentPrice <= signal.target)) {
      const pnlPercent = isLong
        ? ((signal.target - signal.entry) / signal.entry) * 100
        : ((signal.entry - signal.target) / signal.entry) * 100;
      
      updates.push(closeSignal(signal.id, signal.target, 'WIN', pnlPercent).then(() => {}));
      
      return {
        ...signal,
        status: 'CLOSED' as const,
        closedAt: Date.now(),
        closePrice: signal.target,
        outcome: 'WIN' as const,
        pnlPercent,
      };
    }
    
    // Check stop hit
    if ((isLong && currentPrice <= signal.stop) || (!isLong && currentPrice >= signal.stop)) {
      const pnlPercent = isLong
        ? ((signal.stop - signal.entry) / signal.entry) * 100
        : ((signal.entry - signal.stop) / signal.entry) * 100;
      
      updates.push(closeSignal(signal.id, signal.stop, 'LOSS', pnlPercent).then(() => {}));
      
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
  
  // Wait for all DB updates
  await Promise.all(updates);
  
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
    
    const grossWins = stats.wins * stats.avgWinPercent;
    const grossLosses = stats.losses * stats.avgLossPercent;
    stats.profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  }
  
  return Array.from(statsMap.values()).sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
}

export async function clearAllSignals(): Promise<void> {
  try {
    await getSupabase().from('signals').delete().neq('id', '');
    await getSupabase().from('processed_signals').delete().neq('id', '');
  } catch (e) {
    console.error('Failed to clear signals:', e);
  }
}
