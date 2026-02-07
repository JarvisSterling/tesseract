import { ultimateStrategy } from '../src/lib/strategies/ultimate';
import { STRATEGIES } from '../src/lib/strategies/index';

console.log('=== Ultimate Strategy Test ===\n');
console.log('Total strategies registered:', STRATEGIES.length);
console.log('Ultimate included:', STRATEGIES.some(s => s.id === 'ultimate'));

// Create mock candle data (trending up)
const mockCandles = [];
let price = 50000;
for (let i = 0; i < 100; i++) {
  price = price * (1 + (Math.random() - 0.45) * 0.02); // Slight upward bias
  mockCandles.push({
    time: Date.now() - (100 - i) * 3600000,
    open: price * 0.999,
    high: price * 1.005,
    low: price * 0.995,
    close: price,
    volume: 1000 + Math.random() * 500
  });
}

const input = {
  symbol: 'BTC',
  timeframe: '1h' as const,
  price: mockCandles[99].close,
  candles: mockCandles,
  candles4h: mockCandles.filter((_, i) => i % 4 === 0)
};

console.log('\nTesting with mock uptrend data...');
console.log('Current price:', input.price.toFixed(2));

const result = ultimateStrategy.evaluate(input);
console.log('\n=== Result ===');
console.log('Signal:', result.type);
console.log('Strength:', result.strength);
console.log('Entry:', result.entry);
console.log('Stop:', result.stop);
console.log('Target:', result.target);
console.log('Reasons:');
result.reasons.forEach(r => console.log('  -', r));
