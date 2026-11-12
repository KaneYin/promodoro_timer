from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest

from agent import collector, main, sync_client
from agent.config import AgentConfig, load_config
from scripts import backup_db


@pytest.fixture
def cfg():
    return AgentConfig(
        UUID("15ba172f-e397-4155-8285-6757a75875f1"),
        "http://localhost:8000",
        "http://localhost:5600",
        ZoneInfo("America/Chicago"),
        300,
        7,
        10,
    )


def test_discover_pairs_not_unrelated_hosts():
    buckets = {
        "aw-watcher-window_mine": {"created": "2026-01-01T00:00:00Z"},
        "aw-watcher-afk_mine": {},
        "aw-watcher-window_other": {},
    }
    client = SimpleNamespace(client_hostname="mine", get_buckets=lambda: buckets)
    found = collector.discover_buckets(client)
    assert (found.window_id, found.afk_id) == (
        "aw-watcher-window_mine",
        "aw-watcher-afk_mine",
    )
    with pytest.raises(collector.BucketsMissing):
        collector.discover_buckets(
            SimpleNamespace(
                get_buckets=lambda: {"aw-watcher-window_a": {}, "aw-watcher-afk_b": {}}
            )
        )


@pytest.mark.parametrize("day,hours", [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25)])
def test_collector_intersection_query_and_dst(cfg, day, hours):
    def query(text, periods):
        assert "filter_period_intersect(events, not_afk)" in text
        assert "RETURN = sum_durations(events)" in text
        assert "not-afk" in text
        start, end = periods[0]
        assert (end - start).total_seconds() == hours * 3600
        assert start.tzinfo == UTC
        return [123.75]

    assert (
        collector.compute_active_seconds(
            SimpleNamespace(query=query), collector.Buckets("window", "afk"), day, cfg
        )
        == 123
    )


@pytest.mark.parametrize(
    "result",
    [[], [None], [float("nan")], [-1], [90001], [True], [{"titles": "private"}]],
)
def test_invalid_query_results_never_become_zero(cfg, result):
    with pytest.raises(collector.ActivityWatchUnavailable):
        collector.compute_active_seconds(
            SimpleNamespace(query=lambda *args: result),
            collector.Buckets("w", "a"),
            date(2026, 11, 12),
            cfg,
        )


def test_real_zero_and_pre_tracking_day(cfg):
    client = SimpleNamespace(query=lambda *args: [0])
    assert (
        collector.compute_active_seconds(
            client, collector.Buckets("w", "a"), date(2026, 11, 12), cfg
        )
        == 0
    )
    with pytest.raises(collector.DayNotTracked):
        collector.compute_active_seconds(
            client,
            collector.Buckets("w", "a", datetime(2026, 11, 12, tzinfo=UTC)),
            date(2026, 11, 10),
            cfg,
        )


def test_real_activitywatch_query_engine_counts_intersection(cfg):
    query_engine = pytest.importorskip("aw_query.query2")
    from aw_core import Event
    from aw_datastore import Datastore
    from aw_datastore.storages import MemoryStorage

    store = Datastore(MemoryStorage, testing=True)
    start = datetime(2026, 11, 12, 6, tzinfo=UTC)
    window = store.create_bucket("w", "currentwindow", "test", "test")
    afk = store.create_bucket("a", "afkstatus", "test", "test")
    window.insert(
        Event(
            timestamp=start,
            duration=40,
            data={"app": "Test", "title": "Private test title"},
        )
    )
    afk.insert(
        [
            Event(timestamp=start, duration=10, data={"status": "not-afk"}),
            Event(
                timestamp=start + timedelta(seconds=10),
                duration=20,
                data={"status": "afk"},
            ),
            Event(
                timestamp=start + timedelta(seconds=30),
                duration=10,
                data={"status": "not-afk"},
            ),
        ]
    )

    def query(text, periods):
        # AW's HTTP encoder converts a timedelta result to numeric seconds.
        return [query_engine.query("test", text, *periods[0], store).total_seconds()]

    assert (
        collector.compute_active_seconds(
            SimpleNamespace(query=query),
            collector.Buckets("w", "a"),
            date(2026, 11, 12),
            cfg,
        )
        == 20
    )


def test_sdk_transport_uses_bounded_http_requests(cfg, monkeypatch):
    aw_client = pytest.importorskip("aw_client")
    import httpx

    def init(self, name, host, port):
        self.server_address = f"http://{host}:{port}"

    # Avoid the SDK's unrelated persistent upload queue and lock-file side effects.
    monkeypatch.setattr(aw_client.ActivityWatchClient, "__init__", init)
    requests = []

    def get(url, **kwargs):
        requests.append(kwargs)
        return httpx.Response(200, json={}, request=httpx.Request("GET", url))

    def post(url, **kwargs):
        requests.append(kwargs)
        return httpx.Response(200, json=[0], request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(httpx, "post", post)
    client = collector.open_client(cfg)
    assert client.get_buckets() == {}
    start = datetime(2026, 11, 12, tzinfo=UTC)
    assert client.query("RETURN = 0;", [(start, start + timedelta(days=1))]) == [0]
    assert all(r["timeout"] == cfg.http_timeout_seconds for r in requests)


def test_failed_collection_never_uploads(cfg, monkeypatch):
    monkeypatch.setattr(collector, "open_client", lambda cfg: object())
    monkeypatch.setattr(
        collector, "discover_buckets", lambda _: collector.Buckets("w", "a")
    )

    def fail(*args):
        raise collector.ActivityWatchUnavailable("offline")

    monkeypatch.setattr(collector, "compute_active_seconds", fail)
    sent = []
    monkeypatch.setattr(
        sync_client, "push_daily_usage", lambda *args: sent.append(args)
    )
    assert main.run_cycle(cfg, 2) is False
    assert sent == []


def test_cycle_uploads_snapshots_and_continues_after_sync_failure(cfg, monkeypatch):
    monkeypatch.setattr(collector, "open_client", lambda cfg: object())
    monkeypatch.setattr(
        collector, "discover_buckets", lambda _: collector.Buckets("w", "a")
    )
    monkeypatch.setattr(collector, "compute_active_seconds", lambda *args: 42)
    sent = []

    def push(cfg, usage):
        sent.append(usage)
        if len(sent) == 1:
            raise sync_client.SyncError("offline")
        return "updated"

    monkeypatch.setattr(sync_client, "push_daily_usage", push)
    assert main.run_cycle(cfg, 3) is False
    assert len(sent) == 3
    assert all(
        s.active_seconds == 42 and s.collected_at_utc.tzinfo == UTC for s in sent
    )


def test_agent_config_rejects_wrong_timezone(monkeypatch):
    monkeypatch.setenv("AGENT_DEVICE_ID", "15ba172f-e397-4155-8285-6757a75875f1")
    monkeypatch.setenv("AGENT_TIMEZONE", "UTC")
    with pytest.raises(SystemExit, match="America/Chicago"):
        load_config()


def test_backup_is_unique_verified_restorable_and_pruned(conn, monkeypatch):
    monkeypatch.setattr(backup_db.config, "BACKUP_KEEP", 1)
    first = backup_db.backup(True)
    second = backup_db.backup(True)
    assert first != second
    import sqlite3

    with sqlite3.connect(second) as restored:
        assert restored.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
    backup_db.prune()
    assert not first.exists() and second.exists()


def test_agent_upload_roundtrip_through_real_api(client, cfg, monkeypatch):
    import httpx

    def put(url, *, json, timeout):
        assert url == "http://localhost:8000/api/screen-usage/daily"
        assert set(json) == {
            "device_id",
            "usage_date",
            "active_seconds",
            "collected_at_utc",
        }
        return client.put("/api/screen-usage/daily", json=json)

    monkeypatch.setattr(httpx, "put", put)
    payload = collector.DailyUsage(
        date(2026, 11, 12), 123, datetime(2026, 11, 12, 18, tzinfo=UTC)
    )
    assert sync_client.push_daily_usage(cfg, payload) == "created"
    assert sync_client.push_daily_usage(cfg, payload) == "ignored_stale"
    entry = client.get("/api/leaderboards?metric=screen&period=day").json()["entries"][
        0
    ]
    assert (entry["duration_seconds"], entry["data_status"], entry["rank"]) == (
        123,
        "available",
        1,
    )


@pytest.mark.parametrize("successful,exit_code", [(True, 0), (False, 1)])
def test_once_exit_status_matches_sync_result(cfg, monkeypatch, successful, exit_code):
    import sys

    monkeypatch.setattr(sys, "argv", ["agent", "--once"])
    monkeypatch.setattr(main, "load_config", lambda: cfg)
    monkeypatch.setattr(main, "run_cycle", lambda *args: successful)
    with pytest.raises(SystemExit) as exc:
        main.main()
    assert exc.value.code == exit_code


def test_failed_backup_verification_does_not_publish_or_prune_good_copy(
    conn, monkeypatch
):
    first = backup_db.backup(True)
    conn.executescript(
        "DROP TABLE screen_usage_daily; DROP TABLE focus_sessions; DROP TABLE devices; DROP TABLE users;"
    )
    with pytest.raises(RuntimeError, match="Backup verification failed"):
        backup_db.backup(True)
    assert list(backup_db.config.BACKUP_DIR.glob("*.db")) == [first]
    assert list(backup_db.config.BACKUP_DIR.glob("*.tmp")) == []
