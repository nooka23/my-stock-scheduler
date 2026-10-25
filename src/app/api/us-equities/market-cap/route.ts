import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type MarketCapRow = {
  ticker: string;
  market_cap: number | string | null;
  volume: number | string | null;
};

type UniverseRow = {
  ticker: string;
  company_name: string;
};

type RsRow = {
  ticker: string;
  score_weighted: number | string | null;
};

export async function GET() {
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase server env vars are missing.');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).schema('market_data');

    const { data: latestRows, error: latestError } = await supabase
      .from('us_daily_prices')
      .select('trade_date')
      .eq('source', 'KIS_OVERSEAS_DAILYPRICE')
      .not('market_cap', 'is', null)
      .order('trade_date', { ascending: false })
      .limit(1);

    if (latestError) throw latestError;

    const referenceDate = latestRows?.[0]?.trade_date;
    if (!referenceDate) {
      return NextResponse.json({ referenceDate: null, rows: [] });
    }

    const { data: marketCapRows, error: marketCapError } = await supabase
      .from('us_daily_prices')
      .select('ticker, market_cap, volume')
      .eq('source', 'KIS_OVERSEAS_DAILYPRICE')
      .eq('trade_date', referenceDate)
      .not('market_cap', 'is', null)
      .order('market_cap', { ascending: false })
      .limit(100);

    if (marketCapError) throw marketCapError;

    const rows = (marketCapRows ?? []) as MarketCapRow[];
    const tickers = rows.map((row) => row.ticker);
    if (tickers.length === 0) {
      return NextResponse.json({ referenceDate, rows: [] });
    }

    const [{ data: companyRows, error: companyError }, { data: rsRows, error: rsError }] = await Promise.all([
      supabase
        .from('us_equity_universe')
        .select('ticker, company_name')
        .in('ticker', tickers),
      supabase
        .from('us_equity_rs_rankings')
        .select('ticker, score_weighted')
        .eq('date', referenceDate)
        .in('ticker', tickers),
    ]);

    if (companyError) throw companyError;
    if (rsError) throw rsError;

    const companyNames = new Map(
      ((companyRows ?? []) as UniverseRow[]).map((row) => [row.ticker, row.company_name]),
    );
    const rsRatings = new Map(
      ((rsRows ?? []) as RsRow[]).map((row) => [row.ticker, row.score_weighted]),
    );

    return NextResponse.json({
      referenceDate,
      rows: rows.map((row) => ({
        code: row.ticker,
        name: companyNames.get(row.ticker) ?? row.ticker,
        rsRating: rsRatings.get(row.ticker) ?? null,
        marketCap: row.market_cap,
        volume: row.volume,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
