"""Python collects and validates; ChatGPT directly selects and writes events.
No LLM API calls, ranking rules, or article bodies are stored in the review DB.
"""
import argparse
import fcntl
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from supabase import create_client
from collect_fred_market_data import SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,require_environment
from daily_review_news_evidence import inspect_articles
from daily_review_news_updates import compare_candidates, content_hash, merge_events
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
    p.add_argument('action',choices=['collect','register','context','prepare','publish','enrich'])
    p.add_argument('--review-date',default=datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat())
    p.add_argument('--selection',type=Path)
    p.add_argument('--context-output',type=Path)
    args=p.parse_args();datetime.strptime(args.review_date,'%Y-%m-%d')
    if args.action != 'prepare':
        require_environment()
        db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data')
    if args.action=='collect':
        RAW.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run([str(SCRAPER/'.venv/bin/python3'),str(SCRAPER/'fetch_news.py'),'--output',str(RAW)],check=True)
    articles,manifest=snapshot()
    evidence_path=RAW.parent / f"{manifest['run_id']}.evidence.json"
    if args.action == 'prepare':
        if not args.selection: p.error('--selection is required for the editorial shortlist')
        selection=json.loads(args.selection.read_text())
        if selection['run_id']!=manifest['run_id'] or selection['input_sha256']!=manifest['output_sha256']:
            raise ValueError('Selection uses a different snapshot')
        ids={aid for event in selection['events'] for aid in event['article_ids']}
        if not ids or not ids <= {a['id'] for a in articles}: raise ValueError('Invalid shortlist')
        records,texts=inspect_articles([a for a in articles if a['id'] in ids])
        if evidence_path.exists():
            previous=json.loads(evidence_path.read_text())
            if previous['input_sha256']!=manifest['output_sha256']: raise ValueError('Evidence snapshot mismatch')
            records={**previous['articles'],**records}
        evidence_path.write_text(json.dumps({'run_id':manifest['run_id'],'input_sha256':manifest['output_sha256'],'articles':records},ensure_ascii=False,indent=2))
        text_path=Path(tempfile.gettempdir()) / f"daily-review-{manifest['run_id']}.texts.json"
        if text_path.exists():
            texts={**json.loads(text_path.read_text()),**texts}
        text_path.write_text(json.dumps(texts,ensure_ascii=False))
        print(json.dumps({'inspected':len(ids),'text_available':sum(r['status']=='text_available' for r in records.values()),'metadata':str(evidence_path),'temporary_texts':str(text_path)},ensure_ascii=False))
        return
    coverage=[{key:s.get(key) for key in ['name','status','entries_seen','articles_emitted','error_codes']} for s in manifest['sources']]
    if args.action in ('collect','register'):
        row=dict(run_id=manifest['run_id'],review_date=args.review_date,collected_at=manifest['completed_at'],window_start=manifest['window_start'],window_end=manifest['window_end'],collection_status=manifest['status'],candidate_count=len(articles),input_sha256=manifest['output_sha256'],coverage=coverage)
        db.table('daily_review_news_runs').upsert(row,on_conflict='run_id').execute()
        # Retain a reproducible candidate inventory, never RSS summaries/bodies.
        inventory={key:manifest[key] for key in ['run_id','output_sha256','window_start','window_end']}
        inventory['articles']=[{**{key:a.get(key) for key in ['id','title','source','region','url','published_at']}, 'content_hash':content_hash(a)} for a in articles]
        (RAW.parent / f"{manifest['run_id']}.candidates.json").write_text(json.dumps(inventory,ensure_ascii=False))
        print(json.dumps({'run_id':manifest['run_id'],'candidates':len(articles),'status':manifest['status']}))
        return
    if manifest['status']=='FAILED' or not articles: raise ValueError('No usable candidates; do not publish an empty failed collection')
    if args.action == 'context':
        if not args.context_output: p.error('--context-output is required')
        previous = (db.table('daily_review_news_runs')
                    .select('run_id,review_date,collected_at,review_status,events')
                    .eq('review_status','REVIEWED')
                    .lt('collected_at',manifest['completed_at'])
                    .order('collected_at',desc=True).limit(1).execute().data)
        prior = previous[0] if previous else None
        prior_inventory = None
        if prior:
            inventory_path = RAW.parent / f"{prior['run_id']}.candidates.json"
            if inventory_path.exists():
                prior_inventory = json.loads(inventory_path.read_text())['articles']
        hints = compare_candidates(articles, prior_inventory)
        context = {'run_id': manifest['run_id'], 'input_sha256': manifest['output_sha256'],
                   'baseline_run_id': prior['run_id'] if prior else None,
                   'baseline_date': prior['review_date'] if prior else None,
                   'baseline_events': prior['events'] if prior else [],
                   'candidate_hints': hints,
                   'inventory_available': prior_inventory is not None}
        args.context_output.write_text(json.dumps(context,ensure_ascii=False,indent=2))
        print(json.dumps({'context':str(args.context_output), 'baseline_run_id':context['baseline_run_id'],
                          'counts':{status:sum(h['status']==status for h in hints)
                                    for status in ('new','seen','title_changed','content_changed','unknown')}}))
        return
    if not args.selection: p.error('--selection is required')
    selection=json.loads(args.selection.read_text())
    if selection['run_id']!=manifest['run_id'] or selection['input_sha256']!=manifest['output_sha256']: raise ValueError('Selection uses a different snapshot')
    by_id={a['id']:a for a in articles}
    if set(selection['reviewed_article_ids'])!=set(by_id) or len(selection['reviewed_article_ids'])!=len(by_id): raise ValueError('All candidates must be reviewed exactly once')
    evidence=json.loads(evidence_path.read_text()) if evidence_path.exists() else None
    if evidence and (evidence['run_id']!=manifest['run_id'] or evidence['input_sha256']!=manifest['output_sha256']): raise ValueError('Evidence snapshot mismatch')
    evidence_records=evidence['articles'] if evidence else {}
    read_ids=set(selection.get('read_article_ids',[]))
    if not read_ids <= set(evidence_records) or any(evidence_records[aid]['status']!='text_available' for aid in read_ids):
        raise ValueError('Read evidence must have fetched article text')
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
            source={k:a.get(k) for k in ['id','title','source','region','url','published_at']}
            if aid in evidence_records:
                record=evidence_records[aid]
                safe_fields=['rss_url','rss_published_at','checked_at','status','stage','resolved_url','page_title','page_published_at','published_at_method','published_at_conflict','body_chars','body_sha256','error_type','http_status']
                source['verification']={**{key:record[key] for key in safe_fields if key in record},'editor_read':aid in read_ids}
                if record.get('resolved_url'): source['url']=record['resolved_url']
                if not source['published_at'] and record.get('page_published_at'):
                    published=datetime.fromisoformat(record['page_published_at'])
                    if published<=datetime.fromisoformat(manifest['window_end'].replace('Z','+00:00')):
                        source['published_at']=record['page_published_at']
                        source['verification']['outside_window']=published<datetime.fromisoformat(manifest['window_start'].replace('Z','+00:00'))
            sources.append(source)
        event={k:e[k] for k in ['id','category','importance','title','summary','details','reason','market_scope','confidence']}|{'sources':sources}
        if selection.get('update_mode') == 'incremental':
            event['update_state'] = e.get('update_state')
            event['update_note'] = e.get('update_note', '')
        if e['importance']=='핵심' and not set(e['article_ids']) & read_ids and e.get('verification_note','').strip():
            event['confidence']='추가 확인 필요 · '+e['verification_note'].strip()+' · '+event['confidence']
        events.append(event)
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
    if included and (not evidence or not included <= set(evidence_records)): raise ValueError('Run prepare for every selected article before publishing')
    for original,event in zip(selection['events'],events):
        if original['importance']=='핵심' and not set(original['article_ids']) & read_ids:
            note=original.get('verification_note','').strip()
            if not note: raise ValueError('Core event needs read evidence or a specific verification_note')
    reviewed_at = existing.get('reviewed_at') or datetime.now(timezone.utc).isoformat()
    if selection.get('update_mode') == 'incremental':
        previous = (db.table('daily_review_news_runs')
                    .select('run_id,review_date,collected_at,events')
                    .eq('review_status','REVIEWED').lt('collected_at',manifest['completed_at'])
                    .order('collected_at',desc=True).limit(1).execute().data)
        prior = previous[0] if previous else None
        if selection.get('baseline_run_id') != (prior['run_id'] if prior else None):
            raise ValueError('Review baseline changed; refresh context and review again')
        recent_events = prior['events'] if prior else []
        same_day = recent_events if prior and prior['review_date'] == args.review_date else []
        events = merge_events(same_day, events, recent_events, reviewed_at)
    if existing['review_status']=='REVIEWED':
        if existing['events']!=events: raise ValueError('Published runs are immutable; collect a new run')
        print('Already published; no change');return
    quality={'fetch_status_counts':{status:sum(evidence_records[aid]['status']==status for aid in included) for status in ['text_available','metadata_only','unavailable']},'editor_read_count':len(read_ids & included),'short_details':[e['id'] for e in events if len(e['details'])<800],'core_without_read_evidence':[e['id'] for e in selection['events'] if e['importance']=='핵심' and not set(e['article_ids']) & read_ids]}
    payload=dict(events=events,review_status='REVIEWED',reviewed_at=reviewed_at,audit={'method':'ChatGPT direct judgment','prompt_version':'daily-review-news-v3-incremental' if selection.get('update_mode') == 'incremental' else 'daily-review-news-v2-evidence','reviewed_count':len(by_id),'included_count':len(included),'excluded_count':len(excluded),'exclusion_reasons':selection['exclusion_reasons'],'quality':quality})
    result=db.table('daily_review_news_runs').update(payload).eq('run_id',manifest['run_id']).eq('review_status','PENDING').execute()
    if not result.data: raise ValueError('Publish did not update a pending run')
    print(f'Published {len(events)} events with {len(included)} evidence articles')


if __name__=='__main__':main()
