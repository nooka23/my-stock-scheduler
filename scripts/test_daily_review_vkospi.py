import unittest
from datetime import date
from collect_global_market_data import fetch_daily_chart_history, DOMESTIC_SOURCE, SOURCE, KisApiError


class DomesticClient:
    def get_ranking_page(self,path,tr,params):
        assert params['FID_INPUT_ISCD']=='0503' and tr=='FHPUP02120000'
        return {'output1':{'bstp_nmix_prpr':'999'},'output2':[
            {'stck_bsop_date':'20261016','bstp_nmix_prpr':'999'},
            {'stck_bsop_date':'20261015','bstp_nmix_prpr':'55.38','bstp_nmix_oprc':'48.05','bstp_nmix_hgpr':'57.22','bstp_nmix_lwpr':'48.05'},
            {'stck_bsop_date':'20261014','bstp_nmix_prpr':'44.91'}]},{}


class History(unittest.TestCase):
    def test_dated_history_only(self):
        item=dict(id='fixture',internal_code='KR_INDEX_VKOSPI',currency='POINT',provider_symbol='0503',provider_params={'fid_cond_mrkt_div_code':'U'})
        rows,count=fetch_daily_chart_history(DomesticClient(),item,date(2026,10,14),date(2026,10,15))
        self.assertEqual(count,2);self.assertEqual(rows[-1]['close'],55.38)
        self.assertEqual(rows[-1]['trade_date'],'2026-10-15');self.assertEqual(rows[-1]['source'],DOMESTIC_SOURCE)
    def test_invalid_close_rejected(self):
        class Invalid(DomesticClient):
            def get_ranking_page(self,*args):return {'output2':[{'stck_bsop_date':'20261015','bstp_nmix_prpr':'NaN'}]},{}
        item=dict(id='fixture',internal_code='KR_INDEX_VKOSPI',provider_symbol='0503',provider_params={'fid_cond_mrkt_div_code':'U'})
        with self.assertRaises(KisApiError):fetch_daily_chart_history(Invalid(),item,date(2026,10,15),date(2026,10,15))
    def test_existing_overseas_path_preserved(self):
        class Overseas:
            def get_daily_chart_page(self,*args):return {'output2':[{'stck_bsop_date':'20261015','ovrs_nmix_prpr':'15.0'}]}
        item=dict(id='fixture',internal_code='US_INDEX_VIX',provider_symbol='VIX',provider_params={'fid_cond_mrkt_div_code':'N'})
        rows,_=fetch_daily_chart_history(Overseas(),item,date(2026,10,15),date(2026,10,15))
        self.assertEqual(rows[0]['close'],15);self.assertEqual(rows[0]['source'],SOURCE)


if __name__=='__main__':unittest.main()
