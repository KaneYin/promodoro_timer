"""Calendar windows in the leaderboard timezone (design doc 4.4).

Shared by focus_service (history range) and leaderboard_service (rankings).
"""

from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app import config
from app.schemas import Period


@dataclass(frozen=True)
class PeriodWindow:
    period: Period
    start_date: date  # local calendar date, inclusive
    end_date_exclusive: date  # local calendar date, exclusive
    start_utc: datetime  # aware, UTC. Local midnight of start_date.
    end_utc: datetime  # aware, UTC. Local midnight of end_date_exclusive.


def today_local(tz: ZoneInfo = config.LEADERBOARD_TZ) -> date:
    return datetime.now(tz).date()


def local_midnight_utc(d: date, tz: ZoneInfo = config.LEADERBOARD_TZ) -> datetime:
    """The instant (aware, UTC) at which local calendar day `d` begins in `tz`.

    TODO(core): implement. See docs/implementation-guide.md, item 1.

    Rules:
      - Build the local midnight with a timezone-aware datetime, then convert to UTC.
      - Never compute "start + 24h". A DST day is 23 or 25 hours long.
    """
    raise NotImplementedError("TODO(core): local_midnight_utc")


def resolve_window(
    period: Period, anchor: date, tz: ZoneInfo = config.LEADERBOARD_TZ
) -> PeriodWindow:
    """The day/week/month that contains local date `anchor`.

    TODO(core): implement. See docs/implementation-guide.md, item 1.

    Rules:
      - day:   [anchor, anchor + 1 day)
      - week:  Monday of anchor's week .. next Monday (exclusive)
      - month: first of anchor's month .. first of next month (exclusive)
      - start_utc / end_utc are the local midnights of the boundaries, via
        local_midnight_utc(), so a DST week/month has the right length.
    """
    raise NotImplementedError("TODO(core): resolve_window")
