"""Active intervals shared by charts, rankings, and time-of-day rhythms."""

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.timeutil import to_utc_iso

MICROSECOND = timedelta(microseconds=1)


@dataclass
class FocusIntervals:
    user_id: int
    seconds: int
    estimated: bool
    segments: list[tuple[datetime, datetime]]

    def bucket_seconds(self, boundaries: list[datetime]) -> list[int]:
        """Allocate whole seconds consistently even when a bucket is queried alone."""
        result = [0] * (len(boundaries) - 1)
        span = sum((end - start) // MICROSECOND for start, end in self.segments)
        preceding = 0
        for start, end in self.segments:
            for index, (left, right) in enumerate(zip(boundaries, boundaries[1:])):
                overlap_start, overlap_end = max(start, left), min(end, right)
                if overlap_start < overlap_end:
                    before = preceding + (overlap_start - start) // MICROSECOND
                    after = preceding + (overlap_end - start) // MICROSECOND
                    result[index] += (
                        after * self.seconds // span - before * self.seconds // span
                    )
            preceding += (end - start) // MICROSECOND
        return result


def load_focus_intervals(
    conn: sqlite3.Connection,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[FocusIntervals]:
    # Filter on session bounds, then load every segment of matching sessions.
    # A segment outside this window still affects rounding inside the window.
    start_iso = to_utc_iso(start) if start is not None else None
    end_iso = to_utc_iso(end) if end is not None else None
    rows = conn.execute(
        """SELECT f.id, f.user_id, f.started_at_utc, f.completed_at_utc,
                  f.focus_seconds, s.started_at_utc AS segment_start,
                  s.ended_at_utc AS segment_end
           FROM focus_sessions f LEFT JOIN focus_session_segments s ON s.session_id = f.id
           WHERE (? IS NULL OR f.started_at_utc < ?)
             AND (? IS NULL OR f.completed_at_utc >= ?)
           ORDER BY f.id, s.position""",
        (end_iso, end_iso, start_iso, start_iso),
    )
    sessions: dict[str, FocusIntervals] = {}
    for row in rows:
        estimated = row["segment_start"] is None
        session = sessions.setdefault(
            row["id"],
            FocusIntervals(row["user_id"], row["focus_seconds"], estimated, []),
        )
        session.segments.append(
            (
                datetime.fromisoformat(
                    row["started_at_utc"] if estimated else row["segment_start"]
                ),
                datetime.fromisoformat(
                    row["completed_at_utc"] if estimated else row["segment_end"]
                ),
            )
        )
    return list(sessions.values())
