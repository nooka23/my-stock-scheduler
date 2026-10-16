"""Regression checks for official curves and Yahoo live/daily bucket isolation."""
import unittest
from datetime import datetime, date
from collect_daily_review_treasury import parse_xml
from collect_yahoo_review_markets import parse_chart


def xml(fields, day='2026-10-15'):
    return f'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"><entry><content><m:properties><d:NEW_DATE>{day}T00:00:00</d:NEW_DATE>{fields}</m:properties></content></entry></feed>'''


class Curves(unittest.TestCase):
    def test_missing_is_not_zero_and_negative_real_valid(self):
        self.assertEqual(parse_xml(xml('<d:TC_5YEAR>-0.2</d:TC_5YEAR><d:TC_10YEAR m:null="true"/>'),'real',2026,date(2026,10,16)), {'UST_REAL_5Y':{'2026-10-15':-.2}})

    def test_future_date_rejected(self):
        with self.assertRaises(ValueError): parse_xml(xml('<d:BC_2YEAR>4.2</d:BC_2YEAR>','2026-10-17'),'nominal',2026,date(2026,10,16))

    def test_nonfinite_rejected(self):
        with self.assertRaises(ValueError): parse_xml(xml('<d:BC_2YEAR>NaN</d:BC_2YEAR>'),'nominal',2026,date(2026,10,16))

    def test_empty_response_rejected(self):
        with self.assertRaises(ValueError): parse_xml(xml(''),'nominal',2026,date(2026,10,16))


class Yahoo(unittest.TestCase):
    def payload(self, times, ends):
        return {'meta':{'symbol':'GC=F','currency':'USD','exchangeTimezoneName':'America/New_York','currentTradingPeriod':{'regular':{'end':int(datetime.fromisoformat(ends).timestamp())}}},'timestamp':[int(datetime.fromisoformat(t).timestamp()) for t in times],'indicators':{'quote':[{'open':[100]*len(times),'high':[200]*len(times),'low':[90]*len(times),'close':[101+i for i in range(len(times))],'volume':[5]*len(times)}]}}

    def test_live_extra_cannot_overwrite_canonical(self):
        p=self.payload(['2026-10-15T04:00:00+00:00','2026-10-16T03:39:00+00:00'],'2026-10-16T03:59:00+00:00')
        rows=parse_chart(p,'GC=F',datetime.fromisoformat('2026-10-16T05:00:00+00:00'))
        self.assertEqual([(r['trade_date'],r['close']) for r in rows],[('2026-10-15',101)])

    def test_unfinished_day_not_accepted(self):
        p=self.payload(['2026-10-14T04:00:00+00:00','2026-10-15T04:00:00+00:00'],'2026-10-16T03:59:00+00:00')
        rows=parse_chart(p,'GC=F',datetime.fromisoformat('2026-10-15T22:15:00+00:00'))
        self.assertEqual(rows[-1]['trade_date'],'2026-10-14')

    def test_dst_uses_exchange_zone(self):
        p=self.payload(['2026-11-05T05:00:00+00:00','2026-11-06T04:39:00+00:00'],'2026-11-06T04:59:00+00:00')
        rows=parse_chart(p,'GC=F',datetime.fromisoformat('2026-11-06T06:00:00+00:00'))
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['trade_date'],'2026-11-05')


if __name__=='__main__': unittest.main()
