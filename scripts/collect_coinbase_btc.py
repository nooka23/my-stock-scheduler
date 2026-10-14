"""Collect completed Coinbase BTC/USD UTC daily candles for owner use.
Public chart redistribution is not enabled by this collector.
"""
import argparse
import math
import time
import fcntl
import tempfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
import requests
from supabase import create_client
from collect_fred_market_data import require_environment,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY
SOURCE='COINBASE_EXCHANGE_DAILY'
CODE='CRYPTO_BTCUSD'
URL='https://api.exchange.coinbase.com/products/BTC-USD/candles'


def fetch_history(start,end,now):
    session=requests.Session();session.headers['User-Agent']='MyStockScheduler-DailyReview/1.0'
    rows={};cursor=start
    while cursor<end:
        stop=min(cursor+timedelta(days=200),end)
        for attempt in range(3):
            try:
                r=session.get(URL,params={'granularity':86400,'start':cursor.isoformat(),'end':stop.isoformat()},timeout=(10,30))
                r.raise_for_status();data=r.json()
                if not isinstance(data,list):raise ValueError('Unexpected candle response')
                break
            except (requests.RequestException,ValueError):
                if attempt==2:raise
                time.sleep(2**attempt)
        for candle in data:
            if not isinstance(candle,list) or len(candle)!=6:raise ValueError('Unexpected candle format')
            timestamp,low,high,opening,close,volume=map(float,candle)
            day=datetime.fromtimestamp(timestamp,timezone.utc)
            if not(start<=day<end) or day+timedelta(days=1)>now:continue
            if timestamp%86400 or not all(math.isfinite(v) for v in [low,high,opening,close,volume]):raise ValueError('Invalid candle')
            if not(0<low<=opening<=high and low<=close<=high and volume>=0):raise ValueError('Invalid candle OHLCV')
            rows[day.date().isoformat()]=dict(trade_date=day.date().isoformat(),open=opening,high=high,low=low,close=close,volume=volume,currency='USD',source=SOURCE,source_updated_at=None,raw_payload={'product':'BTC-USD','utc_bucket_start':int(timestamp),'granularity':86400})
        cursor=stop;time.sleep(.15)
    return [rows[k] for k in sorted(rows)]


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--lookback-days',type=int,default=7);p.add_argument('--dry-run',action='store_true');args=p.parse_args()
    if not 1<=args.lookback_days<=3650:p.error('lookback must be 1..3650 days')
    now=datetime.now(timezone.utc);end=now.replace(hour=0,minute=0,second=0,microsecond=0);start=end-timedelta(days=args.lookback_days)
    rows=fetch_history(start,end,now)
    if not rows:raise ValueError('No completed BTC daily candles')
    latest=(end-timedelta(days=1)).date().isoformat()
    if rows[-1]['trade_date']!=latest:raise ValueError('Latest completed candle missing; no write')
    if args.dry_run:
        print(f"DRY RUN: {len(rows)} completed candles, {rows[0]['trade_date']} .. {rows[-1]['trade_date']}");return
    require_environment();db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    asset=db.table('market_instruments').select('id').eq('internal_code',CODE).eq('provider','COINBASE').eq('is_enabled',True).single().execute().data
    run=db.table('data_ingestion_runs').insert({'pipeline_key':'coinbase_btc_daily','source':SOURCE,'status':'RUNNING','metadata':{'start':start.isoformat(),'end_exclusive':end.isoformat(),'timezone':'UTC','scope':'owner_only'}}).execute().data[0]['id']
    written=0
    try:
        for row in rows:row['instrument_id']=asset['id']
        for offset in range(0,len(rows),200):
            batch=rows[offset:offset+200];db.table('global_daily_prices').upsert(batch,on_conflict='instrument_id,trade_date,source').execute();written+=len(batch)
        db.table('data_ingestion_runs').update({'status':'SUCCEEDED','completed_at':datetime.now(timezone.utc).isoformat(),'rows_read':len(rows),'rows_written':written}).eq('id',run).execute()
    except Exception:
        db.table('data_ingestion_runs').update({'status':'FAILED','completed_at':datetime.now(timezone.utc).isoformat(),'rows_written':written,'error_message':'BTC collection write failed; inspect local execution'}).eq('id',run).execute();raise
    print(f"BTC/USD: {written} rows upserted, {rows[0]['trade_date']} .. {rows[-1]['trade_date']}, UTC closed candles only")


if __name__=='__main__':
    lock=open(Path(tempfile.gettempdir())/'my-stock-scheduler-btc.lock','w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise SystemExit('BTC collector already running')
    main()
