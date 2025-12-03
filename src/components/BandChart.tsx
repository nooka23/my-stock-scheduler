'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, CandlestickSeries, LineSeries, LineStyle } from 'lightweight-charts';
import { FinancialData } from '@/app/chart/page'; // page.tsx의 타입 참조

export type BandSettings = {
  type: 'PER' | 'PBR' | 'POR';
  financials: FinancialData[];
  multipliers: number[];
};

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

interface Props {
  data: ChartData[];
  settings: BandSettings;
}

export default function BandChart({ data, settings }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. 차트 생성
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'white' }, textColor: 'black' },
      width: chartContainerRef.current.clientWidth,
      height: 500,
      grid: { vertLines: { color: '#f0f3fa' }, horzLines: { color: '#f0f3fa' } },
      rightPriceScale: { visible: true, borderColor: '#cccccc' },
      timeScale: { borderColor: '#cccccc', timeVisible: true },
    });
    chartRef.current = chart;

    // 2. 캔들스틱 (주가)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444', downColor: '#3b82f6', borderVisible: false, wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
    });
    
    if (data.length > 0) {
      candleSeries.setData(data.map(d => ({ ...d, time: d.time as any })));
    }

    // 3. 밴드 그리기 로직 (대각선 보간 적용)
    const bandColors = ['#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];

    // (1) 재무 데이터 Map 생성 (빠른 조회를 위해)
    const finMap = new Map<number, number>();
    settings.financials.forEach(f => {
      let val = 0;
      if (settings.type === 'PER') val = f.eps;
      else if (settings.type === 'PBR') val = f.bps;
      else if (settings.type === 'POR') val = f.ops;
      finMap.set(f.year, val);
    });
    
    // 데이터 범위 내 최소/최대 연도 파악
    const years = settings.financials.map(f => f.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);

    settings.multipliers.forEach((mult, idx) => {
      const lineSeries = chart.addSeries(LineSeries, {
        color: bandColors[idx % bandColors.length],
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: `${settings.type} ${mult}x`,
        crosshairMarkerVisible: true,
        lastValueVisible: false,
      });

      const lineData = data.map(d => {
        // "2023-05-20" -> Date 객체 및 연도 추출
        const dateStr = d.time; 
        const dateObj = new Date(dateStr);
        const currentYear = dateObj.getFullYear();

        // ★ 핵심 로직: 대각선 그리기 (Linear Interpolation)
        
        // Target Value (올해 연말 기준 값)
        let targetBase = finMap.get(currentYear);
        // Start Value (작년 연말 기준 값 = 올해의 시작 값)
        let startBase = finMap.get(currentYear - 1);

        // 예외 처리 1: 올해 데이터가 없으면? (미래 추정치 or 가장 최근 데이터 사용)
        if (targetBase === undefined) {
            if (currentYear > maxYear) targetBase = finMap.get(maxYear); // 미래는 최근 값 유지
            else return { time: d.time as any, value: NaN }; // 과거 데이터 없으면 그리지 않음
        }

        // 예외 처리 2: 작년 데이터가 없으면? (데이터 시작점)
        // -> 보간할 수 없으므로 올해 값으로 평행선 그리기 (Flat)
        if (startBase === undefined) {
            startBase = targetBase; 
        }

        // 보간(Interpolation) 비율 계산
        // 해당 연도의 1월 1일 ~ 12월 31일 사이에서 오늘이 몇 퍼센트 지점인지 계산
        const startOfYear = new Date(currentYear, 0, 1).getTime();
        const endOfYear = new Date(currentYear, 11, 31).getTime();
        const current = dateObj.getTime();

        // 0.0 ~ 1.0 사이 값 (범위 벗어나면 클램핑)
        let ratio = (current - startOfYear) / (endOfYear - startOfYear);
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;

        // ★ 공식: 시작값 + (변화량 * 진행률)
        // 예: 작년 2000원, 올해 4000원, 진행률 50%(6월말) -> 2000 + (2000 * 0.5) = 3000원
        const interpolatedBase = startBase! + (targetBase! - startBase!) * ratio;

        return {
          time: d.time as any,
          value: Math.floor(interpolatedBase * mult) // 배수 적용
        };
      });
      
      // 유효한 데이터만 필터링해서 차트에 주입
      lineSeries.setData(lineData.filter(ld => !isNaN(ld.value)));
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, settings]);

  return <div ref={chartContainerRef} className="w-full relative" />;
}