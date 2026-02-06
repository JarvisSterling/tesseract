import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function createTables() {
  // Use connection string with SSL mode from env
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  const client = new Client({
    connectionString,
    ssl: true
  });

  console.log('🔌 Connecting to Postgres...');
  await client.connect();
  console.log('✅ Connected!\n');

  const sql = `
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
      status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'closed')),
      pnl_percent DECIMAL(10, 4),
      opened_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      close_price DECIMAL(20, 8),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Processed signals for deduplication
    CREATE TABLE IF NOT EXISTS processed_signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      signal_key VARCHAR(200) NOT NULL UNIQUE,
      processed_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
    CREATE INDEX IF NOT EXISTS idx_signals_opened_at ON signals(opened_at);
    CREATE INDEX IF NOT EXISTS idx_processed_signals_key ON processed_signals(signal_key);
    CREATE INDEX IF NOT EXISTS idx_processed_signals_expires ON processed_signals(expires_at);
  `;

  console.log('📦 Creating tables...');
  await client.query(sql);
  console.log('✅ Tables created!\n');

  // Enable RLS and create policies
  const rlsSQL = `
    ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE processed_signals ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "public_signals" ON signals;
    DROP POLICY IF EXISTS "public_processed" ON processed_signals;
    
    CREATE POLICY "public_signals" ON signals FOR ALL USING (true);
    CREATE POLICY "public_processed" ON processed_signals FOR ALL USING (true);
  `;

  console.log('🔐 Setting up access policies...');
  await client.query(rlsSQL);
  console.log('✅ Policies created!\n');

  // Verify
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('signals', 'processed_signals')
  `);
  
  console.log('📋 Tables in database:');
  rows.forEach(r => console.log(`   - ${r.table_name}`));

  await client.end();
  console.log('\n🎉 Database setup complete!');
}

createTables().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
