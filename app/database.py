"""SQLite access: one connection per HTTP request, plain sqlite3, no ORM."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends

from app import config


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open a connection with the project's required settings.

    - Foreign keys are OFF by default in SQLite and are per-connection, so we
      enable them every time.
    - WAL lets readers and the single writer run concurrently.
    - busy_timeout makes a blocked writer wait instead of failing immediately.
    - check_same_thread=False: FastAPI may create the connection in one worker
      thread and use it in another. That is safe here because a connection is
      never shared between requests.
    """
    path = Path(db_path) if db_path else config.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """Create tables and insert the preset users/devices. Idempotent."""
    conn.executescript(config.SCHEMA_PATH.read_text(encoding="utf-8"))
    # Existing databases predate timer modes. ALTER keeps every stored session
    # and gives legacy rows the same default as legacy API requests.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(focus_sessions)")}
    if "mode" not in columns:
        conn.execute(
            "ALTER TABLE focus_sessions ADD COLUMN mode TEXT NOT NULL "
            "DEFAULT 'pomodoro' CHECK (mode IN ('pomodoro', 'countup'))"
        )
    conn.executescript(config.SEED_PATH.read_text(encoding="utf-8"))
    conn.commit()


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: a fresh connection for the lifetime of one request."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


# Use as a route parameter annotation:  def handler(db: Db): ...
Db = Annotated[sqlite3.Connection, Depends(get_db)]
