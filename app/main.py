"""FastAPI application: JSON API under /api, static frontend at /."""

import logging
import sqlite3
from contextlib import asynccontextmanager
from hashlib import sha256

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import config, database
from app.errors import AppError
from app.routers import focus, focus_stats, health, leaderboard, screen_time, users


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


for module in (health, users, focus, focus_stats, screen_time, leaderboard):
    app.include_router(module.router)


class RevalidatedStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Version the entire module graph, not just app.js. Relative imports inherit
# this prefix, so an updated entry point cannot import an old cached api.js.
# Recompute on server restart; no frontend build tool is required.
asset_hash = sha256()
for asset in sorted(config.STATIC_DIR.rglob("*")):
    if asset.is_file() and asset.suffix in {".html", ".css", ".js"}:
        asset_hash.update(asset.relative_to(config.STATIC_DIR).as_posix().encode())
        asset_hash.update(asset.read_bytes())
ASSET_PREFIX = f"/assets/{asset_hash.hexdigest()[:16]}"


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
@app.get("/index.html", response_class=HTMLResponse, include_in_schema=False)
def frontend():
    html = (config.STATIC_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace('href="/css/', f'href="{ASSET_PREFIX}/css/').replace(
        'src="/js/', f'src="{ASSET_PREFIX}/js/'
    )
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


app.mount(
    ASSET_PREFIX,
    RevalidatedStaticFiles(directory=config.STATIC_DIR),
    name="versioned-static",
)

# Must be registered last: a "/" mount would otherwise shadow routes added after it.
app.mount(
    "/", RevalidatedStaticFiles(directory=config.STATIC_DIR, html=True), name="static"
)
