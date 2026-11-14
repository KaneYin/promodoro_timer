# Focus Tracker

A Pomodoro app for two people, with Focus and ActivityWatch Screen Time leaderboards.
FastAPI + SQLite + vanilla JavaScript, reachable over Tailscale. No accounts or frontend build step.

## Reference and practice branches

- `main` preserves the original TODO scaffold.
- `reference/complete-implementation` contains the working reference, bug fixes, tests and updated documentation.
- Start your own practice branch from `main`. Read [the learning guide](docs/implementation-guide.md) when comparing your implementation with this reference.

```bash
git diff main..reference/complete-implementation -- app/periods.py
git diff main..reference/complete-implementation -- app/services agent/collector.py
```

## What works

- Persistent 25-minute focus / 5-minute break timer, pause/resume, reset and delayed-reopen recovery.
- Count-up mode: Stop & save records actual whole seconds as one session; automatically stops and saves at 2 hours. Modes cannot run simultaneously in the same browser origin.
- Opt-in silent browser notifications for focus/break completion. Use **Enable silent notifications** and allow the browser prompt. Unsupported browsers retain an in-page completion message; no audio is played.
- Completed-session outbox, automatic retry, UUID deduplication and per-record storage safe from cross-tab array overwrites.
- Local-day history and day/week/month leaderboards, including DST boundaries and competition ranks.
- Shared two-user Focus bar chart below personal stats: daily completion hours, weekly days, and monthly Monday-aligned weeks. Automatically opens the current period using the browser clock; the history menu lists only periods with recorded sessions. Fixed user colors and an accessible data table.
- ActivityWatch foreground-window time intersected with not-AFK time; cumulative daily snapshots and historical backfill.
- Screen data coverage and freshness: incomplete, stale or missing data is displayed but never ranked.
- SQLite initialization, verified online backups and retention.

Automated checks cover Python services/API/agent and JavaScript timer/outbox/controller behavior. Real ActivityWatch accuracy, macOS login startup and two-machine Tailscale access require the manual checks in [testing](docs/testing.md).

## Quick start

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/). Node.js 22+ is only needed for JavaScript tests.
Run commands from the repository root. **Before the first initialization**, edit display/device names in `database/seed.sql`. After initialization, rename existing rows with SQL `UPDATE`.

```bash
uv sync
uv run --no-sync python scripts/init_db.py
uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8000
```

- App: http://127.0.0.1:8000
- Interactive API docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/api/health

Complete a timer session, then confirm the outbox clears and Focus totals update. Cancelled sessions and breaks are excluded. For a faster local check, start the server with `FOCUS_MIN_TARGET_SECONDS=1` and open `/?focus=10&break=5`; restore the normal minimum afterwards.

For open-ended work, select **Count up**, start, then **Stop & save** (also available while paused). Sessions shorter than one second are not saved. Focus totals and session counts update through the same offline outbox. Dates use the completion day in America/Chicago. Startup automatically migrates existing database rows to `mode="pomodoro"` without deleting history.

Notifications require HTTPS or localhost, browser permission and support for the silent option. They fire when the loaded page processes a completion; closed or suspended pages cannot guarantee an on-time alert. A notification-only service worker supports delivery where available, without adding offline caching or a background timer.

After updating frontend files, restart the server and refresh the page. HTML is not cached, and CSS plus the complete JavaScript module graph use a content-versioned URL prefix, preventing a new page from loading older cached modules.

## Screen Time agent

Install and run ActivityWatch on each Mac first; see [deployment](docs/deployment.md). Copy that Mac's device UUID from the initialization output:

```bash
uv sync --extra agent
export AGENT_DEVICE_ID=15ba172f-e397-4155-8285-6757a75875f1
export AGENT_SERVER_URL=http://127.0.0.1:8000
uv run --no-sync python -m agent.main --once
uv run --no-sync python -m agent.main
```

Use the second seeded UUID on the second Mac and the server's Tailscale HTTPS URL for remote access. One registered device per user. The agent normally re-queries the last seven days; `--once --backfill-days 30` repairs longer outages when ActivityWatch has that history. A failed one-shot sync exits nonzero. Days before tracking began are skipped, not uploaded as zero.

## Checks

```bash
uv sync --extra agent
uv run --no-sync pytest -q
npm test
uv run --no-sync python scripts/backup_db.py --verify
```

`npm test` uses Node's built-in runner and requires no npm install. Tests use temporary databases and mocked ActivityWatch/network responses. See [testing](docs/testing.md) for coverage, reproducible smoke checks and integration limits.

## Layout and documentation

| Path | Purpose |
|---|---|
| `app/routers/`, `app/schemas.py` | HTTP routes and API models |
| `app/services/`, `app/periods.py` | Persistence, validation, aggregation and calendar windows |
| `app/static/` | Browser timer, outbox, statistics and leaderboards |
| `app/static/js/focus-chart.js` | Shared two-user Focus chart, date/period controls and data table |
| `agent/` | Local ActivityWatch collection and HTTP sync |
| `database/`, `scripts/` | Schema, seed, initialization and backup |
| `tests/` | Python and JavaScript regression tests |
| [Design](docs/design.md) | Goals, invariants, coverage policy and limits |
| [API](docs/api.md) | Endpoint contracts and errors |
| [Database](docs/database.md) | Tables, connection settings and privacy |
| [Frontend](docs/frontend-backend.md) | Timer state, outbox, polling and offline behavior |
| [Learning guide](docs/implementation-guide.md) | Suggested implementation order and reference explanations |
| [Deployment](docs/deployment.md) | ActivityWatch, Tailscale, launchd and restore |

## Configuration and access

Server variables: `FOCUS_DB_PATH`, `FOCUS_BACKUP_DIR`, `FOCUS_BACKUP_KEEP` (14), `FOCUS_MIN_TARGET_SECONDS` (60), `FOCUS_MAX_TARGET_SECONDS` (14400), `CLOCK_SKEW_TOLERANCE_SECONDS` (300), `SCREEN_STALE_AFTER_SECONDS` (1200). All paths default under `data/`, which is ignored by Git. Agent variables and defaults are listed in `agent/config.py`.

The server binds to `127.0.0.1`; use Tailscale Serve for tailnet access. Never use Funnel. There is no authentication: either trusted user can select or submit data as the other. Timer state is local to a browser origin; clearing browser data loses unsynced sessions. An already loaded page works offline, but a fresh offline page load is not guaranteed. This app measures ActivityWatch non-AFK foreground time, not Apple's Screen Time or verified human attention.
