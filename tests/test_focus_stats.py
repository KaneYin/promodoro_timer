from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.services import focus_stats_service


def save(client, user, completed, seconds=1500, mode="pomodoro", segments=None):
    end = datetime.fromisoformat(completed.replace("Z", "+00:00"))
    body = dict(
        id=str(uuid4()),
        user_id=user,
        mode=mode,
        completed_at_utc=completed,
        started_at_utc=(end - timedelta(seconds=seconds)).isoformat(),
        focus_seconds=seconds,
        target_seconds=7200 if mode == "countup" else seconds,
    )
    if segments:
        body["started_at_utc"] = segments[0][0]
        body["active_segments"] = [
            dict(started_at_utc=start, ended_at_utc=stop) for start, stop in segments
        ]
    response = client.post("/api/focus-sessions", json=body)
    assert response.status_code == 200, response.text


def get(client, period="day", day="2026-11-11"):
    response = client.get("/api/focus-stats", params={"period": period, "date": day})
    assert response.status_code == 200, response.text
    return response.json()


def test_recorded_dates_empty_database(client):
    response = client.get("/api/focus-stats/dates")
    assert response.status_code == 200
    assert response.json() == {"timezone": "America/Chicago", "dates": []}


def test_recorded_dates_are_shared_unique_sorted_and_use_chicago_boundaries(client):
    save(client, 1, "2026-11-11T05:59:59Z", 60, "countup")  # Nov 10 locally
    save(client, 2, "2026-11-11T06:00:00Z")  # Nov 11 locally
    save(client, 1, "2026-11-12T05:59:59Z")  # still Nov 11
    save(client, 1, "2026-11-01T06:30:00Z", 60, "countup")  # 01:30 CDT
    save(client, 2, "2026-11-01T07:30:00Z", 60, "countup")  # 01:30 CST
    data = client.get("/api/focus-stats/dates").json()
    assert data == {
        "timezone": "America/Chicago",
        "dates": ["2026-11-11", "2026-11-10", "2026-11-01"],
    }
    assert client.get("/api/focus-stats/dates?user_id=2").json() == data


@pytest.mark.parametrize("period,count", [("day", 24), ("week", 7), ("month", 6)])
def test_empty_stats_include_both_users_and_zero_buckets(client, period, count):
    data = get(client, period)
    assert len(data["buckets"]) == count
    assert [s["display_name"] for s in data["series"]] == ["Yinkun", "Ruiping"]
    assert all(
        s["duration_seconds"] == [0] * count
        and s["total_seconds"] == 0
        and s["session_count"] == 0
        for s in data["series"]
    )
    assert data["attribution"] == "active_intervals"


def test_daily_histogram_uses_active_hours_and_counts_both_modes(client):
    # Sessions ending on the hour credit the preceding hour.
    save(client, 1, "2026-11-11T15:00:00Z")
    save(client, 1, "2026-11-11T15:59:59Z", 42, "countup")
    save(client, 2, "2026-11-11T16:00:00Z", 120, "countup")
    data = get(client)
    assert data["series"][0]["duration_seconds"][8:10] == [1500, 42]
    assert data["series"][1]["duration_seconds"][9:11] == [120, 0]
    assert [s["session_count"] for s in data["series"]] == [2, 1]
    entries = client.get(
        "/api/leaderboards?metric=focus&period=day&date=2026-11-11"
    ).json()["entries"]
    totals = {e["user_id"]: e["duration_seconds"] for e in entries}
    for s in data["series"]:
        assert sum(s["duration_seconds"]) == s["total_seconds"] == totals[s["user_id"]]


def test_stats_are_shared_and_do_not_filter_on_selected_user(client):
    save(client, 2, "2026-11-11T15:00:00Z")
    a = client.get("/api/focus-stats?period=day&date=2026-11-11&user_id=1").json()
    b = client.get("/api/focus-stats?period=day&date=2026-11-11&user_id=2").json()
    assert a["series"] == b["series"]
    assert [s["total_seconds"] for s in a["series"]] == [0, 1500]


def test_week_is_monday_to_sunday_with_active_time_boundaries(client):
    save(client, 1, "2026-11-09T05:59:59Z")  # previous Sunday
    save(client, 1, "2026-11-09T06:00:00Z")  # Monday midnight
    save(client, 2, "2026-11-11T06:00:00Z")  # Wednesday midnight
    data = get(client, "week")
    assert (data["period_start"], data["period_end_exclusive"]) == (
        "2026-11-09",
        "2026-11-16",
    )
    assert data["series"][0]["duration_seconds"] == [0] * 7
    assert data["series"][1]["duration_seconds"] == [0, 1500, 0, 0, 0, 0, 0]


def test_month_weeks_are_clipped_and_exclude_neighboring_months(client):
    save(client, 1, "2026-11-01T04:59:59Z")  # Oct 31
    save(client, 1, "2026-11-01T05:00:00Z")  # Nov 1
    save(client, 2, "2026-11-02T06:00:00Z")  # Nov 2
    data = get(client, "month")
    assert [b["label"] for b in data["buckets"]] == [
        "11/1",
        "11/2-11/8",
        "11/9-11/15",
        "11/16-11/22",
        "11/23-11/29",
        "11/30",
    ]
    assert data["series"][0]["duration_seconds"] == [0] * 6
    assert data["series"][1]["duration_seconds"] == [1500, 0, 0, 0, 0, 0]
    for a, b in zip(data["buckets"], data["buckets"][1:]):
        assert a["end_utc"] == b["start_utc"]


def test_fall_back_hours_remain_distinct(client):
    save(client, 1, "2026-11-01T06:30:00Z", 60, "countup")
    save(client, 1, "2026-11-01T07:30:00Z", 120, "countup")
    data = get(client, day="2026-11-01")
    assert len(data["buckets"]) == 25
    assert data["buckets"][1]["label"] == "01:00 CDT"
    assert data["buckets"][2]["label"] == "01:00 CST"
    assert data["series"][0]["duration_seconds"][1:3] == [60, 120]


def test_spring_forward_has_no_nonexistent_hour(client):
    data = get(client, day="2026-03-08")
    assert len(data["buckets"]) == 23
    assert not any(b["label"].startswith("02:") for b in data["buckets"])


def test_default_date_uses_server_timezone_and_invalid_queries_are_422(
    client, monkeypatch
):
    monkeypatch.setattr(
        focus_stats_service,
        "today_local",
        lambda: datetime(2026, 11, 11, tzinfo=UTC).date(),
    )
    assert client.get("/api/focus-stats").json()["period_start"] == "2026-11-11"
    for query in ["period=year", "date=nope", "date=9999-12-31&period=month"]:
        assert client.get("/api/focus-stats?" + query).status_code == 422


@pytest.mark.parametrize("period", ["day", "week", "month"])
def test_every_chart_total_matches_rankings_for_both_users_and_modes(client, period):
    save(client, 1, "2026-11-11T15:00:00Z")
    save(client, 1, "2026-11-11T16:00:00Z", 72, "countup")
    save(client, 2, "2026-11-10T16:00:00Z", 300, "countup")
    data = get(client, period)
    board = client.get(
        f"/api/leaderboards?metric=focus&period={period}&date=2026-11-11"
    ).json()
    expected = {e["user_id"]: e["duration_seconds"] for e in board["entries"]}
    assert {
        s["user_id"]: sum(s["duration_seconds"]) for s in data["series"]
    } == expected


def test_month_last_partial_week_and_next_month_boundary(client, monkeypatch):
    from app.services import focus_service

    monkeypatch.setattr(
        focus_service, "utc_now", lambda: datetime(2026, 12, 2, tzinfo=UTC)
    )
    save(client, 1, "2026-12-01T05:59:59Z", 60, "countup")
    save(client, 1, "2026-12-01T06:00:30Z", 120, "countup")
    november = get(client, "month", "2026-11-15")
    december = get(client, "month", "2026-12-15")
    assert november["series"][0]["duration_seconds"][-1] == 150
    assert november["series"][0]["total_seconds"] == 150
    assert december["series"][0]["duration_seconds"][0] == 30


def test_saved_segments_split_across_midnight_and_skip_pause_and_late_stop(client):
    save(
        client,
        1,
        "2026-11-12T15:00:00Z",
        75,
        "countup",
        [
            ("2026-11-11T05:59:30.250Z", "2026-11-11T06:00:15.250Z"),
            ("2026-11-11T16:00:00.000Z", "2026-11-11T16:00:30.500Z"),
        ],
    )
    for day, expected, completed in [
        ("2026-11-10", {23: 29}, 0),
        ("2026-11-11", {0: 15, 10: 31}, 0),
        ("2026-11-12", {}, 1),
    ]:
        series = get(client, day=day)["series"][0]
        assert {
            i: value for i, value in enumerate(series["duration_seconds"]) if value
        } == expected
        assert series["session_count"] == completed
        board = client.get(
            "/api/leaderboards",
            params={"metric": "focus", "period": "day", "date": day},
        ).json()
        assert board["entries"][0]["duration_seconds"] == sum(expected.values())
    assert get(client, "week")["series"][0]["total_seconds"] == 75
    assert client.get("/api/focus-stats/dates").json()["dates"] == [
        "2026-11-11",
        "2026-11-10",
    ]
