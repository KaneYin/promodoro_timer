"""Focus and Screen Time leaderboards (design doc 4.3, 9)."""

import sqlite3
from datetime import date, datetime

from app import config
from app.periods import PeriodWindow, resolve_window, today_local
from app.schemas import (
    LeaderboardEntry,
    LeaderboardOut,
    Metric,
    Order,
    Period,
)
from app.timeutil import to_utc_iso, utc_now


def default_order(metric: Metric) -> Order:
    """Focus: longest first. Screen Time: least first (design doc 4.3)."""
    return "desc" if metric == "focus" else "asc"


def get_leaderboard(
    conn: sqlite3.Connection,
    metric: Metric,
    period: Period,
    anchor: date | None,
    order: Order | None,
) -> LeaderboardOut:
    """Assemble the response. Provided; the three helpers below are yours."""
    anchor = anchor or today_local()
    order = order or default_order(metric)
    now = utc_now()

    window = resolve_window(period, anchor, config.LEADERBOARD_TZ)
    if metric == "focus":
        entries = focus_entries(conn, window)
    else:
        entries = screen_entries(conn, window, now)

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


def focus_entries(conn: sqlite3.Connection, window: PeriodWindow) -> list[LeaderboardEntry]:
    """One entry per user with the summed focus seconds in the window.

    TODO(core): implement. See docs/implementation-guide.md, item 5.

    Contract:
      - EVERY user appears, including users with no sessions (duration_seconds=0).
      - A session belongs to the window by completed_at_utc in
        [window.start_utc, window.end_utc).
      - data_status is always "available"; rank may be left None (rank_entries sets it);
        last_synced_at_utc and days_with_data stay None.
    """
    raise NotImplementedError("TODO(core): focus_entries")


def screen_entries(
    conn: sqlite3.Connection, window: PeriodWindow, now: datetime
) -> list[LeaderboardEntry]:
    """One entry per user with summed active seconds and an honest data_status.

    TODO(core): implement. See docs/implementation-guide.md, item 6.

    Contract:
      - EVERY user appears. Join users -> devices -> screen_usage_daily on
        usage_date in [window.start_date, window.end_date_exclusive).
      - No rows at all in the window  -> data_status "no_data", duration_seconds None.
        (Missing data is NOT zero. A row with active_seconds = 0 IS real zero.)
      - Rows exist                    -> duration_seconds = SUM(active_seconds),
        days_with_data = COUNT(rows), last_synced_at_utc = MAX(synced_at_utc).
      - If the window contains today (leaderboard timezone) and
        now - last_synced_at_utc > config.SCREEN_STALE_AFTER_SECONDS
        -> data_status "stale", otherwise "available". Windows fully in the past
        are never "stale".
    """
    raise NotImplementedError("TODO(core): screen_entries")


def rank_entries(entries: list[LeaderboardEntry], order: Order) -> list[LeaderboardEntry]:
    """Sort entries and assign ranks.

    TODO(core): implement. See docs/implementation-guide.md, item 7.

    Contract:
      - Ranked group: data_status == "available", sorted by duration_seconds in `order`.
        Ties share a rank and the next rank skips (1, 1, 3). Ties break by user_id
        in the returned list so the output is deterministic.
      - "stale" entries are NOT ranked (rank None; design doc 9.2). Keep their
        duration for display. They follow the ranked group.
      - "no_data" entries are NOT ranked (rank None) and come last.
      - Return a new list; do not depend on the input order.
    """
    raise NotImplementedError("TODO(core): rank_entries")
