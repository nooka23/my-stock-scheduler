import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeLivermoreStateRows, PriceRow } from '@/lib/livermoreStateMachine';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type DbRow = {
  date: string;
  open: number;
  high: number | null;
  low: number | null;
  close: number;
};

function formatDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

async function fetchDailyPrices(code: string, startDate: string, endDate: string): Promise<DbRow[]> {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase env vars are missing.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const pageSize = 1000;
  let offset = 0;
  const allRows: DbRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from('daily_prices_v2')
      .select('date, open, high, low, close')
      .eq('code', code)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw error;
    }

    const batch = (data ?? []) as DbRow[];
    allRows.push(...batch);

    if (batch.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return allRows;
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code') ?? 'KOSPI';
    const yearsRaw = Number(searchParams.get('years') ?? '3');
    const reversalMultiplierRaw = Number(searchParams.get('reversalMult') ?? '4');
    const confirmMultiplierRaw = Number(searchParams.get('confirmMult') ?? '2');

    const years = Number.isFinite(yearsRaw) ? Math.min(Math.max(yearsRaw, 1), 20) : 3;
    const reversalMultiplier = Number.isFinite(reversalMultiplierRaw)
      ? Math.min(Math.max(reversalMultiplierRaw, 0.5), 20)
      : 4;
    const confirmMultiplier = Number.isFinite(confirmMultiplierRaw)
      ? Math.min(Math.max(confirmMultiplierRaw, 0.1), 20)
      : 2;

    const end = new Date();
    const start = new Date(end);
    start.setFullYear(end.getFullYear() - years);

    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    const rawRows = await fetchDailyPrices(code, startDate, endDate);

    if (rawRows.length === 0) {
      return NextResponse.json(
        {
          meta: {
            code,
            startDate,
            endDate,
            rowCount: 0,
          },
          rows: [],
        },
        { status: 200 },
      );
    }

    const byDate = new Map<string, PriceRow>();
    for (const row of rawRows) {
      const dateOnly = formatDateOnly(row.date);
      byDate.set(dateOnly, {
        date: dateOnly,
        open: Number(row.open),
        high: row.high === null ? null : Number(row.high),
        low: row.low === null ? null : Number(row.low),
        close: Number(row.close),
      });
    }

    const normalizedRows = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    const missingHighLowCount = normalizedRows.filter((row) => row.high === null || row.low === null).length;
    const hasTimestampRows = rawRows.some((row) => row.date.includes('T') || row.date.includes(' '));

    const computed = computeLivermoreStateRows(normalizedRows, {
      reversalMultiplier,
      confirmMultiplier,
      momentumLookback: 60,
    });

    return NextResponse.json({
      meta: {
        code,
        startDate,
        endDate,
        rowCount: normalizedRows.length,
        hasTimestampRows,
        missingHighLowCount,
        reversalMultiplier,
        confirmMultiplier,
      },
      rows: computed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
