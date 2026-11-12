"""Focus session persistence and history (design doc 4.1, 5.3, 6.2).

Services take an open sqlite3 connection and raise app.errors exceptions.
They do not know about HTTP.
"""

import sqlite3
from datetime import date

from app.schemas import FocusSessionIn, FocusSessionOut, FocusSessionSavedOut


def save_focus_session(
    conn: sqlite3.Connection, payload: FocusSessionIn
) -> FocusSessionSavedOut:
    """Validate and store one completed Focus Session, idempotently.

    TODO(core): implement. See docs/implementation-guide.md, item 2.

    Contract (docs/api.md, POST /api/focus-sessions):
      1. user_id must exist                         -> NotFoundError("user_not_found")
      2. Business rules                             -> InvalidDataError(<code>)
         - config.FOCUS_MIN_TARGET_SECONDS <= target_seconds <= FOCUS_MAX_TARGET_SECONDS
         - the session is *completed*: focus_seconds == target_seconds
         - completed_at_utc > started_at_utc, and the wall-clock span is at least
           focus_seconds (pauses only make the span longer)
         - completed_at_utc is not in the future (allow CLOCK_SKEW_TOLERANCE_SECONDS)
      3. Same id already stored:
         - identical content                        -> success, no second row (HTTP 200)
         - different content                        -> ConflictError("session_conflict")
      4. Otherwise insert one row and return FocusSessionSavedOut(id=..., saved=True).

    payload timestamps are already aware UTC with microseconds stripped;
    store them with app.timeutil.to_utc_iso(). Ids are stored as str(payload.id).
    Use parameterised SQL only.
    """
    raise NotImplementedError("TODO(core): save_focus_session")


def list_focus_sessions(
    conn: sqlite3.Connection,
    user_id: int,
    start_date: date | None,
    end_date: date | None,
) -> list[FocusSessionOut]:
    """Completed sessions of one user whose *completion* falls in the date range.

    TODO(core): implement. See docs/implementation-guide.md, item 3.

    Contract (docs/api.md, GET /api/focus-sessions):
      - start_date / end_date are calendar dates in config.LEADERBOARD_TZ and both
        INCLUSIVE ("2026-11-11".."2026-11-11" = that whole local day).
      - Either bound may be omitted (open-ended).
      - end_date < start_date              -> InvalidDataError("invalid_date_range")
      - unknown user_id                    -> NotFoundError("user_not_found")
      - Convert the local dates to a UTC half-open window with
        periods.local_midnight_utc(start) .. local_midnight_utc(end + 1 day),
        then compare against completed_at_utc.
      - Order: completed_at_utc DESC.
    """
    raise NotImplementedError("TODO(core): list_focus_sessions")
