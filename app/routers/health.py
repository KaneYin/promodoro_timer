from fastapi import APIRouter

from app.database import Db
from app.schemas import HealthOut

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthOut)
def health(db: Db):
    db.execute("SELECT 1 FROM users LIMIT 1").fetchone()
    return HealthOut(status="ok", database="connected")
