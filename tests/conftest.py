from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app
from app.services import focus_service, leaderboard_service, screen_time_service

NOW = datetime(2026, 11, 12, 18, tzinfo=UTC)


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "focus.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(focus_service, "utc_now", lambda: NOW)
    monkeypatch.setattr(screen_time_service, "utc_now", lambda: NOW)
    monkeypatch.setattr(
        screen_time_service, "utc_now_iso", lambda: "2026-11-12T18:00:00Z"
    )
    monkeypatch.setattr(screen_time_service, "today_local", lambda: NOW.date())
    monkeypatch.setattr(leaderboard_service, "utc_now", lambda: NOW)
    monkeypatch.setattr(leaderboard_service, "today_local", lambda: NOW.date())
    return path


@pytest.fixture
def conn(db_path):
    db = database.connect(db_path)
    database.init_db(db)
    yield db
    db.close()


@pytest.fixture
def client(db_path):
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
