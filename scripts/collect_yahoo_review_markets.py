"""Collect owner-only Yahoo daily market history; never synthesize missing bars."""
import argparse
import fcntl
import math
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
from supabase import create_client
from collect_fred_market_data import require_environment, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

SOURCE = 'YAHOO_CHART_DAILY'
ASSETS = {'YAHOO_GOLD_FUTURE':'GC=F', 'YAHOO_COPPER_FUTURE':'HG=F', 'YAHOO_DXY':'DX-Y.NYB', 'YAHOO_RUSSELL2000':'^RUT', 'YAHOO_WTI_FUTURE':'CL=F', 'YAHOO_BRENT_FUTURE':'BZ=F'}


def fetch(symbol, days, now):
    response = None
    for attempt in range(3):
        try:
            response = requests.get('https://query1.finance.yahoo.com/v8/finance/chart/' + requests.utils.quote(symbol, safe=''), params={'period1':int((now-timedelta(days=days)).timestamp()), 'period2':int(now.timestamp()), 'interval':'1d'}, headers={'User-Agent':'Mozilla/5.0'}, timeout=(10,30))
            response.raise_for_status()
            payload = response.json()['chart']
            if payload.get('error') or not payload.get('result'): raise ValueError('Missing chart result')
            break
        except (requests.RequestException, ValueError, KeyError):
            if attempt == 2: raise
            time.sleep(2**attempt)
    return parse_chart(payload['result'][0], symbol, now)


def parse_chart(result, symbol, now):
    meta = result['meta']
    if meta.get('symbol') != symbol or meta.get('currency') != 'USD': raise ValueError('Unexpected instrument identity')
    zone = ZoneInfo(meta['exchangeTimezoneName'])
    today = now.astimezone(zone).date()
    session_end = meta.get('currentTradingPeriod',{}).get('regular',{}).get('end')
    quotes = result['indicators']['quote'][0]
    rows = {}
    for index, timestamp in enumerate(result.get('timestamp',[])):
        bucket = datetime.fromtimestamp(timestamp,zone)
        day = bucket.date()
        # Futures feeds append a live quote with a non-midnight timestamp,
        # sometimes carrying the SAME local date as a historical daily bar.
        # Never let that quote overwrite the canonical daily bucket.
        if symbol != '^RUT' and (bucket.hour, bucket.minute, bucket.second) != (0, 0, 0): continue
        # A current local-day bar is accepted only after the provider's session end + 30 minutes.
        if day > today or (day == today and (not session_end or now.timestamp() < session_end+1800)): continue
        values = {field:quotes.get(field,[])[index] for field in ['open','high','low','close','volume']}
        if any(values[field] is None for field in ['open','high','low','close']): continue
        if any(not math.isfinite(float(value)) for value in values.values() if value is not None): raise ValueError('Nonfinite OHLCV')
        if not (values['low'] <= values['open'] <= values['high'] and values['low'] <= values['close'] <= values['high']) or (symbol not in ('CL=F', 'BZ=F') and values['low'] <= 0): raise ValueError('Invalid OHLC')
        if values['volume'] is not None and values['volume'] < 0: raise ValueError('Negative volume')
        rows[day.isoformat()] = {'trade_date':day.isoformat(), **values, 'currency':'USD', 'source':SOURCE, 'source_updated_at':None, 'raw_payload':{'symbol':symbol,'exchange_timezone':str(zone),'bucket_timestamp':timestamp,'interval':'1d'}}
    ordered = [rows[key] for key in sorted(rows)]
    if not ordered or (today-datetime.fromisoformat(ordered[-1]['trade_date']).date()).days > 7: raise ValueError('Missing or stale completed bars')
    return ordered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lookback-days',type=int,default=14)
    parser.add_argument('--dry-run',action='store_true')
    args = parser.parse_args()
    if not 7 <= args.lookback_days <= 3650: parser.error('lookback must be 7..3650')
    require_environment()
    db = create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    failed = []
    for code,symbol in ASSETS.items():
        now = datetime.now(timezone.utc)
        run = None
        written = 0
        try:
            if not args.dry_run:
                run = db.table('data_ingestion_runs').insert({'pipeline_key':'yahoo_review_daily','source':SOURCE,'status':'RUNNING','metadata':{'symbol':symbol,'lookback_days':args.lookback_days,'scope':'owner_only'}}).execute().data[0]['id']
            rows = fetch(symbol,args.lookback_days,now)
            if not args.dry_run:
                asset = db.table('market_instruments').select('id').eq('internal_code',code).eq('provider','YAHOO').eq('is_enabled',True).single().execute().data
                for row in rows: row['instrument_id'] = asset['id']
                for offset in range(0,len(rows),200):
                    batch = rows[offset:offset+200]
                    db.table('global_daily_prices').upsert(batch,on_conflict='instrument_id,trade_date,source').execute()
                    written += len(batch)
                db.table('data_ingestion_runs').update({'status':'SUCCEEDED','completed_at':datetime.now(timezone.utc).isoformat(),'rows_read':len(rows),'rows_written':written}).eq('id',run).execute()
            print(f'{symbol}: {len(rows)} completed bars, {rows[0]["trade_date"]} .. {rows[-1]["trade_date"]}' + (' (dry run)' if args.dry_run else ' upserted'))
        except Exception as error:
            failed.append(symbol)
            if run:
                db.table('data_ingestion_runs').update({'status':'FAILED','completed_at':datetime.now(timezone.utc).isoformat(),'rows_written':written,'error_message':f'{symbol} collection failed ({type(error).__name__}); inspect local job'}).eq('id',run).execute()
            print(f'{symbol}: FAILED ({type(error).__name__})')
        time.sleep(1)
    if failed: raise SystemExit('Failed assets: '+', '.join(failed))


if __name__ == '__main__':
    with open(Path(tempfile.gettempdir())/'my-stock-scheduler-yahoo-review.lock','w') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise SystemExit('Yahoo review collector already running')
        main()
