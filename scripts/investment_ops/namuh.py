"""NAMUH-only authenticated read transport. No order or FX mutation endpoints."""
from __future__ import annotations

import json
import argparse
import os
import re
import time
from decimal import Decimal
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE_URL = "https://api.nhplug.com:8443"
READ_PATHS = frozenset({"/n2/acctinfo", "/krstock/inquiry/v1/balance", "/gbstock/inquiry/v1/balance",
    "/krstock/inquiry/v1/dailyOrderExecution", "/gbstock/inquiry/v1/unexecuted",
    "/common/inquiry/v1/totalTransaction", "/common/inquiry/v1/depositWithdrawal",
    "/gbstock/inquiry/v1/dailyTransaction", "/gbstock/inquiry/v1/margin"})
EMPTY_CODES = {
    "/krstock/inquiry/v1/dailyOrderExecution": "11512",
    "/gbstock/inquiry/v1/unexecuted": "13578",
}


class NamuhError(RuntimeError):
    """Safe error: no URL with authentication query, payload, or credentials."""


def safe_code(data: object) -> str:
    if not isinstance(data, dict):
        return "UNKNOWN"
    code = str(data.get("error_code") or data.get("rsp_cd") or "UNKNOWN")
    return code if re.fullmatch(r"[A-Za-z0-9_-]{1,32}", code) else "UNKNOWN"


class NamuhReadOnlyClient:
    def __init__(self, key: str, secret: str, *, session=None):
        if not key or not secret:
            raise NamuhError("NAMUH_CREDENTIALS_MISSING")
        self._key, self._secret = key, secret
        self._session = session or requests.Session()
        self._token = None

    def authenticate(self) -> None:
        if self._token:
            return
        try:
            response = self._session.post(
                BASE_URL + "/oauth2/token",
                params={"appkey": self._key, "appsecretkey": self._secret, "grant_type": "client_credentials", "scope": "oob"},
                headers={"content-type": "application/x-www-form-urlencoded"},
                timeout=(10, 25), allow_redirects=False,
            )
            data = response.json(parse_float=Decimal)
        except (requests.RequestException, ValueError):
            raise NamuhError("NAMUH_AUTH_NETWORK_OR_FORMAT_ERROR") from None
        if response.status_code != 200 or not isinstance(data, dict) or not data.get("access_token"):
            raise NamuhError(f"NAMUH_AUTH_FAILED HTTP={response.status_code} CODE={safe_code(data)}")
        self._token = data["access_token"]

    def read(self, path: str, parameters: dict | None = None, *, cts: str | None = None) -> tuple[dict, dict]:
        if path not in READ_PATHS:
            raise NamuhError("NAMUH_ENDPOINT_NOT_ALLOWED")
        self.authenticate()
        try:
            response = self._session.post(
                BASE_URL + path,
                headers={"x-client-id": self._key, "x-client-secret": self._secret,
                         "authorization": "Bearer " + self._token, "content-type": "application/json; charset=UTF-8",
                         **({"cts": cts, "cts_flag": "Y"} if cts else {})},
                json={"Input_0": parameters or {}}, timeout=(10, 25), allow_redirects=False,
            )
            data = response.json(parse_float=Decimal)
        except (requests.RequestException, ValueError):
            raise NamuhError("NAMUH_READ_NETWORK_OR_FORMAT_ERROR") from None
        if response.status_code != 200 or not isinstance(data, dict):
            raise NamuhError(f"NAMUH_READ_FAILED HTTP={response.status_code} CODE={safe_code(data)}")
        # HTTP 200 is not proof of business success; caller inspects status/shape.
        return data, {key.lower(): value for key, value in response.headers.items()}

    def pages(self, path: str, parameters: dict, *, max_pages: int = 100):
        """Read to terminal status; an incomplete cursor chain fails closed."""
        cursor = None
        seen = set()
        for _ in range(max_pages):
            data, headers = self.read(path, parameters, cts=cursor)
            code = safe_code(data)
            if code == EMPTY_CODES.get(path) and data.get("Output_0") == [] and not continuation(data, headers):
                yield data
                return
            if code not in {"00000", "00166", "00165", "00218"}:
                raise NamuhError("NAMUH_BUSINESS_STATUS_UNVERIFIED CODE=" + code)
            cursor = continuation(data, headers)
            if code in {"00165", "00218"} and not cursor:
                raise NamuhError("NAMUH_CONTINUATION_MISSING")
            yield data
            if not cursor:
                return
            if cursor in seen:
                raise NamuhError("NAMUH_CONTINUATION_REPEATED")
            seen.add(cursor)
            time.sleep(0.26)
        raise NamuhError("NAMUH_PAGE_LIMIT_INCOMPLETE")


def continuation(data: dict, headers: dict) -> str | None:
    """Official SDK rules: nonempty terminal header CTS alone is not a next page."""
    flag = str(headers.get("cts_flag") or "").strip().upper()
    if flag == "N":
        return None
    cursor = str(headers.get("cts") or "").strip()
    body_cursor = None
    if not cursor:
        for key, block in data.items():
            if key.startswith("Output"):
                for row in block if isinstance(block, list) else [block]:
                    if isinstance(row, dict):
                        for field, value in row.items():
                            if re.fullmatch(r"ctsz\w*", field, re.IGNORECASE) and str(value or "").strip():
                                body_cursor = str(value).strip()
        cursor = body_cursor or ""
    if flag == "Y" and not cursor:
        raise NamuhError("NAMUH_CONTINUATION_MISSING")
    return cursor if cursor and (flag == "Y" or body_cursor or safe_code(data) in {"00165", "00218"}) else None


def probe(*, balances: bool = False) -> dict:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local", override=False)
    client = NamuhReadOnlyClient(os.environ.get("NAMUH_APP_KEY", ""), os.environ.get("NAMUH_APP_SECRET", ""))
    client.authenticate()
    data, headers = client.read("/n2/acctinfo")
    rows = data.get("Output_0")
    if not isinstance(rows, list):
        raise NamuhError("NAMUH_ACCOUNT_SHAPE_UNVERIFIED CODE=" + safe_code(data))
    summaries = []
    balance_results = []
    configured_accounts = {os.environ.get(name) for name in ("NAMUH_GENERAL_ACCOUNT", "NAMUH_ISA_ACCOUNT") if os.environ.get(name)}
    for row in rows:
        if not isinstance(row, dict):
            raise NamuhError("NAMUH_ACCOUNT_ROW_UNVERIFIED")
        account = str(row.get("acct_no") or "")
        summaries.append({"account_suffix": account[-4:] if len(account) >= 4 else "UNKNOWN",
                          "environment_type": str(row.get("acct_type") or "UNKNOWN"), "fields": sorted(row.keys())})
        # Environment type 01/02 does not distinguish GENERAL/ISA/IRP.
        # Probe only exact account numbers separately identified by the owner.
        if balances and account in configured_accounts and row.get("acct_type") in {"01", "02"}:
            for market, path, parameters in (
                ("KR", "/krstock/inquiry/v1/balance", {"act_no": account, "bnc_bse_cd": "5", "ltg_aot_dit_cd": "9", "aet_bse": "2", "qut_dit_cd": "UNT", "aly_qut_cd": "2"}),
                ("US", "/gbstock/inquiry/v1/balance", {"act_no": account, "qut_iqr_dit_cd": "9", "fc_sec_trd_nat_cd": "200", "cur_cd": "USD", "xns_dit_cd": "1"}),
            ):
                result, metadata = client.read(path, parameters)
                blocks = {}
                for key, block in result.items():
                    if not key.startswith("Output"):
                        continue
                    block_rows = block if isinstance(block, list) else [block]
                    blocks[key] = {"rows": len(block_rows), "fields": sorted({k for item in block_rows if isinstance(item, dict) for k in item})}
                balance_results.append({"account_suffix": account[-4:], "market": market, "response_code": safe_code(result), "blocks": blocks, "has_continuation": bool(metadata.get("cts"))})
    return {"authentication": "SUCCESS", "account_response_code": safe_code(data), "account_count": len(summaries),
            "accounts": summaries, "balance_probes": balance_results, "has_continuation": bool(headers.get("cts")), "database_written": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="나무 조회 전용 연결 검증: 계좌번호/금액/키는 출력하지 않음")
    parser.add_argument("--balances", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(probe(balances=args.balances), ensure_ascii=False))
    except NamuhError as exc:
        print(str(exc))
        raise SystemExit(2)
    except Exception:
        print("NAMUH_PROBE_UNAVAILABLE")
        raise SystemExit(1)
