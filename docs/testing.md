# Tests and acceptance

## Automated checks

```bash
uv sync --extra agent
uv run --no-sync pytest -q
npm test
git diff --check
```

Python tests use temporary SQLite databases and a frozen clock; they never write the default `data/focus.db`. They cover HTTP contracts, normalized idempotency, conflicting payloads, concurrent retries, local-date/DST filtering, snapshot decreases, stale collections, Screen coverage, ranking, collector errors, upload recovery and restorable unique backups.

JavaScript tests use Node's built-in runner, in-memory storage and a small controlled DOM/network surface. They cover pause/resume, deadline recovery, cancellation, failed durable writes, per-record queue behavior, legacy migration, rejection/retry and controller recovery. They are not a full browser engine or cross-process browser concurrency test. No npm dependencies are needed.

When the agent extra provides the ActivityWatch query packages, an additional in-memory query-engine test checks actual window/not-AFK intersection. Live watcher permissions, real computer usage totals and the Tailscale network are outside these isolated tests.

## Local browser smoke check

Use a disposable DB and a shortened timer, leaving normal data untouched:

```bash
FOCUS_DB_PATH=/tmp/focus-smoke.db FOCUS_MIN_TARGET_SECONDS=1 uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8765
```

1. Open http://127.0.0.1:8765/?focus=10&break=5 in a real browser. Confirm two selectable users, Connected, empty Focus totals and missing Screen data.
2. Start, pause, wait, resume and complete one session. Confirm the user selector stays locked during Focus, a break begins, the outbox clears, and today's session count and Focus rank update.
3. Reload during Focus; the remaining time should follow the original deadline. Reopen after both phases would have elapsed; exactly one session should be saved and the timer should be Ready.
4. Disconnect the server while the page remains loaded. Totals should become unavailable and old ranks disappear. A completed session stays queued. Restart with the same database; reconnect and confirm one stored session per UUID.
5. Use two tabs. Follow Start/Pause/Resume/Reset changes and confirm uploads do not lose a new session while another is being acknowledged. In browsers with Web Locks, state transitions are serialized. Different browsers/devices have separate timers.
6. Switch Focus/Screen and day/week/month/order controls rapidly. Late responses must not overwrite the latest selection. Verify readable narrow-window layout.

The demo URL's durations are for testing only. The production server's default minimum target is 60 seconds and must be lowered explicitly for this check. The page must already be loaded to keep working offline; no service worker is installed.

## Real ActivityWatch and deployment acceptance

- [ ] Both watchers have permission and appear under the intended host in the local dashboard.
- [ ] Agent's one-shot total matches the dashboard for the same Chicago date and no browser overlay.
- [ ] AFK intervals reduce counted window duration; a failed query does not upload zero.
- [ ] Each Mac uses its own registered device UUID; server Screen data appears for the right person.
- [ ] Fresh zero is ranked; missing dates show Partial, missing/stale today is unranked, and yesterday's backfill cannot refresh today.
- [ ] Tailscale HTTPS health works from the other Mac on another Wi-Fi network.
- [ ] Neither the server's loopback port nor ActivityWatch's port 5600 is reachable from the LAN.
- [ ] Funnel is disabled and access rules include only intended users/devices.
- [ ] After restart and login, ActivityWatch, server and agents resume without an interactive shell.
- [ ] A verified backup restores expected users, Focus sessions and Screen snapshots in a separate test database.

These manual checks require the two actual Macs, ActivityWatch and the user's tailnet. Passing unit/API tests alone does not establish that those services have been deployed or configured.
