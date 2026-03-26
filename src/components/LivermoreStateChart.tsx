'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import type { ISeriesApi, Time } from 'lightweight-charts';
import type { LivermoreComputedRow, ExtendedLivermoreState } from '@/lib/livermoreStateMachine';

type Props = {
  rows: LivermoreComputedRow[];
};

const STATE_COLORS: Record<ExtendedLivermoreState, string> = {
  upward_trend: 'rgba(34, 197, 94, 0.22)',
  downward_trend: 'rgba(239, 68, 68, 0.22)',
  natural_rally: 'rgba(190, 242, 100, 0.20)',
  natural_reaction: 'rgba(251, 146, 60, 0.20)',
  secondary_rally: 'rgba(156, 163, 175, 0.18)',
  secondary_reaction: 'rgba(156, 163, 175, 0.18)',
  insufficient_data: 'rgba(209, 213, 219, 0.18)',
};

export default function LivermoreStateChart({ rows }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const closeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bgSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

  const transitionMap = useMemo(() => {
    const map = new Map<string, LivermoreComputedRow>();
    for (const row of rows) {
      if (row.state_changed) {
        map.set(row.date, row);
      }
    }
    return map;
  }, [rows]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#111827',
      },
      grid: {
        vertLines: { color: '#f3f4f6' },
        horzLines: { color: '#f3f4f6' },
      },
      rightPriceScale: { borderColor: '#e5e7eb' },
      timeScale: { borderColor: '#e5e7eb', timeVisible: true },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 520,
      localization: {
        priceFormatter: (value: number) => Math.round(value).toLocaleString(),
      },
    });

    const bgSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'state-bg-scale',
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0,
    });
    chart.priceScale('state-bg-scale').applyOptions({
      visible: false,
      scaleMargins: { top: 0, bottom: 0 },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#3b82f6',
      borderVisible: false,
      wickUpColor: '#ef4444',
      wickDownColor: '#3b82f6',
    });

    const closeSeries = chart.addSeries(LineSeries, {
      color: '#111827',
      lineWidth: 1,
      priceLineVisible: false,
    });

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight || 520,
      });
    };

    const handleCrosshairMove = (param: { time?: Time }) => {
      if (!tooltipRef.current) return;
      if (!param.time || typeof param.time !== 'string') {
        tooltipRef.current.style.display = 'none';
        return;
      }

      const matched = transitionMap.get(param.time);
      if (!matched) {
        tooltipRef.current.style.display = 'none';
        return;
      }

      tooltipRef.current.style.display = 'block';
      tooltipRef.current.textContent = `${matched.date} | ${matched.state} | ${matched.reason}`;
    };

    chart.subscribeCrosshairMove(handleCrosshairMove as never);
    window.addEventListener('resize', handleResize);

    chartRef.current = chart;
    bgSeriesRef.current = bgSeries;
    candleSeriesRef.current = candleSeries;
    closeSeriesRef.current = closeSeries;

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.unsubscribeCrosshairMove(handleCrosshairMove as never);
      chart.remove();
      chartRef.current = null;
      bgSeriesRef.current = null;
      candleSeriesRef.current = null;
      closeSeriesRef.current = null;
      markersRef.current = null;
    };
  }, [transitionMap]);

  useEffect(() => {
    if (!rows.length || !chartRef.current || !candleSeriesRef.current || !closeSeriesRef.current || !bgSeriesRef.current) {
      return;
    }

    const candleData = rows.map((row) => ({
      time: row.date as Time,
      open: row.open,
      high: row.high ?? Math.max(row.open, row.close),
      low: row.low ?? Math.min(row.open, row.close),
      close: row.close,
    }));

    candleSeriesRef.current.setData(candleData);

    closeSeriesRef.current.setData(
      rows.map((row) => ({
        time: row.date as Time,
        value: row.close,
      })),
    );

    bgSeriesRef.current.setData(
      rows.map((row) => ({
        time: row.date as Time,
        value: 1,
        color: STATE_COLORS[row.state],
      })),
    );

    const markers: Array<{
      time: Time;
      position: 'aboveBar' | 'belowBar' | 'inBar';
      shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
      color: string;
      text?: string;
    }> = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const prevRow = i > 0 ? rows[i - 1] : null;

      const hasNewSPivot = row.pivot_high !== null && row.pivot_high_date !== null && (
        row.pivot_high !== prevRow?.pivot_high || row.pivot_high_date !== prevRow?.pivot_high_date
      );
      const hasNewBPivot = row.pivot_low !== null && row.pivot_low_date !== null && (
        row.pivot_low !== prevRow?.pivot_low || row.pivot_low_date !== prevRow?.pivot_low_date
      );
      const hasNewSsPivot = row.pivot_ss !== null && row.pivot_ss_date !== null && (
        row.pivot_ss !== prevRow?.pivot_ss || row.pivot_ss_date !== prevRow?.pivot_ss_date
      );
      const hasNewBbPivot = row.pivot_bb !== null && row.pivot_bb_date !== null && (
        row.pivot_bb !== prevRow?.pivot_bb || row.pivot_bb_date !== prevRow?.pivot_bb_date
      );

      if (hasNewSPivot) {
        markers.push({
          time: row.pivot_high_date as Time,
          position: 'aboveBar',
          shape: 'circle',
          color: '#1d4ed8',
          text: 'S',
        });
      }

      if (hasNewBPivot) {
        markers.push({
          time: row.pivot_low_date as Time,
          position: 'belowBar',
          shape: 'circle',
          color: '#b45309',
          text: 'B',
        });
      }

      if (hasNewSsPivot) {
        markers.push({
          time: row.pivot_ss_date as Time,
          position: 'aboveBar',
          shape: 'square',
          color: '#7c3aed',
          text: 'SS',
        });
      }

      if (hasNewBbPivot) {
        markers.push({
          time: row.pivot_bb_date as Time,
          position: 'belowBar',
          shape: 'square',
          color: '#047857',
          text: 'BB',
        });
      }
    }

    if (!markersRef.current) {
      markersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
    } else {
      markersRef.current.setMarkers(markers);
    }

    const total = rows.length;
    if (total > 280) {
      chartRef.current.timeScale().setVisibleLogicalRange({ from: total - 280, to: total + 5 });
    } else {
      chartRef.current.timeScale().fitContent();
    }
  }, [rows]);

  return (
    <div className="relative h-full min-h-[520px] w-full border border-gray-200 bg-white">
      <div ref={containerRef} className="h-full w-full" />
      <div
        ref={tooltipRef}
        className="absolute left-2 top-2 hidden max-w-[85%] rounded bg-white/95 px-2 py-1 text-xs text-gray-700 shadow"
      />
    </div>
  );
}
