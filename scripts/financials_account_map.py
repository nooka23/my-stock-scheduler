"""
Shared DART financial account mappings used by legacy financial scripts.

This file is intentionally small and conservative:
- it centralizes the current string-based mapping rules
- it does not define the future raw/normalized financial pipeline
- it is primarily a shared reference while the new DART-first pipeline is rebuilt
"""

from __future__ import annotations

DART_CORE_ACCOUNT_MAP: dict[str, list[str]] = {
    "revenue": ["매출액", "수익(매출액)", "영업수익", "매출"],
    "op_income": [
        "영업이익",
        "영업이익(손실)",
        "영업손실",
        "영업손익",
        "영업활동으로부터의 이익(손실)",
        "영업순손익",
    ],
    "net_income": [
        "당기순이익",
        "당기순이익(손실)",
        "분기순이익",
        "분기순손실",
        "분기연결순이익",
        "분기손이익",
        "당기순손익",
        "분기순손익",
        "당기순손실",
        "반기순이익(손실)",
        "분기순이익(손실)",
    ],
    "assets": [
        "자산총계",
        "자산 총계",
        "자산 계",
        "자 산 총 계",
        "총자산",
        "자  산  총  계",
    ],
    "equity": [
        "자본총계",
        "자본 총계",
        "자본 계",
        "자 본 총 계",
        "기말자본",
        "자  본  총  계",
    ],
    "liabilities": [
        "부채총계",
        "부채 총계",
        "부채 계",
        "부 채 총 계",
        "총부채",
        "부  채  총  계",
    ],
}


DART_EXPLORATORY_ACCOUNT_MAP: dict[str, list[str]] = {
    **DART_CORE_ACCOUNT_MAP,
    "capital": ["자본금"],
    "shares": ["발행주식수", "보통주식수", "우선주식수"],
}


DART_STATEMENT_PRIORITY_MAP: dict[str, list[str]] = {
    "revenue": ["손익계산서", "포괄손익계산서"],
    "op_income": ["손익계산서", "포괄손익계산서"],
    "net_income": ["손익계산서", "포괄손익계산서"],
    "assets": ["재무상태표"],
    "equity": ["재무상태표", "자본변동표"],
    "liabilities": ["재무상태표"],
    "capital": ["재무상태표", "자본변동표"],
    "shares": ["주석", "재무상태표"],
}


def parse_amount(value: str | None) -> int | None:
    if not value or value == "-":
        return None
    try:
        return int(value.replace(",", ""))
    except ValueError:
        return None


def amount_to_eok(amount: int | None) -> int | None:
    if amount is None:
        return None
    return amount // 100


def normalize_account_name(value: str) -> str:
    return "".join(value.split())


def row_matches_keywords(account_name: str, keywords: list[str]) -> bool:
    normalized_name = normalize_account_name(account_name)
    return any(normalized_name == normalize_account_name(keyword) for keyword in keywords)


def normalize_statement_name(value: str | None) -> str:
    return normalize_account_name(value or "")


def normalize_account_id(value: str | None) -> str:
    return (value or "").strip().upper()


def row_matches_account_id(row: dict[str, object], account_id: str) -> bool:
    return normalize_account_id(str(row.get("account_id") or "")) == normalize_account_id(account_id)


def statement_priority(field: str, statement_name: str | None) -> int:
    priorities = DART_STATEMENT_PRIORITY_MAP.get(field, [])
    normalized_statement = normalize_statement_name(statement_name)

    for index, candidate in enumerate(priorities):
        if normalize_statement_name(candidate) in normalized_statement:
            return index

    return len(priorities)


def collect_account_matches(
    rows: list[dict[str, object]],
    field: str,
    account_map: dict[str, list[str]] = DART_CORE_ACCOUNT_MAP,
) -> list[dict[str, object]]:
    keywords = account_map.get(field, [])
    matches = []

    for row in rows:
        account_name = str(row.get("account_nm") or "")
        if row_matches_keywords(account_name, keywords):
            matches.append(row)

    return matches


def collect_account_id_matches(
    rows: list[dict[str, object]],
    account_ids: list[str],
) -> list[dict[str, object]]:
    normalized_ids = [normalize_account_id(account_id) for account_id in account_ids if normalize_account_id(account_id)]
    if not normalized_ids:
        return []

    matches = []
    for row in rows:
        row_account_id = normalize_account_id(str(row.get("account_id") or ""))
        if row_account_id in normalized_ids:
            matches.append(row)
    return matches


def select_preferred_account_row(
    rows: list[dict[str, object]],
    field: str,
    account_map: dict[str, list[str]] = DART_CORE_ACCOUNT_MAP,
) -> dict[str, object] | None:
    matches = collect_account_matches(rows, field, account_map=account_map)
    if not matches:
        return None

    ranked_matches = sorted(
        enumerate(matches),
        key=lambda item: (
            statement_priority(field, str(item[1].get("sj_nm") or item[1].get("sj_div") or "")),
            item[0],
        ),
    )
    return ranked_matches[0][1]


def select_account_row_by_priority(
    rows: list[dict[str, object]],
    account_ids: list[str],
) -> tuple[dict[str, object] | None, str | None, int | None]:
    for priority_index, account_id in enumerate(account_ids, start=1):
        normalized_account_id = normalize_account_id(account_id)
        if not normalized_account_id:
            continue

        for row in rows:
            if row_matches_account_id(row, normalized_account_id):
                return row, normalized_account_id, priority_index

    return None, None, None
