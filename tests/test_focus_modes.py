"""Count-up sessions share the existing history, ranking and retry contracts."""

from uuid import uuid4

import pytest

from app import database


def countup(seconds=42, **overrides):
    return (
        dict(
            id=str(uuid4()),
            user_id=1,
            mode="countup",
            started_at_utc="2026-11-11T15:00:00Z",
            completed_at_utc="2026-11-11T17:00:00Z",
            focus_seconds=seconds,
            target_seconds=7200,
        )
        | overrides
    )


@pytest.mark.parametrize("seconds", [1, 42, 3600, 7200])
def test_countup_saves_actual_duration_as_one_session(client, seconds):
    body = countup(seconds)
    assert client.post("/api/focus-sessions", json=body).status_code == 200
    assert client.post("/api/focus-sessions", json=body).status_code == 200
    history = client.get(
        "/api/focus-sessions?user_id=1&start_date=2026-11-11&end_date=2026-11-11"
    ).json()
    assert len(history) == 1
    assert (
        history[0]["mode"],
        history[0]["focus_seconds"],
        history[0]["target_seconds"],
    ) == ("countup", seconds, 7200)
    entries = client.get(
        "/api/leaderboards?metric=focus&period=day&date=2026-11-11"
    ).json()["entries"]
    assert entries[0]["duration_seconds"] == seconds


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"focus_seconds": 7201}, "focus_out_of_range"),
        ({"target_seconds": 3600}, "target_out_of_range"),
        ({"completed_at_utc": "2026-11-11T15:00:01Z"}, "invalid_time_span"),
    ],
)
def test_countup_validation(client, changes, code):
    response = client.post("/api/focus-sessions", json=countup(**changes))
    assert (response.status_code, response.json()["code"]) == (422, code)


def test_countup_zero_and_unknown_mode_are_shape_errors(client):
    for changes in ({"focus_seconds": 0}, {"mode": "other"}):
        assert (
            client.post("/api/focus-sessions", json=countup(**changes)).status_code
            == 422
        )


def test_countup_belongs_to_stop_day_even_if_started_yesterday(client):
    body = countup(
        90,
        started_at_utc="2026-11-11T05:59:00Z",
        completed_at_utc="2026-11-11T06:01:00Z",
    )
    assert client.post("/api/focus-sessions", json=body).status_code == 200
    assert (
        client.get(
            "/api/focus-sessions?user_id=1&start_date=2026-11-10&end_date=2026-11-10"
        ).json()
        == []
    )
    assert (
        len(
            client.get(
                "/api/focus-sessions?user_id=1&start_date=2026-11-11&end_date=2026-11-11"
            ).json()
        )
        == 1
    )


def test_mode_is_part_of_immutable_session_content(client):
    body = countup(7200)
    assert client.post("/api/focus-sessions", json=body).status_code == 200
    assert (
        client.post("/api/focus-sessions", json=body | {"mode": "pomodoro"}).status_code
        == 409
    )


def test_existing_database_migration_preserves_old_rows(tmp_path):
    path = tmp_path / "legacy.db"
    db = database.connect(path)
    db.executescript("""
        CREATE TABLE focus_sessions (
            id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
            started_at_utc TEXT NOT NULL, completed_at_utc TEXT NOT NULL,
            focus_seconds INTEGER NOT NULL, target_seconds INTEGER NOT NULL
        );
        INSERT INTO focus_sessions VALUES (
            'legacy', 1, '2026-11-11T15:00:00Z', '2026-11-11T15:25:00Z', 1500, 1500
        );
    """)
    database.init_db(db)
    database.init_db(db)  # startup migration is safe to repeat
    row = dict(
        db.execute("SELECT * FROM focus_sessions WHERE id = 'legacy'").fetchone()
    )
    assert (row["mode"], row["focus_seconds"], row["target_seconds"]) == (
        "pomodoro",
        1500,
        1500,
    )
    assert db.execute("SELECT COUNT(*) FROM focus_sessions").fetchone()[0] == 1
    db.close()
