from datetime import date as date_type

from fastapi import APIRouter

from app.database import Db
from app.schemas import LeaderboardOut, Metric, Order, Period
from app.services import leaderboard_service

router = APIRouter(prefix="/api", tags=["leaderboards"])


@router.get("/leaderboards", response_model=LeaderboardOut)
def get_leaderboard(
    db: Db,
    metric: Metric,
    period: Period,
    date: date_type | None = None,
    order: Order | None = None,
):
    """Ranking for the day/week/month containing `date` (default: today, America/Chicago).

    `order` defaults to desc for focus and asc for screen.
    """
    return leaderboard_service.get_leaderboard(db, metric, period, date, order)
