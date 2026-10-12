"""Small deterministic domain helpers shared by investment operations modules."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation


class DomainValidationError(ValueError):
    """Raised when a value cannot meet the deterministic domain contract."""


def parse_decimal(value: object, *, field_name: str) -> Decimal:
    """Parse an exact Decimal without accepting binary floating-point inputs."""
    if isinstance(value, bool) or isinstance(value, float):
        raise DomainValidationError(f"{field_name} must be a Decimal string or integer")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise DomainValidationError(f"{field_name} is not a valid Decimal") from exc
    if not parsed.is_finite():
        raise DomainValidationError(f"{field_name} must be finite")
    return parsed


def decimal_to_string(value: Decimal) -> str:
    """Serialize canonical numeric values as non-exponent Decimal strings."""
    if not isinstance(value, Decimal):
        raise DomainValidationError("Decimal serialization requires decimal.Decimal")
    if not value.is_finite():
        raise DomainValidationError("Decimal serialization requires a finite value")
    return format(value, "f")


def parse_aware_datetime(value: object, *, field_name: str) -> datetime:
    """Parse an ISO-8601 timestamp and normalize it to UTC.

    Naive timestamps are rejected rather than silently treated as KST or UTC.
    """
    if not isinstance(value, str) or not value:
        raise DomainValidationError(f"{field_name} must be an ISO-8601 timestamp string")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise DomainValidationError(f"{field_name} is not a valid ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise DomainValidationError(f"{field_name} must include a timezone offset")
    return parsed.astimezone(timezone.utc)


def utc_isoformat(value: datetime) -> str:
    """Serialize a timezone-aware datetime in the UTC Z format required by contracts."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise DomainValidationError("datetime serialization requires timezone-aware value")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
