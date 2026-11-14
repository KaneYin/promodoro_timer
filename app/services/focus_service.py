"""Completed Focus sessions. BEGIN IMMEDIATE serializes concurrent retry checks."""

import sqlite3
from datetime import UTC, date, timedelta
from math import floor

from app import config
from app.errors import ConflictError, InvalidDataError, NotFoundError
from app.periods import local_midnight_utc
from app.schemas import FocusSessionIn, FocusSessionOut, FocusSessionSavedOut
from app.timeutil import to_utc_iso, utc_now


def _segments(payload: FocusSessionIn) -> list[tuple[str, str]]:
    if payload.active_segments is None:
        return []
    previous = payload.started_at_utc
    total = 0.0
    values = []
    for segment in payload.active_segments:
        start = segment.started_at_utc.astimezone(UTC)
        end = segment.ended_at_utc.astimezone(UTC)
        if start < previous or end <= start or end >= payload.completed_at_utc + timedelta(seconds=1):
            raise InvalidDataError(
                "Active segments must be ordered, non-overlapping and inside the session",
                code="invalid_active_segments",
            )
        total += (end - start).total_seconds()
        previous = end
        values.append((start.isoformat(), end.isoformat()))
    if floor(total + 1e-6) != payload.focus_seconds:
        raise InvalidDataError(
            "Active segment duration must match focus_seconds (whole seconds)",
            code="invalid_active_segments",
        )
    return values


def _require_user(conn: sqlite3.Connection, user_id: int) -> None:
    if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
        raise NotFoundError("User does not exist", code="user_not_found")


def save_focus_session(
    conn: sqlite3.Connection, payload: FocusSessionIn
) -> FocusSessionSavedOut:
    """Save once per UUID; compare normalized content on every retry.

    The writer lock covers lookup and insert together. A competing request waits,
    then sees the committed row. Identical retries also survive later config changes.
    """
    values = {
        "id": str(payload.id),
        "user_id": payload.user_id,
        "started_at_utc": to_utc_iso(payload.started_at_utc),
        "completed_at_utc": to_utc_iso(payload.completed_at_utc),
        "focus_seconds": payload.focus_seconds,
        "target_seconds": payload.target_seconds,
        "mode": payload.mode,
    }
    segments = _segments(payload)
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_user(conn, payload.user_id)
        existing = conn.execute(
            "SELECT * FROM focus_sessions WHERE id = ?", (values["id"],)
        ).fetchone()
        if existing is not None:
            saved_segments = [tuple(row) for row in conn.execute(
                "SELECT started_at_utc, ended_at_utc FROM focus_session_segments "
                "WHERE session_id = ? ORDER BY position", (values["id"],)
            )]
            if dict(existing) != values or saved_segments != segments:
                raise ConflictError(
                    "Session id already has different content", code="session_conflict"
                )
            return FocusSessionSavedOut(id=payload.id, saved=True)
        if payload.mode == "countup":
            if payload.target_seconds != config.COUNTUP_MAX_SECONDS:
                raise InvalidDataError(
                    "Count-up target must be exactly two hours",
                    code="target_out_of_range",
                )
            if payload.focus_seconds > config.COUNTUP_MAX_SECONDS:
                raise InvalidDataError(
                    "Count-up duration cannot exceed two hours",
                    code="focus_out_of_range",
                )
        else:
            if (
                not config.FOCUS_MIN_TARGET_SECONDS
                <= payload.target_seconds
                <= config.FOCUS_MAX_TARGET_SECONDS
            ):
                raise InvalidDataError(
                    "Target duration is outside configured bounds",
                    code="target_out_of_range",
                )
            if payload.focus_seconds != payload.target_seconds:
                raise InvalidDataError(
                    "Only completed Pomodoro sessions can be saved",
                    code="session_not_completed",
                )
        span = (payload.completed_at_utc - payload.started_at_utc).total_seconds()
        if span < payload.focus_seconds:
            raise InvalidDataError(
                "Session time span is shorter than its focus duration",
                code="invalid_time_span",
            )
        if payload.completed_at_utc > utc_now() + timedelta(
            seconds=config.CLOCK_SKEW_TOLERANCE_SECONDS
        ):
            raise InvalidDataError(
                "Completion time is in the future", code="time_in_future"
            )
        conn.execute(
            """INSERT INTO focus_sessions
               (id, user_id, started_at_utc, completed_at_utc, focus_seconds, target_seconds, mode)
               VALUES (:id, :user_id, :started_at_utc, :completed_at_utc, :focus_seconds, :target_seconds, :mode)""",
            values,
        )
        conn.executemany(
            "INSERT INTO focus_session_segments "
            "(session_id, position, started_at_utc, ended_at_utc) VALUES (?, ?, ?, ?)",
            [(values["id"], i, start, end) for i, (start, end) in enumerate(segments)],
        )
    return FocusSessionSavedOut(id=payload.id, saved=True)


def list_focus_sessions(
    conn: sqlite3.Connection,
    user_id: int,
    start_date: date | None,
    end_date: date | None,
) -> list[FocusSessionOut]:
    """Filter by completion time; both supplied local calendar bounds are inclusive."""
    _require_user(conn, user_id)
    if start_date and end_date and end_date < start_date:
        raise InvalidDataError(
            "end_date must not precede start_date", code="invalid_date_range"
        )
    conditions, values = ["user_id = ?"], [user_id]
    try:
        if start_date:
            conditions.append("completed_at_utc >= ?")
            values.append(to_utc_iso(local_midnight_utc(start_date)))
        if end_date:
            conditions.append("completed_at_utc < ?")
            values.append(to_utc_iso(local_midnight_utc(end_date + timedelta(days=1))))
    except (ValueError, OverflowError) as exc:
        raise InvalidDataError(
            "Date is outside the supported calendar range", code="invalid_date_range"
        ) from exc
    rows = conn.execute(
        "SELECT * FROM focus_sessions WHERE "
        + " AND ".join(conditions)
        + " ORDER BY completed_at_utc DESC, id",
        values,
    ).fetchall()
    return [FocusSessionOut(**dict(row)) for row in rows]
