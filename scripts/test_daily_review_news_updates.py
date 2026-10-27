import unittest
from daily_review_news_updates import compare_candidates, content_hash, merge_events


def event(id, sources=None, **extra):
    return {'id': id, 'title': id, 'sources': sources or [], **extra}


class UpdatesTest(unittest.TestCase):
    def test_candidate_hints_preserve_unknown_and_changed(self):
        previous = [{'id':'old', 'url':'https://example.org/a?utm_source=x', 'title':'Before'}]
        current = [{'id':'same', 'url':'https://example.org/a', 'title':'Before'},
                   {'id':'changed', 'url':'https://example.org/a#x', 'title':'After'},
                   {'id':'new', 'url':'https://example.org/b', 'title':'Before'}]
        self.assertEqual([x['status'] for x in compare_candidates(current, previous)], ['seen','title_changed','new'])
        self.assertEqual([x['status'] for x in compare_candidates(current, None)], ['unknown']*3)

    def test_same_url_and_title_with_new_rss_content_is_only_a_hint(self):
        old = {'id':'a','url':'https://example.org/story','title':'Headline','summary':'First'}
        changed = {**old, 'summary':'Updated'}
        prior = [{**old, 'content_hash':content_hash(old)}]
        self.assertEqual(compare_candidates([changed],prior)[0]['status'],'content_changed')
        self.assertEqual(compare_candidates([old],prior)[0]['status'],'seen')
        self.assertNotEqual(content_hash(old),content_hash(changed))

    def test_same_day_carry_update_and_source_provenance(self):
        prior = [event('a',[{'id':'old'}]),event('b',[{'id':'b'}])]
        current = [event('a',[{'id':'fresh'}],update_state='updated',update_note='Final result'),
                   event('c',[{'id':'c'}],update_state='new')]
        result = {e['id']:e for e in merge_events(prior,current,prior,'2026-10-27T06:00:00Z')}
        self.assertEqual(set(result),{'a','b','c'})
        self.assertEqual([s['id'] for s in result['a']['sources']],['fresh','old'])
        self.assertEqual(result['b']['update_state'],'unchanged')
        self.assertEqual(result['a']['read_id'],'a@2026-10-27T06:00:00Z')
        self.assertEqual(result['c']['read_id'],'c')
        self.assertNotIn('update_state',prior[1])

    def test_prior_day_is_not_carried_and_invalid_updates_fail(self):
        prior = [event('old')]
        result = merge_events([], [event('new',update_state='new')], prior, 't')
        self.assertEqual([e['id'] for e in result],['new'])
        for bad in [event('old',update_state='new'),event('old',update_state='updated'),
                    event('unknown',update_state='updated',update_note='x')]:
            with self.assertRaises(ValueError): merge_events([], [bad], prior, 't')


if __name__ == '__main__': unittest.main()
