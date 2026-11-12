import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from uuid import uuid4

import pytest

from app import database

DEVICE = "15ba172f-e397-4155-8285-6757a75875f1"


def focus(**overrides):
    return (
        dict(
            id=str(uuid4()),
            user_id=1,
            started_at_utc="2026-11-11T15:00:00Z",
            completed_at_utc="2026-11-11T15:25:00Z",
            focus_seconds=1500,
            target_seconds=1500,
        )
        | overrides
    )


def usage(**overrides):
    return (
        dict(
            device_id=DEVICE,
            usage_date="2026-11-12",
            active_seconds=100,
            collected_at_utc="2026-11-12T18:00:00Z",
        )
        | overrides
    )


def test_static_health_users_and_no_data(client):
    assert client.get("/").status_code == 200
    assert client.get("/js/app.js").status_code == 200
    assert client.get("/api/health").json() == {"status": "ok", "database": "connected"}
    assert len(client.get("/api/users").json()) == 2
    assert client.get("/api/focus-sessions", params={"user_id": 1}).json() == []
    for metric in ("focus", "screen"):
        data = client.get(
            "/api/leaderboards", params={"metric": metric, "period": "day"}
        ).json()
        assert len(data["entries"]) == 2
        assert data["order"] == ("desc" if metric == "focus" else "asc")
        assert all(
            e["duration_seconds"] == (0 if metric == "focus" else None)
            for e in data["entries"]
        )
        assert all(
            e["rank"] == (1 if metric == "focus" else None) for e in data["entries"]
        )


def test_focus_retry_offset_normalization_and_conflict(client):
    body = focus()
    assert client.post("/api/focus-sessions", json=body).status_code == 200
    retry = body | {"started_at_utc": "2026-11-11T09:00:00-06:00"}
    assert client.post("/api/focus-sessions", json=retry).status_code == 200
    assert len(client.get("/api/focus-sessions?user_id=1").json()) == 1
    r = client.post("/api/focus-sessions", json=body | {"user_id": 2})
    assert (r.status_code, r.json()["code"]) == (409, "session_conflict")


def test_concurrent_focus_retries_store_one_row(client):
    body = focus()
    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(
            pool.map(
                lambda _: client.post("/api/focus-sessions", json=body).status_code,
                range(8),
            )
        )
    assert statuses == [200] * 8
    assert len(client.get("/api/focus-sessions?user_id=1").json()) == 1


@pytest.mark.parametrize(
    "changes,status,code",
    [
        ({"user_id": 99}, 404, "user_not_found"),
        ({"target_seconds": 10}, 422, "target_out_of_range"),
        ({"focus_seconds": 1400}, 422, "session_not_completed"),
        ({"completed_at_utc": "2026-11-11T15:01:00Z"}, 422, "invalid_time_span"),
        (
            {
                "started_at_utc": "2027-01-01T15:00:00Z",
                "completed_at_utc": "2027-01-01T15:25:00Z",
            },
            422,
            "time_in_future",
        ),
    ],
)
def test_focus_business_rules(client, changes, status, code):
    response = client.post("/api/focus-sessions", json=focus(**changes))
    assert (response.status_code, response.json()["code"]) == (status, code)


@pytest.mark.parametrize(
    "changes",
    [{"id": "bad"}, {"focus_seconds": 0}, {"started_at_utc": "2026-11-11T15:00:00"}],
)
def test_shape_errors(client, changes):
    assert client.post("/api/focus-sessions", json=focus(**changes)).status_code == 422


def test_local_day_filter_and_focus_sum(client):
    # Chicago DST fall-back day starts at 05:00Z and ends next day at 06:00Z.
    for instant in (
        "2026-11-01T04:59:59Z",
        "2026-11-01T05:00:00Z",
        "2026-11-02T05:59:59Z",
        "2026-11-02T06:00:00Z",
    ):
        end = datetime.fromisoformat(instant.replace("Z", "+00:00"))
        start = (end - timedelta(minutes=25)).isoformat()
        assert (
            client.post(
                "/api/focus-sessions",
                json=focus(started_at_utc=start, completed_at_utc=instant),
            ).status_code
            == 200
        )
    rows = client.get(
        "/api/focus-sessions?user_id=1&start_date=2026-11-01&end_date=2026-11-01"
    ).json()
    assert len(rows) == 2
    data = client.get(
        "/api/leaderboards?metric=focus&period=day&date=2026-11-01"
    ).json()
    assert [e["duration_seconds"] for e in data["entries"]] == [3000, 0]
    assert (
        client.get(
            "/api/focus-sessions?user_id=1&start_date=2026-11-02&end_date=2026-11-01"
        ).status_code
        == 422
    )
    assert (
        client.get("/api/focus-sessions?user_id=999").json()["code"] == "user_not_found"
    )
    assert (
        client.get(
            "/api/leaderboards?metric=focus&period=day&date=9999-12-31"
        ).status_code
        == 422
    )


def test_screen_snapshot_overwrites_decrease_and_stale_does_not_refresh(
    client, db_path
):
    body = usage(collected_at_utc="2026-11-12T17:59:00Z")
    assert (
        client.put("/api/screen-usage/daily", json=body).json()["result"] == "created"
    )
    newer = body | {"active_seconds": 20, "collected_at_utc": "2026-11-12T18:00:00Z"}
    assert (
        client.put("/api/screen-usage/daily", json=newer).json()["result"] == "updated"
    )
    for request in (body, newer):
        assert (
            client.put("/api/screen-usage/daily", json=request).json()["result"]
            == "ignored_stale"
        )
    conn = database.connect(db_path)
    row = conn.execute("SELECT * FROM screen_usage_daily").fetchone()
    assert row["active_seconds"] == 20
    assert row["synced_at_utc"] == "2026-11-12T18:00:00Z"
    conn.close()


@pytest.mark.parametrize(
    "changes,status,code",
    [
        ({"device_id": str(uuid4())}, 404, "device_not_found"),
        ({"active_seconds": 90001}, 422, "usage_too_large"),
        ({"usage_date": "2027-01-01"}, 422, "time_in_future"),
        ({"collected_at_utc": "2027-01-01T00:00:00Z"}, 422, "time_in_future"),
    ],
)
def test_screen_validation(client, changes, status, code):
    r = client.put("/api/screen-usage/daily", json=usage(**changes))
    assert (r.status_code, r.json()["code"]) == (status, code)


def test_screen_zero_is_ranked_but_missing_is_not(client):
    client.put("/api/screen-usage/daily", json=usage(active_seconds=0))
    entries = client.get("/api/leaderboards?metric=screen&period=day").json()["entries"]
    assert (
        entries[0]["duration_seconds"],
        entries[0]["rank"],
        entries[0]["data_status"],
    ) == (0, 1, "available")
    assert (
        entries[1]["duration_seconds"],
        entries[1]["rank"],
        entries[1]["data_status"],
    ) == (None, None, "no_data")


def test_screen_backfill_cannot_refresh_today_and_missing_days_are_partial(client):
    client.put("/api/screen-usage/daily", json=usage(usage_date="2026-11-11"))
    endpoint = "/api/leaderboards?metric=screen&period=week&date=2026-11-12"
    entry = client.get(endpoint).json()["entries"][0]
    assert (entry["data_status"], entry["rank"], entry["last_synced_at_utc"]) == (
        "stale",
        None,
        None,
    )
    client.put("/api/screen-usage/daily", json=usage())
    entry = client.get(endpoint).json()["entries"][0]
    assert (
        entry["data_status"],
        entry["rank"],
        entry["days_with_data"],
        entry["days_expected"],
    ) == ("partial", None, 2, 4)
    for day in ("2026-11-09", "2026-11-10"):
        client.put("/api/screen-usage/daily", json=usage(usage_date=day))
    entry = client.get(endpoint).json()["entries"][0]
    assert (entry["data_status"], entry["rank"], entry["days_expected"]) == (
        "available",
        1,
        4,
    )


def test_screen_old_collection_received_now_is_stale(client):
    client.put(
        "/api/screen-usage/daily", json=usage(collected_at_utc="2026-11-12T16:00:00Z")
    )
    entry = client.get("/api/leaderboards?metric=screen&period=day").json()["entries"][
        0
    ]
    assert (entry["data_status"], entry["rank"]) == ("stale", None)


def test_database_connection_failure_is_503(client, monkeypatch):
    def broken():
        raise sqlite3.OperationalError("unable to open database file")

    monkeypatch.setattr(database, "connect", broken)
    response = client.get("/api/health")
    assert (response.status_code, response.json()["code"]) == (
        503,
        "database_unavailable",
    )


def test_concurrent_screen_snapshots_keep_newest_collection(client, db_path):
    bodies = [
        usage(active_seconds=i, collected_at_utc=f"2026-11-12T17:59:{50 + i:02d}Z")
        for i in range(8)
    ]
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(
            pool.map(
                lambda body: client.put("/api/screen-usage/daily", json=body), bodies
            )
        )
    assert all(r.status_code == 200 for r in responses)
    assert sum(r.json()["result"] == "created" for r in responses) == 1
    db = database.connect(db_path)
    try:
        row = db.execute("SELECT * FROM screen_usage_daily").fetchone()
        assert row["active_seconds"] == 7
        assert row["collected_at_utc"] == "2026-11-12T17:59:57Z"
    finally:
        db.close()


def test_historical_screen_gap_is_partial_never_freshly_ranked(client):
    client.put("/api/screen-usage/daily", json=usage(usage_date="2026-11-02"))
    entries = client.get(
        "/api/leaderboards?metric=screen&period=week&date=2026-11-02"
    ).json()["entries"]
    entry = entries[0]
    assert (
        entry["data_status"],
        entry["rank"],
        entry["days_with_data"],
        entry["days_expected"],
    ) == ("partial", None, 1, 7)
