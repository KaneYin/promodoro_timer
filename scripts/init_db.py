"""Create the SQLite database, apply schema.sql and seed.sql, and print the result.

    uv run python scripts/init_db.py

Safe to run repeatedly. Prints the device UUIDs the Screen Time Agent needs.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, database  # noqa: E402


def main() -> None:
    conn = database.connect()
    try:
        database.init_db(conn)
        print(f"Database: {config.DB_PATH}")
        print("\nUsers and devices:")
        rows = conn.execute(
            """SELECT u.id, u.display_name, d.id AS device_id, d.device_name, d.timezone
               FROM users u LEFT JOIN devices d ON d.user_id = u.id ORDER BY u.id"""
        ).fetchall()
        for r in rows:
            print(f"  user {r['id']}: {r['display_name']}")
            print(f"    device {r['device_id']}  ({r['device_name']}, {r['timezone']})")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
