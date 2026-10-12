"""Save a complete current CMA portfolio snapshot; no historical trade imports."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from dotenv import load_dotenv
from .namuh import NamuhReadOnlyClient, NamuhError, safe_code, continuation
from .namuh_verify import rows_of
from .journal import money, text_field, currency


def number(row, key, *, nullable=False):
    return money(row.get(key), key, nullable=nullable)


def positions_from(pages, market):
    positions=[]; seen=set()
    for page in pages:
        for r in rows_of(page,'Output_1'):
            symbol=str(r.get('iem_cd') or '').strip()
            qty=number(r,'itg_bnc_qty' if market=='KR' else 'cns_bse_bnc_qty')
            if Decimal(qty)==0: continue
            if not symbol: raise NamuhError('HOLDING_SYMBOL_MISSING')
            if market=='US' and (r.get('fc_sec_trd_nat_cd')!='200' or r.get('cur_cd')!='USD'):
                raise NamuhError('HOLDING_MARKET_CURRENCY_UNVERIFIED')
            category=str(r.get('tp_cd_nm' if market=='KR' else 'cfd_lon_cd_nm') or '')
            loan=str(r.get('lon_byn_dt' if market=='KR' else 'lon_dt') or '')
            identity=json.dumps([market,symbol,category,loan],ensure_ascii=False)
            key=hashlib.sha256(identity.encode()).hexdigest()
            if key in seen: raise NamuhError('HOLDING_DUPLICATE_IDENTITY')
            seen.add(key)
            positions.append({'position_key':key,'market':market,'symbol':symbol,
                'name':text_field(str(r.get('iem_nm') or ''),'name'),'currency':'KRW' if market=='KR' else 'USD',
                'category':category,'quantity':qty,
                'unsettled_quantity':number(r,'ny_stl_qty') if market=='KR' else None,
                'average_price':number(r,'phs_pr' if market=='KR' else 'fc_phs_uit_pr'),
                'current_price':number(r,'now_pr' if market=='KR' else 'fc_sec_end_pr'),
                'valuation':number(r,'eal_amt' if market=='KR' else 'fc_eal_amt'),
                'unrealized_pnl':number(r,'eal_pls_amt' if market=='KR' else 'fc_eal_pls_amt'),
                'book_value':number(r,'fc_abk_amt') if market=='US' else None})
    return positions


def cash_from(kr_pages, margin_pages):
    # Summary amounts are authoritative only once holdings pagination has finished.
    summaries=rows_of(kr_pages[-1]);
    if len(summaries)!=1: raise NamuhError('KR_CASH_SUMMARY_UNVERIFIED')
    r=summaries[0]
    cash=[{'currency':'KRW','cash':number(r,'dca'),'withdrawable':number(r,'drn_pbl_amt'),
           'buying_power':number(r,'orr_pbl_amt4'),'d1_cash':number(r,'nxt_dd_dca'),'d2_cash':number(r,'nxt2_dd_dca')}]
    seen={'KRW'}
    for p in margin_pages:
        for r in rows_of(p):
            cur=str(r.get('cur_cd') or '').strip()
            # This API also returns a converted aggregate row, not another currency balance.
            if '원화환산합계' in cur: continue
            currency(cur)
            if cur=='KRW': continue  # domestic cash is the KRW authority
            if cur in seen: raise NamuhError('DUPLICATE_CASH_CURRENCY')
            seen.add(cur)
            cash.append({'currency':cur,'cash':number(r,'fc_dca'),'withdrawable':number(r,'fc_drn_pbl_amt'),
                'buying_power':None,'settled_cash':number(r,'stl_af_fc_dca'),
                'settled_withdrawable':number(r,'stl_af_fc_drn_pbl_amt')})
    return cash


def collect():
    account=os.environ.get('NAMUH_GENERAL_ACCOUNT','')
    if not account: raise NamuhError('GENERAL_ACCOUNT_MISSING')
    c=NamuhReadOnlyClient(os.environ.get('NAMUH_APP_KEY',''),os.environ.get('NAMUH_APP_SECRET',''))
    d,h=c.read('/n2/acctinfo')
    if safe_code(d)!='00000' or continuation(d,h): raise NamuhError('ACCOUNT_LIST_UNVERIFIED')
    matches=[r for r in rows_of(d) if str(r.get('acct_no'))==account and r.get('acct_type') in {'01','02'}]
    if len(matches)!=1: raise NamuhError('CONFIGURED_ACCOUNT_UNVERIFIED')
    observed=datetime.now(timezone.utc).isoformat()
    kr=list(c.pages('/krstock/inquiry/v1/balance',{'act_no':account,'bnc_bse_cd':'1','ltg_aot_dit_cd':'9','aet_bse':'2','qut_dit_cd':'UNT','aly_qut_cd':'2'}))
    time.sleep(.26)
    us=list(c.pages('/gbstock/inquiry/v1/balance',{'act_no':account,'qut_iqr_dit_cd':'9','fc_sec_trd_nat_cd':'200','cur_cd':'USD','xns_dit_cd':'1'}))
    time.sleep(.26)
    margin=list(c.pages('/gbstock/inquiry/v1/margin',{'act_no':account}))
    return {'observed_at':observed,'completed_at':datetime.now(timezone.utc).isoformat(),
        'positions':positions_from(kr,'KR')+positions_from(us,'US'),'cash':cash_from(kr,margin),'source':'NAMUH_API'}


def save(snapshot, owner_email):
    from supabase import create_client
    url=os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key: raise NamuhError('SUPABASE_CONFIG_MISSING')
    db=create_client(url,key)
    # Resolve only the explicit owner email supplied by the user, never the first admin.
    owners=db.table('profiles').select('id').eq('email',owner_email).execute().data
    if len(owners)!=1: raise NamuhError('SITE_OWNER_EMAIL_NOT_UNIQUE')
    owner=str(uuid.UUID(owners[0]['id']))
    account=db.table('trade_journal_accounts').upsert({'user_id':owner,'alias':'namuh-general','label':'나무 일반/CMA'},on_conflict='user_id,alias').execute().data
    if len(account)!=1: raise NamuhError('JOURNAL_ACCOUNT_UNVERIFIED')
    digest=hashlib.sha256(json.dumps(snapshot,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    result=db.table('trade_journal_position_snapshots').upsert({**snapshot,'account_id':account[0]['id'],
        'user_id':owner,'content_hash':digest},on_conflict='account_id,content_hash').execute().data
    if len(result)!=1: raise NamuhError('SNAPSHOT_SAVE_UNVERIFIED')
    check=db.table('trade_journal_position_snapshots').select('id,positions,cash').eq('id',result[0]['id']).eq('user_id',owner).execute().data
    if len(check)!=1 or check[0]['positions']!=snapshot['positions'] or check[0]['cash']!=snapshot['cash']:
        raise NamuhError('SNAPSHOT_READBACK_MISMATCH')
    return {'saved':True,'snapshot_id':check[0]['id'],'position_count':len(snapshot['positions']),
        'market_counts':{m:sum(p['market']==m for p in snapshot['positions']) for m in ['KR','US']},
        'currencies':[r['currency'] for r in snapshot['cash']],'observed_at':snapshot['observed_at'],'historical_trades_imported':0}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--owner-email',required=True); args=parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[2]/'.env.local')
    # requests decodes numeric JSON values as Decimal to preserve exact money/quantity.
    try: print(json.dumps(save(collect(),args.owner_email),ensure_ascii=False))
    except NamuhError as exc: print(str(exc)); return 2
    except Exception: print('NAMUH_SNAPSHOT_UNAVAILABLE'); return 1
    return 0

if __name__=='__main__': raise SystemExit(main())
