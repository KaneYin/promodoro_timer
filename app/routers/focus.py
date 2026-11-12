from datetime import date

from fastapi import APIRouter

from app.database import Db
from app.schemas import FocusSessionIn, FocusSessionOut, FocusSessionSavedOut
from app.services import focus_service

router = APIRouter(prefix="/api", tags=["focus"])


@router.post("/focus-sessions", response_model=FocusSessionSavedOut)
def create_focus_session(payload: FocusSessionIn, db: Db):
    """Save one completed Focus Session. Idempotent per session UUID."""
    return focus_service.save_focus_session(db, payload)


@router.get("/focus-sessions", response_model=list[FocusSessionOut])
def list_focus_sessions(
    db: Db,
    user_id: int,
    start_date: date | None = None,
    end_date: date | None = None,
):
    """Sessions completed by `user_id`; dates are inclusive local dates (America/Chicago)."""
    return focus_service.list_focus_sessions(db, user_id, start_date, end_date)
