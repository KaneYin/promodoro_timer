"""Time-of-day rhythms, independent of the chart's completion attribution.

New records use active intervals. Legacy focus seconds are spread uniformly
over the recorded wall-clock span and always marked as estimated. No historical
row is rewritten. Credit is clipped to the requested local calendar window.
"""

import sqlite3
from datetime import datetime, timedelta

from app import config
from app.periods import PeriodWindow
from app.schemas import FocusRhythm, FocusRhythmWindow
from app.timeutil import parse_utc_iso, to_utc_iso

# Chronological from 02:00; all windows are half-open and four hours long.
WINDOWS = (
    ("before_dawn", "Before-Dawn Learner", "🌌", "2 AM–6 AM"),
    ("early_bird", "Early Bird", "🐦", "6 AM–10 AM"),
    ("midday", "Midday Focuser", "☀️", "10 AM–2 PM"),
    ("afternoon", "Afternoon Learner", "🌤️", "2 PM–6 PM"),
    ("evening", "Evening Learner", "🌆", "6 PM–10 PM"),
    ("night_owl", "Night Owl", "🦉", "10 PM–2 AM"),
)
MINIMUMS = {"day": (1500, 1), "week": (6000, 3), "month": (18000, 7)}


def classify(seconds: list[float], active_days: int, period: str) -> tuple[str, str, str]:
    total = sum(seconds)
    minimum, days = MINIMUMS[period]
    if total <= 0:
        return "no_focus", "No Focus Yet", "🌱"
    if total + 1e-6 < minimum or active_days < days:
        return "discovering", "Discovering Your Rhythm", "🔎"
    ranked = sorted(range(len(seconds)), key=lambda i: seconds[i], reverse=True)
    first, second = (seconds[i] for i in ranked[:2])
    # Inclusive thresholds, calculated before any display rounding.
    if first * 2 + 1e-6 >= total and (first - second) * 100 + 1e-6 >= total * 15:
        return WINDOWS[ranked[0]][:3]
    return "flexible", "Flexible Focuser", "🎨"


def get_focus_rhythms(conn: sqlite3.Connection, window: PeriodWindow) -> dict[int, FocusRhythm]:
    rows = conn.execute(
        """SELECT f.id, f.user_id, f.started_at_utc, f.completed_at_utc,
                  f.focus_seconds, s.started_at_utc AS segment_start,
                  s.ended_at_utc AS segment_end
           FROM focus_sessions f LEFT JOIN focus_session_segments s ON s.session_id = f.id
           WHERE f.started_at_utc < ? AND f.completed_at_utc >= ?
           ORDER BY f.id, s.position""",
        (to_utc_iso(window.end_utc), to_utc_iso(window.start_utc)),
    ).fetchall()
    sessions = {}
    for row in rows:
        item = sessions.setdefault(row["id"], {"row": row, "segments": []})
        if row["segment_start"] is not None:
            item["segments"].append((datetime.fromisoformat(row["segment_start"]), datetime.fromisoformat(row["segment_end"])))
    totals = {}
    for item in sessions.values():
        row, segments = item["row"], item["segments"]
        estimated = not segments
        if estimated:
            segments = [(parse_utc_iso(row["started_at_utc"]), parse_utc_iso(row["completed_at_utc"]))]
        span = sum((end - start).total_seconds() for start, end in segments)
        if span <= 0:
            continue
        # Remove the discarded subsecond fraction of count-up sessions without
        # shifting any interval into pauses or changing its time-of-day shares.
        weight = row["focus_seconds"] / span
        values, days, estimate = totals.setdefault(row["user_id"], ([0.0] * 6, set(), [0.0]))
        for start, end in segments:
            start, end = max(start, window.start_utc), min(end, window.end_utc)
            while start < end:
                # Chicago offsets are whole hours. UTC stepping handles both
                # repeated fall-back hours and nonexistent spring-forward hours.
                boundary = start.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
                stop = min(end, boundary)
                local = start.astimezone(config.LEADERBOARD_TZ)
                credit = (stop - start).total_seconds() * weight
                values[((local.hour - 2) % 24) // 4] += credit
                days.add(local.date())
                if estimated:
                    estimate[0] += credit
                start = stop
    result = {}
    minimum, minimum_days = MINIMUMS[window.period]
    for user in conn.execute("SELECT id FROM users ORDER BY id"):
        values, days, estimate = totals.get(user["id"], ([0.0] * 6, set(), [0.0]))
        total = sum(values)
        key, label, emoji = classify(values, len(days), window.period)
        result[user["id"]] = FocusRhythm(
            key=key, label=label, emoji=emoji, total_seconds=total,
            active_days=len(days), minimum_seconds=minimum, minimum_days=minimum_days,
            estimated_seconds=estimate[0],
            windows=[FocusRhythmWindow(
                key=definition[0], label=definition[1], emoji=definition[2], time_range=definition[3],
                duration_seconds=seconds, share=seconds / total if total else 0,
            ) for definition, seconds in zip(WINDOWS, values)],
        )
    return result
