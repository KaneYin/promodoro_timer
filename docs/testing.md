# Tests and acceptance

## Automated checks

```bash
uv sync --extra agent
uv run --no-sync pytest -q
npm test
git diff --check
```

Python tests use temporary SQLite databases and a frozen clock; they never write the default `data/focus.db`. They cover HTTP contracts, normalized idempotency, conflicting payloads, concurrent retries, local-date/DST filtering, snapshot decreases, stale collections, Screen coverage, ranking, collector errors, upload recovery and restorable unique backups.

JavaScript tests use Node's built-in runner, in-memory storage and a small controlled DOM/network surface. They cover pause/resume, deadline recovery, cancellation, count-up stop/cap/recovery, immutable manual-stop retries, silent notification permission/delivery/fallback, per-record queue behavior, legacy migration, rejection/retry and controller recovery. They are not a full browser engine or cross-process browser concurrency test. No npm dependencies are needed.

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
7. Select Count up, start and pause/resume, then Stop & save. Confirm one session with the actual duration is counted, no break starts, and Discard does not save. Automated clock tests cover the exact two-hour cap and late reopen without waiting two hours.
8. Click Enable silent notifications and allow the prompt. Finish a short Pomodoro and its break; confirm silent browser notifications and in-page notices. Denial/unsupported browsers must preserve timer behavior without a system alert. On supporting mobile browsers, verify service-worker delivery. No audio or vibration is requested.
9. Under Your stats, confirm the chart automatically opens Today using the browser clock. Compare both colored Focus series. Switch Daily/Weekly/Monthly: each opens the current period and the dropdown lists only other periods containing recorded sessions. Totals should match Focus leaderboards for that period. Select a bar to show both values and expand the data table. Switching Yinkun/Ruiping in the user selector must preserve the same chart. An empty current period shows zero values; offline state hides old totals.
10. After a frontend update and server restart, refresh an already-open page. Confirm styles and chart appear together. HTML must reference the new `/assets/<content-version>/...` prefix, and relative module imports must retain it.

Chart API regressions include completion-hour boundaries, both focus modes, monthly partial weeks, zero-filled users, totals matching rankings, spring/fall DST dates and SQL history-date conversion/deduplication. Component tests cover automatic current dates, recorded-period options, midnight rollover, history-lookup fallback, stable colors, exact bar details, stale-response rejection and shared rendering across personal-user switches. Static-route tests follow the actual versioned module graph and check cache revalidation headers.

The demo URL's Pomodoro durations are for testing only. The production server's default Pomodoro minimum is 60 seconds; count-up independently permits one second. The notification worker adds no offline cache or closed-page scheduling, so keep the page loaded to test completion events. Browser/OS permission settings can prevent delivery even when the timer saves successfully.

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
