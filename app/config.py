"""Central configuration. Every value can be overridden by an environment variable."""

import os
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent.parent


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


# --- Paths -------------------------------------------------------------------
DB_PATH = Path(os.environ.get("FOCUS_DB_PATH", BASE_DIR / "data" / "focus.db"))
BACKUP_DIR = Path(os.environ.get("FOCUS_BACKUP_DIR", BASE_DIR / "data" / "backups"))
SCHEMA_PATH = BASE_DIR / "database" / "schema.sql"
SEED_PATH = BASE_DIR / "database" / "seed.sql"
STATIC_DIR = BASE_DIR / "app" / "static"

# --- Leaderboard time model (docs/design.md) -------------------------------
LEADERBOARD_TZ_NAME = "America/Chicago"
LEADERBOARD_TZ = ZoneInfo(LEADERBOARD_TZ_NAME)

# --- Focus session validation (used by focus_service) -----------------------
# Bounds for target_seconds. The default Pomodoro is 1500 (25 min).
FOCUS_MIN_TARGET_SECONDS = _int_env("FOCUS_MIN_TARGET_SECONDS", 60)
FOCUS_MAX_TARGET_SECONDS = _int_env("FOCUS_MAX_TARGET_SECONDS", 4 * 3600)
COUNTUP_MAX_SECONDS = 2 * 3600
# Allowed clock error between client and server when checking "not in the future".
CLOCK_SKEW_TOLERANCE_SECONDS = _int_env("CLOCK_SKEW_TOLERANCE_SECONDS", 300)

# --- Screen time (used by screen_time_service / leaderboard_service) --------
# A device whose last sync is older than this is "stale" for the current period.
SCREEN_STALE_AFTER_SECONDS = _int_env("SCREEN_STALE_AFTER_SECONDS", 20 * 60)
# A local day can be 23, 24 or 25 hours long (DST); 25h is the upper bound.
SCREEN_MAX_DAILY_SECONDS = 25 * 3600

# --- Backups ----------------------------------------------------------------
BACKUP_KEEP = _int_env("FOCUS_BACKUP_KEEP", 14)
