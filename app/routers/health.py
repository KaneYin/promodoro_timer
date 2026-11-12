from fastapi import APIRouter, HTTPException

from app.database import Db
from app.schemas import HealthOut

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthOut)
def health(db: Db):
    try:
        db.execute("SELECT 1").fetchone()
    except Exception as exc:  # any DB failure means the service is not healthy
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return HealthOut(status="ok", database="connected")
