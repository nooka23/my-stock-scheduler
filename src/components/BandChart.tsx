'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, CandlestickSeries, LineSeries, HistogramSeries, LineStyle } from 'lightweight-charts';
import { FinancialData } from '@/app/chart/page'; 

// ...

export interface BandSettings {
  type: 'PER' | 'PBR' | 'POR';
  financials: FinancialData[];
  multipliers: number[];
}

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // [수정] 거래량 추가
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
      // [수정] 소수점 제거 포맷터
      localization: {
        priceFormatter: (p: number) => Math.round(p).toLocaleString(),
      },
    });
    chartRef.current = chart;

    // 2. 캔들스틱 (주가)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444', downColor: '#3b82f6', borderVisible: false, wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
    });
    
    if (data.length > 0) {
      candleSeries.setData(data.map(d => ({ ...d, time: d.time as any })));
    }

    // [신규] 거래량 막대 그래프
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '', // 오버레이 모드 (별도 스케일 없이 하단에 배치)
    });
    
    // 거래량 위치 조정 (하단 20% 영역만 사용)
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, 
        bottom: 0,
      },
    });

    if (data.length > 0) {
      volumeSeries.setData(data.map(d => ({
        time: d.time as any,
        value: d.volume,
        color: d.close >= d.open ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.5)', // 반투명 빨강/파랑
      })));
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

    // ★ [수정] 미래 날짜 데이터 생성 로직
    // 주가 데이터의 마지막 날짜 이후부터 재무 데이터의 마지막 연도 말일까지 날짜 생성
    const futureDates: string[] = [];
    if (data.length > 0 && maxYear > 0) {
        const lastData = data[data.length - 1];
        const lastDate = new Date(lastData.time);
        
        // 마지막 데이터의 연도가 maxYear보다 작거나 같을 때만 미래 데이터 생성 필요
        // (이미 주가 데이터가 maxYear보다 더 미래까지 있다면 굳이 생성 안 함 - 일반적이진 않음)
        const endDate = new Date(maxYear, 11, 31); // 12월 31일

        if (lastDate < endDate) {
            let curr = new Date(lastDate);
            curr.setDate(curr.getDate() + 1); // 다음날부터

            while (curr <= endDate) {
                const y = curr.getFullYear();
                const m = String(curr.getMonth() + 1).padStart(2, '0');
                const d = String(curr.getDate()).padStart(2, '0');
                futureDates.push(`${y}-${m}-${d}`);
                
                // 하루 증가
                curr.setDate(curr.getDate() + 1);
            }
        }
    }

    // 밴드 값 계산 함수 (공통 로직 분리)
    const calculateBandValue = (dateStr: string, mult: number) => {
        const dateObj = new Date(dateStr);
        const currentYear = dateObj.getFullYear();

        // Target Value (올해 연말 기준 값)
        let targetBase = finMap.get(currentYear);
        // Start Value (작년 연말 기준 값 = 올해의 시작 값)
        let startBase = finMap.get(currentYear - 1);

        // [수정] 음수 값은 0으로 처리하여 차트가 0 아래로 내려가지 않도록 함
        if (targetBase !== undefined && targetBase < 0) targetBase = 0;
        if (startBase !== undefined && startBase < 0) startBase = 0;

        // 예외 처리 1: 올해 데이터가 없으면? (미래 추정치 or 가장 최근 데이터 사용)
        if (targetBase === undefined) {
            if (currentYear > maxYear) targetBase = finMap.get(maxYear); // 미래는 최근 값 유지
            else return NaN; // 과거 데이터 없으면 그리지 않음
        }

        // 예외 처리 2: 작년 데이터가 없으면? (데이터 시작점)
        // -> 보간할 수 없으므로 올해 값으로 평행선 그리기 (Flat)
        if (startBase === undefined) {
            startBase = targetBase; 
        }

        // 보간(Interpolation) 비율 계산
        const startOfYear = new Date(currentYear, 0, 1).getTime();
        const endOfYear = new Date(currentYear, 11, 31).getTime();
        const current = dateObj.getTime();

        let ratio = (current - startOfYear) / (endOfYear - startOfYear);
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;

        const interpolatedBase = startBase! + (targetBase! - startBase!) * ratio;
        
        // [수정] 차트 라이브러리 한계값 방어 로직 (약 90조)
        const MAX_VAL = 90000000000000; 
        let result = Math.floor(interpolatedBase * mult);
        
        if (result > MAX_VAL) result = MAX_VAL;
        if (result < -MAX_VAL) result = -MAX_VAL;

        return result;
    };

    settings.multipliers.forEach((mult, idx) => {
      const lineSeries = chart.addSeries(LineSeries, {
        color: bandColors[idx % bandColors.length],
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: `${settings.type} ${mult}x`,
        crosshairMarkerVisible: true,
        lastValueVisible: false,
      });

      // 1. 기존 주가 데이터 구간의 밴드 값
      const currentData = data.map(d => ({
        time: d.time as any,
        value: calculateBandValue(d.time, mult)
      })).filter(d => !isNaN(d.value));

      // 2. 미래 구간의 밴드 값
      const futureLineData = futureDates.map(dateStr => ({
        time: dateStr as any,
        value: calculateBandValue(dateStr, mult)
      })).filter(d => !isNaN(d.value));

      // 3. 병합 및 설정
      lineSeries.setData([...currentData, ...futureLineData]);
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