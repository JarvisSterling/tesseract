import { createClient } from '@supabase/supabase-js';

// Server-side client (full access)
export function createServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase server credentials');
  }
  
  return createClient(supabaseUrl, supabaseKey);
}

// Client-side client (anon access with RLS)
export function createBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase client credentials');
  }
  
  return createClient(supabaseUrl, supabaseKey);
}

// Types for our tables
export interface Signal {
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
  created_at: string;
}

export interface ProcessedSignal {
  id: string;
  signal_key: string;
  processed_at: string;
  expires_at: string;
}
