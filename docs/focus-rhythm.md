# Focus Rhythm

Leaderboards display a compact personality icon beside each user's name. Hover
or keyboard-focus the icon to read its established label. Expand **Details** for
an accessible pie chart, all six window percentages and durations, minimum-data
progress, and any legacy estimate disclosure. Details remain open during polling
for the same period and reset when the selected period changes.

The Focus comparison date menu and both sets of Daily / Weekly / Monthly buttons
share one selection. Choosing a historical date updates the rankings and icons
to that date; weekly/monthly selections use their full calendar window. Current
selections follow the Chicago date at midnight; historical selections stay fixed.
Both leaderboard metrics show a personality based on **focus** time, independently
of screen-data availability. Offline/error states clear outdated labels.

The corner **Rules** link opens the read-only `/personality-rules.html` page in
a new tab, with concise tables of time windows, minimum data, and label rules.

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
Manual pause and detected screen lock close the current interval. After a long
browser interruption, the timer closes it at the last running checkpoint.
Resuming opens another interval. Stop-and-save freezes intervals before the
durable outbox write. Caps and outbox retries keep the same intervals and UUID. Cancelled
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
and Details explicitly discloses the amount of **estimated timing**. This preserves
the original focus duration but cannot reconstruct historical pauses.

Intervals are split at window boundaries and local midnight, clipped to the
selected day/week/month. A 23:30–00:30 session contributes 30 minutes to each
day, all as Night Owl. UTC stepping handles Chicago's 23/25-hour DST dates.
The history menu includes dates touched by intervals or legacy estimates, including days before completion.

## API and chart totals

`GET /api/focus-stats` adds `series[].rhythm` with:

- `key`, `label`, `emoji`;
- `total_seconds`, `active_days`, `estimated_seconds`;
- `minimum_seconds`, `minimum_days`;
- `windows`: six objects with `key`, `label`, `emoji`, `time_range`,
  `duration_seconds`, and fractional `share` (0–1).

`GET /api/leaderboards` also returns this object in `entries[].rhythm`, calculated
for its requested `period` and `date`. Attaching it to the same response prevents
an icon from being paired with a ranking for a different window. Classification
and stored data are unchanged by the compact presentation.

Bars, personal focus durations and Focus rankings use the same intervals and legacy estimates. They allocate whole seconds cumulatively for consistent totals across calendar periods. Rhythm retains fractional proportions for classification.

## Verification

Run `uv run --no-sync pytest -q` and `npm test` in the normal project environment.
Service-only checks can also run with
`python -m unittest discover -s tests -p test_focus_rhythm.py -v` (Pydantic 2 required).
Coverage includes all labels, exact thresholds, active-day minimums, pauses,
midnight/month splits, DST, estimates, immutable retries, invalid intervals,
subsecond precision, timer reload/retry behavior and UI/offline updates.
