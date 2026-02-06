'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, AreaSeries } from 'lightweight-charts';
import { X, ExternalLink, TrendingUp, TrendingDown, Minus, Target, Zap, BarChart3, GitBranch } from 'lucide-react';
import { StrategySignals } from './StrategySignals';

interface TimeframeData {
  stack: 'bull' | 'bear' | 'mixed';
  priceVsEma: Record<number, number | null>;
  trend: string;
  emas?: Record<number, number | null>;
}

interface StrategySignal {
  type: 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';
  strength: number;
  entry?: number;
  stop?: number;
  target?: number;
  reasons: string[];
}

interface StrategyResult {
  id: string;
  name: string;
  category: 'swing' | 'scalp' | 'breakout' | 'reversal';
  signal: StrategySignal;
}

interface ChartModalProps {
  crypto: {
    symbol: string;
    name: string;
    price: number;
    priceChange24h: number;
    recentPrices: number[];
    confluence: { score: number; signal: string };
    tradeSignal: { signal: string; confidence: number; reasons: string[] };
    rsi: Record<string, number | null>;
    timeframes: Record<string, TimeframeData>;
    strategies?: StrategyResult[];
  };
  livePrice?: number;
  liveChange?: number;
  onClose: () => void;
}

// Recalculate price vs EMA with live price
function calcLivePriceVsEma(ema: number | null, livePrice: number): number | null {
  if (ema === null || ema === 0) return null;
  return ((livePrice - ema) / ema) * 100;
}

// Recalculate stack based on live price and EMAs
function calcLiveStack(emas: Record<number, number | null>, livePrice: number): 'bull' | 'bear' | 'mixed' {
  const periods = [9, 21, 50, 100, 200];
  const values = periods.map(p => emas[p]).filter((v): v is number => v !== null);
  if (values.length < 3) return 'mixed';
  
  // Check if price and EMAs are in perfect bull order (price > 9 > 21 > 50 > 100 > 200)
  const allWithPrice = [livePrice, ...values];
  let bull = true, bear = true;
  for (let i = 0; i < allWithPrice.length - 1; i++) {
    if (allWithPrice[i] <= allWithPrice[i + 1]) bull = false;
    if (allWithPrice[i] >= allWithPrice[i + 1]) bear = false;
  }
  return bull ? 'bull' : bear ? 'bear' : 'mixed';
}

// Recalculate trend based on live price
function calcLiveTrend(emas: Record<number, number | null>, livePrice: number): string {
  const ema50 = emas[50];
  const ema200 = emas[200];
  if (!ema50 || !ema200) return 'neutral';
  if (livePrice > ema50 && livePrice > ema200) return 'bullish';
  if (livePrice < ema50 && livePrice < ema200) return 'bearish';
  return 'neutral';
}

export function ChartModal({ crypto, livePrice, liveChange, onClose }: ChartModalProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const pricesRef = useRef<number[]>([...crypto.recentPrices]);
  
  // Current display values
  const displayPrice = livePrice ?? crypto.price;
  const displayChange = liveChange ?? crypto.priceChange24h;
  
  // Track price direction for flash effect
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef<number>(displayPrice);
  
  // Update chart with live price
  useEffect(() => {
    if (livePrice && seriesRef.current && livePrice !== prevPriceRef.current) {
      // Determine direction
      setPriceDirection(livePrice > prevPriceRef.current ? 'up' : 'down');
      setTimeout(() => setPriceDirection(null), 300);
      
      prevPriceRef.current = livePrice;
      
      // Add new price point to chart
      const now = Math.floor(Date.now() / 1000);
      seriesRef.current.update({
        time: now as any,
        value: livePrice,
      });
    }
  }, [livePrice]);

  useEffect(() => {
    if (!chartContainerRef.current || crypto.recentPrices.length < 2) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#18181b' },
        textColor: '#a1a1aa',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#6366f1', width: 1, style: 2 },
        horzLine: { color: '#6366f1', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#27272a',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
      },
    });

    chartRef.current = chart;

    // Responsive resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: 400,
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Add area series
    const isUp = crypto.recentPrices[crypto.recentPrices.length - 1] >= crypto.recentPrices[0];
    const color = isUp ? '#10b981' : '#f43f5e';

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}30`,
      bottomColor: 'transparent',
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    
    seriesRef.current = areaSeries;

    // Convert to time series
    const now = Date.now();
    const interval = 3600000; // 1 hour
    const seriesData = crypto.recentPrices.map((price, i) => ({
      time: Math.floor((now - (crypto.recentPrices.length - i) * interval) / 1000) as any,
      value: price,
    }));

    areaSeries.setData(seriesData);
    chart.timeScale().fitContent();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [crypto.recentPrices]);

  // Close on escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const signalIcon = crypto.tradeSignal.signal.includes('LONG') 
    ? <TrendingUp className="text-emerald-400" size={20} />
    : crypto.tradeSignal.signal.includes('SHORT')
    ? <TrendingDown className="text-rose-400" size={20} />
    : <Minus className="text-zinc-400" size={20} />;

  const signalColor = crypto.tradeSignal.signal.includes('LONG')
    ? 'text-emerald-400'
    : crypto.tradeSignal.signal.includes('SHORT')
    ? 'text-rose-400'
    : 'text-zinc-400';

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-lg font-bold">
              {crypto.symbol.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-white">{crypto.symbol}</span>
                <span className="text-zinc-500">{crypto.name}</span>
                <a
                  href={`https://www.tradingview.com/chart/?symbol=BINANCE:${crypto.symbol}USDT`}
                  target="_blank"
                  rel="noopener"
                  className="text-zinc-500 hover:text-blue-400 transition-colors"
                >
                  <ExternalLink size={16} />
                </a>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-2xl font-mono font-bold transition-colors duration-150 ${
                  priceDirection === 'up' ? 'text-emerald-400' :
                  priceDirection === 'down' ? 'text-rose-400' : 'text-white'
                }`}>
                  ${displayPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span className={`text-sm font-bold ${displayChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {displayChange >= 0 ? '+' : ''}{displayChange.toFixed(2)}%
                </span>
                {livePrice && (
                  <span className="flex items-center gap-1 text-xs text-emerald-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Chart */}
        <div ref={chartContainerRef} className="w-full h-[400px]" />

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border-t border-zinc-800">
          {/* Signal */}
          <div className="bg-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Signal</div>
            <div className={`flex items-center gap-2 text-lg font-bold ${signalColor}`}>
              {signalIcon}
              {crypto.tradeSignal.signal.replace('STRONG_', '').replace('_', ' ')}
            </div>
            <div className="text-xs text-zinc-500 mt-1">{crypto.tradeSignal.confidence}% confidence</div>
          </div>

          {/* Confluence */}
          <div className="bg-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Confluence</div>
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-white">{crypto.confluence.score}</div>
              <div className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all ${
                    crypto.confluence.score >= 60 ? 'bg-emerald-500' :
                    crypto.confluence.score <= 40 ? 'bg-rose-500' : 'bg-zinc-500'
                  }`}
                  style={{ width: `${crypto.confluence.score}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {crypto.confluence.score >= 60 ? 'Bullish' : crypto.confluence.score <= 40 ? 'Bearish' : 'Neutral'}
            </div>
          </div>

          {/* RSI */}
          <div className="bg-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-500 mb-1">RSI (1h)</div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${
                (crypto.rsi['1h'] || 50) > 70 ? 'text-rose-400' :
                (crypto.rsi['1h'] || 50) < 30 ? 'text-emerald-400' : 'text-white'
              }`}>
                {crypto.rsi['1h']?.toFixed(0) || '-'}
              </div>
              <div className="text-xs text-zinc-500">
                {(crypto.rsi['1h'] || 50) > 70 ? 'Overbought' :
                 (crypto.rsi['1h'] || 50) < 30 ? 'Oversold' : 'Neutral'}
              </div>
            </div>
          </div>

          {/* Timeframe Stacks - Live Updated */}
          <div className="bg-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-500 mb-2">EMA Stacks {livePrice && <span className="text-emerald-500">(Live)</span>}</div>
            <div className="flex gap-2">
              {['15m', '1h', '4h', '1d'].map(tf => {
                const tfData = crypto.timeframes[tf];
                // Recalculate stack with live price if available
                const stack = livePrice && tfData?.emas 
                  ? calcLiveStack(tfData.emas, displayPrice)
                  : tfData?.stack || 'mixed';
                const color = stack === 'bull' ? 'bg-emerald-500' : stack === 'bear' ? 'bg-rose-500' : 'bg-zinc-600';
                return (
                  <div key={tf} className="flex flex-col items-center">
                    <div className={`w-3 h-3 rounded-full ${color} transition-colors duration-300`} />
                    <span className="text-[10px] text-zinc-500 mt-1">{tf}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Reasons */}
        {crypto.tradeSignal.reasons.length > 0 && (
          <div className="px-4 pb-4">
            <div className="text-xs text-zinc-500 mb-2">Signal Reasons</div>
            <div className="flex flex-wrap gap-2">
              {crypto.tradeSignal.reasons.map((reason, i) => (
                <span 
                  key={i}
                  className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700"
                >
                  {reason}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Strategy Signals */}
        {crypto.strategies && crypto.strategies.length > 0 && (
          <div className="px-4 pb-4">
            <StrategySignals strategies={crypto.strategies} />
          </div>
        )}
      </div>
    </div>
  );
}
