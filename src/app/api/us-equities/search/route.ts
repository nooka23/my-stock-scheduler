import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type UsEquityRow = {
  ticker: string;
  company_name: string;
};

export async function GET(req: NextRequest) {
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase server env vars are missing.');
    }

    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

    if (!q) {
      return NextResponse.json({ rows: [] });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const pattern = `%${q.replace(/[%_]/g, '')}%`;

    const search = (column: 'company_name' | 'ticker') => supabase
      .schema('market_data')
      .from('us_equity_universe')
      .select('ticker, company_name')
      .eq('provider', 'MASSIVE')
      .eq('is_active', true)
      .ilike(column, pattern)
      .order(column === 'ticker' ? 'ticker' : 'company_name', { ascending: true })
      .limit(limit);

    const [nameResult, tickerResult] = await Promise.all([search('company_name'), search('ticker')]);
    if (nameResult.error) throw nameResult.error;
    if (tickerResult.error) throw tickerResult.error;

    const rows = new Map<string, { code: string; name: string; market: 'US' }>();
    [...(nameResult.data ?? []), ...(tickerResult.data ?? [])].forEach((row: UsEquityRow) => {
      rows.set(row.ticker, { code: row.ticker, name: row.company_name, market: 'US' });
    });

    return NextResponse.json({
      rows: Array.from(rows.values()).slice(0, limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
