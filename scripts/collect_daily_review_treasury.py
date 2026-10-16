"""Collect official US Treasury nominal/real par curves, separately from FRED.

First collection is a baseline. Missing tenors remain missing, never carried
forward. Treasury par curves are daily official estimates, not traded closes.
"""
import argparse
import fcntl
import math
import tempfile
import time
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
from supabase import create_client
from collect_fred_market_data import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, require_environment

URL = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml'
KINDS = {
 'nominal': ('daily_treasury_yield_curve', {'1MONTH':'1MO','1_5MONTH':'1_5MO','2MONTH':'2MO','3MONTH':'3MO','4MONTH':'4MO','6MONTH':'6MO', **{f'{n}YEAR':f'{n}Y' for n in (1,2,3,5,7,10,20,30)}}),
 'real': ('daily_treasury_real_yield_curve', {f'{n}YEAR':f'{n}Y' for n in (5,7,10,20,30)})
}
NS = {'a':'http://www.w3.org/2005/Atom', 'm':'http://schemas.microsoft.com/ado/2007/08/dataservices/metadata', 'd':'http://schemas.microsoft.com/ado/2007/08/dataservices'}


def parse_xml(content, kind, year, today):
    root = ET.fromstring(content)
    result = {}
    for entry in root.findall('a:entry', NS):
        props = entry.find('a:content/m:properties', NS)
        if props is None: raise ValueError('Missing Treasury properties')
        date = props.find('d:NEW_DATE', NS)
        if date is None or not date.text: raise ValueError('Missing Treasury observation date')
        day = datetime.fromisoformat(date.text).date()
        if day.year != year or day > today: raise ValueError('Unexpected Treasury observation date')
        for field, tenor in KINDS[kind][1].items():
            node = props.find('d:'+('TC_' if kind == 'real' else 'BC_')+field, NS)
            if node is None or node.get('{'+NS['m']+'}null') == 'true' or not node.text: continue
            value = float(node.text)
            if not math.isfinite(value): raise ValueError('Nonfinite Treasury yield')
            code = ('UST_REAL_' if kind == 'real' else 'UST_') + tenor
            values = result.setdefault(code, {})
            if day.isoformat() in values and values[day.isoformat()] != value: raise ValueError('Conflicting Treasury observations')
            values[day.isoformat()] = value
    if not result: raise ValueError('Empty Treasury curve')
    return result


def fetch(session, kind, year, today):
    for attempt in range(3):
        try:
            response = session.get(URL, params={'data':KINDS[kind][0], 'field_tdr_date_value':year}, timeout=(10,45))
            response.raise_for_status()
            return parse_xml(response.content, kind, year, today)
        except (requests.RequestException, ValueError, ET.ParseError):
            if attempt == 2: raise
            time.sleep(2**attempt)


def metadata(code):
    real = code.startswith('UST_REAL_')
    tenor = code.removeprefix('UST_REAL_').removeprefix('UST_')
    label = tenor.replace('_5MO','.5개월').replace('MO','개월').replace('Y','년')
    return dict(code=code, name=f'미국 {"실질 " if real else ""}국채 {label} · 재무부', group='금리', frequency='daily', unit='%', transform='level', source='US_TREASURY', source_url='https://home.treasury.gov/resource-center-data-chart-center/interest-rates')


def save(db, code, values, now, item=None):
    item = item or metadata(code)
    records = db.table('economic_series').select('last_checked_at,latest_observation_date').eq('code',code).limit(1).execute().data
    record = records[0] if records else None
    if record and record['latest_observation_date'] and max(values) < record['latest_observation_date']: raise ValueError('Source observation date regressed')
    old = {}; offset = 0
    while True:
        batch = db.table('economic_observations').select('observation_date,value,first_seen_at').eq('series_code',code).order('observation_date').range(offset,offset+999).execute().data
        old.update({row['observation_date']:row for row in batch})
        if len(batch)<1000: break
        offset += 1000
    stamp = now.isoformat(); rows = []; changes = []
    for day, value in sorted(values.items()):
        prev = old.get(day)
        if prev and float(prev['value']) == value: continue
        rows.append(dict(series_code=code, observation_date=day, value=value, first_seen_at=prev['first_seen_at'] if prev else stamp, last_seen_at=stamp))
        if record and record['last_checked_at']:
            changes.append(dict(series_code=code, observation_date=day, old_value=prev['value'] if prev else None, new_value=value, detected_at=stamp, review_date=now.astimezone(ZoneInfo('Asia/Seoul')).date().isoformat(), kind='revision' if prev else 'new'))
    # The existing RPC preserves source on conflict. Set source explicitly first;
    # observations and their checkpoint/change log still commit in one RPC.
    db.table('economic_series').upsert(item,on_conflict='code').execute()
    db.rpc('save_economic_series', {'p_series':item,'p_rows':rows,'p_changes':changes,'p_checked_at':stamp,'p_latest':max(values)}).execute()
    print(f'{code}: latest {max(values)}, {len(rows)} written, {len(changes)} changes',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--start-year',type=int,default=datetime.now().year-1)
    args=parser.parse_args(); now=datetime.now(timezone.utc);today=now.astimezone(ZoneInfo('America/New_York')).date()
    if not 1990<=args.start_year<=today.year: parser.error('Invalid start year')
    require_environment(); db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    failed=[]
    with requests.Session() as session:
        for kind in KINDS:
            try:
                combined={}
                for year in range(args.start_year,today.year+1):
                    for code,values in fetch(session,kind,year,today).items(): combined.setdefault(code,{}).update(values)
                for code,values in combined.items():
                    if (today-datetime.fromisoformat(max(values)).date()).days > 7: raise ValueError('Stale Treasury observations')
                    if args.dry_run: print(f'{code}: {len(values)} values, latest {max(values)}',flush=True)
                    else: save(db,code,values,now)
            except Exception as exc:
                failed.append(kind); print(f'{kind}: FAILED ({type(exc).__name__})',file=sys.stderr,flush=True)
                if not args.dry_run:
                    for tenor in KINDS[kind][1].values():
                        code=('UST_REAL_' if kind=='real' else 'UST_')+tenor
                        db.table('economic_series').update({'last_error':type(exc).__name__}).eq('code',code).execute()
    return 2 if failed else 0


if __name__=='__main__':
    with open(Path(tempfile.gettempdir())/'my-stock-scheduler-treasury.lock','w') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: sys.exit('Treasury collector already running')
        sys.exit(main())
