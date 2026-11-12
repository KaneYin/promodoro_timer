"""Online SQLite backup (safe while the server is running).

    uv run python scripts/backup_db.py            # backup now, prune old ones
    uv run python scripts/backup_db.py --verify   # also open the copy and run integrity_check

Uses sqlite3.Connection.backup(), which copies a consistent snapshot even in WAL mode.
Restore = stop the server, copy a backup over data/focus.db (delete focus.db-wal and
focus.db-shm first), start the server. Details: docs/deployment.md.
"""

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402

PREFIX = "focus-"


def backup(verify: bool) -> Path:
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = config.BACKUP_DIR / f"{PREFIX}{datetime.now():%Y%m%d-%H%M%S}.db"

    src = sqlite3.connect(config.DB_PATH)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    if verify:
        check = sqlite3.connect(target)
        try:
            result = check.execute("PRAGMA integrity_check").fetchone()[0]
            tables = check.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()
        finally:
            check.close()
        if result != "ok":
            raise SystemExit(f"Backup verification failed: {result}")
        print(f"Verified: integrity ok, tables = {[t[0] for t in tables]}")
    return target


def prune() -> None:
    files = sorted(config.BACKUP_DIR.glob(f"{PREFIX}*.db"))
    for old in files[: max(0, len(files) - config.BACKUP_KEEP)]:
        old.unlink()
        print(f"Pruned {old.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--verify", action="store_true", help="integrity-check the copy")
    args = parser.parse_args()

    if not config.DB_PATH.exists():
        raise SystemExit(f"No database at {config.DB_PATH}")
    print(f"Backup written: {backup(args.verify)}")
    prune()


if __name__ == "__main__":
    main()
