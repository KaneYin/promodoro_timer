from fastapi import APIRouter

from app.database import Db
from app.schemas import ScreenUsageIn, ScreenUsageSavedOut
from app.services import screen_time_service

router = APIRouter(prefix="/api", tags=["screen-time"])


@router.put("/screen-usage/daily", response_model=ScreenUsageSavedOut)
def put_daily_usage(payload: ScreenUsageIn, db: Db):
    """Upsert one device's cumulative active seconds for one local day."""
    return screen_time_service.upsert_daily_usage(db, payload)
