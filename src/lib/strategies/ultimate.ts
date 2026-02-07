/**
 * Ultimate Strategy V3 - Voting Window
 * 
 * PROBLEM WITH V1/V2:
 * - Required strategies to agree on SAME candle
 * - Strategies trigger at different times, rarely overlap
 * - Generated 0 trades in backtests
 * 
 * V3 SOLUTION - Voting Window:
 * - Track recent signals from all strategies (last N candles)
 * - If multiple strategies fired in same direction recently → confluence
 * - More realistic: strategies agree on TREND, not exact entry
 */

import { Strategy, StrategyInput, StrategySignal, SignalType, OHLCVData } from './types';

// Import all other strategies
import { macdMomentum } from './macd-momentum';
import { bollingerSqueeze } from './bollinger-squeeze';
import { ribbonRider } from './ribbon-rider';
import { meanReversion } from './mean-reversion';
import { divergenceHunter } from './divergence-hunter';
import { compressionCannon } from './compression-cannon';
import { crossoverCascade } from './crossover-cascade';
import { dynamicBounce } from './dynamic-bounce';
import { volumeBreakout } from './volume-breakout';

// Strategy weights based on P&L performance
const STRATEGY_WEIGHTS: Record<string, number> = {
  'macd-momentum': 3.5,
  'bollinger-squeeze': 2.7,
  'ribbon-rider': 1.6,
  'mean-reversion': 0.75,
  'divergence-hunter': 0.75,
  'compression-cannon': 0.2,
  'crossover-cascade': 0.2,
  'dynamic-bounce': 0.15,
  'volume-breakout': 0.1,
};

const ALL_STRATEGIES = [
  macdMomentum,
  bollingerSqueeze,
  ribbonRider,
  meanReversion,
  divergenceHunter,
  compressionCannon,
  crossoverCascade,
  dynamicBounce,
  volumeBreakout,
];

// How many candles to look back for recent signals
// V3.1: Reduced to 1 (current only) to avoid Vercel timeout
const LOOKBACK_CANDLES = 1;

// Thresholds - lowered for single-candle evaluation
// MACD at 70% = 3.5 * 0.7 = 2.45, Bollinger at 60% = 2.7 * 0.6 = 1.62
// Two top strategies agreeing = ~4.0
const SIGNAL_THRESHOLD = 1.5;  // ~1 top strategy or 2 mid-tier
const STRONG_THRESHOLD = 3.5;  // 2+ top strategies agreeing

function getDirection(signal: SignalType): 'long' | 'short' | 'neutral' {
  if (signal === 'LONG' || signal === 'STRONG_LONG') return 'long';
  if (signal === 'SHORT' || signal === 'STRONG_SHORT') return 'short';
  return 'neutral';
}

export const ultimateStrategy: Strategy = {
  id: 'ultimate',
  name: 'Ultimate Strategy',
  description: 'V3: Voting window - aggregates signals over recent candles',
  category: 'confluence',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price, candles, candles4h } = input;
    
    if (candles.length < 60) {
      return { type: 'NEUTRAL', strength: 0, reasons: ['Insufficient data'] };
    }
    
    // Evaluate each strategy at current candle AND recent candles
    const recentVotes: Map<string, { direction: 'long' | 'short'; strength: number; weight: number; stop?: number; target?: number }> = new Map();
    
    // Check current candle and lookback
    for (let offset = 0; offset < Math.min(LOOKBACK_CANDLES, candles.length - 50); offset++) {
      const endIdx = candles.length - offset;
      const historicalCandles = candles.slice(0, endIdx);
      
      if (historicalCandles.length < 50) continue;
      
      const historicalInput: StrategyInput = {
        symbol: input.symbol,
        timeframe: input.timeframe,
        price: historicalCandles[historicalCandles.length - 1].close,
        candles: historicalCandles,
        candles4h: candles4h ? candles4h.slice(0, Math.floor(endIdx / 4)) : undefined,
      };
      
      for (const strategy of ALL_STRATEGIES) {
        try {
          const signal = strategy.evaluate(historicalInput);
          const direction = getDirection(signal.type);
          
          if (direction !== 'neutral' && signal.strength > 40) {
            const weight = STRATEGY_WEIGHTS[strategy.id] || 1;
            const existing = recentVotes.get(strategy.id);
            
            // Only keep the strongest signal per strategy
            if (!existing || signal.strength > existing.strength) {
              // Decay weight for older signals
              const decayFactor = 1 - (offset * 0.15); // 15% decay per candle back
              
              recentVotes.set(strategy.id, {
                direction,
                strength: signal.strength,
                weight: weight * decayFactor,
                stop: offset === 0 ? signal.stop : undefined,  // Only use stop/target from current
                target: offset === 0 ? signal.target : undefined,
              });
            }
          }
        } catch (e) {
          // Skip failed strategies
        }
      }
    }
    
    // Count weighted votes
    let longScore = 0;
    let shortScore = 0;
    const longVotes: string[] = [];
    const shortVotes: string[] = [];
    let bestStop: number | undefined;
    let bestTarget: number | undefined;
    
    for (const [strategyId, vote] of recentVotes) {
      const effectiveWeight = vote.weight * (vote.strength / 100);
      
      if (vote.direction === 'long') {
        longScore += effectiveWeight;
        longVotes.push(strategyId);
        
        // Track stops/targets from agreeing strategies
        if (vote.stop) {
          if (!bestStop || vote.stop > bestStop) bestStop = vote.stop;
        }
        if (vote.target) {
          if (!bestTarget || vote.target < bestTarget) bestTarget = vote.target;
        }
      } else if (vote.direction === 'short') {
        shortScore += effectiveWeight;
        shortVotes.push(strategyId);
        
        if (vote.stop) {
          if (!bestStop || vote.stop < bestStop) bestStop = vote.stop;
        }
        if (vote.target) {
          if (!bestTarget || vote.target > bestTarget) bestTarget = vote.target;
        }
      }
    }
    
    const reasons: string[] = [];
    reasons.push(`📊 Window votes: LONG ${longScore.toFixed(1)} (${longVotes.length}) | SHORT ${shortScore.toFixed(1)} (${shortVotes.length})`);
    
    // Determine direction
    let finalDirection: 'long' | 'short' | null = null;
    let score = 0;
    
    if (longScore >= SIGNAL_THRESHOLD && longScore > shortScore) {
      finalDirection = 'long';
      score = longScore;
      reasons.push(`✅ LONG: ${longVotes.join(', ')}`);
    } else if (shortScore >= SIGNAL_THRESHOLD && shortScore > longScore) {
      finalDirection = 'short';
      score = shortScore;
      reasons.push(`✅ SHORT: ${shortVotes.join(', ')}`);
    } else {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: [...reasons, `⏳ Need ${SIGNAL_THRESHOLD}+ weighted score`],
      };
    }
    
    // Ensure valid R:R
    if (bestStop && bestTarget) {
      const risk = Math.abs(price - bestStop);
      const reward = Math.abs(bestTarget - price);
      if (reward / risk < 1.5) {
        bestTarget = finalDirection === 'long' 
          ? price + risk * 1.5 
          : price - risk * 1.5;
      }
      reasons.push(`R:R ${(Math.abs(bestTarget - price) / Math.abs(price - bestStop)).toFixed(1)}:1`);
    }
    
    const normalizedStrength = Math.min(Math.round((score / 10) * 100), 100);
    
    let signalType: SignalType;
    if (score >= STRONG_THRESHOLD) {
      signalType = finalDirection === 'long' ? 'STRONG_LONG' : 'STRONG_SHORT';
      reasons.push(`🔥 HIGH conviction`);
    } else {
      signalType = finalDirection === 'long' ? 'LONG' : 'SHORT';
    }
    
    return {
      type: signalType,
      strength: normalizedStrength,
      entry: price,
      stop: bestStop,
      target: bestTarget,
      reasons,
    };
  },
};
