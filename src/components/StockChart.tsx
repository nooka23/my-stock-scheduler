'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { Chart, DeepPartial, IndicatorDrawParams, KLineData, Styles } from 'klinecharts';

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rs?: number;
  ema20?: number;
  ma30?: number;
  ma50?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
};

export type StockChartIndicatorVisibility = {
  ema20?: boolean;
  ma30?: boolean;
  ma50?: boolean;
  wma150?: boolean;
  keltner?: boolean;
  volume?: boolean;
  rs?: boolean;
};

interface Props {
  data: ChartData[];
  colors?: {
    backgroundColor?: string;
    textColor?: string;
  };
  showLegend?: boolean;
  showOHLC?: boolean;
  showIndicatorsValues?: boolean;
  showMacd?: boolean;
  visibleIndicators?: StockChartIndicatorVisibility;
  onLegendChange?: (item: ChartData | undefined) => void;
}

export type StockChartHandle = {
  startDrawing: (tool: DrawingTool) => void;
  clearDrawings: () => void;
};

type PriceOverlayResult = {
  ema20: number | null;
  ma30: number | null;
  ma50: number | null;
  wma150: number | null;
  keltnerUpper: number | null;
  keltnerLower: number | null;
};

const DEFAULT_VISIBLE_INDICATORS: Required<StockChartIndicatorVisibility> = {
  ema20: true,
  ma30: true,
  ma50: true,
  wma150: true,
  keltner: true,
  volume: true,
  rs: true,
};

type VolumeResult = {
  volume: number;
  isUp: boolean;
};

type RsResult = {
  rs: number | null;
  upperBound: number | null;
  lowerBound: number | null;
};

const PRICE_OVERLAY_NAME = 'stock_price_overlay_v1';
const VOLUME_NAME = 'stock_volume_overlay_v1';
const RS_NAME = 'stock_rs_overlay_v1';
const DRAWING_GROUP_ID = 'stock_chart_drawings';

type DrawingTool =
  | 'segment'
  | 'straightLine'
  | 'parallelStraightLine'
  | 'verticalStraightLine'
  | 'horizontalStraightLine';

let indicatorsRegistered = false;

function toTimestamp(time: string) {
  const timestamp = new Date(time).getTime();
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function toNullableNumber(value: unknown) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function getVisibleIndexes(from: number, to: number, length: number) {
  const start = Math.max(0, Math.floor(from) - 1);
  const end = Math.min(length - 1, Math.ceil(to) + 1);
  return { start, end };
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number | null }>,
  color: string,
  width: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;

  let started = false;
  for (const point of points) {
    if (point.y === null) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(point.x, point.y);
      started = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawDashedHorizontalLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number,
  color: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.restore();
}

function registerCustomIndicators(klinecharts: Awaited<typeof import('klinecharts')>) {
  if (indicatorsRegistered) {
    return;
  }

  const { IndicatorSeries, registerIndicator } = klinecharts;

  registerIndicator<PriceOverlayResult>({
    name: PRICE_OVERLAY_NAME,
    shortName: 'PRICE',
    series: IndicatorSeries.Price,
    figures: [],
    calc: (dataList: KLineData[]) =>
      dataList.map(item => ({
        ema20: toNullableNumber(item.ema20),
        ma30: toNullableNumber(item.ma30),
        ma50: toNullableNumber(item.ma50),
        wma150: toNullableNumber(item.wma150),
        keltnerUpper: toNullableNumber(item.keltner?.upper),
        keltnerLower: toNullableNumber(item.keltner?.lower),
      })),
    draw: ({
      ctx,
      indicator,
      visibleRange,
      xAxis,
      yAxis,
    }: IndicatorDrawParams<PriceOverlayResult>) => {
      const result = indicator.result ?? [];
      const { start, end } = getVisibleIndexes(visibleRange.from, visibleRange.to, result.length);
      const upperPoints: Array<{ x: number; y: number }> = [];
      const lowerPoints: Array<{ x: number; y: number }> = [];
      const emaPoints: Array<{ x: number; y: number | null }> = [];
      const ma30Points: Array<{ x: number; y: number | null }> = [];
      const ma50Points: Array<{ x: number; y: number | null }> = [];
      const wmaPoints: Array<{ x: number; y: number | null }> = [];

      for (let index = start; index <= end; index += 1) {
        const entry = result[index];
        if (!entry) continue;

        const x = xAxis.convertToPixel(index);

        if (entry.keltnerUpper !== null) {
          upperPoints.push({ x, y: yAxis.convertToPixel(entry.keltnerUpper) });
        }
        if (entry.keltnerLower !== null) {
          lowerPoints.push({ x, y: yAxis.convertToPixel(entry.keltnerLower) });
        }

        emaPoints.push({
          x,
          y: entry.ema20 === null ? null : yAxis.convertToPixel(entry.ema20),
        });
        ma30Points.push({
          x,
          y: entry.ma30 === null ? null : yAxis.convertToPixel(entry.ma30),
        });
        ma50Points.push({
          x,
          y: entry.ma50 === null ? null : yAxis.convertToPixel(entry.ma50),
        });
        wmaPoints.push({
          x,
          y: entry.wma150 === null ? null : yAxis.convertToPixel(entry.wma150),
        });
      }

      if (upperPoints.length > 1 && lowerPoints.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(upperPoints[0].x, upperPoints[0].y);
        upperPoints.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
        lowerPoints
          .slice()
          .reverse()
          .forEach(point => ctx.lineTo(point.x, point.y));
        ctx.closePath();
        ctx.fillStyle = 'rgba(236, 72, 153, 0.15)';
        ctx.fill();
        ctx.restore();

        drawPolyline(ctx, upperPoints.map(point => ({ ...point })), '#ec4899', 1);
        drawPolyline(ctx, lowerPoints.map(point => ({ ...point })), '#ec4899', 1);
      }

      drawPolyline(ctx, emaPoints, '#eab308', 2);
      drawPolyline(ctx, ma30Points, '#22c55e', 1.5);
      drawPolyline(ctx, ma50Points, '#f97316', 1.5);
      drawPolyline(ctx, wmaPoints, '#000000', 1);
      return true;
    },
  });

  registerIndicator<VolumeResult>({
    name: VOLUME_NAME,
    shortName: 'VOL',
    series: IndicatorSeries.Volume,
    figures: [
      {
        key: 'volume',
        type: 'bar',
        baseValue: 0,
        styles: data => {
          const isUp = data.current.indicatorData?.isUp ?? false;
          const color = isUp ? '#ef444480' : '#3b82f680';
          return {
            color,
            borderColor: color,
            style: 'fill',
          };
        },
      },
    ],
    precision: 0,
    minValue: 0,
    shouldFormatBigNumber: true,
    calc: (dataList: KLineData[]) =>
      dataList.map(item => ({
        volume: typeof item.volume === 'number' ? item.volume : 0,
        isUp: item.close >= item.open,
      })),
  });

  registerIndicator<RsResult>({
    name: RS_NAME,
    shortName: 'RS',
    series: IndicatorSeries.Normal,
    figures: [
      { key: 'rs', type: 'line' },
      { key: 'upperBound', type: 'line' },
      { key: 'lowerBound', type: 'line' },
    ],
    precision: 2,
    calc: (dataList: KLineData[]) => {
      const visibleCount = Math.min(250, dataList.length);
      const recentRsValues = dataList
        .slice(-visibleCount)
        .map(item => toNullableNumber(item.rs))
        .filter((value): value is number => value !== null);
      const rsAbsMax = recentRsValues.length > 0
        ? Math.max(...recentRsValues.map(value => Math.abs(value)))
        : null;
      const rsBound = rsAbsMax !== null ? Math.max(rsAbsMax * 1.08, 0.5) : null;

      return dataList.map(item => ({
        rs: toNullableNumber(item.rs),
        upperBound: rsBound,
        lowerBound: rsBound === null ? null : -rsBound,
      }));
    },
    draw: ({
      ctx,
      yAxis,
      bounding,
    }: IndicatorDrawParams<RsResult>) => {
      const zeroY = yAxis.convertToPixel(0);
      if (Number.isFinite(zeroY) && zeroY >= 0 && zeroY <= bounding.height) {
        drawDashedHorizontalLine(ctx, zeroY, bounding.width, '#9ca3af');
      }
      return false;
    },
    styles: {
      lines: [
        { color: '#8b5cf6', size: 1, style: 'solid', dashedValue: [0, 0], smooth: false },
        { color: 'rgba(0,0,0,0)', size: 0, style: 'solid', dashedValue: [0, 0], smooth: false },
        { color: 'rgba(0,0,0,0)', size: 0, style: 'solid', dashedValue: [0, 0], smooth: false },
      ],
      lastValueMark: {
        show: false,
      },
    },
  });

  indicatorsRegistered = true;
}

function formatLegendHtml(
  item: ChartData | undefined,
  options: {
    showOHLC: boolean;
    showIndicatorsValues: boolean;
    visibleIndicators: Required<StockChartIndicatorVisibility>;
  },
) {
  if (!item) {
    return '<span class="text-xs text-gray-400">지표 로딩중...</span>';
  }

  const fmtPrice = (val: unknown) =>
    typeof val === 'number' && !Number.isNaN(val) ? val.toLocaleString() : '-';
  const fmtVol = (val: unknown) =>
    typeof val === 'number' && !Number.isNaN(val) ? val.toLocaleString() : '-';
  const fmtRS = (val: unknown) =>
    typeof val === 'number' && !Number.isNaN(val) ? val.toFixed(2) : '-';
  return `
    <div class="flex flex-wrap gap-4 text-xs font-medium text-gray-700 items-center">
      ${options.showOHLC ? `
        <div class="flex items-center gap-2 mr-2 border-r border-gray-300 pr-2 font-mono">
          <span class="text-gray-800">O:${fmtPrice(item.open)}</span>
          <span class="text-red-600">H:${fmtPrice(item.high)}</span>
          <span class="text-blue-600">L:${fmtPrice(item.low)}</span>
          <span class="text-gray-800">C:${fmtPrice(item.close)}</span>
        </div>
      ` : ''}
      ${options.showIndicatorsValues ? `
        ${options.visibleIndicators.ema20 ? `
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
            <span>EMA(20): ${fmtPrice(item.ema20)}</span>
          </div>
        ` : ''}
        ${options.visibleIndicators.ma30 ? `
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-green-500"></span>
            <span>MA(30): ${fmtPrice(item.ma30)}</span>
          </div>
        ` : ''}
        ${options.visibleIndicators.ma50 ? `
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-orange-500"></span>
            <span>MA(50): ${fmtPrice(item.ma50)}</span>
          </div>
        ` : ''}
        ${options.visibleIndicators.wma150 ? `
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-black"></span>
            <span>WMA(150): ${fmtPrice(item.wma150)}</span>
          </div>
        ` : ''}
        ${options.visibleIndicators.volume ? `<div class="flex items-center gap-1 pl-2 border-l border-gray-300">
          <span class="text-teal-600 font-bold">Vol:</span>
          <span>${fmtVol(item.volume)}</span>
        </div>` : ''}
        ${options.visibleIndicators.rs ? `<div class="flex items-center gap-1 pl-2 border-l border-gray-300">
          <span class="text-purple-600 font-bold">RS:</span>
          <span>${fmtRS(item.rs)}</span>
        </div>` : ''}
      ` : ''}
    </div>
  `;
}

function createChartStyles(textColor: string): DeepPartial<Styles> {
  return {
    grid: {
      horizontal: { color: '#f0f3fa' },
      vertical: { color: '#f0f3fa' },
    },
    candle: {
      bar: {
        upColor: '#ef4444',
        downColor: '#3b82f6',
        noChangeColor: '#9ca3af',
        upBorderColor: '#ef4444',
        downBorderColor: '#3b82f6',
        noChangeBorderColor: '#9ca3af',
        upWickColor: '#ef4444',
        downWickColor: '#3b82f6',
        noChangeWickColor: '#9ca3af',
      },
      priceMark: {
        high: { show: false },
        low: { show: false },
        last: { show: false },
      },
      tooltip: {
        showRule: 'none' as never,
      },
    },
    indicator: {
      lastValueMark: {
        show: false,
      },
      tooltip: {
        showRule: 'none' as never,
      },
    },
    xAxis: {
      axisLine: { color: '#cccccc' },
      tickLine: { color: '#cccccc' },
      tickText: { color: textColor },
    },
    yAxis: {
      position: 'right' as never,
      axisLine: { color: '#cccccc' },
      tickLine: { color: '#cccccc' },
      tickText: { color: textColor },
    },
    separator: {
      color: '#f0f3fa',
      activeBackgroundColor: '#f8fafc',
    },
    crosshair: {
      horizontal: {
        line: { color: '#9ca3af' },
        text: { color: '#ffffff', backgroundColor: '#6b7280' },
      },
      vertical: {
        line: { color: '#9ca3af' },
        text: { color: '#ffffff', backgroundColor: '#6b7280' },
      },
    },
  };
}

const StockChart = forwardRef<StockChartHandle, Props>(function StockChart({
  data = [],
  colors: { backgroundColor = 'white', textColor = 'black' } = {},
  showLegend = true,
  showOHLC = false,
  showIndicatorsValues = true,
  showMacd = true,
  visibleIndicators,
  onLegendChange,
}: Props, ref) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const activeToolRef = useRef<DrawingTool | null>(null);
  const indicatorVisibility = useMemo(() => ({
    ...DEFAULT_VISIBLE_INDICATORS,
    ...visibleIndicators,
  }), [visibleIndicators]);

  const startDrawing = (tool: DrawingTool) => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    activeToolRef.current = tool;
    chart.createOverlay(
      {
        name: tool,
        groupId: DRAWING_GROUP_ID,
        lock: false,
        mode: 'strong_magnet',
        modeSensitivity: 8,
        styles: {
          line: {
            color: '#2563eb',
            size: 2,
            style: 'solid',
            dashedValue: [0, 0],
            smooth: false,
          },
          point: {
            color: 'rgba(37, 99, 235, 0)',
            borderColor: 'rgba(37, 99, 235, 0)',
            borderSize: 0,
            radius: 0,
            activeColor: 'rgba(37, 99, 235, 0)',
            activeBorderColor: 'rgba(37, 99, 235, 0)',
            activeBorderSize: 0,
            activeRadius: 0,
          },
        },
        onDrawEnd: () => {
          activeToolRef.current = null;
          return false;
        },
      },
      'candle_pane',
    );
  };

  const clearDrawings = () => {
    chartRef.current?.removeOverlay({ groupId: DRAWING_GROUP_ID });
    activeToolRef.current = null;
  };

  useImperativeHandle(ref, () => ({
    startDrawing,
    clearDrawings,
  }), []);

  useEffect(() => {
    let chart: Chart | null = null;
    let mounted = true;
    let resizeHandler: (() => void) | null = null;
    let crosshairHandler: ((payload?: unknown) => void) | null = null;

    const initialize = async () => {
      if (!chartContainerRef.current) {
        return;
      }

      const klinecharts = await import('klinecharts');
      const { ActionType, dispose, init } = klinecharts;

      if (!mounted || !chartContainerRef.current) {
        return;
      }

      registerCustomIndicators(klinecharts);

      const container = chartContainerRef.current;
      container.style.backgroundColor = backgroundColor;
      const chartData: KLineData[] = data.map(item => ({
        timestamp: toTimestamp(item.time),
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume ?? 0,
        ema20: indicatorVisibility.ema20 ? item.ema20 : undefined,
        ma30: indicatorVisibility.ma30 ? item.ma30 : undefined,
        ma50: indicatorVisibility.ma50 ? item.ma50 : undefined,
        wma150: indicatorVisibility.wma150 ? item.wma150 : undefined,
        rs: item.rs,
        keltner: indicatorVisibility.keltner ? item.keltner : undefined,
        macd: item.macd,
      }));

      const containerHeight = container.clientHeight || 600;
      const volumeHeight = Math.max(70, Math.round(containerHeight * 0.15));
      const rsHeight = Math.max(90, Math.round(containerHeight * 0.18));

      const layout = [
        { type: 'candle' as never },
        ...(indicatorVisibility.volume
          ? [{ type: 'indicator' as never, content: [VOLUME_NAME], options: { id: 'volume_pane', height: volumeHeight } }]
          : []),
        ...(indicatorVisibility.rs
          ? [{
            type: 'indicator' as never,
            content: [RS_NAME],
            options: { id: 'rs_pane', height: rsHeight },
          }]
          : []),
        { type: 'xAxis' as never },
      ];

      chart = init(container, {
        timezone: 'Asia/Seoul',
        styles: createChartStyles(textColor),
        layout,
      });

      if (!chart) {
        return;
      }

      chartRef.current = chart;
      chart.createIndicator(PRICE_OVERLAY_NAME, true, { id: 'candle_pane' });
      chart.setOffsetRightDistance(0);
      chart.setPriceVolumePrecision(0, 0);

      if (chartData.length > 0) {
        chart.applyNewData(chartData);
        const visibleCount = Math.min(250, chartData.length);
        const barSpace = Math.max(3, Math.min(18, Math.floor(container.clientWidth / Math.max(visibleCount, 1))));
        chart.setBarSpace(barSpace);
        chart.scrollToRealTime();
      } else {
        chart.clearData();
      }

      onLegendChange?.(data[data.length - 1]);

      if (showLegend && legendRef.current) {
        legendRef.current.innerHTML = formatLegendHtml(data[data.length - 1], {
          showOHLC,
          showIndicatorsValues,
          visibleIndicators: indicatorVisibility,
        });

        crosshairHandler = payload => {
          if (!legendRef.current || !payload || typeof payload !== 'object') {
            return;
          }

          const maybeCrosshair = payload as { dataIndex?: number };
          const dataIndex = maybeCrosshair.dataIndex;
          if (typeof dataIndex !== 'number' || dataIndex < 0 || dataIndex >= data.length) {
            return;
          }

          onLegendChange?.(data[dataIndex]);

          legendRef.current.innerHTML = formatLegendHtml(data[dataIndex], {
            showOHLC,
            showIndicatorsValues,
            visibleIndicators: indicatorVisibility,
          });
        };

        chart.subscribeAction(ActionType.OnCrosshairChange, crosshairHandler);
      } else if (onLegendChange) {
        crosshairHandler = payload => {
          if (!payload || typeof payload !== 'object') {
            return;
          }

          const maybeCrosshair = payload as { dataIndex?: number };
          const dataIndex = maybeCrosshair.dataIndex;
          if (typeof dataIndex !== 'number' || dataIndex < 0 || dataIndex >= data.length) {
            return;
          }

          onLegendChange(data[dataIndex]);
        };

        chart.subscribeAction(ActionType.OnCrosshairChange, crosshairHandler);
      }

      resizeHandler = () => {
        if (!chart || !chartContainerRef.current) {
          return;
        }

        chart.resize();

        const nextHeight = chartContainerRef.current.clientHeight || 600;
        if (indicatorVisibility.volume) {
          chart.setPaneOptions({ id: 'volume_pane', height: Math.max(70, Math.round(nextHeight * 0.15)) });
        }
        if (indicatorVisibility.rs) {
          chart.setPaneOptions({ id: 'rs_pane', height: Math.max(90, Math.round(nextHeight * 0.18)) });
        }
      };

      window.addEventListener('resize', resizeHandler);

      return () => {
        if (crosshairHandler) {
          chart?.unsubscribeAction(ActionType.OnCrosshairChange, crosshairHandler);
        }
        if (resizeHandler) {
          window.removeEventListener('resize', resizeHandler);
        }
        if (chartContainerRef.current) {
          dispose(chartContainerRef.current);
        }
        chartRef.current = null;
      };
    };

    let cleanup: (() => void) | undefined;
    void initialize().then(result => {
      cleanup = result;
    });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [data, backgroundColor, textColor, showLegend, showOHLC, showIndicatorsValues, showMacd, indicatorVisibility, onLegendChange]);

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {showLegend && (
        <div className="flex-none">
          <div
            ref={legendRef}
            className="mb-2 rounded border border-gray-200 bg-white/90 p-2 shadow-sm"
          >
            <span className="text-xs text-gray-400">지표 로딩중...</span>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-stretch gap-3">
        <div ref={chartContainerRef} className="min-h-0 flex-1" />
      </div>
    </div>
  );
});

export default StockChart;
