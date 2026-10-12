"""Read-only live journal verification. Reports metadata, never raw account data."""
from __future__ import annotations
import json
import os
import time
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from .namuh import NamuhReadOnlyClient, NamuhError, safe_code, continuation


def rows_of(data, block='Output_0'):
    value = data.get(block)
    rows = value if isinstance(value, list) else [value]
    if not all(isinstance(row, dict) for row in rows):
        raise NamuhError('NAMUH_OUTPUT_SHAPE_UNVERIFIED')
    return rows


def numeric(rows, fields):
    missing = sorted({field for row in rows for field in fields if field not in row or row[field] in ('', None)})
    invalid = set()
    for row in rows:
        for field in fields:
            if field in missing:
                continue
            try:
                if not Decimal(str(row[field])).is_finite(): invalid.add(field)
            except (InvalidOperation, ValueError): invalid.add(field)
    return {'missing_numeric_fields': missing, 'invalid_numeric_fields': sorted(invalid)}


def verify():
    load_dotenv(Path(__file__).resolve().parents[2] / '.env.local')
    account = os.environ.get('NAMUH_GENERAL_ACCOUNT', '')
    if not account: raise NamuhError('NAMUH_GENERAL_ACCOUNT_MISSING')
    client = NamuhReadOnlyClient(os.environ.get('NAMUH_APP_KEY', ''), os.environ.get('NAMUH_APP_SECRET', ''))
    data, headers = client.read('/n2/acctinfo')
    if safe_code(data) != '00000' or continuation(data, headers): raise NamuhError('ACCOUNT_LIST_UNVERIFIED')
    matches = [r for r in rows_of(data) if str(r.get('acct_no')) == account and r.get('acct_type') in {'01','02'}]
    if len(matches) != 1: raise NamuhError('CONFIGURED_LIVE_ACCOUNT_NOT_UNIQUE')
    now = datetime.now(ZoneInfo('Asia/Seoul'))
    end = now.strftime('%Y%m%d'); start = (now-timedelta(days=30)).strftime('%Y%m%d')
    jobs = [
        ('KR_BALANCE','/krstock/inquiry/v1/balance',{'bnc_bse_cd':'1','ltg_aot_dit_cd':'9','aet_bse':'2','qut_dit_cd':'UNT','aly_qut_cd':'2'},['dca','nxt_dd_dca','nxt2_dd_dca','drn_pbl_amt','orr_pbl_amt4']),
        ('US_BALANCE','/gbstock/inquiry/v1/balance',{'qut_iqr_dit_cd':'9','fc_sec_trd_nat_cd':'200','cur_cd':'USD','xns_dit_cd':'1'},['fc_dca']),
        ('CURRENCY_CASH','/gbstock/inquiry/v1/margin',{},['fc_dca','fc_drn_pbl_amt','stl_af_fc_dca','stl_af_fc_drn_pbl_amt']),
        ('SETTLED_TRANSACTIONS','/common/inquiry/v1/totalTransaction',{'iqr_tp_cd':'1','iqr_rge_cd':'1','iqr_sta_dt':start,'iqr_end_dt':end,'iem_llf_cd':'00','act_trd_dtl_cd':'00'},['trd_qty','trd_uit_pr','trd_amt','trd_orn_fee','tax_sum']),
        ('DEPOSIT_WITHDRAWAL','/common/inquiry/v1/depositWithdrawal',{'iqr_tp_cd':'1','iqr_sta_dt':start,'iqr_end_dt':end,'act_trd_dtl_cd':'01'},['trd_amt','trd_af_dca']),
        ('US_DAILY_TRANSACTIONS','/gbstock/inquiry/v1/dailyTransaction',{'iqr_sta_dt':start,'iqr_end_dt':end,'act_trd_cfc_cd':'00','iem_mlf_cd':'00001'},['trd_qty','trd_uit_pr','fc_trd_amt','ose_fee','dmt_fee','fc_tax_sum']),
    ]
    for ago in range(7):
        day=(now-timedelta(days=ago)).strftime('%Y%m%d')
        jobs.extend([
            ('KR_EXECUTIONS_'+day,'/krstock/inquiry/v1/dailyOrderExecution',{'orr_dt':day,'orr_mkt_cd':'00','ost_cns_dit':'0'},['tot_cns_qty','cns_avg_uit_pr','cns_amt']),
            ('US_EXECUTIONS_'+day,'/gbstock/inquiry/v1/unexecuted',{'orr_dt':day,'oss_sby_dit_cd':'0','sot_dit':'0','ost_cns_dit':'0'},['cns_qty','cns_pr']),
        ])
    results=[]
    for label, path, params, fields in jobs:
        time.sleep(0.26)
        try:
            pages=list(client.pages(path,{'act_no':account, **params}))
            rows=[row for page in pages for row in rows_of(page)]
            meaningful=[row for row in rows if any(str(v).strip() not in {'','0','0.0','0.000000','00000000'} for v in row.values())]
            summary={'check':label,'status':'EMPTY' if not rows else 'COMPLETE','pages':len(pages),'rows':len(rows),
                     'meaningful_rows':len(meaningful),'response_codes':sorted({safe_code(p) for p in pages}),
                     'fields':sorted({f for r in rows for f in r}), **numeric(rows,fields)}
            if label=='CURRENCY_CASH':
                summary['currencies']=sorted({str(r.get('cur_cd')) for r in rows if str(r.get('cur_cd')) in {'KRW','USD','CNY','HKD','JPY','EUR','GBP','VND','IDR'}})
            if label.startswith(('KR_EXECUTIONS','US_EXECUTIONS')):
                q='tot_cns_qty' if label.startswith('KR') else 'cns_qty'
                summary['filled_order_rows']=sum(Decimal(str(r.get(q) or '0'))>0 for r in rows)
            if label=='US_DAILY_TRANSACTIONS':
                keys=[(str(r.get('trd_dt')),str(r.get('trd_sno'))) for r in rows]
                summary['transaction_keys_unique']=len(keys)==len(set(keys))
            results.append(summary)
        except NamuhError as exc:
            results.append({'check':label,'status':'UNVERIFIED','error':str(exc)})
    passed = all(r['status'] in {'COMPLETE','EMPTY'} and not r.get('missing_numeric_fields')
                 and not r.get('invalid_numeric_fields') for r in results)
    return {'status':'PASS' if passed else 'UNVERIFIED','observed_at':now.isoformat(),'account_suffix':account[-4:],
            'history_window':{'start':start,'end':end},'checks':results,'database_written':False}


if __name__=='__main__':
    try:
        result = verify()
        print(json.dumps(result,ensure_ascii=False))
        if result['status'] != 'PASS': raise SystemExit(2)
    except NamuhError as exc:
        print(json.dumps({'status':'UNVERIFIED','error':str(exc)})); raise SystemExit(2)
    except Exception:
        print('{"status":"UNVERIFIED","error":"NAMUH_VERIFY_UNAVAILABLE"}'); raise SystemExit(1)
