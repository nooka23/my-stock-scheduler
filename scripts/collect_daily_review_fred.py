"""Collect FRED observations, detect revisions, preserve first-seen timestamps.

CSV observations are not original release timestamps. First collection is a
baseline, not a list of new releases. Only completed series are checkpointed.
"""
import argparse
import csv
import io
import json
import sys
import time
from statistics import median
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
from supabase import create_client
from collect_fred_market_data import SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,require_environment

ROOT=Path(__file__).resolve().parents[1]


def validate_frequency(values, frequency):
    dates=sorted(datetime.strptime(day,'%Y-%m-%d') for day in values)
    gaps=[(b-a).days for a,b in zip(dates[-13:],dates[-12:])] if len(dates)>=13 else [(b-a).days for a,b in zip(dates,dates[1:])]
    if len(gaps)>=4 and frequency=='monthly' and median(gaps)>45:
        raise ValueError('Monthly configuration received lower-frequency observations')
    if len(gaps)>=4 and frequency=='quarterly' and not 60<=median(gaps)<=120:
        raise ValueError('Quarterly configuration received incompatible observations')


def fetch(session,code,start):
    for attempt in range(3):
        try:
            r=session.get('https://fred.stlouisfed.org/graph/fredgraph.csv',params={'id':code,'cosd':start},timeout=(10,40))
            r.raise_for_status()
            reader=csv.DictReader(io.StringIO(r.text))
            if code not in (reader.fieldnames or []):
                raise ValueError('Unexpected CSV columns')
            out={}
            for row in reader:
                day=row.get('observation_date') or row.get('DATE')
                value=row.get(code)
                if not day or value in (None,'','.'):
                    continue
                datetime.strptime(day,'%Y-%m-%d')
                number=float(value)
                import math
                if not math.isfinite(number): raise ValueError('Non-finite observation')
                out[day]=number
            if not out: raise ValueError('No observations')
            return out
        except (requests.RequestException,ValueError):
            if attempt==2: raise
            time.sleep(2**attempt)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dry-run',action='store_true')
    p.add_argument('--limit',type=int)
    p.add_argument('--series',action='append',help='Collect only the named configured series; repeatable')
    p.add_argument('--start-date',default='2016-01-01')
    args=p.parse_args()
    datetime.strptime(args.start_date,'%Y-%m-%d')
    require_environment()
    db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    config=json.loads((ROOT/'config/daily_review_fred.json').read_text())
    if args.series:
        if set(args.series)-{i['code'] for i in config}: p.error('Unknown series code')
        config=[i for i in config if i['code'] in args.series]
    if args.limit: config=config[:args.limit]
    session=requests.Session()
    failures=[];total=0;change_count=0
    for item in config:
        code=item['code'];stamp=datetime.now(timezone.utc).isoformat()
        review_date=datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
        try:
            values=fetch(session,code,args.start_date)
            validate_frequency(values,item['frequency'])
            if args.dry_run:
                print(f'{code}: {len(values)} observations, latest {max(values)}',flush=True)
                continue
            existing=db.table('economic_series').select('last_checked_at').eq('code',code).limit(1).execute().data
            previous=existing[0] if existing else None
            baseline=not previous or not previous['last_checked_at']
            old={};offset=0
            while True:
                batch=db.table('economic_observations').select('observation_date,value,first_seen_at').eq('series_code',code).order('observation_date').range(offset,offset+999).execute().data
                old.update({r['observation_date']:r for r in batch})
                if len(batch)<1000: break
                offset+=1000
            if old and max(values)<max(old):
                raise ValueError('Source latest observation regressed; preserve stored checkpoint')
            rows=[];changes=[]
            for day,value in sorted(values.items()):
                prev=old.get(day)
                if prev and float(prev['value'])==value: continue
                rows.append(dict(series_code=code,observation_date=day,value=value,
                                 first_seen_at=prev['first_seen_at'] if prev else stamp,last_seen_at=stamp))
                if not baseline:
                    changes.append(dict(series_code=code,observation_date=day,old_value=prev['value'] if prev else None,new_value=value,
                                        detected_at=stamp,review_date=review_date,kind='revision' if prev else 'new'))
            # Commit one series atomically using the migration RPC.
            db.rpc('save_economic_series', {'p_series':dict(**item,source_url=f'https://fred.stlouisfed.org/series/{code}'),
                     'p_rows':rows,'p_changes':changes,'p_checked_at':stamp,'p_latest':max(values)}).execute()
            total+=len(rows);change_count+=len(changes)
            print(f'OK {code}: {len(values)} observations, {len(rows)} written, {len(changes)} changes; latest {max(values)}',flush=True)
        except Exception as exc:
            failures.append(code)
            # No credential-bearing exception contents in operational logs.
            print(f'FAILED {code}: {type(exc).__name__}',file=sys.stderr,flush=True)
            if not args.dry_run:
                db.table('economic_series').upsert(dict(**item,source_url=f'https://fred.stlouisfed.org/series/{code}'),on_conflict='code').execute()
                db.table('economic_series').update({'last_error':type(exc).__name__}).eq('code',code).execute()
    print(json.dumps({'series':len(config),'failed':failures,'rows_written':total,'changes':change_count}),flush=True)
    return 2 if failures else 0


if __name__=='__main__':
    import fcntl
    import tempfile
    lock = open(Path(tempfile.gettempdir()) / 'my-stock-scheduler-fred.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('Another FRED collection is running', file=sys.stderr)
        sys.exit(2)
    sys.exit(main())
