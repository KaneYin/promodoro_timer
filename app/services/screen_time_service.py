"""Screen Time ingestion (design doc 4.2, 5.4, 6.3)."""

import sqlite3

from app.schemas import ScreenUsageIn, ScreenUsageSavedOut


def upsert_daily_usage(
    conn: sqlite3.Connection, payload: ScreenUsageIn
) -> ScreenUsageSavedOut:
    """Store one device's cumulative active seconds for one local day.

    TODO(core): implement. See docs/implementation-guide.md, item 4.

    Contract (docs/api.md, PUT /api/screen-usage/daily):
      1. device_id must be registered              -> NotFoundError("device_not_found")
      2. Sanity checks                             -> InvalidDataError(<code>)
         - active_seconds <= config.SCREEN_MAX_DAILY_SECONDS
         - usage_date is not after today in the leaderboard timezone
         - collected_at_utc is not in the future (allow CLOCK_SKEW_TOLERANCE_SECONDS)
      3. Write rules (the value is a cumulative snapshot, never added):
         - no row for (device_id, usage_date)       -> INSERT          -> result "created"
         - row exists, payload.collected_at_utc is NEWER than stored -> overwrite
           active_seconds, collected_at_utc and synced_at_utc          -> "updated"
         - row exists, payload is older or equal      -> change nothing -> "ignored_stale"
           (HTTP 200, not an error. The agent just retried or raced.)
      4. synced_at_utc = app.timeutil.utc_now_iso() at the moment of the write.
         Do NOT use MAX(active_seconds): historical totals may legitimately shrink.

    Hint: do the compare-and-write atomically. A single
    `INSERT ... ON CONFLICT(...) DO UPDATE ... WHERE excluded.collected_at_utc > ...`
    is one way. Use cursor.rowcount / a prior SELECT to tell the three outcomes apart.
    """
    raise NotImplementedError("TODO(core): upsert_daily_usage")
