"""Fetch review evidence without ranking candidates or storing article bodies in DB."""
import base64
import concurrent.futures
import hashlib
import ipaddress
import json
import re
import socket
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

MAX_BYTES = 2_000_000


def public_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Unsafe source URL')
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80))
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Non-public source URL')
    return url


def google_url(url):
    return (urlparse(url).hostname or '').lower() == 'news.google.com'


def parse_time(value):
    """No timezone guessing; dateModified is never treated as datePublished."""
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError:
        try:
            dt = parsedate_to_datetime(value)
        except (ValueError, TypeError):
            return None
    if dt.tzinfo is None or dt.utcoffset() is None:
        return None
    return dt.astimezone(timezone.utc).isoformat()


def get_page(session, url):
    for _ in range(6):
        public_url(url)
        with session.get(url, timeout=(5, 12), allow_redirects=False, stream=True) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers['Location'])
                continue
            response.raise_for_status()
            if 'html' not in response.headers.get('Content-Type', '').lower():
                raise ValueError('Not HTML evidence')
            chunks = []; size = 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError('Evidence response too large')
                chunks.append(chunk)
            return url, BeautifulSoup(b''.join(chunks), 'html.parser')
    raise ValueError('Too many redirects')


def resolve_google(session, url):
    """Legacy embedded URL, then Google's article URL response; failures stay explicit."""
    token = urlparse(url).path.rstrip('/').split('/')[-1]
    try:
        decoded = base64.urlsafe_b64decode(token + '=' * (-len(token) % 4))
        match = re.search(rb'https?://[^\x00-\x20\x7f-\xff]+', decoded)
        if match:
            return public_url(match.group().decode())
    except (ValueError, UnicodeError):
        pass
    final, soup = get_page(session, url)
    if not google_url(final):
        return final
    node = soup.select_one('[data-n-a-sg][data-n-a-ts]')
    if node:
        signature = node.get('data-n-a-sg'); timestamp = int(node['data-n-a-ts'])
        payload = ['garturlreq', [['X', 'X', ['X', 'X'], None, None, 1, 1, 'US:en', None, 1, None, None, None, None, None, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], token, timestamp, signature]
        rpc = json.dumps([[['Fbv4je', json.dumps(payload), None, 'generic']]])
        response = session.post('https://news.google.com/_/DotsSplashUi/data/batchexecute', data={'f.req': rpc}, timeout=(5, 12))
        response.raise_for_status()
        for line in response.text.splitlines():
            try:
                rows = json.loads(line)
            except (ValueError, TypeError):
                continue
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, list) and len(row) > 2 and row[0:2] == ['wrb.fr', 'Fbv4je'] and isinstance(row[2], str):
                    result = json.loads(row[2])
                    if isinstance(result, list) and len(result) > 1 and result[0] == 'garturlres' and isinstance(result[1], str):
                        return public_url(result[1])
    raise ValueError('Google original URL unresolved')


def metadata(soup):
    dates = []
    def walk(node):
        if isinstance(node, list):
            for item in node: walk(item)
        elif isinstance(node, dict):
            kinds = node.get('@type', [])
            if isinstance(kinds, str): kinds = [kinds]
            if any(k in ('NewsArticle', 'Article', 'ReportageNewsArticle', 'AnalysisNewsArticle', 'BlogPosting') for k in kinds):
                value = parse_time(node.get('datePublished'))
                if value: dates.append((value, 'jsonld.datePublished'))
            if '@graph' in node: walk(node['@graph'])
    for script in soup.select('script[type="application/ld+json"]'):
        try: walk(json.loads(script.string or script.get_text()))
        except (ValueError, TypeError): pass
    for selector in ['meta[property="article:published_time"]', 'meta[name="pubdate"]', 'meta[itemprop="datePublished"]']:
        for tag in soup.select(selector):
            value = parse_time(tag.get('content'))
            if value: dates.append((value, selector))
    title = soup.select_one('meta[property="og:title"]')
    title = title.get('content', '').strip() if title else (soup.title.get_text(' ', strip=True) if soup.title else '')
    for tag in soup(['script', 'style', 'nav', 'footer', 'header']): tag.decompose()
    body = soup.select_one('.ArticleBody-articleBody, .story-news.article, #articleWrap, article, [itemprop="articleBody"]')
    text = body.get_text(' ', strip=True) if body else ''
    unique = {d for d, _ in dates}
    return {'page_title': title, 'page_published_at': dates[0][0] if len(unique) == 1 else None,
            'published_at_method': dates[0][1] if len(unique) == 1 else None,
            'published_at_conflict': len(unique) > 1, 'text': text}


def inspect_article(article):
    result = {'id': article['id'], 'rss_url': article['url'], 'rss_published_at': article.get('published_at'),
              'checked_at': datetime.now(timezone.utc).isoformat(), 'status': 'unavailable'}
    try:
        with requests.Session() as session:
            session.headers['User-Agent'] = 'daily-review-evidence/1.0'
            result['stage']='resolve' if google_url(article['url']) else 'fetch'
            url = resolve_google(session, article['url']) if google_url(article['url']) else article['url']
            result.update(resolved_url=url,stage='fetch')
            final, soup = get_page(session, url)
            result.update(metadata(soup), resolved_url=final)
            text = result.pop('text')
            result['body_chars'] = len(text)
            result['body_sha256'] = hashlib.sha256(text.encode('utf-8')).hexdigest()
            # Fetching is not editorial reading or independent fact verification.
            result['status'] = 'text_available' if len(text) >= 300 else 'metadata_only'
            return result, text
    except Exception as exc:
        result['error_type'] = type(exc).__name__
        if isinstance(exc,requests.HTTPError) and exc.response is not None:
            result['http_status']=exc.response.status_code
        return result, ''


def inspect_articles(articles):
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(inspect_article, articles))
    return {r['id']: r for r, _ in results}, {r['id']: t for r, t in results if t}
