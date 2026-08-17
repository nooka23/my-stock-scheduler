'use client';

import { useEffect, useRef } from 'react';
import { AreaSeries, ColorType, createChart } from 'lightweight-charts';

type BreadthPoint = {
  time: string;
  value: number;
};

type Props = {
  data: BreadthPoint[];
};

const BULLISH_LINE = 300;
const MIDPOINT_LINE = 200;
const CAUTION_LINE = 100;

export default function MarketBreadthChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.12)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.12)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.25)',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.25)',
        timeVisible: true,
      },
      localization: {
        locale: 'ko-KR',
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#0f766e',
      lineWidth: 2,
      topColor: 'rgba(13, 148, 136, 0.34)',
      bottomColor: 'rgba(13, 148, 136, 0.02)',
      crosshairMarkerBackgroundColor: '#0f766e',
      crosshairMarkerBorderColor: '#ffffff',
      crosshairMarkerRadius: 4,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    series.createPriceLine({
      price: BULLISH_LINE,
      color: 'rgba(5, 150, 105, 0.5)',
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: '확산',
    });
    series.createPriceLine({
      price: MIDPOINT_LINE,
      color: 'rgba(245, 158, 11, 0.65)',
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: '중심',
    });
    series.createPriceLine({
      price: CAUTION_LINE,
      color: 'rgba(239, 68, 68, 0.5)',
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: '위축',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
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
      data.map(point => ({ time: point.time as any, value: Number(point.value) }))
    );
    chartRef.current.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="h-full w-full" />;
}
