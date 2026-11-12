from fastapi import APIRouter

from app.database import Db
from app.schemas import UserOut

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/users", response_model=list[UserOut])
def list_users(db: Db):
    """The preset users (no registration, no login in the MVP)."""
    rows = db.execute("SELECT id, display_name FROM users ORDER BY id").fetchall()
    return [UserOut(id=r["id"], display_name=r["display_name"]) for r in rows]
