"""FastAPI application: JSON API under /api, static frontend at /."""

import logging
import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import config, database
from app.errors import AppError
from app.routers import focus, health, leaderboard, screen_time, users


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Idempotent: creates the DB file, tables and preset users/devices if missing.
    conn = database.connect()
    try:
        database.init_db(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="Focus Tracker", version="0.1.0", lifespan=lifespan)


@app.exception_handler(AppError)
async def handle_app_error(_: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code, content={"detail": exc.message, "code": exc.code}
    )


@app.exception_handler(sqlite3.Error)
async def handle_database_error(_: Request, exc: sqlite3.Error):
    # Includes failures establishing a connection in get_db.
    logging.getLogger(__name__).error("Database failure: %s", exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database unavailable", "code": "database_unavailable"},
    )


for module in (health, users, focus, screen_time, leaderboard):
    app.include_router(module.router)

# Must be registered last: a "/" mount would otherwise shadow routes added after it.
app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")
