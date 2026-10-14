import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { reviewMarketCodes, koreanDate, yahooReviewAssets, opinetReviewAssets, reviewSourceLabel } from '@/lib/daily-review-market';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const instrument = req.nextUrl.searchParams.get('instrument') ?? '';
  const code = Object.prototype.hasOwnProperty.call(reviewMarketCodes, instrument) ? reviewMarketCodes[instrument] : undefined;
  const date = req.nextUrl.searchParams.get('date') ?? '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > koreanDate()) {
    return NextResponse.json({ error: '자산 또는 리뷰 날짜가 올바르지 않습니다.' }, { status: 400 });
  }
  // A Korean morning review includes only observations dated before that day.
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  const through = parsed.toISOString().slice(0, 10);
  parsed.setUTCFullYear(parsed.getUTCFullYear() - 1);
  parsed.setUTCDate(parsed.getUTCDate() - 7);
  const start = parsed.toISOString().slice(0, 10);
  const btc = instrument === 'btc';
  const yahoo = yahooReviewAssets.has(instrument);
  const opinet = opinetReviewAssets.has(instrument);
  const derived = instrument === 'cnykrw';
  const fred = instrument === 'us2y';
  // The UTC daily bucket closes at 09:00 KST. Never include a live bucket.
  const latestClosed = new Date();
  latestClosed.setUTCDate(latestClosed.getUTCDate() - 1);
  const btcThrough = latestClosed.toISOString().slice(0,10);
  const cutoff = btc && btcThrough < through ? btcThrough : through;
  const source = opinet ? 'OPINET_CRUDE_DAILY' : yahoo ? 'YAHOO_CHART_DAILY' : btc ? 'COINBASE_EXCHANGE_DAILY' : derived ? 'KIS_DERIVED_DAILY_CROSS' : 'KIS_OVERSEAS_DAILY_CHARTPRICE';
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing server configuration');
    if (btc || yahoo || opinet) {
      const cookieStore = await cookies();
      const ownerClient = createRouteHandlerClient({ cookies: (() => cookieStore) as unknown as typeof cookies });
      const { data: { user }, error: authError } = await ownerClient.auth.getUser();
      if (authError || !user) return NextResponse.json({ error: '개인용 데이터 차트는 소유자 로그인 후 확인할 수 있습니다.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
      const { data: owner, error: ownerError } = await ownerClient.rpc('wiki_is_owner');
      if (ownerError || owner !== true) return NextResponse.json({ error: '이 차트의 개인 사용 권한이 없습니다.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).schema('market_data');
    if (fred) {
      const { data, error } = await db.from('economic_observations').select('observation_date,value').eq('series_code', code).gte('observation_date', start).lte('observation_date', cutoff).order('observation_date', { ascending: true }).limit(400);
      if (error) throw error;
      const rows = (data ?? []).filter(row => row.value !== null && Number.isFinite(Number(row.value))).map(row => ({ time: row.observation_date, value: Number(row.value) }));
      return NextResponse.json({ rows, source: 'FRED_DGS2', through: cutoff, sourceLabel: reviewSourceLabel(instrument), dayBoundary: '미국 국채 2년 수익률 · 일별 관측 · 단위 %' }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { data: asset, error: assetError } = await db.from('market_instruments').select('id').eq('internal_code', code).eq('provider', opinet ? 'OPINET' : yahoo ? 'YAHOO' : btc ? 'COINBASE' : derived ? 'CALCULATED' : 'KIS').eq('is_enabled', true).maybeSingle();
    if (assetError) throw assetError;
    if (!asset) return NextResponse.json({ rows: [], source, through });
    const { data, error } = await db.from('global_daily_prices').select('trade_date,close').eq('instrument_id', asset.id).eq('source', source).gte('trade_date', start).lte('trade_date', cutoff).order('trade_date', { ascending: true }).limit(400);
    if (error) throw error;
    const rows = (data ?? []).filter(row => row.close !== null && Number.isFinite(Number(row.close))).map(row => ({ time: row.trade_date, value: Number(row.close) * (instrument === 'jpykrw' ? 100 : 1) }));
    return NextResponse.json({ rows, source, through: cutoff, sourceLabel: reviewSourceLabel(instrument), dayBoundary: btc ? 'UTC 일봉 · 한국시간 오전 9시 종료' : opinet ? '오피넷 공표 관측일 · 현물 추정가/선물 공표가 · 종가만 저장' : yahoo ? '거래소 현지 날짜 · 종료된 세션 일봉' : undefined }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: '시장 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 503 });
  }
}
