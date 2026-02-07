/**
 * Local Backtest - bypasses Vercel cache
 */
import { STRATEGIES } from '../src/lib/strategies/index';
import { buildIndicators } from '../src/lib/indicators';
import { OHLCVData } from '../src/lib/strategies/types';

console.log('=== LOCAL STRATEGY TEST ===\n');
console.log('Registered strategies:', STRATEGIES.length);
STRATEGIES.forEach((s, i) => {
  console.log(`  ${i + 1}. ${s.id} - ${s.name}`);
});

// Quick test with mock trending data
const mockCandles: OHLCVData[] = [];
let price = 50000;
for (let i = 0; i < 200; i++) {
  // Simulate uptrend
  price = price * (1 + (Math.random() - 0.4) * 0.015);
  mockCandles.push({
    timestamp: Date.now() - (200 - i) * 3600000,
    open: price * 0.998,
    high: price * 1.008,
    low: price * 0.992,
    close: price,
    volume: 1000 + Math.random() * 2000
  });
}

// Build indicators
const indicators = buildIndicators(mockCandles.map(c => c.close), mockCandles);

const input = {
  symbol: 'BTC',
  timeframe: '1h',
  price: mockCandles[mockCandles.length - 1].close,
  candles: mockCandles,
  indicators,
};

console.log('\n=== TESTING ALL STRATEGIES ===\n');
console.log(`Price: ${input.price.toFixed(2)}`);
console.log('');

for (const strategy of STRATEGIES) {
  try {
    const result = strategy.evaluate(input);
    const emoji = result.type.includes('LONG') ? '📈' : 
                  result.type.includes('SHORT') ? '📉' : '⏸️';
    console.log(`${emoji} ${strategy.name}: ${result.type} (${result.strength}%)`);
    if (result.type !== 'NEUTRAL') {
      console.log(`   Reasons: ${result.reasons.slice(0, 2).join(' | ')}`);
    }
  } catch (e) {
    console.log(`❌ ${strategy.name}: ERROR - ${e}`);
  }
}
