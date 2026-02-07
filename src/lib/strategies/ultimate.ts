/**
 * Ultimate Strategy V2 - Weighted Confluence
 * 
 * PROBLEM WITH V1:
 * - Required 3-5 strategies to agree on same candle
 * - This is too rare - strategies trigger at different times
 * 
 * V2 APPROACH - Weighted Voting:
 * - Each strategy vote is weighted by its historical performance
 * - Better strategies get more voting power
 * - Signal when weighted score exceeds threshold
 * - Much more signals while still being selective
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

// Strategy weights based on backtest P&L performance
// Higher performing strategies get more weight
const STRATEGY_WEIGHTS: Record<string, number> = {
  'macd-momentum': 3.5,      // +353% P&L - top performer
  'bollinger-squeeze': 2.7,  // +272% P&L
  'ribbon-rider': 1.6,       // +158% P&L
  'mean-reversion': 0.75,    // +74% P&L
  'divergence-hunter': 0.75, // +74% P&L
  'compression-cannon': 0.2, // +20% P&L but few trades
  'crossover-cascade': 0.2,  // +18% P&L
  'dynamic-bounce': 0.15,    // +15% P&L
  'volume-breakout': 0.1,    // +10% P&L
};

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

// Thresholds - calibrated based on weight distribution
// MACD (3.5) + Bollinger (2.7) agreeing = 6.2 max if both at 100%
// Realistically: MACD (70%) + Bollinger (60%) = 2.45 + 1.62 = 4.07
const SIGNAL_THRESHOLD = 2.0;    // ~2 top strategies agreeing at moderate strength
const STRONG_THRESHOLD = 4.0;    // 3+ strategies agreeing strongly

interface StrategyVote {
  strategyId: string;
  strategyName: string;
  direction: 'long' | 'short' | 'neutral';
  strength: number;
  weight: number;
  stop?: number;
  target?: number;
}

function getDirection(signal: SignalType): 'long' | 'short' | 'neutral' {
  if (signal === 'LONG' || signal === 'STRONG_LONG') return 'long';
  if (signal === 'SHORT' || signal === 'STRONG_SHORT') return 'short';
  return 'neutral';
}

export const ultimateStrategy: Strategy = {
  id: 'ultimate',
  name: 'Ultimate Strategy',
  description: 'V2: Weighted confluence - top strategies have more voting power',
  category: 'confluence',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    const { price } = input;
    
    // Collect weighted votes from all strategies
    const votes: StrategyVote[] = [];
    
    for (const strategy of ALL_STRATEGIES) {
      try {
        const signal = strategy.evaluate(input);
        const direction = getDirection(signal.type);
        const weight = STRATEGY_WEIGHTS[strategy.id] || 1;
        
        votes.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          direction,
          strength: signal.strength,
          weight,
          stop: signal.stop,
          target: signal.target,
        });
      } catch (e) {
        // Skip failed strategies
      }
    }
    
    // Calculate weighted scores
    let longScore = 0;
    let shortScore = 0;
    const longVotes: StrategyVote[] = [];
    const shortVotes: StrategyVote[] = [];
    
    for (const vote of votes) {
      // Weight the vote by strategy performance AND signal strength
      const effectiveWeight = vote.weight * (vote.strength / 100);
      
      if (vote.direction === 'long') {
        longScore += effectiveWeight;
        longVotes.push(vote);
      } else if (vote.direction === 'short') {
        shortScore += effectiveWeight;
        shortVotes.push(vote);
      }
    }
    
    const reasons: string[] = [];
    reasons.push(`📊 Weighted: LONG ${longScore.toFixed(1)} | SHORT ${shortScore.toFixed(1)}`);
    
    // Determine direction based on weighted score
    let finalDirection: 'long' | 'short' | null = null;
    let agreeing: StrategyVote[] = [];
    let score = 0;
    
    if (longScore >= SIGNAL_THRESHOLD && longScore > shortScore) {
      finalDirection = 'long';
      agreeing = longVotes;
      score = longScore;
      reasons.push(`✅ LONG confirmed (${longVotes.length} strategies)`);
    } else if (shortScore >= SIGNAL_THRESHOLD && shortScore > longScore) {
      finalDirection = 'short';
      agreeing = shortVotes;
      score = shortScore;
      reasons.push(`✅ SHORT confirmed (${shortVotes.length} strategies)`);
    } else {
      // Not enough conviction
      if (longScore > 0 || shortScore > 0) {
        reasons.push(`⏳ Need >${SIGNAL_THRESHOLD} weighted score`);
      }
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons,
      };
    }
    
    // List top contributing strategies
    const topContributors = agreeing
      .sort((a, b) => b.weight * b.strength - a.weight * a.strength)
      .slice(0, 3)
      .map(v => v.strategyName);
    reasons.push(`Top: ${topContributors.join(', ')}`);
    
    // Calculate stop from agreeing strategies (use tightest)
    const stopsWithValue = agreeing.filter(v => v.stop !== undefined);
    let bestStop: number | undefined;
    
    if (stopsWithValue.length > 0) {
      if (finalDirection === 'long') {
        bestStop = Math.max(...stopsWithValue.map(v => v.stop!));
      } else {
        bestStop = Math.min(...stopsWithValue.map(v => v.stop!));
      }
    }
    
    // Calculate target (use most conservative)
    const targetsWithValue = agreeing.filter(v => v.target !== undefined);
    let bestTarget: number | undefined;
    
    if (targetsWithValue.length > 0) {
      if (finalDirection === 'long') {
        bestTarget = Math.min(...targetsWithValue.map(v => v.target!));
      } else {
        bestTarget = Math.max(...targetsWithValue.map(v => v.target!));
      }
    }
    
    // Ensure minimum R:R
    if (bestStop && bestTarget) {
      const risk = Math.abs(price - bestStop);
      const reward = Math.abs(bestTarget - price);
      const rr = reward / risk;
      
      if (rr < 1.5) {
        if (finalDirection === 'long') {
          bestTarget = price + (risk * 1.5);
        } else {
          bestTarget = price - (risk * 1.5);
        }
      }
      reasons.push(`R:R ${(Math.abs(bestTarget - price) / Math.abs(price - bestStop)).toFixed(1)}:1`);
    }
    
    // Normalize score to 0-100
    const normalizedStrength = Math.min(Math.round((score / 10) * 100), 100);
    
    // Determine signal type
    let signalType: SignalType;
    if (score >= STRONG_THRESHOLD) {
      signalType = finalDirection === 'long' ? 'STRONG_LONG' : 'STRONG_SHORT';
      reasons.push(`🔥 HIGH conviction (${score.toFixed(1)})`);
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
