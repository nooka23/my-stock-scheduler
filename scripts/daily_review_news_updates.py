"""Comparison and safe carry-forward for daily news reviews.

This module does not decide whether articles describe the same event: the editor
makes that decision and supplies the stable event ID and meaningful change.
"""
from copy import deepcopy
import hashlib
import json
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def article_key(url):
    """Normalize only known tracking parameters; never collapse distinct URLs."""
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.netloc:
        return None
    tracking = {'fbclid', 'gclid', 'mc_cid', 'mc_eid'}
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith('utm_') and k.lower() not in tracking]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path,
                       urlencode(sorted(query)), ''))


def content_hash(article):
    """Store a fingerprint, never the RSS summary or content itself."""
    data = [article.get("summary", ""), article.get("content_snippet", "")]
    if not any(data):
        return None
    return hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()


def compare_candidates(current, previous):
    """Return hints only, not a filter; missing prior inventory is unknown."""
    if previous is None:
        return [{'id': a['id'], 'status': 'unknown'} for a in current]
    prior = {}
    for a in previous:
        key = article_key(a.get('url', ''))
        if key:
            prior.setdefault(key, []).append(a)
    result = []
    for a in current:
        key = article_key(a.get('url', ''))
        if not key:
            status = 'unknown'
        elif key not in prior:
            status = 'new'
        elif not any(' '.join(a.get('title', '').split()) == ' '.join(p.get('title', '').split()) for p in prior[key]):
            status = 'title_changed'
        else:
            old_hashes = {p.get('content_hash') for p in prior[key] if p.get('content_hash')}
            new_hash = content_hash(a)
            status = 'content_changed' if old_hashes and new_hash and new_hash not in old_hashes else 'seen'
        result.append({'id': a['id'], 'status': status})
    return result


def merge_events(previous_same_day, current, previous_recent, reviewed_at):
    """Preserve same-day entries; updated entries must retain their event ID."""
    recent = {e['id']: e for e in previous_recent}
    earlier_today = {e['id']: e for e in previous_same_day}
    merged = {key: {**deepcopy(value), 'update_state': 'unchanged',
                    'update_note': ''} for key, value in earlier_today.items()}
    used = set()
    for source in current:
        event = deepcopy(source)
        event_id = event['id']
        if event_id in used:
            raise ValueError('Duplicate event ID')
        used.add(event_id)
        state = event.get('update_state')
        note = event.get('update_note', '').strip()
        if state not in ('new', 'updated'):
            raise ValueError('Each selected event must be new or updated')
        if state == 'updated':
            if event_id not in recent:
                raise ValueError('An update must retain an existing event ID')
            if not note:
                raise ValueError('An update must explain the verified change')
            old = recent[event_id]
            existing_sources = old.get('sources', [])
            seen = {s['id'] for s in event['sources']}
            event['sources'].extend(deepcopy(s) for s in existing_sources if s['id'] not in seen)
        elif event_id in recent or event_id in earlier_today:
            raise ValueError('An existing event cannot be marked new')
        event['update_note'] = note
        event['updated_at'] = reviewed_at
        event['read_id'] = f'{event_id}@{reviewed_at}' if state == 'updated' else event_id
        merged[event_id] = event
    return list(merged.values())
