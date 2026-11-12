"""Timestamp helpers. All stored instants are UTC strings 'YYYY-MM-DDTHH:MM:SSZ'.

The fixed-width format means plain string comparison in SQL
(`completed_at_utc >= ? AND completed_at_utc < ?`) orders correctly in time.
"""

from datetime import UTC, datetime

UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def to_utc_iso(dt: datetime) -> str:
    """Aware datetime -> 'YYYY-MM-DDTHH:MM:SSZ' (UTC, whole seconds)."""
    if dt.tzinfo is None:
        raise ValueError("naive datetime is not allowed")
    return dt.astimezone(UTC).strftime(UTC_FORMAT)


def parse_utc_iso(value: str) -> datetime:
    """Inverse of to_utc_iso. Returns an aware UTC datetime."""
    return datetime.strptime(value, UTC_FORMAT).replace(tzinfo=UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_now_iso() -> str:
    return to_utc_iso(utc_now())
