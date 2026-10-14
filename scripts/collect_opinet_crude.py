"""Store Opinet's published daily Dubai spot, ICE Brent futures and NYMEX WTI futures prices."""
import argparse
import csv
import fcntl
import io
import math
import re
import tempfile
import time
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
from supabase import create_client
from collect_fred_market_data import require_environment,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY
SOURCE='OPINET_CRUDE_DAILY'
ASSETS={'Dubai':'OPINET_DUBAI_SPOT','Brent':'OPINET_BRENT_FUTURE','WTI':'OPINET_WTI_FUTURE'}
URL='https://www.opinet.co.kr/glopcoil_csv.do'


def fetch(start,end):
    session=requests.Session()
    session.headers['User-Agent']='Mozilla/5.0'
    session.get('https://www.opinet.co.kr/glopcoilSelect.do',timeout=(10,30)).raise_for_status()
    rows={key:{} for key in ASSETS}
    cursor=start
    while cursor<=end:
        stop=min(end,date(cursor.year,12,31))
        params={'TERM':'D','SEL_DIV':'div_dar','STDDATE':cursor.strftime('%Y%m%d'),'ENDDATE':stop.strftime('%Y%m%d'),'OILSRTCD':['001','002','003'],'OILSRTCD1':'001','OILSRTCD2':'002','OILSRTCD3':'003'}
        for prefix,day in [('STA',cursor),('END',stop)]:
            params.update({prefix+'_Y':day.strftime('%Y'),prefix+'_M':day.strftime('%m'),prefix+'_D':day.strftime('%d')})
        for attempt in range(3):
            try:
                response=session.post(URL,data=params,timeout=(10,30))
                response.raise_for_status()
                try: text=response.content.decode('utf-8-sig')
                except UnicodeDecodeError: text=response.content.decode('cp949')
                reader=csv.DictReader(io.StringIO(text))
                if reader.fieldnames != ['기간','Dubai','Brent','WTI']: raise ValueError('Unexpected CSV schema or unit')
                chunk=list(reader)
                break
            except (requests.RequestException,UnicodeError,ValueError):
                if attempt==2: raise
                time.sleep(2**attempt)
        for raw in chunk:
            match=re.fullmatch(r'(\d{2})년(\d{2})월(\d{2})일',raw['기간'].strip())
            if not match: raise ValueError('Unexpected observation date')
            year,month,day=map(int,match.groups());observed=date(2000+year,month,day)
            if not cursor<=observed<=stop: raise ValueError('Provider ignored requested date interval')
            for label in ASSETS:
                value=raw[label].strip().replace(',','')
                if value in ('','-','.'): continue
                close=float(value)
                if not math.isfinite(close): raise ValueError('Nonfinite price')
                rows[label][observed.isoformat()]={'trade_date':observed.isoformat(),'close':close,'open':None,'high':None,'low':None,'volume':None,'currency':'USD','source':SOURCE,'source_updated_at':None,'raw_payload':{'product':label,'unit':'USD/bbl','published_date':observed.isoformat(),'download_url':URL}}
        cursor=stop+timedelta(days=1)
        time.sleep(.5)
    for label,observations in rows.items():
        if not observations or (end-date.fromisoformat(max(observations))).days>7: raise ValueError(f'Missing or stale {label} observations')
    return {key:[value[day] for day in sorted(value)] for key,value in rows.items()}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lookback-days',type=int,default=14)
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    if not 7<=args.lookback_days<=3650: parser.error('lookback must be 7..3650')
    end=datetime.now(ZoneInfo('Asia/Seoul')).date()-timedelta(days=1)
    start=end-timedelta(days=args.lookback_days-1)
    if start.year<2008: raise ValueError('Opinet history starts in 2008')
    require_environment()
    db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    run=None;written=0
    if not args.dry_run:
        run=db.table('data_ingestion_runs').insert({'pipeline_key':'opinet_crude_daily','source':SOURCE,'status':'RUNNING','metadata':{'start':str(start),'end':str(end),'scope':'owner_only'}}).execute().data[0]['id']
    try:
        histories=fetch(start,end)
        for label,rows in histories.items():
            if not args.dry_run:
                asset=db.table('market_instruments').select('id').eq('internal_code',ASSETS[label]).eq('provider','OPINET').eq('is_enabled',True).single().execute().data
                for row in rows: row['instrument_id']=asset['id']
                for offset in range(0,len(rows),200):
                    batch=rows[offset:offset+200];db.table('global_daily_prices').upsert(batch,on_conflict='instrument_id,trade_date,source').execute();written+=len(batch)
            print(f'Opinet {label}: {len(rows)} observations, {rows[0]["trade_date"]} .. {rows[-1]["trade_date"]}',flush=True)
        if run: db.table('data_ingestion_runs').update({'status':'SUCCEEDED','completed_at':datetime.now(timezone.utc).isoformat(),'rows_read':sum(len(rows) for rows in histories.values()),'rows_written':written}).eq('id',run).execute()
    except Exception as error:
        if run: db.table('data_ingestion_runs').update({'status':'FAILED','completed_at':datetime.now(timezone.utc).isoformat(),'rows_written':written,'error_message':f'Opinet collection failed ({type(error).__name__}); inspect local job'}).eq('id',run).execute()
        raise SystemExit(f'Opinet collection failed ({type(error).__name__})') from None


if __name__=='__main__':
    with open(Path(tempfile.gettempdir())/'my-stock-scheduler-opinet-crude.lock','w') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise SystemExit('Opinet collector already running')
        main()
