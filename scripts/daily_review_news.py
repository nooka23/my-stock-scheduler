"""Python collects and validates; ChatGPT directly selects and writes events.
No LLM API calls, ranking rules, or article bodies are stored in the review DB.
"""
import argparse
import fcntl
import hashlib
import json
import subprocess
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from supabase import create_client
from collect_fred_market_data import SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,require_environment
ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'scripts/output/daily-review-news/raw_articles.json'
SCRAPER=Path('/Users/myunghoon/article-scrapper')


def snapshot():
    with RAW.with_suffix('.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_SH)
        data=RAW.read_bytes();m=json.loads(RAW.with_suffix('.manifest.json').read_text())
        if hashlib.sha256(data).hexdigest()!=m['output_sha256']: raise ValueError('Snapshot hash mismatch')
        a=json.loads(data)
        if len(a)!=m['article_count'] or len({x['id'] for x in a})!=len(a): raise ValueError('Invalid article count/ids')
        return a,m


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['collect','register','publish','enrich'])
    p.add_argument('--review-date',default=datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat())
    p.add_argument('--selection',type=Path)
    args=p.parse_args();datetime.strptime(args.review_date,'%Y-%m-%d')
    require_environment()
    db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    if args.action=='collect':
        RAW.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run([str(SCRAPER/'.venv/bin/python3'),str(SCRAPER/'fetch_news.py'),'--output',str(RAW)],check=True)
    articles,manifest=snapshot()
    coverage=[{key:s.get(key) for key in ['name','status','entries_seen','articles_emitted','error_codes']} for s in manifest['sources']]
    if args.action in ('collect','register'):
        row=dict(run_id=manifest['run_id'],review_date=args.review_date,collected_at=manifest['completed_at'],window_start=manifest['window_start'],window_end=manifest['window_end'],collection_status=manifest['status'],candidate_count=len(articles),input_sha256=manifest['output_sha256'],coverage=coverage)
        db.table('daily_review_news_runs').upsert(row,on_conflict='run_id').execute()
        print(json.dumps({'run_id':manifest['run_id'],'candidates':len(articles),'status':manifest['status']}))
        return
    if manifest['status']=='FAILED' or not articles: raise ValueError('No usable candidates; do not publish an empty failed collection')
    if not args.selection: p.error('--selection is required')
    selection=json.loads(args.selection.read_text())
    if selection['run_id']!=manifest['run_id'] or selection['input_sha256']!=manifest['output_sha256']: raise ValueError('Selection uses a different snapshot')
    by_id={a['id']:a for a in articles}
    if set(selection['reviewed_article_ids'])!=set(by_id) or len(selection['reviewed_article_ids'])!=len(by_id): raise ValueError('All candidates must be reviewed exactly once')
    excluded=selection['excluded_article_ids'];included=set();events=[];event_ids=set()
    for e in selection['events']:
        if e['id'] in event_ids or e['category'] not in ['정책','기업·산업','경제'] or e['importance'] not in ['핵심','주요']: raise ValueError('Invalid event')
        event_ids.add(e['id'])
        for key in ['title','summary','details','reason','market_scope','confidence']:
            if not isinstance(e[key],str) or not e[key].strip(): raise ValueError('Missing event field')
        if not e['article_ids'] or len(set(e['article_ids']))!=len(e['article_ids']): raise ValueError('Invalid evidence')
        sources=[]
        for aid in e['article_ids']:
            a=by_id[aid];included.add(aid)
            url=urlparse(a['url'])
            if url.scheme not in ['http','https'] or not url.netloc: raise ValueError('Invalid source URL')
            sources.append({k:a.get(k) for k in ['id','title','source','region','url','published_at']})
        events.append({k:e[k] for k in ['id','category','importance','title','summary','details','reason','market_scope','confidence']}|{'sources':sources})
    if included & set(excluded) or included | set(excluded)!=set(by_id) or len(excluded)!=len(set(excluded)): raise ValueError('Incomplete selection/exclusion audit')
    existing=db.table('daily_review_news_runs').select('review_status,events,review_date,audit,reviewed_at').eq('run_id',manifest['run_id']).single().execute().data
    if existing['review_date']!=args.review_date: raise ValueError('Review date mismatch')
    if args.action == 'enrich':
        if existing['review_status'] != 'REVIEWED': raise ValueError('Only published reviews can be enriched')
        old_events = existing['events']
        # Explicit content enrichment: preserve every original field and evidence.
        def without_details(items):
            return [{k:v for k,v in e.items() if k != 'details'} for e in items]
        if without_details(old_events) != without_details(events):
            raise ValueError('Enrichment may change only details')
        audit = dict(existing['audit'])
        audit['detail_enrichment'] = {'at':datetime.now(timezone.utc).isoformat(),
            'method':'ChatGPT direct explanation',
            'previous_events_sha256':hashlib.sha256(json.dumps(old_events,ensure_ascii=False,sort_keys=True).encode()).hexdigest()}
        result = db.table('daily_review_news_runs').update({'events':events,'audit':audit,'reviewed_at':audit['detail_enrichment']['at']}).eq('run_id',manifest['run_id']).eq('reviewed_at',existing['reviewed_at']).execute()
        if not result.data: raise ValueError('Review changed concurrently; reload before enriching')
        print(f'Enriched {len(events)} events; original summaries and sources preserved')
        return
    if existing['review_status']=='REVIEWED':
        if existing['events']!=events: raise ValueError('Published runs are immutable; collect a new run')
        print('Already published; no change');return
    payload=dict(events=events,review_status='REVIEWED',reviewed_at=datetime.now(timezone.utc).isoformat(),audit={'method':'ChatGPT direct judgment','prompt_version':'daily-review-news-v1','reviewed_count':len(by_id),'included_count':len(included),'excluded_count':len(excluded),'exclusion_reasons':selection['exclusion_reasons']})
    db.table('daily_review_news_runs').update(payload).eq('run_id',manifest['run_id']).eq('review_status','PENDING').execute()
    print(f'Published {len(events)} events with {len(included)} evidence articles')


if __name__=='__main__':main()
