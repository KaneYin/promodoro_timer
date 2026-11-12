from datetime import date

import pytest

from app.periods import resolve_window
from app.schemas import LeaderboardEntry
from app.services.leaderboard_service import rank_entries
from app.timeutil import parse_utc_iso, to_utc_iso


@pytest.mark.parametrize(
    "anchor,hours",
    [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25), (date(2026, 11, 12), 24)],
)
def test_dst_days(anchor, hours):
    window = resolve_window("day", anchor)
    assert (window.end_utc - window.start_utc).total_seconds() == hours * 3600


def test_week_month_and_year_rollover():
    window = resolve_window("week", date(2026, 11, 1))
    assert (window.start_date, window.end_date_exclusive) == (
        date(2026, 10, 26),
        date(2026, 11, 2),
    )
    assert (window.end_utc - window.start_utc).total_seconds() == 169 * 3600
    window = resolve_window("month", date(2026, 12, 25))
    assert window.end_date_exclusive == date(2027, 1, 1)
    assert resolve_window("month", date(2028, 2, 29)).end_date_exclusive == date(
        2028, 3, 1
    )


def test_competition_ranking_copies_and_status_partition():
    def entry(uid, seconds, status="available"):
        return LeaderboardEntry(
            user_id=uid,
            display_name=str(uid),
            duration_seconds=seconds,
            rank=None,
            data_status=status,
        )

    rows = [
        entry(3, 10),
        entry(2, 20),
        entry(1, 20),
        entry(4, 0, "partial"),
        entry(5, 0, "stale"),
        entry(6, None, "no_data"),
    ]
    ranked = rank_entries(rows, "desc")
    assert [(e.user_id, e.rank) for e in ranked] == [
        (1, 1),
        (2, 1),
        (3, 3),
        (4, None),
        (5, None),
        (6, None),
    ]
    assert all(e.rank is None for e in rows)
    assert [e.rank for e in rank_entries(rows, "asc")[:3]] == [1, 2, 2]


def test_fixed_width_year_roundtrip():
    assert to_utc_iso(parse_utc_iso("0001-01-01T00:00:00Z")) == "0001-01-01T00:00:00Z"
