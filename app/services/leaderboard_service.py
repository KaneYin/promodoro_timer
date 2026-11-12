"""Calendar aggregation and competition ranking; incomplete data never wins."""

import sqlite3
from datetime import date, datetime, timedelta

from app import config
from app.periods import PeriodWindow, resolve_window, today_local
from app.schemas import LeaderboardEntry, LeaderboardOut, Metric, Order, Period
from app.timeutil import parse_utc_iso, to_utc_iso, utc_now


def default_order(metric: Metric) -> Order:
    return "desc" if metric == "focus" else "asc"


def get_leaderboard(
    conn: sqlite3.Connection,
    metric: Metric,
    period: Period,
    anchor: date | None,
    order: Order | None,
) -> LeaderboardOut:
    anchor, order, now = (
        anchor or today_local(),
        order or default_order(metric),
        utc_now(),
    )
    window = resolve_window(period, anchor, config.LEADERBOARD_TZ)
    entries = (
        focus_entries(conn, window)
        if metric == "focus"
        else screen_entries(conn, window, now)
    )
    return LeaderboardOut(
        metric=metric,
        period=period,
        period_start=window.start_date,
        period_end_exclusive=window.end_date_exclusive,
        timezone=config.LEADERBOARD_TZ_NAME,
        order=order,
        generated_at_utc=to_utc_iso(now),
        entries=rank_entries(entries, order),
    )


def focus_entries(
    conn: sqlite3.Connection, window: PeriodWindow
) -> list[LeaderboardEntry]:
    """Time predicates belong in ON, preserving users without matching sessions."""
    rows = conn.execute(
        """SELECT u.id, u.display_name, COALESCE(SUM(f.focus_seconds), 0) AS seconds
           FROM users u LEFT JOIN focus_sessions f ON f.user_id = u.id
             AND f.completed_at_utc >= ? AND f.completed_at_utc < ?
           GROUP BY u.id ORDER BY u.id""",
        (to_utc_iso(window.start_utc), to_utc_iso(window.end_utc)),
    ).fetchall()
    return [
        LeaderboardEntry(
            user_id=r["id"],
            display_name=r["display_name"],
            duration_seconds=r["seconds"],
            rank=None,
            data_status="available",
        )
        for r in rows
    ]


def screen_entries(
    conn: sqlite3.Connection, window: PeriodWindow, now: datetime
) -> list[LeaderboardEntry]:
    """Require a fresh today row for current windows and all elapsed dates for ranking."""
    today = now.astimezone(config.LEADERBOARD_TZ).date()
    elapsed_end = min(window.end_date_exclusive, today + timedelta(days=1))
    expected = max(0, (elapsed_end - window.start_date).days)
    contains_today = window.start_date <= today < window.end_date_exclusive
    rows = conn.execute(
        """SELECT u.id, u.display_name, s.usage_date, s.active_seconds,
                  s.collected_at_utc, s.synced_at_utc
           FROM users u LEFT JOIN devices d ON d.user_id = u.id
           LEFT JOIN screen_usage_daily s ON s.device_id = d.id
             AND s.usage_date >= ? AND s.usage_date < ?
           ORDER BY u.id, s.usage_date""",
        (window.start_date.isoformat(), elapsed_end.isoformat()),
    ).fetchall()
    groups = {}
    for row in rows:
        groups.setdefault(row["id"], {"name": row["display_name"], "days": []})
        if row["usage_date"] is not None:
            groups[row["id"]]["days"].append(row)
    entries = []
    for user_id, group in groups.items():
        days = group["days"]
        current = next((r for r in days if r["usage_date"] == today.isoformat()), None)
        last_sync = (
            (current["synced_at_utc"] if current else None)
            if contains_today
            else max(
                (r["synced_at_utc"] for r in days),
                default=None,
            )
        )
        if not days:
            status = "no_data"
        elif contains_today and (
            current is None
            or any(
                (now - parse_utc_iso(current[key])).total_seconds()
                > config.SCREEN_STALE_AFTER_SECONDS
                for key in ("collected_at_utc", "synced_at_utc")
            )
        ):
            status = "stale"
        elif len(days) < expected:
            status = "partial"
        else:
            status = "available"
        entries.append(
            LeaderboardEntry(
                user_id=user_id,
                display_name=group["name"],
                duration_seconds=sum(r["active_seconds"] for r in days)
                if days
                else None,
                rank=None,
                data_status=status,
                last_synced_at_utc=last_sync,
                days_with_data=len(days),
                days_expected=expected,
            )
        )
    return entries


def rank_entries(
    entries: list[LeaderboardEntry], order: Order
) -> list[LeaderboardEntry]:
    """Return copies; ties use competition ranks (1, 1, 3) and stable user ids."""
    available = sorted(
        (e for e in entries if e.data_status == "available"),
        key=lambda e: ((-1 if order == "desc" else 1) * e.duration_seconds, e.user_id),
    )
    result, previous, rank = [], None, 0
    for index, entry in enumerate(available, start=1):
        if entry.duration_seconds != previous:
            rank = index
        result.append(entry.model_copy(update={"rank": rank}))
        previous = entry.duration_seconds
    for status in ("partial", "stale", "no_data"):
        result.extend(
            e.model_copy(update={"rank": None})
            for e in sorted(entries, key=lambda e: e.user_id)
            if e.data_status == status
        )
    return result
