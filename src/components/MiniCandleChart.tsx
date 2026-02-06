'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, AreaSeries } from 'lightweight-charts';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface MiniCandleChartProps {
  data: number[]; // Close prices for now, will enhance later
  width?: number;
  height?: number;
  bullColor?: string;
  bearColor?: string;
}

export function MiniCandleChart({
  data,
  width = 120,
  height = 40,
  bullColor = '#10b981',
  bearColor = '#f43f5e',
}: MiniCandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length < 2) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#71717a',
        fontSize: 8,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: 0, // Hidden
      },
      rightPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
      },
      handleScale: false,
      handleScroll: false,
    });

    chartRef.current = chart;

    // Create area series for smooth look
    const isUp = data[data.length - 1] >= data[0];
    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: isUp ? bullColor : bearColor,
      topColor: isUp ? `${bullColor}40` : `${bearColor}40`,
      bottomColor: 'transparent',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Convert prices to time series
    const now = Date.now();
    const interval = 3600000; // 1 hour in ms
    const seriesData = data.map((price, i) => ({
      time: Math.floor((now - (data.length - i) * interval) / 1000) as any,
      value: price,
    }));

    areaSeries.setData(seriesData);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data, width, height, bullColor, bearColor]);

  if (data.length < 2) return null;

  return (
    <div 
      ref={containerRef} 
      className="opacity-80 hover:opacity-100 transition-opacity"
    />
  );
}
