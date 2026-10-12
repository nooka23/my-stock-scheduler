"""Validated, replayable journal ingestion. No broker field mappings are assumed."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import uuid
from datetime import date
from pathlib import Path

from .domain import DomainValidationError, decimal_to_string, parse_aware_datetime, parse_decimal, utc_isoformat

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config" / "trade_journal.json"
ALIASES = {"namuh-general": {"KR", "US"}, "namuh-isa": {"KR"}, "kiwoom-main": {"KR", "US"}}


class JournalError(ValueError):
    pass


def object_keys(value: object, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise JournalError(f"{label}: unexpected or missing fields")
    return value


def text_field(value: object, label: str, *, limit: int = 200) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise JournalError(f"{label}: invalid text")
    return value


def enum(value: object, choices: set[str], label: str) -> str:
    if not isinstance(value, str) or value not in choices:
        raise JournalError(f"{label}: unsupported value")
    return value


def money(value: object, label: str, *, nullable: bool = False, nonnegative: bool = False) -> str | None:
    if value is None and nullable:
        return None
    amount = parse_decimal(value, field_name=label)
    if nonnegative and amount < 0:
        raise JournalError(f"{label}: must be nonnegative")
    if abs(amount) >= 10**30 or amount.as_tuple().exponent < -12:
        raise JournalError(f"{label}: exceeds supported precision")
    return decimal_to_string(amount)


def iso_date(value: object, label: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise JournalError(f"{label}: use YYYY-MM-DD")
    date.fromisoformat(value)
    return value


def currency(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Z]{3}", value):
        raise JournalError("currency: use a three-letter code")
    return value


def rows(value: object, label: str) -> list:
    if not isinstance(value, list) or len(value) > 10000:
        raise JournalError(f"{label}: expected an array of at most 10000 records")
    return value


def validate_batch(data: object) -> dict:
    batch = dict(object_keys(data, {"schema_version", "account_alias", "source", "complete", "observed_at", "executions", "cash_events", "balances"}, "batch"))
    if type(batch["schema_version"]) is not int or batch["schema_version"] != 1 or batch["complete"] is not True:
        raise JournalError("only complete schema_version 1 batches can be imported")
    alias = enum(batch["account_alias"], set(ALIASES), "account_alias")
    enum(batch["source"], {"API", "MANUAL_IMPORT"}, "source")
    observed = parse_aware_datetime(batch["observed_at"], field_name="observed_at")
    batch["observed_at"] = utc_isoformat(observed)
    normalized = []
    seen = set()
    for row in rows(batch["executions"], "executions"):
        item = dict(object_keys(row, {"source_key", "market", "symbol", "name", "currency", "side", "trade_date", "executed_at", "settlement_date", "quantity", "price", "gross_amount", "fee", "tax", "status"}, "execution"))
        for key in ("source_key", "symbol", "name"):
            text_field(item[key], key)
        enum(item["market"], ALIASES[alias], "market")
        currency(item["currency"])
        enum(item["side"], {"BUY", "SELL"}, "side")
        enum(item["status"], {"PROVISIONAL", "CONFIRMED", "REVERSED"}, "status")
        iso_date(item["trade_date"], "trade_date")
        iso_date(item["settlement_date"], "settlement_date", nullable=True)
        executed = parse_aware_datetime(item["executed_at"], field_name="executed_at")
        if executed > observed:
            raise JournalError("execution cannot be later than the observation")
        item["executed_at"] = utc_isoformat(executed)
        for key in ("quantity", "price", "gross_amount", "fee", "tax"):
            item[key] = money(item[key], key, nonnegative=True, nullable=key in {"fee", "tax"})
        if parse_decimal(item["quantity"], field_name="quantity") <= 0:
            raise JournalError("quantity must be positive")
        if item["source_key"] in seen:
            raise JournalError("duplicate execution source_key; partial fills need distinct keys")
        seen.add(item["source_key"])
        normalized.append(item)
    batch["executions"] = sorted(normalized, key=lambda r: r["source_key"])
    normalized, seen = [], set()
    for row in rows(batch["cash_events"], "cash_events"):
        item = dict(object_keys(row, {"source_key", "occurred_at", "currency", "kind", "amount", "description"}, "cash_event"))
        text_field(item["source_key"], "source_key")
        text_field(item["description"], "description", limit=1000)
        occurred = parse_aware_datetime(item["occurred_at"], field_name="occurred_at")
        if occurred > observed:
            raise JournalError("cash event cannot be later than the observation")
        item["occurred_at"] = utc_isoformat(occurred)
        currency(item["currency"])
        enum(item["kind"], {"DEPOSIT", "WITHDRAWAL", "SETTLEMENT", "FX", "DIVIDEND", "INTEREST", "FEE", "TAX", "OTHER"}, "kind")
        item["amount"] = money(item["amount"], "amount")
        if item["source_key"] in seen:
            raise JournalError("duplicate cash source_key")
        seen.add(item["source_key"])
        normalized.append(item)
    batch["cash_events"] = sorted(normalized, key=lambda r: r["source_key"])
    normalized, seen = [], set()
    for row in rows(batch["balances"], "balances"):
        item = dict(object_keys(row, {"currency", "cash", "withdrawable", "buying_power", "settlements"}, "balance"))
        currency(item["currency"])
        if item["currency"] in seen:
            raise JournalError("one authoritative balance per currency per observation is required")
        seen.add(item["currency"])
        for key in ("cash", "withdrawable", "buying_power"):
            item[key] = money(item[key], key, nullable=key != "cash")
        settlements = []
        for settlement in rows(item["settlements"], "settlements"):
            settlement = dict(object_keys(settlement, {"date", "amount"}, "settlement"))
            iso_date(settlement["date"], "settlement.date")
            settlement["amount"] = money(settlement["amount"], "settlement.amount")
            settlements.append(settlement)
        item["settlements"] = sorted(settlements, key=lambda r: (r["date"], r["amount"]))
        normalized.append(item)
    batch["balances"] = sorted(normalized, key=lambda r: r["currency"])
    return batch


def batch_hash(batch: dict) -> str:
    return hashlib.sha256(json.dumps(batch, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def reject_duplicate_keys(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise JournalError("duplicate JSON field")
        result[key] = value
    return result


def read_json(path: Path) -> dict:
    if path.stat().st_size > 20_000_000:
        raise JournalError("input file exceeds 20 MB")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)


def readiness(config: dict) -> dict:
    if config.get("timezone") != "Asia/Seoul" or config.get("collection_times") != ["06:00", "16:00"]:
        raise JournalError("schedule must use Asia/Seoul at 06:00 and 16:00")
    owner = os.environ.get("TRADE_JOURNAL_USER_ID") or config.get("user_id")
    if owner:
        uuid.UUID(owner)
    active = [a for a in config.get("accounts", []) if a.get("enabled", True)]
    required = set()
    for account in active:
        if account.get("alias") not in ALIASES:
            raise JournalError("unknown account alias")
        if account["alias"].startswith("namuh-"):
            required.update(("NAMUH_APP_KEY", "NAMUH_APP_SECRET"))
            required.add("NAMUH_ISA_ACCOUNT" if account["alias"] == "namuh-isa" else "NAMUH_GENERAL_ACCOUNT")
        else:
            required.update(("KIWOOM_APP_KEY", "KIWOOM_APP_SECRET"))
    missing = [name for name in sorted(required) if not os.environ.get(name)]
    return {"schedule": "Asia/Seoul 06:00, 16:00", "owner_configured": bool(owner), "missing_environment": missing,
            "active_accounts": [a["alias"] for a in active],
            "provider_mapping": "PENDING_AUTHENTICATED_SAMPLES", "collection_ready": False}


def import_batch(batch: dict, user_id: str, *, client=None) -> str:
    uuid.UUID(user_id)
    batch = validate_batch(batch)
    if client is None:
        from supabase import create_client
        url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise JournalError("Supabase service configuration is missing")
        client = create_client(url, key)
    result = client.rpc("ingest_trade_journal_batch", {"p_user_id": user_id, "p_alias": batch["account_alias"], "p_hash": batch_hash(batch), "p_batch": batch}).execute()
    return str(result.data)


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env.local", override=False)
    parser = argparse.ArgumentParser(description="매매일지 준비상태 확인 및 검증된 표준 데이터 가져오기")
    parser.add_argument("--config", type=Path, default=CONFIG)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("readiness")
    for command in ("validate-batch", "import-batch"):
        sub = commands.add_parser(command)
        sub.add_argument("path", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "readiness":
            print(json.dumps(readiness(read_json(args.config)), ensure_ascii=False))
            return 2  # Not a successful collection: credentials and field verification are pending.
        batch = validate_batch(read_json(args.path))
        if args.command == "validate-batch":
            print(json.dumps({"valid": True, "hash": batch_hash(batch), "executions": len(batch["executions"]), "cash_events": len(batch["cash_events"]), "balances": len(batch["balances"])}))
            return 0
        config = read_json(args.config)
        owner = os.environ.get("TRADE_JOURNAL_USER_ID") or config.get("user_id")
        if not owner:
            raise JournalError("TRADE_JOURNAL_USER_ID is required before importing")
        import_batch(batch, owner)
        print("IMPORTED: account batch committed")
        return 0
    except (JournalError, DomainValidationError, ValueError, OSError):
        print("JOURNAL_INVALID: check configuration or standard batch fields; no payload is logged")
        return 2
    except Exception:
        # Broker/DB clients may include credentials or raw response data in exceptions.
        print("JOURNAL_UNAVAILABLE: import failed; verify connection and migration")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
