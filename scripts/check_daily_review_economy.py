"""Read-only comparison of configured FRED series, DB checkpoints and live CSV."""
import argparse
import concurrent.futures
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import requests
from supabase import create_client
from collect_daily_review_fred import fetch, validate_frequency, ROOT
from collect_fred_market_data import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, require_environment


def check_source(item):
    try:
        with requests.Session() as session:
            values=fetch(session,item['code'],'2024-01-01')
        validate_frequency(values,item['frequency'])
        return {'code':item['code'],'source_latest':max(values),'source_value':values[max(values)]}
    except Exception as exc:
        return {'code':item['code'],'source_error':type(exc).__name__}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();require_environment()
    config=json.loads((ROOT/'config/daily_review_fred.json').read_text())
    db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    records={r['code']:r for r in db.table('economic_series').select('code,frequency,last_checked_at,last_error,latest_observation_date').execute().data}
    now=datetime.now(timezone.utc)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        checks=list(pool.map(check_source,config))
    for item,check in zip(config,checks):
        record=records.get(item['code']);issues=[]
        if not record: issues.append('NOT_COLLECTED')
        else:
            check['db_latest']=record['latest_observation_date'];check['last_checked_at']=record['last_checked_at']
            if record['last_error']: issues.append('LAST_COLLECTION_FAILED')
            if record['frequency']!=item['frequency']: issues.append('FREQUENCY_MISMATCH')
            if not record['last_checked_at'] or (now-datetime.fromisoformat(record['last_checked_at'])).total_seconds()>30*3600: issues.append('COLLECTION_OVER_30_HOURS')
            if not check.get('source_error'):
                if record['latest_observation_date']!=check['source_latest']: issues.append('LATEST_DATE_DIFFERS')
                row=db.table('economic_observations').select('value').eq('series_code',item['code']).eq('observation_date',check['source_latest']).limit(1).execute().data
                if not row or float(row[0]['value'])!=check['source_value']: issues.append('LATEST_VALUE_DIFFERS')
        if check.get('source_error'): issues.append('LIVE_SOURCE_UNAVAILABLE')
        check['issues']=issues
    report={'checked_at':now.isoformat(),'series_count':len(config),'issue_counts':dict(Counter(i for c in checks for i in c['issues'])),'series':checks,'note':'Source observation age alone is not a failure: release schedules, holidays and FRED licensing/publication delays differ. This check never writes to DB.'}
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'series':len(checks),'issue_counts':report['issue_counts'],'output':str(args.output)}))
    return 1 if any(c['issues'] for c in checks) else 0

if __name__=='__main__':raise SystemExit(main())
