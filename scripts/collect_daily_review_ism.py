"""Collect ISM-issued public PMI releases via PR Newswire, never report text.

Persist only the verified 12-month headline series. Fail closed if the issuer,
sector, report month, table shape, or headline/table consistency changes.
"""
import argparse
import calendar
import fcntl
import math
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup
from supabase import create_client
from collect_fred_market_data import require_environment, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from collect_daily_review_treasury import save

INDEX='https://www.prnewswire.com/news/institute-for-supply-management/'
SECTORS={'manufacturing':('ISM_MANUFACTURING_PMI','ISM 제조업 PMI'),'services':('ISM_SERVICES_PMI','ISM 서비스업 PMI')}
MONTHS={name.lower():i for i,name in enumerate(calendar.month_name) if name}


def get(session,url):
    if urlparse(url).hostname!='www.prnewswire.com': raise ValueError('Unexpected release host')
    for attempt in range(3):
        try:
            response=session.get(url,timeout=(10,30));response.raise_for_status()
            if urlparse(response.url).hostname!='www.prnewswire.com': raise ValueError('Unexpected redirect')
            return response.text
        except requests.RequestException:
            if attempt==2: raise
            time.sleep(2**attempt)


def discover(html):
    soup=BeautifulSoup(html,'html.parser');found={key:[] for key in SECTORS}
    for a in soup.find_all('a',href=True):
        url=urljoin(INDEX,a['href'])
        if urlparse(url).hostname!='www.prnewswire.com': continue
        for sector in SECTORS:
            if f'/{sector}-pmi-at-' in url and f'-ism-{sector}-pmi-report-' in url and url not in found[sector]: found[sector].append(url)
    if not all(found.values()): raise ValueError('Missing sector release links')
    return found


def parse_report(html,sector,today):
    soup=BeautifulSoup(html,'html.parser');head=soup.find('h1')
    title=head.get_text(' ',strip=True) if head else ''
    pattern=rf'{sector}\s+PMI.*?at\s+(\d+(?:\.\d+)?)\s*%;\s*([A-Za-z]+)\s+(20\d{{2}})\s+ISM.*?{sector}\s+PMI'
    match=re.search(pattern,title,re.I)
    if not match: raise ValueError('Unexpected PMI headline')
    # Verify the actual release issuer, not arbitrary copied article text.
    issuer=soup.find(string=re.compile(r'^\s*Institute for Supply Management\s*$'))
    if not issuer or 'News provided by' not in soup.get_text(' ',strip=True): raise ValueError('Unverified release issuer')
    headline=float(match[1]);month=MONTHS.get(match[2].lower());year=int(match[3])
    if month is None: raise ValueError('Invalid report month')
    latest=f'{year:04d}-{month:02d}-01'
    if latest>today.isoformat() or (today.year-year)*12+today.month-month>2: raise ValueError('Future or stale report')
    tables=[]
    for table in soup.find_all('table'):
        first=table.find('tr')
        cells=first.find_all(['th','td']) if first else []
        if cells and cells[0].get_text(' ',strip=True)=='Month' and re.search(sector+r'\s+PMI',first.get_text(' ',strip=True),re.I): tables.append(table)
    if len(tables)!=1: raise ValueError('Missing or ambiguous 12-month PMI table')
    values={}
    for row in tables[0].find_all('tr')[1:]:
        cells=[c.get_text(' ',strip=True) for c in row.find_all(['td','th'])]
        if len(cells)!=4: continue
        for offset in (0,2):
            try: day=datetime.strptime(cells[offset],'%b %Y').date().isoformat(); value=float(cells[offset+1])
            except ValueError: raise ValueError('Malformed monthly observation') from None
            if not math.isfinite(value) or not 0<=value<=100 or day in values: raise ValueError('Invalid PMI observation')
            values[day]=value
    if len(values)!=12 or max(values)!=latest or values[latest]!=headline: raise ValueError('Headline and monthly table disagree')
    dates=sorted(datetime.fromisoformat(d) for d in values)
    if any((b.year-a.year)*12+b.month-a.month!=1 for a,b in zip(dates,dates[1:])): raise ValueError('Non-contiguous PMI history')
    return values


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dry-run',action='store_true');args=parser.parse_args()
    require_environment();db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY).schema('market_data');now=datetime.now(timezone.utc);failures=[]
    with requests.Session() as session:
        session.headers['User-Agent']='Mozilla/5.0'
        try: links=discover(get(session,INDEX))
        except Exception as exc:
            print(f'ISM index FAILED ({type(exc).__name__})',file=sys.stderr)
            if not args.dry_run:
                for code,_ in SECTORS.values(): db.table('economic_series').update({'last_error':type(exc).__name__}).eq('code',code).execute()
            return 2
        for sector,(code,name) in SECTORS.items():
            try:
                # The issuer index is newest first. Invalid newest content fails
                # visibly rather than silently publishing an older release.
                url=links[sector][0];values=parse_report(get(session,url),sector,now.date())
                if args.dry_run: print(f'{code}: {len(values)} values, latest {max(values)} = {values[max(values)]}')
                else: save(db,code,values,now,item=dict(code=code,name=name,group='경기·심리',frequency='monthly',unit='pt',transform='diffusion',source='ISM_PRNEWSWIRE',source_url=url))
            except Exception as exc:
                failures.append(code);print(f'{code}: FAILED ({type(exc).__name__})',file=sys.stderr)
                if not args.dry_run: db.table('economic_series').update({'last_error':type(exc).__name__}).eq('code',code).execute()
    return 2 if failures else 0


if __name__=='__main__':
    with open(Path(tempfile.gettempdir())/'my-stock-scheduler-ism.lock','w') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: sys.exit('ISM collector already running')
        sys.exit(main())
