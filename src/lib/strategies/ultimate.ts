/**
 * Ultimate Strategy - Multi-Strategy Confluence
 * 
 * CONCEPT:
 * - Run ALL other strategies simultaneously
 * - Only trade when 5+ strategies agree on direction
 * - Use the best stop/target from agreeing strategies
 * - Fewer trades, much higher win rate
 * 
 * EXPECTED:
 * - 50-100 trades per year (vs 2000+)
 * - 60-80% win rate (vs 30-35%)
 * - High conviction setups only
 */

import { Strategy, StrategyInput, StrategySignal, SignalType } from './types';

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

// All strategies to evaluate
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

// Minimum strategies that must agree
const MIN_CONFLUENCE = 5;

// Strong signal threshold
const STRONG_CONFLUENCE = 7;

interface StrategyVote {
  strategyId: string;
  strategyName: string;
  direction: 'long' | 'short' | 'neutral';
  strength: number;
  stop?: number;
  target?: number;
  reasons: string[];
}

function getDirection(signal: SignalType): 'long' | 'short' | 'neutral' {
  if (signal === 'LONG' || signal === 'STRONG_LONG') return 'long';
  if (signal === 'SHORT' || signal === 'STRONG_SHORT') return 'short';
  return 'neutral';
}

export const ultimateStrategy: Strategy = {
  id: 'ultimate',
  name: 'Ultimate Strategy',
  description: 'Multi-strategy confluence - trades only when 5+ strategies agree',
  category: 'confluence',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price } = input;
    
    // Collect votes from all strategies
    const votes: StrategyVote[] = [];
    
    for (const strategy of ALL_STRATEGIES) {
      try {
        const signal = strategy.evaluate(input);
        const direction = getDirection(signal.type);
        
        votes.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          direction,
          strength: signal.strength,
          stop: signal.stop,
          target: signal.target,
          reasons: signal.reasons,
        });
      } catch (e) {
        // Skip failed strategies
        console.error(`Strategy ${strategy.id} failed:`, e);
      }
    }
    
    // Count votes by direction
    const longVotes = votes.filter(v => v.direction === 'long');
    const shortVotes = votes.filter(v => v.direction === 'short');
    const neutralVotes = votes.filter(v => v.direction === 'neutral');
    
    const longCount = longVotes.length;
    const shortCount = shortVotes.length;
    
    // Build reasons
    const reasons: string[] = [];
    reasons.push(`📊 Confluence: ${longCount} LONG | ${shortCount} SHORT | ${neutralVotes.length} neutral`);
    
    // Check for confluence
    let finalDirection: 'long' | 'short' | null = null;
    let agreeing: StrategyVote[] = [];
    
    if (longCount >= MIN_CONFLUENCE && longCount > shortCount) {
      finalDirection = 'long';
      agreeing = longVotes;
      reasons.push(`✅ ${longCount} strategies agree on LONG`);
    } else if (shortCount >= MIN_CONFLUENCE && shortCount > longCount) {
      finalDirection = 'short';
      agreeing = shortVotes;
      reasons.push(`✅ ${shortCount} strategies agree on SHORT`);
    } else {
      // Not enough confluence
      if (longCount > 0 || shortCount > 0) {
        reasons.push(`⏳ Need ${MIN_CONFLUENCE}+ to agree (waiting)`);
      }
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons,
      };
    }
    
    // List agreeing strategies
    const agreeingNames = agreeing.map(v => v.strategyName).join(', ');
    reasons.push(`Agreeing: ${agreeingNames}`);
    
    // Calculate best stop (tightest = closest to entry)
    const stopsWithValue = agreeing.filter(v => v.stop !== undefined);
    let bestStop: number | undefined;
    
    if (stopsWithValue.length > 0) {
      if (finalDirection === 'long') {
        // For long, tightest stop is the highest (closest to entry)
        bestStop = Math.max(...stopsWithValue.map(v => v.stop!));
      } else {
        // For short, tightest stop is the lowest (closest to entry)
        bestStop = Math.min(...stopsWithValue.map(v => v.stop!));
      }
    }
    
    // Calculate best target (most conservative = closest to entry)
    const targetsWithValue = agreeing.filter(v => v.target !== undefined);
    let bestTarget: number | undefined;
    
    if (targetsWithValue.length > 0) {
      if (finalDirection === 'long') {
        // For long, conservative target is the lowest
        bestTarget = Math.min(...targetsWithValue.map(v => v.target!));
      } else {
        // For short, conservative target is the highest
        bestTarget = Math.max(...targetsWithValue.map(v => v.target!));
      }
    }
    
    // Ensure minimum R:R of 1.5:1
    if (bestStop && bestTarget) {
      const risk = Math.abs(price - bestStop);
      const reward = Math.abs(bestTarget - price);
      const rr = reward / risk;
      
      if (rr < 1.5) {
        // Adjust target to maintain 1.5:1
        if (finalDirection === 'long') {
          bestTarget = price + (risk * 1.5);
        } else {
          bestTarget = price - (risk * 1.5);
        }
        reasons.push(`R:R adjusted to 1.5:1`);
      } else {
        reasons.push(`R:R ${rr.toFixed(1)}:1`);
      }
    }
    
    // Calculate strength based on confluence level
    const confluenceCount = agreeing.length;
    const avgStrength = agreeing.reduce((sum, v) => sum + v.strength, 0) / agreeing.length;
    
    // Score: base on confluence count + average strength
    let score = 50;
    score += (confluenceCount - MIN_CONFLUENCE) * 10;  // +10 per extra strategy
    score += avgStrength * 0.3;  // Boost from individual strengths
    score = Math.min(score, 100);
    
    // Determine signal type
    let signalType: SignalType;
    if (confluenceCount >= STRONG_CONFLUENCE) {
      signalType = finalDirection === 'long' ? 'STRONG_LONG' : 'STRONG_SHORT';
      reasons.push(`🔥 STRONG signal (${confluenceCount} strategies)`);
    } else {
      signalType = finalDirection === 'long' ? 'LONG' : 'SHORT';
    }
    
    return {
      type: signalType,
      strength: score,
      entry: price,
      stop: bestStop,
      target: bestTarget,
      reasons,
    };
  },
};
