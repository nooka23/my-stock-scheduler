import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req: NextRequest) {
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase server env vars are missing.');
    }

    const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').trim().toUpperCase();
    if (!ticker || !/^[A-Z0-9._-]+$/.test(ticker)) {
      return NextResponse.json({ error: 'A valid US ticker is required.' }, { status: 400 });
    }

    const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '1000');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 1000;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const [{ data, error }, { data: rsData, error: rsError }] = await Promise.all([
      supabase
        .schema('market_data')
        .from('us_daily_prices')
        .select('trade_date, open, high, low, close, volume, vwap, change, change_pct')
        .eq('ticker', ticker)
        .eq('source', 'KIS_OVERSEAS_DAILYPRICE')
        .order('trade_date', { ascending: false })
        .limit(limit),
      supabase
        .schema('market_data')
        .from('us_equity_rs_rankings')
        .select('date, score_weighted')
        .eq('ticker', ticker)
        .order('date', { ascending: false })
        .limit(limit),
    ]);

    if (error) throw error;
    if (rsError) throw rsError;

    const rsByDate = new Map(
      (rsData ?? []).map((row) => [row.date, row.score_weighted]),
    );

    return NextResponse.json({
      rows: (data ?? []).map((row) => ({
        ...row,
        rs: rsByDate.get(row.trade_date) ?? null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
