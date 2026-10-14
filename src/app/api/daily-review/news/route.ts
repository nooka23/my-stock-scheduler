import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {koreanDate} from '@/lib/daily-review-market';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 const date=req.nextUrl.searchParams.get('date')??koreanDate();const parsed=new Date(`${date}T00:00:00Z`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||date>koreanDate())return NextResponse.json({error:'리뷰 날짜가 올바르지 않습니다.'},{status:400});
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error('Missing server config');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}).schema('market_data');
  const {data,error}=await db.from('daily_review_news_runs').select('run_id,review_date,collected_at,window_start,window_end,collection_status,review_status,candidate_count,coverage,events,reviewed_at').eq('review_date',date).order('collected_at',{ascending:false}).limit(1);
  if(error)throw error;return NextResponse.json({run:data?.[0]??null});
 }catch{return NextResponse.json({error:'뉴스 리뷰를 불러오지 못했습니다.'},{status:503});}
}
