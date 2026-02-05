'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';

type ChartPoint = {
  time: string;
  value: number;
};

type Props = {
  data: ChartPoint[];
  wmaPeriod?: number;
};

const buildWma = (data: ChartPoint[], period: number) => {
  if (period <= 1 || data.length < period) return [];
  const weights = Array.from({ length: period }, (_, i) => i + 1);
  const weightSum = weights.reduce((acc, v) => acc + v, 0);
  const result: { time: string; value: number }[] = [];

  for (let i = period - 1; i < data.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < period; j += 1) {
      const idx = i - (period - 1) + j;
      sum += data[idx].value * weights[j];
    }
    result.push({ time: data[i].time, value: sum / weightSum });
  }

  return result;
};

export default function IndexLineChart({ data, wmaPeriod = 150 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<any>(null);
  const wmaRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'white' },
        textColor: '#111827'
      },
      grid: {
        vertLines: { color: '#f3f4f6' },
        horzLines: { color: '#f3f4f6' }
      },
      rightPriceScale: { borderColor: '#e5e7eb' },
      timeScale: { borderColor: '#e5e7eb' },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#2563eb',
      lineWidth: 2
    });

    const wmaSeries = chart.addSeries(LineSeries, {
      color: '#111827',
      lineWidth: 1
    });

    chartRef.current = chart;
    seriesRef.current = lineSeries;
    wmaRef.current = wmaSeries;

    const resize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(
      data.map(item => ({
        time: item.time as any,
        value: Number(item.value)
      }))
    );

    if (wmaRef.current) {
      const wmaData = buildWma(data, wmaPeriod);
      wmaRef.current.setData(
        wmaData.map(item => ({
          time: item.time as any,
          value: Number(item.value)
        }))
      );
    }

    chartRef.current.timeScale().fitContent();
  }, [data, wmaPeriod]);

  return <div ref={containerRef} className="w-full h-full" />;
}
