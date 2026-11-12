"""Calendar windows in the leaderboard timezone (docs/design.md).

Shared by focus_service (history range) and leaderboard_service (rankings).
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app import config
from app.errors import InvalidDataError
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

    Rules:
      - Build the local midnight with a timezone-aware datetime, then convert to UTC.
      - Never compute "start + 24h". A DST day is 23 or 25 hours long.
    """
    return datetime.combine(d, time.min, tzinfo=tz).astimezone(UTC)


def resolve_window(
    period: Period, anchor: date, tz: ZoneInfo = config.LEADERBOARD_TZ
) -> PeriodWindow:
    """The day/week/month that contains local date `anchor`.

    Rules:
      - day:   [anchor, anchor + 1 day)
      - week:  Monday of anchor's week .. next Monday (exclusive)
      - month: first of anchor's month .. first of next month (exclusive)
      - start_utc / end_utc are the local midnights of the boundaries, via
        local_midnight_utc(), so a DST week/month has the right length.
    """
    try:
        if period == "day":
            start, end = anchor, anchor + timedelta(days=1)
        elif period == "week":
            start = anchor - timedelta(days=anchor.weekday())
            end = start + timedelta(days=7)
        elif period == "month":
            start = anchor.replace(day=1)
            end = (
                date(start.year + 1, 1, 1)
                if start.month == 12
                else date(start.year, start.month + 1, 1)
            )
        else:
            raise ValueError("unsupported period")
        return PeriodWindow(
            period,
            start,
            end,
            local_midnight_utc(start, tz),
            local_midnight_utc(end, tz),
        )
    except (OverflowError, ValueError) as exc:
        raise InvalidDataError(
            "Date is outside the supported calendar range", code="invalid_date_range"
        ) from exc
