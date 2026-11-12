"""Online SQLite backup (safe while the server is running).

    uv run python scripts/backup_db.py            # backup now, prune old ones
    uv run python scripts/backup_db.py --verify   # also open the copy and run integrity_check

Uses sqlite3.Connection.backup(), which copies a consistent snapshot even in WAL mode.
Restore = stop the server, copy a backup over data/focus.db (delete focus.db-wal and
focus.db-shm first), start the server. Details: docs/deployment.md.
"""

import argparse
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402

PREFIX = "focus-"


def backup(verify: bool) -> Path:
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    # O_EXCL allocation also protects concurrent invocations, not just subsecond runs.
    fd, name = tempfile.mkstemp(
        prefix=f"{PREFIX}{datetime.now():%Y%m%d-%H%M%S-%f}-",
        suffix=".tmp",
        dir=config.BACKUP_DIR,
    )
    os.close(fd)
    target = Path(name)

    try:
        with closing(
            sqlite3.connect(f"{config.DB_PATH.resolve().as_uri()}?mode=ro", uri=True)
        ) as src:
            with closing(sqlite3.connect(target)) as dst:
                src.backup(dst)
        if verify:
            with closing(sqlite3.connect(target)) as check:
                result = check.execute("PRAGMA integrity_check").fetchone()[0]
                tables = {
                    r[0]
                    for r in check.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
            if result != "ok" or not {
                "users",
                "devices",
                "focus_sessions",
                "screen_usage_daily",
            }.issubset(tables):
                raise RuntimeError(
                    f"Backup verification failed: {result}, tables={sorted(tables)}"
                )
            print(f"Verified: integrity ok, tables = {sorted(tables)}")
        complete = target.with_suffix(".db")
        target.rename(complete)
        return complete
    except Exception:
        target.unlink(missing_ok=True)
        raise


def prune() -> None:
    if config.BACKUP_KEEP < 1:
        raise SystemExit("FOCUS_BACKUP_KEEP must be at least 1")
    files = sorted(config.BACKUP_DIR.glob(f"{PREFIX}*.db"))
    for old in files[: max(0, len(files) - config.BACKUP_KEEP)]:
        old.unlink()
        print(f"Pruned {old.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--verify", action="store_true", help="integrity-check the copy"
    )
    args = parser.parse_args()

    if not config.DB_PATH.exists():
        raise SystemExit(f"No database at {config.DB_PATH}")
    print(f"Backup written: {backup(args.verify)}")
    prune()


if __name__ == "__main__":
    main()
