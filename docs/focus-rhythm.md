# Focus Rhythm

Focus comparison displays a rhythm card for each user. Cards follow the same
Daily / Weekly / Monthly and recorded-period controls. They update after a
completed session syncs and during normal polling. Current periods describe
results so far; offline/error states clear outdated labels.

All classification uses the existing project timezone, **America/Chicago**,
shown above the cards. There is no new per-user timezone preference. These are
descriptive product labels, not assessments of productivity or biological chronotype.

| English label | Local time window |
|---|---|
| Before-Dawn Learner | 02:00–06:00 |
| Early Bird | 06:00–10:00 |
| Midday Focuser | 10:00–14:00 |
| Afternoon Learner | 14:00–18:00 |
| Evening Learner | 18:00–22:00 |
| Night Owl | 22:00–02:00 |

Windows include their start and exclude their end. The leading window needs
at least 50% of credited focus seconds and a lead of at least 15 percentage
points over the runner-up. Classification uses unrounded durations; percentages
round only for display. If neither condition is met, display **Flexible Focuser**.

| Period | Minimum credited duration | Minimum distinct active dates |
|---|---|---|
| Day (00:00 to next midnight) | 25 minutes | 1 |
| Week (Monday through Sunday) | 100 minutes | 3 |
| Calendar month | 300 minutes | 7 |

Zero credited time shows **No Focus Yet**. Positive time below either minimum
shows **Discovering Your Rhythm**, with progress toward both requirements.
Weekly/monthly labels aggregate original focus seconds, never daily-label votes.

## Active intervals and old records

New timer sessions submit optional `active_segments` containing timezone-aware
`started_at_utc` / `ended_at_utc` pairs, with fractional seconds preserved.
Manual pause and screen lock close the current interval; resuming opens another.
Stop-and-save freezes intervals before the durable outbox write. Reloads, caps,
late reopening and outbox retries keep the same intervals and UUID. Cancelled
sessions and breaks contribute nothing. A session already running during an
upgrade retains legacy attribution rather than inventing past pause times.

The server validates ordered, non-overlapping positive intervals within the
session's whole-second boundaries (allowing the discarded end fraction). The
floor of their combined duration must equal `focus_seconds`. Segment content
participates in immutable retries; intervals and their session save atomically.
Count-up interval credit is scaled proportionally to the saved whole-second
duration, so discarded fractions cannot inflate recorded focus totals.

Startup creates `focus_session_segments` without rewriting existing history.
Legacy requests/outbox entries without intervals remain accepted. Their saved
focus seconds are distributed uniformly across their start-to-completion span,
and cards explicitly disclose the amount of **estimated timing**. This preserves
the original focus duration but cannot reconstruct historical pauses.

Intervals are split at window boundaries and local midnight, clipped to the
selected day/week/month. A 23:30–00:30 session contributes 30 minutes to each
day, all as Night Owl. UTC stepping handles Chicago's 23/25-hour DST dates.
The history menu includes dates touched by intervals/legacy estimates, as well
as completion dates, so preceding dates remain selectable.

## API and existing chart totals

`GET /api/focus-stats` adds `series[].rhythm` with:

- `key`, `label`, `emoji`;
- `total_seconds`, `active_days`, `estimated_seconds`;
- `minimum_seconds`, `minimum_days`;
- `windows`: six objects with `key`, `label`, `emoji`, `time_range`,
  `duration_seconds`, and fractional `share` (0–1).

The existing bars, personal stats and rankings retain completion attribution.
Their totals can differ from the interval-based rhythm totals at calendar
boundaries. The page explains this distinction. No existing ranking rule changes.

## Verification

Run `uv run --no-sync pytest -q` and `npm test` in the normal project environment.
Service-only checks can also run with
`python -m unittest discover -s tests -p test_focus_rhythm.py -v` (Pydantic 2 required).
Coverage includes all labels, exact thresholds, active-day minimums, pauses,
midnight/month splits, DST, estimates, immutable retries, invalid intervals,
subsecond precision, timer reload/retry behavior and UI/offline updates.
