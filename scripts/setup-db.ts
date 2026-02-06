// Run with: npx tsx scripts/setup-db.ts
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupDatabase() {
  console.log('🔧 Setting up Tesseract database...\n');
  
  // Create signals table
  const { error: signalsError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS signals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol VARCHAR(20) NOT NULL,
        strategy VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('long', 'short')),
        entry_price DECIMAL(20, 8) NOT NULL,
        stop_loss DECIMAL(20, 8) NOT NULL,
        take_profit DECIMAL(20, 8) NOT NULL,
        strength DECIMAL(5, 2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'closed')),
        pnl_percent DECIMAL(10, 4),
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        close_price DECIMAL(20, 8),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
      CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
      CREATE INDEX IF NOT EXISTS idx_signals_opened_at ON signals(opened_at);
    `
  });
  
  if (signalsError) {
    console.log('Note: Using direct SQL approach instead...');
  }
  
  // Create processed_signals table for deduplication
  const { error: processedError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS processed_signals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        signal_key VARCHAR(200) NOT NULL UNIQUE,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_processed_signals_key ON processed_signals(signal_key);
      CREATE INDEX IF NOT EXISTS idx_processed_signals_expires ON processed_signals(expires_at);
    `
  });
  
  if (processedError) {
    console.log('Note: RPC not available, tables need manual creation.');
    console.log('\n📋 Run this SQL in Supabase Dashboard → SQL Editor:\n');
    console.log(`
-- Signals table (paper trades)
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  strategy VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('long', 'short')),
  entry_price DECIMAL(20, 8) NOT NULL,
  stop_loss DECIMAL(20, 8) NOT NULL,
  take_profit DECIMAL(20, 8) NOT NULL,
  strength DECIMAL(5, 2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'closed')),
  pnl_percent DECIMAL(10, 4),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_price DECIMAL(20, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_opened_at ON signals(opened_at);

-- Processed signals for deduplication
CREATE TABLE IF NOT EXISTS processed_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key VARCHAR(200) NOT NULL UNIQUE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_signals_key ON processed_signals(signal_key);
CREATE INDEX IF NOT EXISTS idx_processed_signals_expires ON processed_signals(expires_at);

-- Enable Row Level Security (optional, for public access)
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_signals ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (no auth required)
CREATE POLICY "Allow all signals" ON signals FOR ALL USING (true);
CREATE POLICY "Allow all processed_signals" ON processed_signals FOR ALL USING (true);
    `);
  } else {
    console.log('✅ Tables created successfully!');
  }
  
  // Test connection
  const { data, error } = await supabase.from('signals').select('count').limit(1);
  if (error && error.code === '42P01') {
    console.log('\n⚠️  Tables not created yet. Please run the SQL above in Supabase Dashboard.');
  } else if (error) {
    console.log('Connection test error:', error.message);
  } else {
    console.log('✅ Connection verified!');
  }
}

setupDatabase().catch(console.error);
