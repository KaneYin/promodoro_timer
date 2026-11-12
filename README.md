# Focus Tracker

A small Pomodoro app for two people, with a Focus leaderboard and a Screen Time leaderboard fed by ActivityWatch.
FastAPI + SQLite + vanilla JavaScript, reachable over Tailscale. No accounts, no build step.

## Status

| Area | State |
|---|---|
| Frontend (timer, stats, leaderboards, offline outbox) | Done |
| Database schema, connection, seed, backup script | Done |
| API routers, schemas, error handling | Done |
| Agent loop and HTTP sync | Done |
| **Core logic** (period windows, focus save, upserts, aggregation, ranking, ActivityWatch query) | **To implement.** See `docs/implementation-guide.md` |

Until the core is implemented those endpoints return `501`, and the page shows "not implemented yet" where it needs them.

## Quick start

```bash
uv sync
uv run python scripts/init_db.py
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

- App: http://127.0.0.1:8000
- API docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/api/health

Before the first run, edit the display names in `database/seed.sql`.

## Layout

```
app/            FastAPI app
  routers/      HTTP layer (done)
  services/     Business logic (your TODOs)
  periods.py    Day/week/month windows (your TODO)
  static/       Frontend
agent/          Screen Time agent (ActivityWatch -> server)
database/       schema.sql, seed.sql
scripts/        init_db.py, backup_db.py
docs/           Documentation
```

## Documentation

| Doc | Content |
|---|---|
| `docs/api.md` | Every endpoint, request/response, errors |
| `docs/database.md` | Tables, conventions, connection settings |
| `docs/frontend-backend.md` | Timer, outbox, polling, error handling |
| `docs/implementation-guide.md` | The functions left for you, with hints |
| `docs/deployment.md` | Tailscale, launchd, agent, backup/restore |

## Configuration

Environment variables, all optional (`app/config.py`): `FOCUS_DB_PATH`, `FOCUS_BACKUP_DIR`, `FOCUS_BACKUP_KEEP`, `FOCUS_MIN_TARGET_SECONDS`, `FOCUS_MAX_TARGET_SECONDS`, `CLOCK_SKEW_TOLERANCE_SECONDS`, `SCREEN_STALE_AFTER_SECONDS`.
Agent variables are listed in `agent/config.py`.

## Security notes

The server listens on `127.0.0.1` only and is exposed to the tailnet with `tailscale serve`. Never use Funnel.
There is no authentication, so either user can act as the other. This is an accepted MVP limit.
