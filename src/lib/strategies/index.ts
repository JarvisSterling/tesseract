/**
 * Tesseract Strategy Engine
 * 
 * A modular strategy framework supporting multiple independent strategies
 * that can be evaluated simultaneously and combined for meta-signals.
 */

export * from './types';

import { Strategy, StrategyInput, StrategyResult, StrategySignal } from './types';
import { ribbonRider } from './ribbon-rider';
import { compressionCannon } from './compression-cannon';
import { dynamicBounce } from './dynamic-bounce';
import { crossoverCascade } from './crossover-cascade';
import { divergenceHunter } from './divergence-hunter';

// ============================================
// STRATEGY REGISTRY
// ============================================

export const STRATEGIES: Strategy[] = [
  ribbonRider,
  compressionCannon,
  dynamicBounce,
  crossoverCascade,
  divergenceHunter,
];

export const STRATEGY_MAP = new Map<string, Strategy>(
  STRATEGIES.map(s => [s.id, s])
);

// ============================================
// STRATEGY ENGINE
// ============================================

export interface EngineConfig {
  enabledStrategies?: string[]; // If empty/undefined, run all
  minStrength?: number;         // Minimum signal strength to report
}

export interface EngineResult {
  symbol: string;
  timeframe: string;
  timestamp: number;
  strategies: StrategyResult[];
  consensus: {
    bullish: number;
    bearish: number;
    neutral: number;
    strongestSignal: StrategyResult | null;
  };
}

/**
 * Run all enabled strategies against the input data
 */
export function evaluateStrategies(
  input: StrategyInput,
  config: EngineConfig = {}
): EngineResult {
  const { enabledStrategies, minStrength = 0 } = config;
  
  const strategiesToRun = enabledStrategies && enabledStrategies.length > 0
    ? STRATEGIES.filter(s => enabledStrategies.includes(s.id))
    : STRATEGIES;
  
  const results: StrategyResult[] = [];
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let strongestSignal: StrategyResult | null = null;
  
  for (const strategy of strategiesToRun) {
    try {
      const signal = strategy.evaluate(input);
      
      // Skip weak signals if configured
      if (signal.strength < minStrength) continue;
      
      const result: StrategyResult = {
        id: strategy.id,
        name: strategy.name,
        category: strategy.category,
        signal,
        timestamp: Date.now(),
      };
      
      results.push(result);
      
      // Count for consensus
      if (signal.type.includes('LONG')) {
        bullishCount++;
      } else if (signal.type.includes('SHORT')) {
        bearishCount++;
      } else {
        neutralCount++;
      }
      
      // Track strongest
      if (!strongestSignal || signal.strength > strongestSignal.signal.strength) {
        if (signal.type !== 'NEUTRAL') {
          strongestSignal = result;
        }
      }
    } catch (e) {
      console.error(`Strategy ${strategy.id} error:`, e);
    }
  }
  
  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    timestamp: Date.now(),
    strategies: results,
    consensus: {
      bullish: bullishCount,
      bearish: bearishCount,
      neutral: neutralCount,
      strongestSignal,
    },
  };
}

/**
 * Calculate a meta-signal by combining multiple strategy outputs
 */
export function calculateMetaSignal(
  results: StrategyResult[]
): StrategySignal {
  if (results.length === 0) {
    return {
      type: 'NEUTRAL',
      strength: 0,
      reasons: ['No strategy signals'],
    };
  }
  
  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];
  
  for (const result of results) {
    const { signal } = result;
    const weight = signal.strength / 100;
    
    if (signal.type === 'STRONG_LONG') {
      bullScore += 2 * weight;
      reasons.push(`${result.name}: STRONG_LONG (${signal.strength}%)`);
    } else if (signal.type === 'LONG') {
      bullScore += 1 * weight;
      reasons.push(`${result.name}: LONG (${signal.strength}%)`);
    } else if (signal.type === 'STRONG_SHORT') {
      bearScore += 2 * weight;
      reasons.push(`${result.name}: STRONG_SHORT (${signal.strength}%)`);
    } else if (signal.type === 'SHORT') {
      bearScore += 1 * weight;
      reasons.push(`${result.name}: SHORT (${signal.strength}%)`);
    }
  }
  
  const netScore = bullScore - bearScore;
  const totalScore = bullScore + bearScore;
  const strength = totalScore > 0 
    ? Math.round((Math.abs(netScore) / totalScore) * 100)
    : 0;
  
  let type: StrategySignal['type'] = 'NEUTRAL';
  
  if (netScore >= 2) type = 'STRONG_LONG';
  else if (netScore >= 0.5) type = 'LONG';
  else if (netScore <= -2) type = 'STRONG_SHORT';
  else if (netScore <= -0.5) type = 'SHORT';
  
  return {
    type,
    strength,
    reasons,
  };
}

// ============================================
// STRATEGY INFO HELPERS
// ============================================

export function getStrategyInfo(id: string): Strategy | undefined {
  return STRATEGY_MAP.get(id);
}

export function getStrategiesByCategory(category: string): Strategy[] {
  return STRATEGIES.filter(s => s.category === category);
}

export function getRecommendedStrategiesForTimeframe(timeframe: string): Strategy[] {
  return STRATEGIES.filter(s => s.timeframes.includes(timeframe));
}
