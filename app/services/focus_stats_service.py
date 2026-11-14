"""Shared chart data, using exactly the completion-date policy of Focus rankings.

Chart bars retain completion attribution. Rhythm cards separately split active
intervals (or disclosed legacy estimates), so calendar-boundary totals may differ.
"""

import sqlite3
from bisect import bisect_right
from datetime import date, datetime, timedelta

from app import config
from app.periods import PeriodWindow, local_midnight_utc, resolve_window, today_local
from app.schemas import (
    FocusDatesOut,
    FocusStatsBucket,
    FocusStatsOut,
    FocusStatsSeries,
    Period,
)
from app.timeutil import parse_utc_iso, to_utc_iso, utc_now_iso
from app.services.focus_rhythm_service import get_focus_rhythms

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def get_focus_dates(conn: sqlite3.Connection) -> FocusDatesOut:
    # SQLite's localtime modifier follows the host timezone, not our chart zone.
    # Convert each completion with ZoneInfo, then deduplicate dates in SQL.
    conn.create_function(
        "focus_local_date",
        1,
        lambda value: (
            parse_utc_iso(value).astimezone(config.LEADERBOARD_TZ).date().isoformat()
        ),
        deterministic=True,
    )
    rows = conn.execute(
        """SELECT DISTINCT focus_local_date(completed_at_utc) AS day
           FROM focus_sessions ORDER BY day DESC"""
    ).fetchall()
    dates = {date.fromisoformat(row["day"]) for row in rows}
    # Rhythm can include the day before completion. Keep these days reachable
    # from the shared history menu, including segment-free legacy estimates.
    intervals = conn.execute(
        """SELECT COALESCE(s.started_at_utc, f.started_at_utc) AS start,
                  COALESCE(s.ended_at_utc, f.completed_at_utc) AS end
           FROM focus_sessions f LEFT JOIN focus_session_segments s ON s.session_id = f.id"""
    )
    for interval in intervals:
        start = datetime.fromisoformat(interval["start"]).astimezone(config.LEADERBOARD_TZ).date()
        last = (datetime.fromisoformat(interval["end"]) - timedelta(microseconds=1)).astimezone(config.LEADERBOARD_TZ).date()
        while start <= last:
            dates.add(start)
            start += timedelta(days=1)
    return FocusDatesOut(timezone=config.LEADERBOARD_TZ_NAME, dates=sorted(dates, reverse=True))


def chart_buckets(window: PeriodWindow) -> list[FocusStatsBucket]:
    buckets = []
    if window.period == "day":
        # Step through UTC instants, so a DST date has 23 or 25 real hours.
        # Include the zone abbreviation to distinguish repeated fall-back hours.
        start = window.start_utc
        while start < window.end_utc:
            end = min(start + timedelta(hours=1), window.end_utc)
            local = start.astimezone(config.LEADERBOARD_TZ)
            buckets.append(
                FocusStatsBucket(
                    label=local.strftime("%H:%M %Z"),
                    start_utc=to_utc_iso(start),
                    end_utc=to_utc_iso(end),
                )
            )
            start = end
        return buckets

    start = window.start_date
    while start < window.end_date_exclusive:
        if window.period == "week":
            end = start + timedelta(days=1)
            label = f"{WEEKDAYS[start.weekday()]} {start.month}/{start.day}"
        else:
            # Monday-aligned weeks, clipped at month boundaries. A partial first
            # or last week contains only the dates that belong to this month.
            end = min(
                start + timedelta(days=7 - start.weekday()), window.end_date_exclusive
            )
            last = end - timedelta(days=1)
            label = (
                f"{start.month}/{start.day}"
                if start == last
                else f"{start.month}/{start.day}-{last.month}/{last.day}"
            )
        buckets.append(
            FocusStatsBucket(
                label=label,
                start_utc=to_utc_iso(local_midnight_utc(start)),
                end_utc=to_utc_iso(local_midnight_utc(end)),
            )
        )
        start = end
    return buckets


def get_focus_stats(
    conn: sqlite3.Connection, period: Period, anchor: date | None
) -> FocusStatsOut:
    window = resolve_window(period, anchor or today_local())
    buckets = chart_buckets(window)
    starts = [bucket.start_utc for bucket in buckets]
    # One SELECT gives both users a consistent snapshot. Filters in ON preserve
    # users with zero sessions; existing (user_id, completed_at_utc) index applies.
    rows = conn.execute(
        """SELECT u.id, u.display_name, f.completed_at_utc, f.focus_seconds
           FROM users u LEFT JOIN focus_sessions f ON f.user_id = u.id
             AND f.completed_at_utc >= ? AND f.completed_at_utc < ?
           ORDER BY u.id, f.completed_at_utc""",
        (to_utc_iso(window.start_utc), to_utc_iso(window.end_utc)),
    ).fetchall()
    series = {}
    for row in rows:
        item = series.setdefault(
            row["id"],
            FocusStatsSeries(
                user_id=row["id"],
                display_name=row["display_name"],
                duration_seconds=[0] * len(buckets),
                total_seconds=0,
                session_count=0,
            ),
        )
        if row["completed_at_utc"] is not None:
            index = bisect_right(starts, row["completed_at_utc"]) - 1
            item.duration_seconds[index] += row["focus_seconds"]
            item.total_seconds += row["focus_seconds"]
            item.session_count += 1
    rhythms = get_focus_rhythms(conn, window)
    for user_id, item in series.items():
        item.rhythm = rhythms[user_id]
    return FocusStatsOut(
        period=period,
        period_start=window.start_date,
        period_end_exclusive=window.end_date_exclusive,
        timezone=config.LEADERBOARD_TZ_NAME,
        bucket_unit={"day": "hour", "week": "day", "month": "week"}[period],
        generated_at_utc=utc_now_iso(),
        buckets=buckets,
        series=list(series.values()),
    )
