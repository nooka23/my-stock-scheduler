'use client';

import { useMemo } from 'react';
import StockChart from '@/components/StockChart';
import {
  calculateEMA,
  calculateKeltner,
  calculateSMA,
  calculateWMA,
} from '@/utils/indicators';

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  rs?: number;
  ema20?: number;
  ma30?: number;
  ma50?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  volumeRank60?: number;
};

interface Props {
  data: ChartData[];
  colors?: {
    backgroundColor?: string;
    textColor?: string;
  };
}

function enrichChartData(data: ChartData[]) {
  const normalized = data.map((item) => ({
    ...item,
    volume: Number(item.volume) || 0,
  }));

  const ema20 = calculateEMA(normalized, 20);
  const ma30 = calculateSMA(normalized, 30);
  const ma50 = calculateSMA(normalized, 50);
  const wma150 = calculateWMA(normalized, 150);
  const keltner = calculateKeltner(normalized, 20, 2.25);

  return normalized.map((item, index) => ({
    ...item,
    ema20: ema20[index],
    ma30: ma30[index],
    ma50: ma50[index],
    wma150: wma150[index],
    keltner: keltner[index],
  }));
}

export default function StockChartDiscovery({ data = [], colors }: Props) {
  const enrichedData = useMemo(() => enrichChartData(data), [data]);
  const hasRs = enrichedData.some((item) => typeof item.rs === 'number' && !Number.isNaN(item.rs));

  return (
    <StockChart
      data={enrichedData}
      colors={colors}
      showLegend
      showOHLC
      visibleIndicators={{
        ema20: true,
        ma30: false,
        ma50: false,
        wma150: true,
        keltner: true,
        volume: true,
        rs: hasRs,
      }}
    />
  );
}
