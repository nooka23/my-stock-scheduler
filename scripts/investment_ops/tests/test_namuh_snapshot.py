import unittest
from decimal import Decimal
from investment_ops.namuh import NamuhError
from investment_ops.namuh_snapshot import cash_from,positions_from

class SnapshotTests(unittest.TestCase):
    def us(self):
        return {'iem_cd':'SYNTH','iem_nm':'Synthetic','fc_sec_trd_nat_cd':'200','cur_cd':'USD',
            'cns_bse_bnc_qty':Decimal('0.123456'),'fc_phs_uit_pr':Decimal('12.123456'),
            'fc_sec_end_pr':Decimal('13.000001'),'fc_eal_amt':Decimal('1.60'),
            'fc_eal_pls_amt':Decimal('-0.11'),'fc_abk_amt':Decimal('1.71')}
    def test_fractional_holdings_precision_and_no_fake_entry_date(self):
        p=positions_from([{'Output_1':[self.us()]}],'US')[0]
        self.assertEqual(p['quantity'],'0.123456'); self.assertEqual(p['unrealized_pnl'],'-0.11')
        self.assertNotIn('trade_date',p)
    def test_duplicate_position_or_wrong_currency_rejected(self):
        r=self.us()
        with self.assertRaises(NamuhError): positions_from([{'Output_1':[r,r]}],'US')
        with self.assertRaises(NamuhError): positions_from([{'Output_1':[{**r,'cur_cd':'JPY'}]}],'US')
    def test_cash_uses_last_page_and_excludes_converted_total(self):
        kr=[{'Output_0':{'dca':999}}, {'Output_0':{'dca':100,'drn_pbl_amt':90,'orr_pbl_amt4':80,'nxt_dd_dca':95,'nxt2_dd_dca':85}}]
        margin=[{'Output_0':[{'cur_cd':'USD','fc_dca':Decimal('10.01'),'fc_drn_pbl_amt':8,'stl_af_fc_dca':9,'stl_af_fc_drn_pbl_amt':7},{'cur_cd':'<원화환산합계>','fc_dca':0}]}]
        cash=cash_from(kr,margin)
        self.assertEqual([r['currency'] for r in cash],['KRW','USD']); self.assertEqual(cash[0]['cash'],'100')
        self.assertIsNone(cash[1]['buying_power'])
