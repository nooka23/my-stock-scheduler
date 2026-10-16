import unittest
from datetime import date
from collect_daily_review_ism import parse_report, discover


def fixture(sector='manufacturing',headline=54.5,issuer=True):
    cells=[]
    for month in range(12):
        year=2025+(month+9)//12;number=(month+9)%12+1
        import calendar
        cells.extend([f'{calendar.month_abbr[number]} {year}',str(headline if month==11 else 50+month/10)])
    rows=''.join('<tr>'+''.join(f'<td>{c}</td>' for c in cells[i:i+4])+'</tr>' for i in range(0,len(cells),4))
    return f'<h1>{sector.title()} PMI® at {headline}%; September 2026 ISM® {sector.title()} PMI® Report</h1><h2>News provided by</h2><a>{"Institute for Supply Management" if issuer else "Other issuer"}</a><table><tr><td>Month</td><td>{sector.title()} PMI®</td><td>Month</td><td>{sector.title()} PMI®</td></tr>{rows}</table>'


class Reports(unittest.TestCase):
    def test_both_sectors(self):
        for sector in ['manufacturing','services']:
            values=parse_report(fixture(sector),sector,date(2026,10,16));self.assertEqual(len(values),12);self.assertEqual(values['2026-09-01'],54.5)
    def test_headline_disagreement(self):
        html=fixture().replace('<td>54.5</td>','<td>54.4</td>')
        with self.assertRaises(ValueError):parse_report(html,'manufacturing',date(2026,10,16))
    def test_wrong_issuer(self):
        with self.assertRaises(ValueError):parse_report(fixture(issuer=False),'manufacturing',date(2026,10,16))
    def test_wrong_sector(self):
        with self.assertRaises(ValueError):parse_report(fixture('services'),'manufacturing',date(2026,10,16))
    def test_stale_and_future(self):
        for day in [date(2026,8,1),date(2027,1,1)]:
            with self.assertRaises(ValueError):parse_report(fixture(),'manufacturing',day)
    def test_incomplete_history(self):
        with self.assertRaises(ValueError):parse_report(fixture().replace('Oct 2025','Nov 2025'),'manufacturing',date(2026,10,16))
    def test_missing_links(self):
        with self.assertRaises(ValueError): discover('<a href="https://example.com/manufacturing-pmi-at-54-ism-manufacturing-pmi-report.html">x</a>')


if __name__=='__main__':unittest.main()
