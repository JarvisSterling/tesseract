# Tesseract Strategy Tuning Log

## Baseline Analysis (2026-02-07)

**Test Period:** 90 days  
**Symbols:** BTC, ETH, SOL, BNB, XRP

### Initial Performance

| Rank | Strategy | Trades | Win% | Avg Win | Avg Loss | Total P&L | PF | Expect |
|------|----------|--------|------|---------|----------|-----------|-----|--------|
| 1 | Bollinger Squeeze | 479 | 31.1% | +4.08% | -1.32% | +173.14% | 1.40 | +0.36% |
| 2 | MACD Momentum | 502 | 35.7% | +3.10% | -1.31% | +131.11% | 1.31 | +0.26% |
| 3 | Crossover Cascade | 226 | 62.4% | +4.00% | -5.49% | +97.04% | 1.21 | +0.43% |
| 4 | Ribbon Rider | 430 | 32.1% | +2.79% | -1.16% | +44.54% | 1.13 | +0.10% |
| 5 | Volume Breakout | 320 | 30.3% | +2.51% | -0.96% | +30.01% | 1.14 | +0.09% |
| 6 | Dynamic Bounce | 121 | 42.1% | +1.00% | -0.47% | +18.24% | 1.55 | +0.15% |
| 7 | Compression Cannon | 84 | 33.3% | +2.57% | -1.02% | +14.88% | 1.26 | +0.18% |
| 8 | Divergence Hunter | 234 | 53.0% | +2.02% | -2.18% | +9.77% | 1.04 | +0.04% |
| 9 | Mean Reversion | 185 | 24.3% | +3.60% | -1.48% | **-45.33%** | 0.78 | -0.25% |

---

## Fix #1: Mean Reversion Sniper (2026-02-07)

### Before
- **Win Rate:** 24.3% ❌
- **Total P&L:** -45.33% ❌
- **Profit Factor:** 0.78 ❌
- **Max Consecutive Losses:** 14

### Issues Identified
1. **Threshold too low (1.5%)** - Triggered too often on minor deviations
2. **RSI too loose (< 35 / > 65)** - Not extreme enough for reversals
3. **Trend filter too weak** - Caught trending knives
4. **Pattern matching too lenient** - "Simple reversal candle" gave 50 pts

### Changes Made
1. **Deviation threshold:** 1.5% → **3.0%** (only real extensions)
2. **RSI thresholds:** < 35 / > 65 → **< 25 / > 75** for full points, < 35 / > 65 for partial
3. **Trend filter:** Added EMA stack check + slope momentum check
4. **Pattern requirements:** Removed weak "simple reversal", require proper engulfing/hammer/star
5. **New gate:** EMA100/200 support/resistance check (don't catch falling knives)
6. **New gate:** Minimum score threshold increased to 55
7. **Added:** Exhaustion pattern detection for bonus points

### Config Snapshot (V2)
```
Deviation Threshold: 3.0%
RSI Extreme: < 25 (oversold) / > 75 (overbought)
Min Score: 55
ATR Stop Multiplier: 0.8x
Trend Filter: EMA stack + slope > 0.3%
Patterns: Engulfing, Hammer, Star only
```

### Expected Improvement
- Fewer trades (higher quality)
- Higher win rate (stricter filters)
- Better expectancy (only extreme setups)

### After (Pending Re-test)
- TBD

---

## Observations

### Top Performers (don't touch unless broken)
1. **Crossover Cascade** - 62.4% win rate, +0.43%/trade
2. **Divergence Hunter** - 53% win rate, profitable
3. **Dynamic Bounce** - 42% win rate, 1.55 PF

### Profitable but Could Improve
- **Bollinger Squeeze** - 31% win rate but +173% P&L due to great R:R
- **MACD Momentum** - 36% win rate but +131% P&L
- **Ribbon Rider** - Low win rate, high consecutive losses (24)

### Notes
- Low win rate strategies can still be profitable if avg win >> avg loss
- High consecutive losses = harder to trade psychologically
- Consider adding trailing stops for winners
