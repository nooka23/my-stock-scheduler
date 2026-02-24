import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type CompanyRow = {
  code: string;
  name: string;
};

export async function GET(req: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase env vars are missing.');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const searchParams = req.nextUrl.searchParams;
    const q = (searchParams.get('q') ?? '').trim();
    const limitRaw = Number(searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

    if (!q) {
      return NextResponse.json({ rows: [] });
    }

    const escaped = q.replace(/[%_]/g, '');

    const { data, error } = await supabase
      .from('companies')
      .select('code, name')
      .or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%`)
      .order('name', { ascending: true })
      .limit(limit);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      rows: (data ?? []) as CompanyRow[],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

