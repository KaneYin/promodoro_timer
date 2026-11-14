-- Focus Tracker schema (SQLite). Safe to run repeatedly.
-- Details and rationale: docs/database.md

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    device_name TEXT NOT NULL,
    timezone TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    started_at_utc TEXT NOT NULL,
    completed_at_utc TEXT NOT NULL,
    focus_seconds INTEGER NOT NULL,
    target_seconds INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'pomodoro' CHECK (mode IN ('pomodoro', 'countup')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    CHECK (focus_seconds > 0),
    CHECK (target_seconds > 0)
);

-- Serves "sessions of user X completed in [start, end)" (history + leaderboard).
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_completed
    ON focus_sessions (user_id, completed_at_utc);

CREATE TABLE IF NOT EXISTS screen_usage_daily (
    device_id TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    active_seconds INTEGER NOT NULL,
    collected_at_utc TEXT NOT NULL,
    synced_at_utc TEXT NOT NULL,
    PRIMARY KEY (device_id, usage_date),
    FOREIGN KEY (device_id) REFERENCES devices(id),
    CHECK (active_seconds >= 0)
);
