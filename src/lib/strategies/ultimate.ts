/**
 * Ultimate Strategy V4 - MACD + Confirmation
 * 
 * SIMPLE APPROACH:
 * - Use MACD (our #1 performer at +353%) as the primary signal
 * - Only take the trade when at least 1 other strategy confirms
 * - This filters MACD's 2451 trades down to higher-probability setups
 * 
 * Expected:
 * - Fewer trades than MACD alone
 * - Higher win rate (filtered by confluence)
 * - Still plenty of signals (not 0!)
 */

import { Strategy, StrategyInput, StrategySignal, SignalType } from './types';

// Import strategies
import { macdMomentum } from './macd-momentum';
import { bollingerSqueeze } from './bollinger-squeeze';
import { ribbonRider } from './ribbon-rider';
import { meanReversion } from './mean-reversion';
import { divergenceHunter } from './divergence-hunter';
import { crossoverCascade } from './crossover-cascade';

// Confirmation strategies (excluding MACD which is primary)
const CONFIRMING_STRATEGIES = [
  bollingerSqueeze,
  ribbonRider,
  meanReversion,
  divergenceHunter,
  crossoverCascade,
];

function getDirection(signal: SignalType): 'long' | 'short' | 'neutral' {
  if (signal === 'LONG' || signal === 'STRONG_LONG') return 'long';
  if (signal === 'SHORT' || signal === 'STRONG_SHORT') return 'short';
  return 'neutral';
}

export const ultimateStrategy: Strategy = {
  id: 'ultimate',
  name: 'Ultimate Strategy',
  description: 'V4: MACD signals confirmed by at least 1 other strategy',
  category: 'confluence',
  timeframes: ['1h', '4h'],
  
  evaluate: (input: StrategyInput): StrategySignal => {
    // Step 1: Get MACD signal
    const macdSignal = macdMomentum.evaluate(input);
    const macdDirection = getDirection(macdSignal.type);
    
    // If MACD is neutral, we're neutral
    if (macdDirection === 'neutral') {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: ['MACD neutral - waiting for primary signal'],
      };
    }
    
    // Step 2: Check for confirmations
    const confirmations: string[] = [];
    let totalConfirmStrength = 0;
    
    for (const strategy of CONFIRMING_STRATEGIES) {
      try {
        const signal = strategy.evaluate(input);
        const direction = getDirection(signal.type);
        
        // Must agree with MACD direction
        if (direction === macdDirection && signal.strength >= 40) {
          confirmations.push(strategy.name);
          totalConfirmStrength += signal.strength;
        }
      } catch (e) {
        // Skip failed strategies
      }
    }
    
    // Step 3: Need at least 1 confirmation
    if (confirmations.length === 0) {
      return {
        type: 'NEUTRAL',
        strength: 0,
        reasons: [
          `MACD says ${macdDirection.toUpperCase()} but no confirmation`,
          'Waiting for confluence...'
        ],
      };
    }
    
    // Step 4: We have confluence! Generate signal
    const reasons: string[] = [];
    reasons.push(`✅ MACD ${macdDirection.toUpperCase()} (${macdSignal.strength}%)`);
    reasons.push(`✅ Confirmed by: ${confirmations.join(', ')}`);
    
    // Calculate combined strength
    const avgConfirmStrength = totalConfirmStrength / confirmations.length;
    const combinedStrength = Math.round((macdSignal.strength + avgConfirmStrength) / 2);
    
    // Use MACD's stop/target as base
    let stop = macdSignal.stop;
    let target = macdSignal.target;
    
    // Determine signal strength
    let signalType: SignalType;
    if (confirmations.length >= 3) {
      signalType = macdDirection === 'long' ? 'STRONG_LONG' : 'STRONG_SHORT';
      reasons.push(`🔥 Strong confluence (${confirmations.length} confirmations)`);
    } else if (confirmations.length >= 2) {
      signalType = macdDirection === 'long' ? 'STRONG_LONG' : 'STRONG_SHORT';
      reasons.push(`Good confluence (${confirmations.length} confirmations)`);
    } else {
      signalType = macdDirection === 'long' ? 'LONG' : 'SHORT';
    }
    
    // Add R:R info if available
    if (stop && target) {
      const risk = Math.abs(input.price - stop);
      const reward = Math.abs(target - input.price);
      reasons.push(`R:R ${(reward / risk).toFixed(1)}:1`);
    }
    
    return {
      type: signalType,
      strength: combinedStrength,
      entry: input.price,
      stop,
      target,
      reasons,
    };
  },
};
