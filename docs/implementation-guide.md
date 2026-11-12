# Implementation Guide: the parts left for you

Everything not listed here is done: schema, DB connection, Pydantic models, all routers, error mapping, the whole frontend, the agent loop and HTTP client, backup script.

Every missing function raises `NotImplementedError("TODO(core): <name>")`, which the API returns as `501`. Find them all with:

```bash
grep -rn "TODO(core)" app agent
```

Each stub's docstring is the contract. This guide adds order, hints and pitfalls. Hints describe approaches, not finished code.

## Suggested order

| # | File · function | Lab | Unblocks |
|---|---|---|---|
| 1 | `app/periods.py` · `local_midnight_utc`, `resolve_window` | 4 | everything date-related |
| 2 | `app/services/focus_service.py` · `save_focus_session` | 4 | saving Pomodoros |
| 3 | `app/services/focus_service.py` · `list_focus_sessions` | 4 | "Sessions today" stats |
| 5 | `app/services/leaderboard_service.py` · `focus_entries` | 4 | Focus leaderboard |
| 7 | `app/services/leaderboard_service.py` · `rank_entries` | 4 | rank numbers |
| 8 | `agent/collector.py` · `discover_buckets`, `compute_active_seconds` | 1, 5 | real Screen Time data |
| 4 | `app/services/screen_time_service.py` · `upsert_daily_usage` | 5 | storing agent uploads |
| 6 | `app/services/leaderboard_service.py` · `screen_entries` | 6 | Screen Time leaderboard |

After steps 1, 2, 3, 5 and 7, the Focus half of the app works in the browser. The design doc's Lab 1 (ActivityWatch PoC) fits naturally as step 8 before anything else on the Screen Time side.

---

## 1. Period windows (`app/periods.py`)

- `local_midnight_utc(d, tz)`: build an aware `datetime` at 00:00 in `tz`, convert to UTC. Do not add 24 h to anything.
- `resolve_window`: compute local dates first (Monday = `anchor - timedelta(days=anchor.weekday())`; month start and next month start), then convert only the two boundaries to UTC.
- Check with dates around DST: in `America/Chicago` the clocks change on 2026-03-08 and 2026-11-01. The week of 2026-11-01 is 169 hours long, and the Sunday itself is 25 hours.
- December needs a year rollover for "first of next month".

## 2. `save_focus_session`

- Check user existence with a `SELECT`. Business rules come before the insert.
- Idempotency: look up the id first. If a row exists, compare **all** fields. Equal -> return success. Different -> `ConflictError`.
- Race: two identical requests can arrive at once (two tabs). A `SELECT` then `INSERT` can lose the race and hit the primary key. Handle `sqlite3.IntegrityError` on the insert by re-reading and comparing, or use `INSERT ... ON CONFLICT DO NOTHING` and inspect `rowcount`.
- Store `to_utc_iso(payload.started_at_utc)` and `str(payload.id)`.
- Use `with conn:` so the write commits or rolls back.

## 3. `list_focus_sessions`

- End bound is **inclusive** at the API but the SQL window is half-open: `local_midnight_utc(end_date + 1 day)`.
- Build the WHERE clause conditionally for missing bounds, but keep every value parameterised (`?`).

## 4. `upsert_daily_usage`

- The value is a snapshot. Never `active_seconds = active_seconds + ?` and never `MAX()`: totals can drop when ActivityWatch corrects history.
- Three outcomes (`created`, `updated`, `ignored_stale`). Decide in one statement if you can. An `INSERT ... ON CONFLICT(device_id, usage_date) DO UPDATE SET ... WHERE excluded.collected_at_utc > screen_usage_daily.collected_at_utc` leaves `rowcount == 0` when ignored. You still need to know created vs updated, so either read first inside a transaction or compare before/after.
- Equal `collected_at_utc` counts as stale/ignored (a retried identical request).
- `synced_at_utc` is the server clock at write time, not the client's.

## 5. `focus_entries`

- Every user must appear, including those with zero sessions. A `LEFT JOIN` where the time filter is in the **ON** clause (not WHERE) keeps users with no rows. Putting it in WHERE silently drops them.
- Wrap the sum in `COALESCE(..., 0)`.
- Pass the window as `to_utc_iso(window.start_utc)` and `to_utc_iso(window.end_utc)`.

## 6. `screen_entries`

- Same LEFT JOIN trap as above, across three tables (users -> devices -> screen_usage_daily).
- Distinguish "no rows" (`COUNT(*) = 0` -> `no_data`, `duration_seconds=None`) from a real `0`. `SUM` of no rows is `NULL`, and `COALESCE(SUM, 0)` would erase that distinction. Check the count.
- `usage_date` is text, so `usage_date >= ? AND usage_date < ?` with `window.start_date.isoformat()` works.
- Staleness only applies if today (in the leaderboard timezone) lies inside the window. Parse `last_synced_at_utc` with `parse_utc_iso` and compare with `now`.
- A user with a device but no rows, and a user with no device at all, are both `no_data`.

## 7. `rank_entries`

- Partition into available / stale / no_data first, rank only the first group.
- Competition ranking: tied values share a rank and the following rank skips. Track the previous value and the index.
- Sort key for ties: `user_id`, to keep output stable.
- `order="asc"` flips the sort, not the partitioning.

## 8. Collector (`agent/collector.py`)

Do this first as the Lab 1 PoC, in a scratch script, before wiring it into the agent.

- `client.get_buckets()` returns a dict keyed by bucket id such as `aw-watcher-window_<host>`. Pick by prefix or by the bucket's `type` field (`currentwindow`, `afkstatus`).
- `aw_client.queries.canonicalEvents(DesktopQueryParams(bid_window=..., bid_afk=..., ...))` builds the window ∩ not-AFK query string. Append a final `RETURN = ...` statement; check the ActivityWatch query docs for a function that sums event durations. Run it with `client.query(query, [(start, end)])`, which returns one result per time period.
- Note `canonicalEvents` reads category settings from the server when `classes` is empty. If that causes trouble, build the query string by hand with `flood`, `filter_keyvals`, `filter_period_intersect`.
- Day window: aware datetimes in `cfg.timezone`, from local midnight to the next local midnight. Pass them to the client; aw-client wants aware datetimes.
- Compare with the ActivityWatch dashboard in the same conditions (same date, no browser-watcher overlay) before trusting the number. This is the Lab 1 acceptance check.
- Errors: wrap connection and query failures in `ActivityWatchUnavailable`. `main.py` already skips the upload when a `CollectorError` is raised, so a failure can never become a fake `0`.

Run the agent once against a running server:

```bash
export AGENT_DEVICE_ID=<uuid from scripts/init_db.py>
uv run --extra agent python -m agent.main --once
```

---

## Checking your work

- API contract and edge cases: `docs/api.md`.
- Interactive: `http://127.0.0.1:8000/docs`.
- No tests are included. The design doc's section 13 lists what to cover, and `tests/` is yours to fill. A reasonable fixture is a temporary DB file passed through `app.config.DB_PATH` plus `TestClient(app)`.

Quick manual check once focus works:

```bash
curl -s -X POST localhost:8000/api/focus-sessions -H 'content-type: application/json' -d '{
  "id":"6f1d2b2e-8d41-4c8e-9c0a-1f7d2f0b9a11","user_id":1,
  "started_at_utc":"2026-11-11T15:00:00Z","completed_at_utc":"2026-11-11T15:25:00Z",
  "focus_seconds":1500,"target_seconds":1500}'
# repeat the same command: still 200, still one row
curl -s 'localhost:8000/api/leaderboards?metric=focus&period=day&date=2026-11-11'
```
