'use client';

import { useEffect, useRef } from 'react';
import { 
  createChart, 
  ColorType, 
  IChartApi, 
  CandlestickSeries, 
  HistogramSeries,
  LineSeries,
  AreaSeries,
  LineStyle,
  MouseEventParams,
} from 'lightweight-charts';

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  // rs?: number; // RS 대신 volumeRank60 사용
  ema20?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
  volumeRank60?: number; // 거래량 순위 지수
};

interface Props {
  data: ChartData[];
  colors?: {
    backgroundColor?: string;
    textColor?: string;
  };
}

export default function StockChartVolume({ data = [], colors: {
  backgroundColor = 'white', 
  textColor = 'black',
} = {} }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. 차트 생성
    const chart: IChartApi = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight, 
      grid: { vertLines: { color: '#f0f3fa' }, horzLines: { color: '#f0f3fa' } },
      crosshair: { mode: 1 },
      rightPriceScale: {
        visible: true,
        borderColor: '#cccccc',
        scaleMargins: { top: 0.05, bottom: 0.45 },
        priceFormat: { type: 'price', precision: 0 }, 
      },
      timeScale: { borderColor: '#cccccc', timeVisible: true },
    });

    chartRef.current = chart;

    // ============================================================
    // 시리즈 추가
    // ============================================================

    const keltnerUpperArea = chart.addSeries(AreaSeries, {
      lineColor: '#ec4899', 
      lineWidth: 1,
      topColor: 'rgba(236, 72, 153, 0.15)', 
      bottomColor: 'rgba(236, 72, 153, 0.15)',
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    const keltnerLowerArea = chart.addSeries(AreaSeries, {
      lineColor: '#ec4899', 
      lineWidth: 1,
      topColor: backgroundColor, 
      bottomColor: backgroundColor,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    const ema20Series = chart.addSeries(LineSeries, { 
      color: '#eab308', lineWidth: 2, 
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    const wma150Series = chart.addSeries(LineSeries, { 
      color: '#000000', lineWidth: 1,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444', downColor: '#3b82f6', 
      borderVisible: false, wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: 'vol-scale',
      lastValueVisible: true,
    });
    
    // 거래량 순위 지수 (rank_amount_60)
    const volumeRank60Series = chart.addSeries(LineSeries, {
      color: '#8b5cf6', lineWidth: 1, priceScaleId: 'volume-rank-scale',
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });
    volumeRank60Series.createPriceLine({ price: 50, color: '#9ca3af', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });

    const macdSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, priceScaleId: 'macd-scale', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const signalSeries = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 1, priceScaleId: 'macd-scale', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    
    macdSeries.createPriceLine({
      price: 0,
      color: '#9ca3af', 
      lineWidth: 1,
      lineStyle: LineStyle.Dashed, 
      axisLabelVisible: false, 
      title: '',
    });
    
    // 레이아웃 설정
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } }); 
    chart.priceScale('vol-scale').applyOptions({ scaleMargins: { top: 0.70, bottom: 0.15 } }); 
    chart.priceScale('volume-rank-scale').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } }); 
    chart.priceScale('macd-scale').applyOptions({ scaleMargins: { top: 0.55, bottom: 0.30 } });

    // ----------------------------------------
    // 데이터 주입
    // ----------------------------------------
    if (data.length > 0) {
      candlestickSeries.setData(data.map(d => ({ 
        time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close 
      })));
      
      ema20Series.setData(data.filter(d => d.ema20 !== undefined && !isNaN(d.ema20)).map(d => ({ time: d.time as any, value: d.ema20! })));
      wma150Series.setData(data.filter(d => d.wma150 !== undefined && !isNaN(d.wma150)).map(d => ({ time: d.time as any, value: d.wma150! })));
      
      keltnerUpperArea.setData(data.filter(d => d.keltner && !isNaN(d.keltner.upper)).map(d => ({ time: d.time as any, value: d.keltner!.upper })));
      keltnerLowerArea.setData(data.filter(d => d.keltner && !isNaN(d.keltner.lower)).map(d => ({ time: d.time as any, value: d.keltner!.lower })));

      volumeSeries.setData(data.map(d => ({ 
        time: d.time as any, value: d.volume || 0, color: d.close >= d.open ? '#ef444480' : '#3b82f680' 
      })));
      
      // volumeRank60 데이터 설정
      volumeRank60Series.setData(data.filter(d => d.volumeRank60 !== undefined && !isNaN(d.volumeRank60)).map(d => ({ time: d.time as any, value: d.volumeRank60! })));

      macdSeries.setData(data.filter(d => d.macd && !isNaN(d.macd.macd)).map(d => ({ time: d.time as any, value: d.macd!.macd })));
      signalSeries.setData(data.filter(d => d.macd && !isNaN(d.macd.signal)).map(d => ({ time: d.time as any, value: d.macd!.signal })));
      
      chart.timeScale().fitContent();
    }

    // ----------------------------------------
    // 범례(Legend) 업데이트
    // ----------------------------------------
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!legendRef.current) return;
      
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current!.clientHeight
      ) {
        return;
      }

      const dataMap = param.seriesData;
      
      const ema20 = dataMap.get(ema20Series);
      const wma150 = dataMap.get(wma150Series);
      const volume = dataMap.get(volumeSeries);
      const volumeRank = dataMap.get(volumeRank60Series); 

      const fmtPrice = (val: any) => (typeof val === 'number' && !isNaN(val) ? val.toFixed(0) : '-'); 
      const fmtVol = (val: any) => (typeof val === 'number' && !isNaN(val) ? val.toLocaleString() : '-'); 
      const fmtVolumeRank = (val: any) => (typeof val === 'number' && !isNaN(val) ? val.toFixed(1) : '-'); 

      const hoveredTime = param.time ? new Date(param.time * 1000).toLocaleDateString('ko-KR') : '-';

      legendRef.current.innerHTML = `
        <div class="flex flex-wrap gap-4 text-xs font-medium text-gray-700 items-center">
          <div class="flex items-center gap-1">
            <span class="text-teal-600 font-bold">거래량:</span>
            <span>${fmtVol(volume ? (volume as any).value : NaN)}</span>
          </div>

          <div class="flex items-center gap-1 pl-2 border-l border-gray-300">
            <span class="text-purple-600 font-bold">거래량순위(60일):</span>
            <span>${fmtVolumeRank(volumeRank ? (volumeRank as any).value : NaN)}</span>
          </div>
        </div>
      `;
    });

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) { return; }
      const newRect = entries[0].contentRect;
      chart.applyOptions({ width: newRect.width, height: newRect.height });
    });
    
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, backgroundColor, textColor]);

  return (
    <div className="relative w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full" />
      <div 
        ref={legendRef} 
        className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-sm p-2 rounded border border-gray-200 shadow-sm pointer-events-none"
      >
        <span className="text-xs text-gray-400">지표 로딩중...</span>
      </div>
    </div>
  );
}
