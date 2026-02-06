'use client';

import { useState, useMemo } from 'react';
import { Calculator, DollarSign, Percent, Target, AlertTriangle, X } from 'lucide-react';

interface PositionCalculatorProps {
  symbol: string;
  currentPrice: number;
  suggestedStop?: number;
  suggestedTarget?: number;
  atrPercent?: number;
  onClose: () => void;
}

export function PositionCalculator({
  symbol,
  currentPrice,
  suggestedStop,
  suggestedTarget,
  atrPercent,
  onClose,
}: PositionCalculatorProps) {
  const [accountSize, setAccountSize] = useState<string>('10000');
  const [riskPercent, setRiskPercent] = useState<string>('1');
  const [entryPrice, setEntryPrice] = useState<string>(currentPrice.toFixed(2));
  const [stopPrice, setStopPrice] = useState<string>(suggestedStop?.toFixed(2) || (currentPrice * 0.98).toFixed(2));
  const [targetPrice, setTargetPrice] = useState<string>(suggestedTarget?.toFixed(2) || (currentPrice * 1.03).toFixed(2));
  
  const calculations = useMemo(() => {
    const account = parseFloat(accountSize) || 0;
    const risk = parseFloat(riskPercent) || 0;
    const entry = parseFloat(entryPrice) || 0;
    const stop = parseFloat(stopPrice) || 0;
    const target = parseFloat(targetPrice) || 0;
    
    if (account <= 0 || entry <= 0 || stop <= 0) {
      return null;
    }
    
    const isLong = entry > stop;
    const riskPerShare = Math.abs(entry - stop);
    const riskAmount = account * (risk / 100);
    const positionSize = riskPerShare > 0 ? riskAmount / riskPerShare : 0;
    const positionValue = positionSize * entry;
    const leverage = positionValue / account;
    
    const rewardPerShare = Math.abs(target - entry);
    const rewardAmount = positionSize * rewardPerShare;
    const riskRewardRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;
    
    const stopPercent = ((entry - stop) / entry) * 100;
    const targetPercent = ((target - entry) / entry) * 100;
    
    return {
      isLong,
      riskAmount,
      positionSize,
      positionValue,
      leverage,
      rewardAmount,
      riskRewardRatio,
      stopPercent: Math.abs(stopPercent),
      targetPercent: Math.abs(targetPercent),
    };
  }, [accountSize, riskPercent, entryPrice, stopPrice, targetPrice]);
  
  const useATRStop = () => {
    if (atrPercent) {
      const entry = parseFloat(entryPrice) || currentPrice;
      const stop = entry * (1 - atrPercent * 1.5 / 100);
      setStopPrice(stop.toFixed(2));
    }
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Calculator className="text-indigo-400" size={20} />
            <span className="font-bold text-white">Position Calculator</span>
            <span className="text-zinc-500">{symbol}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded-lg transition-colors">
            <X size={18} className="text-zinc-400" />
          </button>
        </div>
        
        {/* Inputs */}
        <div className="p-4 space-y-4">
          {/* Account & Risk */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
                Account Size
              </label>
              <div className="relative">
                <DollarSign size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="number"
                  value={accountSize}
                  onChange={e => setAccountSize(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg py-2 pl-7 pr-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
                Risk %
              </label>
              <div className="relative">
                <Percent size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="number"
                  step="0.5"
                  value={riskPercent}
                  onChange={e => setRiskPercent(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg py-2 pl-7 pr-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
          
          {/* Entry */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
              Entry Price
            </label>
            <input
              type="number"
              step="0.01"
              value={entryPrice}
              onChange={e => setEntryPrice(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          
          {/* Stop */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Stop Loss
              </label>
              {atrPercent && (
                <button 
                  onClick={useATRStop}
                  className="text-[9px] text-indigo-400 hover:text-indigo-300"
                >
                  Use 1.5x ATR ({(atrPercent * 1.5).toFixed(1)}%)
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.01"
              value={stopPrice}
              onChange={e => setStopPrice(e.target.value)}
              className="w-full bg-zinc-800 border border-rose-500/30 rounded-lg py-2 px-3 text-sm text-rose-400 focus:border-rose-500 focus:outline-none"
            />
          </div>
          
          {/* Target */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
              Take Profit
            </label>
            <input
              type="number"
              step="0.01"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              className="w-full bg-zinc-800 border border-emerald-500/30 rounded-lg py-2 px-3 text-sm text-emerald-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
        
        {/* Results */}
        {calculations && (
          <div className="p-4 bg-zinc-800/50 border-t border-zinc-800 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-900/50 rounded-lg p-3">
                <div className="text-[10px] text-zinc-500 uppercase">Position Size</div>
                <div className="text-lg font-bold text-white font-mono">
                  {calculations.positionSize.toFixed(4)}
                </div>
                <div className="text-[10px] text-zinc-500">
                  ${calculations.positionValue.toFixed(2)}
                </div>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-3">
                <div className="text-[10px] text-zinc-500 uppercase">Risk Amount</div>
                <div className="text-lg font-bold text-rose-400 font-mono">
                  ${calculations.riskAmount.toFixed(2)}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {calculations.stopPercent.toFixed(2)}% from entry
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-zinc-900/50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-zinc-500">R:R Ratio</div>
                <div className={`text-sm font-bold font-mono ${
                  calculations.riskRewardRatio >= 2 ? 'text-emerald-400' :
                  calculations.riskRewardRatio >= 1 ? 'text-amber-400' : 'text-rose-400'
                }`}>
                  1:{calculations.riskRewardRatio.toFixed(1)}
                </div>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-zinc-500">Potential</div>
                <div className="text-sm font-bold text-emerald-400 font-mono">
                  +${calculations.rewardAmount.toFixed(2)}
                </div>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-zinc-500">Leverage</div>
                <div className={`text-sm font-bold font-mono ${
                  calculations.leverage > 3 ? 'text-rose-400' : 'text-zinc-300'
                }`}>
                  {calculations.leverage.toFixed(1)}x
                </div>
              </div>
            </div>
            
            {calculations.leverage > 3 && (
              <div className="flex items-center gap-2 text-[10px] text-amber-400 bg-amber-500/10 rounded-lg p-2">
                <AlertTriangle size={14} />
                High leverage ({calculations.leverage.toFixed(1)}x) - consider smaller position
              </div>
            )}
            
            {calculations.riskRewardRatio < 1.5 && (
              <div className="flex items-center gap-2 text-[10px] text-amber-400 bg-amber-500/10 rounded-lg p-2">
                <AlertTriangle size={14} />
                Low R:R ratio - consider wider target or tighter stop
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
