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
  rs?: number;
  ema20?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
};

interface Props {
  data: ChartData[];
  colors?: {
    backgroundColor?: string;
    textColor?: string;
  };
}

export default function StockChart({ data = [], colors: {
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
      height: 600,
      grid: { vertLines: { color: '#f0f3fa' }, horzLines: { color: '#f0f3fa' } },
      crosshair: { mode: 1 },
      rightPriceScale: {
        visible: true,
        borderColor: '#cccccc',
        scaleMargins: { top: 0.05, bottom: 0.45 },
      },
      timeScale: { borderColor: '#cccccc', timeVisible: true },
    });

    chartRef.current = chart;

    // ============================================================
    // 시리즈 추가
    // ============================================================

    // 1. [Layer 1] 켈트너 상단 영역 (분홍색 전체 채우기)
    const keltnerUpperArea = chart.addSeries(AreaSeries, {
      lineColor: '#ec4899', 
      lineWidth: 1,
      topColor: 'rgba(236, 72, 153, 0.15)', 
      bottomColor: 'rgba(236, 72, 153, 0.15)',
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    // 2. [Layer 2] 켈트너 하단 마스크 (흰색으로 아래쪽 지우기)
    const keltnerLowerArea = chart.addSeries(AreaSeries, {
      lineColor: '#ec4899', 
      lineWidth: 1,
      topColor: backgroundColor, 
      bottomColor: backgroundColor,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    // 4. [Layer 4] 이동평균선
    const ema20Series = chart.addSeries(LineSeries, { 
      color: '#eab308', lineWidth: 2, 
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    const wma150Series = chart.addSeries(LineSeries, { 
      color: '#000000', lineWidth: 1,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    // 3. [Layer 3] 캔들
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444', downColor: '#3b82f6', 
      borderVisible: false, wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
    });

    // 5. [하단] 거래량
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: 'vol-scale',
      lastValueVisible: true,
    });
    
    // 6. [하단] RS 지수
    const rsSeries = chart.addSeries(LineSeries, {
      color: '#8b5cf6', lineWidth: 1, priceScaleId: 'rs-scale',
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });
    rsSeries.createPriceLine({ price: 50, color: '#9ca3af', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });

    // 7. [하단] MACD
    const macdSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, priceScaleId: 'macd-scale', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const signalSeries = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 1, priceScaleId: 'macd-scale', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    
    // ★ [추가됨] MACD 0선 (수평 기준선)
    macdSeries.createPriceLine({
      price: 0,
      color: '#9ca3af', // 회색
      lineWidth: 1,
      lineStyle: LineStyle.Dashed, // 점선
      axisLabelVisible: false, // Y축에 '0' 라벨은 숨김 (깔끔하게 선만 표시)
      title: '',
    });
    
    // 레이아웃 설정
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } }); 
    chart.priceScale('vol-scale').applyOptions({ scaleMargins: { top: 0.70, bottom: 0.15 } }); 
    chart.priceScale('rs-scale').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
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
      
      rsSeries.setData(data.filter(d => d.rs !== undefined && !isNaN(d.rs)).map(d => ({ time: d.time as any, value: d.rs! })));

      macdSeries.setData(data.filter(d => d.macd && !isNaN(d.macd.macd)).map(d => ({ time: d.time as any, value: d.macd!.macd })));
      signalSeries.setData(data.filter(d => d.macd && !isNaN(d.macd.signal)).map(d => ({ time: d.time as any, value: d.macd!.signal })));
      
      // chart.timeScale().fitContent();
      
      // [수정] 최근 1년(약 250봉)만 확대해서 보기
      const totalDataCount = data.length;
      const visibleCount = 250; // 보여주고 싶은 캔들 개수
      
      if (totalDataCount > visibleCount) {
          chart.timeScale().setVisibleLogicalRange({
              from: totalDataCount - visibleCount,
              to: totalDataCount,
          });
      } else {
          chart.timeScale().fitContent();
      }
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
      const rs = dataMap.get(rsSeries);
      const macdData: any = dataMap.get(macdSeries);
      const signalData: any = dataMap.get(signalSeries);

      const fmtPrice = (val: any) => (typeof val === 'number' && !isNaN(val) ? val.toFixed(0) : '-'); 
      const fmtVol = (val: any) => (typeof val === 'number' && !isNaN(val) ? val.toLocaleString() : '-'); 
      const fmtRS = (val: any) => (typeof val === 'number' && !isNaN(val) ? val.toFixed(1) : '-'); 
      const fmtMacd = (val: any) => (typeof val === 'number' && !isNaN(val) ? val.toFixed(2) : '-'); 

      legendRef.current.innerHTML = `
        <div class="flex flex-wrap gap-4 text-xs font-medium text-gray-700 items-center">
          
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
            <span>EMA(20): ${fmtPrice(ema20 ? (ema20 as any).value : NaN)}</span>
          </div>

          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-black"></span>
            <span>WMA(150): ${fmtPrice(wma150 ? (wma150 as any).value : NaN)}</span>
          </div>

          <div class="flex items-center gap-1 pl-2 border-l border-gray-300">
            <span class="text-teal-600 font-bold">Vol:</span>
            <span>${fmtVol(volume ? (volume as any).value : NaN)}</span>
          </div>

          <div class="flex items-center gap-1 pl-2 border-l border-gray-300">
            <span class="text-purple-600 font-bold">RS:</span>
            <span>${fmtRS(rs ? (rs as any).value : NaN)}</span>
          </div>

          <div class="flex items-center gap-1 pl-2 border-l border-gray-300">
            <span class="text-blue-600 font-bold">MACD:</span>
            <span>${fmtMacd(macdData?.value)}</span>
            <span class="text-orange-500">Sig: ${fmtMacd(signalData?.value)}</span>
          </div>

        </div>
      `;
    });

    const handleResize = () => {
      if (chartRef.current) chartRef.current.applyOptions({ width: chartContainerRef.current!.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, backgroundColor, textColor]);

  return (
    <div className="relative w-full">
      <div ref={chartContainerRef} className="w-full" />
      <div 
        ref={legendRef} 
        className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-sm p-2 rounded border border-gray-200 shadow-sm pointer-events-none"
      >
        <span className="text-xs text-gray-400">지표 로딩중...</span>
      </div>
    </div>
  );
}