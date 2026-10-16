import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { koreanDate, observationStatus } from '@/lib/daily-review-market';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? koreanDate();
  const day = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date || date > koreanDate()) return NextResponse.json({error:'날짜가 올바르지 않습니다.'},{status:400});
  try {
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing environment');
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}).schema('market_data');
    const {data:series,error}=await db.from('economic_series').select('code,name,group,frequency,unit,transform,last_checked_at,last_changed_at,last_error,latest_observation_date,source_url,source').order('code');
    if(error) throw error;
    const {data:changes,error:changeError}=await db.from('economic_changes').select('series_code,observation_date,old_value,new_value,kind,detected_at').eq('review_date',date).order('detected_at',{ascending:false}).limit(1000);
    if(changeError) throw changeError;
    const indicators = req.nextUrl.searchParams.get('view') === 'indicators';
    const selected = (series ?? []).filter(item => !indicators || (item.frequency !== 'daily' && item.group !== '금리' && item.group !== '시장 보조'));
    const items=await Promise.all(selected.map(async item=>{
      const {data:rows,error:rowError}=await db.from('economic_observations').select('observation_date,value').eq('series_code',item.code).lte('observation_date',date).order('observation_date',{ascending:false}).limit(36);
      if(rowError) throw rowError;
      const through = new Date(`${date}T00:00:00Z`); through.setUTCDate(through.getUTCDate()-1);
      const freshness = item.frequency === 'daily' ? observationStatus(rows?.[0]?.observation_date, through.toISOString().slice(0,10), Boolean(item.last_error)) : undefined;
      let detected_at: string | null = null;
      if (indicators && rows?.[0]) {
        const { data: releases, error: releaseError } = await db.from('economic_changes').select('detected_at').eq('series_code', item.code).eq('observation_date', rows[0].observation_date).eq('kind', 'new').lte('review_date', date).order('detected_at').limit(1);
        if (releaseError) throw releaseError;
        detected_at = releases?.[0]?.detected_at ?? null;
      }
      return {...item,freshness,detected_at,rows:(rows??[]).reverse().map(row=>({time:row.observation_date,value:Number(row.value)}))};
    }));
    return NextResponse.json({items,changes:(changes??[]).filter(change => selected.some(item => item.code === change.series_code)),date});
  } catch { return NextResponse.json({error:'경제지표를 불러오지 못했습니다.'},{status:503}); }
}
