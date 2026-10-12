"""Fail-closed runtime configuration validation for investment operations."""

from __future__ import annotations

import copy
import hashlib
import json
import stat
import uuid
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Sequence

from .domain import DomainValidationError, parse_aware_datetime, parse_decimal


class ConfigError(ValueError):
    """Raised when a runtime configuration violates the source-of-truth contract."""


BASE_KEYS = frozenset(
    {
        "schema_version",
        "config_version",
        "config_hash",
        "approved_at",
        "user_id",
        "account_key",
        "cutover_at",
        "candidate_audit_start_at",
        "raw_archive_dir",
        "buy_projection_mode",
        "sell_projection_mode",
        "notification_mode",
        "outbox_lease_seconds",
        "outbox_max_attempts",
        "outbox_retry_base_seconds",
        "outbox_retry_max_seconds",
        "pnl_projection_basis",
        "price_adjustment_verified",
    }
)
RULE_KEYS = frozenset(
    {
        "RR-LT-001",
        "RR-ALLOC-001",
        "RR-CONC-001",
        "RR-STOP-001",
        "RR-ADD-001",
        "RR-ADD-GUIDE-001",
        "RR-BE-001",
    }
)
REQUIRED_KEYS = BASE_KEYS | RULE_KEYS
RULE_SCHEMAS: Mapping[str, tuple[frozenset[str], frozenset[str]]] = {
    "RR-LT-001": (
        frozenset({"status", "daily_method", "daily_period", "weekly_method", "weekly_period", "include_partial_week"}),
        frozenset({"DRAFT", "ACTIVE", "OFF"}),
    ),
    "RR-ALLOC-001": (
        frozenset({"status", "max_ratio", "account_snapshot_max_age_seconds"}),
        frozenset({"DRAFT", "ACTIVE", "OFF"}),
    ),
    "RR-CONC-001": (
        frozenset({"status", "max_ratio", "account_snapshot_max_age_seconds"}),
        frozenset({"DRAFT", "ACTIVE", "OFF"}),
    ),
    "RR-STOP-001": (
        frozenset({"status", "loss_ratio", "quote_max_age_seconds", "session"}),
        frozenset({"DRAFT", "ACTIVE", "OFF"}),
    ),
    "RR-ADD-001": (
        frozenset({"status", "reference"}),
        frozenset({"DRAFT", "ACTIVE", "OFF"}),
    ),
    "RR-ADD-GUIDE-001": (
        frozenset({"status", "levels", "quantity_fraction", "tolerance"}),
        frozenset({"ADVISORY", "OFF"}),
    ),
    "RR-BE-001": (frozenset({"status"}), frozenset({"OFF"})),
}
INITIAL_ALLOCATION_MAX = Decimal("0.10")
MAX_SYMBOL_WEIGHT = Decimal("0.25")
INITIAL_STOP_LOSS = Decimal("0.07")


@dataclass(frozen=True)
class RuntimeConfig:
    """Validated recursively immutable config plus its loader-calculated SHA-256 hash."""

    values: Mapping[str, Any]
    config_hash: str

    @property
    def config_version(self) -> str:
        return self.values["config_version"]

    @property
    def rules(self) -> Mapping[str, Mapping[str, Any]]:
        return MappingProxyType({key: self.values[key] for key in RULE_KEYS})


def canonical_config_hash(values: Mapping[str, Any]) -> str:
    """Hash canonical UTF-8 JSON excluding the non-manual config_hash placeholder."""
    canonical_values = copy.deepcopy(dict(values))
    canonical_values.pop("config_hash", None)
    canonical_json = json.dumps(
        canonical_values,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def load_config(
    path: str | Path,
    *,
    repository_root: str | Path | None = None,
    protected_roots: Sequence[str | Path] = (),
) -> RuntimeConfig:
    """Read and validate a config without network, DB, broker, or order I/O."""
    config_path = Path(path)
    try:
        parsed = json.loads(config_path.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except FileNotFoundError as exc:
        raise ConfigError(f"config file does not exist: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"config file is invalid JSON: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise ConfigError("config root must be a JSON object")
    resolved_repository_root = Path(repository_root) if repository_root is not None else config_path.resolve().parents[1]
    validate_config(parsed, repository_root=resolved_repository_root, protected_roots=protected_roots)
    return RuntimeConfig(values=_freeze(parsed), config_hash=canonical_config_hash(parsed))


def validate_config(
    values: Mapping[str, Any],
    *,
    repository_root: str | Path | None = None,
    protected_roots: Sequence[str | Path] = (),
) -> None:
    """Validate the P1A-02R fail-closed subset of DATA_CONTRACTS §5.5."""
    _validate_exact_keys(values, REQUIRED_KEYS, "config")
    if values["schema_version"] != 1:
        raise ConfigError("schema_version must be 1")
    if not isinstance(values["config_version"], str) or not values["config_version"].strip():
        raise ConfigError("config_version must be a non-empty string")
    if values["config_hash"] is not None:
        raise ConfigError("config_hash is loader-calculated and must be null in the file")

    _validate_optional_timestamp(values, "approved_at")
    _validate_optional_timestamp(values, "cutover_at")
    _validate_optional_timestamp(values, "candidate_audit_start_at")
    _validate_optional_uuid(values, "user_id")
    _validate_optional_text(values, "account_key")
    _validate_optional_raw_archive(
        values,
        repository_root=Path(repository_root) if repository_root is not None else None,
        protected_roots=protected_roots,
    )
    _validate_mode(values, "buy_projection_mode")
    _validate_mode(values, "sell_projection_mode")
    _validate_mode(values, "notification_mode")
    _positive_integer(values, "outbox_lease_seconds")
    _positive_integer(values, "outbox_max_attempts")
    retry_base = _positive_integer(values, "outbox_retry_base_seconds")
    retry_max = _positive_integer(values, "outbox_retry_max_seconds")
    if retry_max < retry_base:
        raise ConfigError("outbox_retry_max_seconds must be >= outbox_retry_base_seconds")
    if values["pnl_projection_basis"] not in {None, "GROSS", "NET"}:
        raise ConfigError("pnl_projection_basis must be GROSS, NET, or null")
    if not isinstance(values["price_adjustment_verified"], bool):
        raise ConfigError("price_adjustment_verified must be boolean")

    _validate_rules(values)
    _validate_activation_gates(values)


def _validate_optional_timestamp(values: Mapping[str, Any], key: str) -> None:
    if values[key] is not None:
        try:
            parse_aware_datetime(values[key], field_name=key)
        except DomainValidationError as exc:
            raise ConfigError(str(exc)) from exc


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ConfigError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze(child_value) for key, child_value in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, tuple):
        return tuple(_freeze(item) for item in value)
    return value


def _validate_exact_keys(values: Mapping[str, Any], expected: frozenset[str], label: str) -> None:
    missing = expected - values.keys()
    unknown = values.keys() - expected
    if missing:
        raise ConfigError(f"missing required {label} keys: {', '.join(sorted(missing))}")
    if unknown:
        raise ConfigError(f"unknown {label} keys: {', '.join(sorted(unknown))}")


def _validate_optional_uuid(values: Mapping[str, Any], key: str) -> None:
    value = values[key]
    if value is None:
        return
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{key} must be a UUID string or null")
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise ConfigError(f"{key} must be a UUID string or null") from exc


def _validate_optional_text(values: Mapping[str, Any], key: str) -> None:
    if values[key] is not None and (not isinstance(values[key], str) or not values[key].strip()):
        raise ConfigError(f"{key} must be a non-empty string or null")


def _validate_optional_raw_archive(
    values: Mapping[str, Any],
    *,
    repository_root: Path | None,
    protected_roots: Sequence[str | Path],
) -> None:
    value = values["raw_archive_dir"]
    if value is None:
        return
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ConfigError("raw_archive_dir must be an absolute path or null")
    if repository_root is None:
        raise ConfigError("raw_archive_dir requires an explicit repository_root")
    archive = Path(value)
    if not archive.exists() or not archive.is_dir():
        raise ConfigError("raw_archive_dir must be an existing directory")
    if stat.S_IMODE(archive.stat().st_mode) != 0o700:
        raise ConfigError("raw_archive_dir must have mode 0700")
    resolved_archive = archive.resolve()
    for root in (repository_root, *[Path(root) for root in protected_roots]):
        if _is_relative_to(resolved_archive, root.resolve()):
            raise ConfigError("raw_archive_dir must be outside repository and protected roots")


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _validate_mode(values: Mapping[str, Any], key: str) -> None:
    if values[key] not in {"SHADOW", "LIVE"}:
        raise ConfigError(f"{key} must be SHADOW or LIVE")


def _positive_integer(values: Mapping[str, Any], key: str) -> int:
    value = values[key]
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ConfigError(f"{key} must be a positive integer")
    return value


def _rule(values: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    rule = values[key]
    if not isinstance(rule, Mapping):
        raise ConfigError(f"{key} must be an object")
    expected_keys, allowed_statuses = RULE_SCHEMAS[key]
    _validate_exact_keys(rule, expected_keys, key)
    status = rule["status"]
    if status not in allowed_statuses:
        raise ConfigError(f"{key}.status must be one of {', '.join(sorted(allowed_statuses))}")
    return rule


def _decimal_parameter(rule: Mapping[str, Any], key: str, *, allow_null: bool = False) -> Decimal | None:
    value = rule[key]
    if value is None and allow_null:
        return None
    try:
        return parse_decimal(value, field_name=key)
    except DomainValidationError as exc:
        raise ConfigError(str(exc)) from exc


def _validate_optional_positive_integer(rule: Mapping[str, Any], key: str, *, rule_code: str) -> None:
    value = rule[key]
    if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value <= 0):
        raise ConfigError(f"{rule_code}.{key} must be positive integer or null")


def _validate_ratio_range(value: Decimal, *, field_name: str, allow_zero: bool) -> None:
    if value > Decimal("1") or (value < Decimal("0") if allow_zero else value <= Decimal("0")):
        lower = ">=" if allow_zero else ">"
        raise ConfigError(f"{field_name} must be {lower} 0 and <= 1")


def _validate_rules(values: Mapping[str, Any]) -> None:
    long_trend = _rule(values, "RR-LT-001")
    if long_trend["daily_method"] != "WMA" or long_trend["daily_period"] != 150:
        raise ConfigError("RR-LT-001 must use daily WMA period 150")
    if long_trend["weekly_period"] != 30:
        raise ConfigError("RR-LT-001.weekly_period must be 30")
    if long_trend["weekly_method"] not in {None, "WMA", "SMA"}:
        raise ConfigError("RR-LT-001.weekly_method must be WMA, SMA, or null")
    if long_trend["include_partial_week"] not in {None, True, False}:
        raise ConfigError("RR-LT-001.include_partial_week must be boolean or null")

    for code, expected_ratio in (("RR-ALLOC-001", INITIAL_ALLOCATION_MAX), ("RR-CONC-001", MAX_SYMBOL_WEIGHT)):
        rule = _rule(values, code)
        if _decimal_parameter(rule, "max_ratio") != expected_ratio:
            raise ConfigError(f"{code}.max_ratio must equal {expected_ratio}")
        _validate_optional_positive_integer(rule, "account_snapshot_max_age_seconds", rule_code=code)

    stop = _rule(values, "RR-STOP-001")
    if _decimal_parameter(stop, "loss_ratio") != INITIAL_STOP_LOSS:
        raise ConfigError(f"RR-STOP-001.loss_ratio must equal {INITIAL_STOP_LOSS}")
    _validate_optional_positive_integer(stop, "quote_max_age_seconds", rule_code="RR-STOP-001")
    if stop["session"] != "REGULAR":
        raise ConfigError("RR-STOP-001.session must be REGULAR")

    add = _rule(values, "RR-ADD-001")
    if add["reference"] not in {None, "INITIAL_ENTRY", "LAST_ADD", "GROUP_AVG"}:
        raise ConfigError("RR-ADD-001.reference must be INITIAL_ENTRY, LAST_ADD, GROUP_AVG, or null")

    add_guide = _rule(values, "RR-ADD-GUIDE-001")
    levels = add_guide["levels"]
    if not isinstance(levels, list) or not levels:
        raise ConfigError("RR-ADD-GUIDE-001.levels must be a non-empty list")
    parsed_levels = [_decimal_parameter({"value": level}, "value") for level in levels]
    for level in parsed_levels:
        assert level is not None
        _validate_ratio_range(level, field_name="RR-ADD-GUIDE-001.levels", allow_zero=False)
    if parsed_levels != sorted(parsed_levels) or len(set(parsed_levels)) != len(parsed_levels):
        raise ConfigError("RR-ADD-GUIDE-001.levels must be strictly increasing")
    quantity_fraction = _decimal_parameter(add_guide, "quantity_fraction")
    assert quantity_fraction is not None
    _validate_ratio_range(quantity_fraction, field_name="RR-ADD-GUIDE-001.quantity_fraction", allow_zero=False)
    tolerance = _decimal_parameter(add_guide, "tolerance", allow_null=True)
    if tolerance is not None:
        _validate_ratio_range(tolerance, field_name="RR-ADD-GUIDE-001.tolerance", allow_zero=True)

    _rule(values, "RR-BE-001")


def _validate_activation_gates(values: Mapping[str, Any]) -> None:
    if any(values[key] == "LIVE" for key in ("buy_projection_mode", "sell_projection_mode", "notification_mode")):
        raise ConfigError("LIVE modes require P1A-02A machine-verifiable activation evidence")
    active_rules = [code for code in RULE_KEYS if values[code]["status"] == "ACTIVE"]
    if active_rules:
        raise ConfigError("ACTIVE rules require P1A-02A machine-verifiable activation evidence: " + ", ".join(sorted(active_rules)))
