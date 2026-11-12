"""Store daily snapshots, accepting newer collections even when totals decrease."""

import sqlite3
from datetime import timedelta

from app import config
from app.errors import InvalidDataError, NotFoundError
from app.periods import today_local
from app.schemas import ScreenUsageIn, ScreenUsageSavedOut
from app.timeutil import to_utc_iso, utc_now, utc_now_iso


def upsert_daily_usage(
    conn: sqlite3.Connection, payload: ScreenUsageIn
) -> ScreenUsageSavedOut:
    device_id = str(payload.device_id)
    collected = to_utc_iso(payload.collected_at_utc)
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        if (
            conn.execute("SELECT 1 FROM devices WHERE id = ?", (device_id,)).fetchone()
            is None
        ):
            raise NotFoundError("Device does not exist", code="device_not_found")
        if payload.active_seconds > config.SCREEN_MAX_DAILY_SECONDS:
            raise InvalidDataError(
                "Daily usage exceeds 25 hours", code="usage_too_large"
            )
        if payload.usage_date > today_local():
            raise InvalidDataError("Usage date is in the future", code="time_in_future")
        if payload.collected_at_utc > utc_now() + timedelta(
            seconds=config.CLOCK_SKEW_TOLERANCE_SECONDS
        ):
            raise InvalidDataError(
                "Collection time is in the future", code="time_in_future"
            )
        existing = conn.execute(
            "SELECT collected_at_utc FROM screen_usage_daily WHERE device_id = ? AND usage_date = ?",
            (device_id, payload.usage_date.isoformat()),
        ).fetchone()
        if existing and collected <= existing["collected_at_utc"]:
            result = "ignored_stale"
        else:
            conn.execute(
                """INSERT INTO screen_usage_daily
                   (device_id, usage_date, active_seconds, collected_at_utc, synced_at_utc)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(device_id, usage_date) DO UPDATE SET
                     active_seconds = excluded.active_seconds,
                     collected_at_utc = excluded.collected_at_utc,
                     synced_at_utc = excluded.synced_at_utc""",
                (
                    device_id,
                    payload.usage_date.isoformat(),
                    payload.active_seconds,
                    collected,
                    utc_now_iso(),
                ),
            )
            result = "updated" if existing else "created"
    return ScreenUsageSavedOut(
        device_id=payload.device_id, usage_date=payload.usage_date, result=result
    )
