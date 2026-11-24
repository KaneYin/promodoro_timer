"""Shared chart totals by active interval and local calendar bucket."""

import sqlite3
from datetime import date, timedelta

from app import config
from app.periods import PeriodWindow, local_midnight_utc, resolve_window, today_local
from app.schemas import (
    FocusDatesOut,
    FocusStatsBucket,
    FocusStatsOut,
    FocusStatsSeries,
    Period,
)
from app.services.focus_intervals import load_focus_intervals
from app.services.focus_rhythm_service import get_focus_rhythms
from app.timeutil import parse_utc_iso, to_utc_iso, utc_now_iso

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def get_focus_dates(conn: sqlite3.Connection) -> FocusDatesOut:
    dates = set()
    for session in load_focus_intervals(conn):
        for started, ended in session.segments:
            start = started.astimezone(config.LEADERBOARD_TZ).date()
            last = (
                (ended - timedelta(microseconds=1))
                .astimezone(config.LEADERBOARD_TZ)
                .date()
            )
            while start <= last:
                dates.add(start)
                if start == last:
                    break
                start += timedelta(days=1)
    return FocusDatesOut(
        timezone=config.LEADERBOARD_TZ_NAME, dates=sorted(dates, reverse=True)
    )


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
    boundaries = [parse_utc_iso(bucket.start_utc) for bucket in buckets] + [
        window.end_utc
    ]
    # Session counts still record how many sessions were completed in the period.
    rows = conn.execute(
        """SELECT u.id, u.display_name, COUNT(f.id) AS session_count
           FROM users u LEFT JOIN focus_sessions f ON f.user_id = u.id
             AND f.completed_at_utc >= ? AND f.completed_at_utc < ?
           GROUP BY u.id ORDER BY u.id""",
        (to_utc_iso(window.start_utc), to_utc_iso(window.end_utc)),
    )
    series = {
        row["id"]: FocusStatsSeries(
            user_id=row["id"],
            display_name=row["display_name"],
            duration_seconds=[0] * len(buckets),
            total_seconds=0,
            session_count=row["session_count"],
        )
        for row in rows
    }
    for session in load_focus_intervals(conn, window.start_utc, window.end_utc):
        item = series[session.user_id]
        for index, seconds in enumerate(session.bucket_seconds(boundaries)):
            item.duration_seconds[index] += seconds
            item.total_seconds += seconds
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
