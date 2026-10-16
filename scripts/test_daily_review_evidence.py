"""Evidence provenance and cadence guards; no DB/network mutations."""
import unittest
from unittest.mock import patch
from bs4 import BeautifulSoup
from daily_review_news_evidence import metadata, parse_time, public_url, inspect_article
from collect_daily_review_fred import validate_frequency

class EvidenceTests(unittest.TestCase):
    def test_modified_date_is_not_publication(self):
        soup=BeautifulSoup('<script type="application/ld+json">{"@type":"NewsArticle","dateModified":"2026-10-16T10:00:00+09:00"}</script>','html.parser')
        self.assertIsNone(metadata(soup)['page_published_at'])
        self.assertIsNone(parse_time('2026-10-16T10:00:00'))

    def test_dates_conflicting_and_timezone(self):
        soup=BeautifulSoup('<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-15T09:00:00+09:00"}]}</script><meta property="article:published_time" content="2026-10-16T00:00:00Z">','html.parser')
        self.assertTrue(metadata(soup)['published_at_conflict'])
        self.assertEqual(parse_time('2026-10-15T09:00:00+09:00'),'2026-10-15T00:00:00+00:00')

    def test_private_target_rejected(self):
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',80))]):
            with self.assertRaises(ValueError):public_url('http://example.com/private')

    def test_page_fetch_does_not_claim_editor_read(self):
        soup=BeautifulSoup('<article>'+('Evidence sentence. '*30)+'</article>','html.parser')
        with patch('daily_review_news_evidence.get_page',return_value=('https://example.com/news',soup)):
            record,body=inspect_article({'id':'a','url':'https://example.com/news','published_at':''})
        self.assertEqual(record['status'],'text_available')
        self.assertNotIn('text',record)
        self.assertNotIn('editor_read',record)
        self.assertTrue(body)

    def test_quarterly_series_cannot_masquerade_as_monthly(self):
        values={f'{year}-{month:02d}-01':1 for year in [2025,2026] for month in [1,4,7,10]}
        with self.assertRaises(ValueError):validate_frequency(values,'monthly')
        validate_frequency(values,'quarterly')



class PublishGuards(unittest.TestCase):
    def invoke(self, evidence=None, read_ids=None, note=None):
        import tempfile,json
        from pathlib import Path
        from types import SimpleNamespace
        import daily_review_news as news
        class DB:
            payload=None
            def schema(self,*args):return self
            def table(self,*args):return self
            def select(self,*args):self.operation='select';return self
            def eq(self,*args):return self
            def single(self):return self
            def update(self,payload):self.operation='update';self.payload=payload;return self
            def execute(self):
                return SimpleNamespace(data={'review_status':'PENDING','review_date':'2026-10-16'} if self.operation=='select' else [{}])
        db=DB()
        article=dict(id='a',title='Example',url='https://example.com/news',source='Example',region='global',published_at='')
        manifest=dict(run_id='run',output_sha256='hash',status='PARTIAL',window_start='2026-10-15T00:00:00Z',window_end='2026-10-16T00:00:00Z',sources=[])
        event=dict(id='event',title='Event',summary='Summary',details='Details',reason='Reason',market_scope='Global',confidence='Evidence limits',category='경제',importance='핵심',article_ids=['a'])
        if note:event['verification_note']=note
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path=root/'selection.json'
            path.write_text(json.dumps(dict(run_id='run',input_sha256='hash',reviewed_article_ids=['a'],excluded_article_ids=[],exclusion_reasons=[],events=[event],read_article_ids=read_ids or [])))
            if evidence is not None:(root/'run.evidence.json').write_text(json.dumps(dict(run_id='run',input_sha256='hash',articles={'a':evidence})))
            with patch.object(news,'RAW',root/'raw.json'),patch.object(news,'snapshot',return_value=([article],manifest)),patch.object(news,'require_environment'),patch.object(news,'create_client',return_value=db),patch('sys.argv',['news','publish','--review-date','2026-10-16','--selection',str(path)]):
                news.main()
        return db.payload

    def test_unprepared_publish_rejected(self):
        with self.assertRaisesRegex(ValueError,'prepare'):self.invoke()

    def test_unavailable_not_claimed_as_read(self):
        with self.assertRaisesRegex(ValueError,'Read evidence'):self.invoke({'status':'unavailable'},['a'])

    def test_core_exception_visible_and_no_body_storage(self):
        payload=self.invoke({'status':'unavailable','error_type':'HTTPError','text':'must never reach DB'},note='Publisher blocked access')
        self.assertTrue(payload['events'][0]['confidence'].startswith('추가 확인 필요'))
        self.assertEqual(payload['audit']['quality']['core_without_read_evidence'],['event'])
        self.assertNotIn('text',payload['events'][0]['sources'][0]['verification'])

if __name__=='__main__':unittest.main()
