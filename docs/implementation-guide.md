# Learning guide: scaffold to reference

`main` contains the original ten TODO functions. This branch implements them and fixes the surrounding bugs. Use separate practice/reference branches so your own work remains intact. The complete specification is [design.md](design.md), with exact payloads in [api.md](api.md).

## Suggested implementation order

| Step | File / functions | What to check before continuing |
|---|---|---|
| 1 | `app/periods.py`: `local_midnight_utc`, `resolve_window` | DST days, Monday weeks, December rollover |
| 2 | `app/services/focus_service.py`: `save_focus_session` | Validation, same-id retry, conflicting content, concurrent requests |
| 3 | `app/services/focus_service.py`: `list_focus_sessions` | Inclusive dates, UTC conversion, open-ended bounds |
| 4 | `app/services/leaderboard_service.py`: `focus_entries` | Every user appears, including zero |
| 5 | `app/services/leaderboard_service.py`: `rank_entries` | Ascending/descending, ties, unranked groups |
| 6 | `agent/collector.py`: `discover_buckets`, `compute_active_seconds` | Same-host pair, window intersected with not-AFK, no fake zeros |
| 7 | `app/services/screen_time_service.py`: `upsert_daily_usage` | Newer snapshots overwrite; stale requests do nothing |
| 8 | `app/services/leaderboard_service.py`: `screen_entries` | Real zero, missing data, partial dates, today's freshness |

After step 5, Focus can work end to end. Test the ActivityWatch query locally before enabling automatic uploads.

## Why the reference makes these choices

### Calendar windows

Compute local calendar dates first, construct each boundary at local midnight, then convert each to UTC. Never derive tomorrow's UTC midnight by adding 24 hours. In Chicago, 2026-03-08 is 23 hours and 2026-11-01 is 25 hours. `resolve_window` uses half-open boundaries; history's inclusive end date becomes the next local midnight.

### Focus saving and errors

The UUID is the idempotency key. Normalize offsets and truncate microseconds before comparing every stored field. The reference acquires `BEGIN IMMEDIATE` before lookup and insert, so two writers cannot both decide an id is new. The transaction context commits on success and rolls back on exceptions. Identical saved retries return success even if validation settings changed later.

Exception constructors accept `(message, code=None)`. Write `NotFoundError("User does not exist", code="user_not_found")`; a positional `"user_not_found"` alone changes the message, not the machine code.

### Aggregation and missing data

Keep time predicates inside a `LEFT JOIN`'s `ON` clause to preserve empty users. For Focus, `COALESCE(SUM(...), 0)` is correct. For Screen Time, first determine whether any right-side rows exist: `COUNT(s.usage_date)` works; `COUNT(*)` does not, because even an unmatched left join contributes a row. The reference groups joined daily rows in Python to make coverage and freshness explicit.

Screen data has two independent checks: coverage of elapsed dates, and freshness of today's row. Historical reuploads must not refresh today. See the exact status precedence in [design.md](design.md). Only `available` entries receive competition ranks; sorting ties by user id makes output stable. Ranking returns copies instead of mutating its inputs.

### Screen snapshots

Use one row per `(device_id, usage_date)`. A newer collection replaces the total, even if the new value is lower. Older or equal timestamps leave all columns unchanged, including `synced_at_utc`. The reference uses a writer transaction so both the overwrite decision and the `created` / `updated` / `ignored_stale` result are consistent under concurrency.

### ActivityWatch

Pair window and AFK buckets from the same host. Build a query using exact, escaped bucket ids:

1. Fetch window events and AFK events with `flood(query_bucket(...))`.
2. Keep `status == "not-afk"` events.
3. Intersect window events with those periods.
4. Return `sum_durations(events)` only.

No category settings or browser-watcher overlay is needed. Query errors and malformed results raise a collector error and skip the upload. Successful zero is different from failure. Days entirely before the required buckets existed are skipped. Partial tracking within a day cannot be detected from daily totals alone.

Official references: [query examples](https://docs.activitywatch.net/en/latest/examples/querying-data.html), [Python API](https://docs.activitywatch.net/en/latest/api/python.html).

### Browser durability

The outbox write precedes the timer's transition to Break. Every pending session has its own storage key; removing one UUID cannot overwrite a concurrent enqueue for another. Rejections are written before pending data is removed. Legacy array queues migrate automatically. Web Locks serialize timer controls between tabs where supported; the server still deduplicates replayed UUIDs.

## Compare and verify

```bash
git diff main..reference/complete-implementation -- app/periods.py
git diff main..reference/complete-implementation -- app/services/focus_service.py
uv sync --extra agent
uv run --no-sync pytest -q
npm test
```

Read tests as behavior examples, especially DST filtering, concurrency, decreased Screen Time totals and historical-backfill freshness. For full HTTP and browser acceptance steps, use [testing.md](testing.md).
