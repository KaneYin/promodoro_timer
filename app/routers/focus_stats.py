from datetime import date as date_type

from fastapi import APIRouter

from app.database import Db
from app.schemas import FocusDatesOut, FocusStatsOut, Period
from app.services.focus_stats_service import get_focus_dates, get_focus_stats

router = APIRouter(prefix="/api", tags=["focus statistics"])


@router.get("/focus-stats/dates", response_model=FocusDatesOut)
def focus_dates(db: Db):
    """Recorded completion dates across both users, newest first."""
    return get_focus_dates(db)


@router.get("/focus-stats", response_model=FocusStatsOut)
def focus_stats(db: Db, period: Period = "day", date: date_type | None = None):
    """Both users' completed Focus durations in hourly/daily/weekly buckets.

    Independent of the user selected in the browser, just like leaderboards.
    """
    return get_focus_stats(db, period, date)
