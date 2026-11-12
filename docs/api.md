# REST API

Base path `/api`. JSON in, JSON out. Interactive docs from the running server: `/docs`.
There is no authentication in the MVP (access control is Tailscale, see `deployment.md`).

## Conventions

| Item | Rule |
|---|---|
| Instants | UTC, `YYYY-MM-DDTHH:MM:SSZ`. Requests may use any timezone offset. They are normalised to UTC and truncated to whole seconds. Naive timestamps are rejected (422). |
| Dates | `YYYY-MM-DD`. Meaning is "calendar date in `America/Chicago`". |
| IDs | `id` and `device_id` are UUID strings. `user_id` is an integer. |
| Durations | Integer seconds. |

### Error body

```json
{ "detail": "human readable message", "code": "machine_readable_code" }
```

Request-shape errors (wrong type, missing field, bad enum) come from FastAPI with status 422 and `detail` as a list of problems, without `code`.

| Status | Meaning | Codes |
|---|---|---|
| 404 | Referenced user or device does not exist | `user_not_found`, `device_not_found` |
| 409 | Same session id, different content | `session_conflict` |
| 422 | Shape or business-rule violation | `invalid_data` and the more specific codes below |
| 503 | Database connection/query unavailable | `database_unavailable` |

Business-rule 422 codes: `target_out_of_range`, `session_not_completed`, `invalid_time_span`, `time_in_future`, `invalid_date_range`, `usage_too_large`. Unsupported calendar boundaries such as a day ending after year 9999 return `invalid_date_range`.

---

## GET `/api/health`

`200` `{"status": "ok", "database": "connected"}`. Checks access to the users table. Connection and query failures return `503 database_unavailable`.

## GET `/api/users`

`200`
```json
[{"id": 1, "display_name": "Yinkun"}, {"id": 2, "display_name": "Ruiping"}]
```

---

## POST `/api/focus-sessions`

Save one completed session. **Idempotent per `id`.**

Request
```json
{
  "id": "6f1d2b2e-8d41-4c8e-9c0a-1f7d2f0b9a11",
  "user_id": 1,
  "started_at_utc": "2026-11-11T15:00:00Z",
  "completed_at_utc": "2026-11-11T15:25:00Z",
  "focus_seconds": 1500,
  "target_seconds": 1500
}
```

Response `200`
```json
{ "id": "6f1d2b2e-8d41-4c8e-9c0a-1f7d2f0b9a11", "saved": true }
```

| Situation | Result |
|---|---|
| New id | Row inserted, `200`, `saved: true` |
| Same id, identical content | No new row, `200`, `saved: true` |
| Same id, different content | `409 session_conflict` |
| Unknown `user_id` | `404 user_not_found` |
| Breaks a business rule | `422` |
| `focus_seconds <= 0`, bad UUID, naive timestamp | `422` (FastAPI) |

Business rules enforced by the service (see `focus_service.py`): target within configured bounds; `focus_seconds == target_seconds` (only completed sessions count); `completed_at_utc` after `started_at_utc` and the span at least `focus_seconds`; `completed_at_utc` not in the future (small clock skew allowed).

The browser retries this call until it gets a 2xx or a permanent 4xx, so every rule above must be safe to hit twice.

## GET `/api/focus-sessions`

Completed sessions of one user, newest first.

| Param | Required | Notes |
|---|---|---|
| `user_id` | yes | integer |
| `start_date` | no | inclusive local date |
| `end_date` | no | inclusive local date |

Filtering is by `completed_at_utc` falling inside the local-date range.

Response `200`: array of
```json
{
  "id": "6f1d2b2e-8d41-4c8e-9c0a-1f7d2f0b9a11",
  "user_id": 1,
  "started_at_utc": "2026-11-11T15:00:00Z",
  "completed_at_utc": "2026-11-11T15:25:00Z",
  "focus_seconds": 1500,
  "target_seconds": 1500
}
```
Errors: `404 user_not_found`, `422 invalid_date_range` when `end_date < start_date`.

---

## PUT `/api/screen-usage/daily`

Called by the agent. Stores one device's cumulative active seconds for one local day. **A snapshot, not an increment.**

Request
```json
{
  "device_id": "15ba172f-e397-4155-8285-6757a75875f1",
  "usage_date": "2026-11-11",
  "active_seconds": 14220,
  "collected_at_utc": "2026-11-11T23:00:00Z"
}
```

Response `200`
```json
{ "device_id": "15ba172f-...", "usage_date": "2026-11-11", "result": "updated" }
```

| `result` | Meaning |
|---|---|
| `created` | First row for this (device, date). |
| `updated` | An existing row was replaced because `collected_at_utc` is newer. The value may be lower than before. |
| `ignored_stale` | The server already has an equal or newer collection. Nothing changed. Not an error. |

Errors: `404 device_not_found`; `422` for `active_seconds` above 25 h, `usage_date` after today, `collected_at_utc` in the future, or `active_seconds < 0`.

Concurrent decisions are serialized in a writer transaction, so the reported result matches the actual write.

---

## GET `/api/leaderboards`

| Param | Required | Values | Default |
|---|---|---|---|
| `metric` | yes | `focus`, `screen` | |
| `period` | yes | `day`, `week`, `month` | |
| `date` | no | `YYYY-MM-DD` | today in `America/Chicago` |
| `order` | no | `asc`, `desc` | `desc` for focus, `asc` for screen |

The window is the day/week (Monday start)/month containing `date`.

Response `200`
```json
{
  "metric": "screen",
  "period": "week",
  "period_start": "2026-11-09",
  "period_end_exclusive": "2026-11-16",
  "timezone": "America/Chicago",
  "order": "asc",
  "generated_at_utc": "2026-11-11T21:04:10Z",
  "entries": [
    {
      "user_id": 1,
      "display_name": "Yinkun",
      "duration_seconds": 15780,
      "rank": 1,
      "data_status": "available",
      "last_synced_at_utc": "2026-11-11T21:00:02Z",
      "days_with_data": 3,
      "days_expected": 3
    },
    {
      "user_id": 2,
      "display_name": "Ruiping",
      "duration_seconds": null,
      "rank": null,
      "data_status": "no_data",
      "last_synced_at_utc": null,
      "days_with_data": 0,
      "days_expected": 3
    }
  ]
}
```

### Entry fields

| Field | Focus | Screen |
|---|---|---|
| `duration_seconds` | Sum, `0` if no sessions | Sum; `null` when `no_data` |
| `rank` | 1-based; ties share a rank (1, 1, 3) | Same, but only `available` entries are ranked |
| `data_status` | Always `available` | `available`, `partial`, `stale`, `no_data` |
| `last_synced_at_utc` | `null` | Today's row's receipt for current windows, or latest receipt for historical windows; `null` if absent |
| `days_with_data` | `null` | Number of days in the window that have a row |
| `days_expected` | `null` | Number of elapsed dates in the period, including today and excluding future dates |

### Ordering of `entries`
1. Ranked entries, sorted by `duration_seconds` in `order`.
2. `partial` entries, sorted by user id.
3. `stale` entries, sorted by user id.
4. `no_data` entries, sorted by user id.

### Screen data status
- `no_data`: no daily row in the elapsed portion of the window. This is **not zero**.
- `stale`: rows exist, the window contains today, and today's row is absent or either its collection or receipt time is older than `SCREEN_STALE_AFTER_SECONDS` (20 minutes by default).
- `partial`: rows exist and freshness passes, but fewer than `days_expected` dates have records.
- `available`: all elapsed dates have records, and today's data is fresh if the window includes today.

Status precedence is no_data, stale, partial, available. Historical windows are not stale but can be partial. Future-only windows have no_data and zero expected dates. Backfilling yesterday does not refresh today's row. Date coverage does not prove uninterrupted observation within each day; see [design.md](design.md).
