"""Screen Time Agent: collect from ActivityWatch, upload to the server, repeat.

    uv run --extra agent python -m agent.main                  # loop forever
    uv run --extra agent python -m agent.main --once           # one cycle, then exit
    uv run --extra agent python -m agent.main --once --backfill-days 30

Each cycle re-computes today plus the previous (lookback - 1) days and uploads
every day. That heals late ActivityWatch writes and outages shorter than the lookback.
"""

import argparse
import logging
import time
from datetime import UTC, datetime, timedelta

from agent import collector, sync_client
from agent.config import AgentConfig, load_config

log = logging.getLogger("agent")


def run_cycle(cfg: AgentConfig, days: int) -> bool:
    """One sync pass. Returns True if every day was collected and uploaded."""
    today = datetime.now(cfg.timezone).date()
    dates = [today - timedelta(days=i) for i in range(days)]

    try:
        client = collector.open_client(cfg)
        buckets = collector.discover_buckets(client)
    except collector.CollectorError as exc:
        # ActivityWatch is down or incomplete: upload nothing (never fake zeros).
        log.warning("cannot read ActivityWatch, skipping cycle: %s", exc)
        return False

    all_ok = True
    for usage_date in dates:
        try:
            seconds = collector.compute_active_seconds(client, buckets, usage_date, cfg)
            usage = collector.DailyUsage(usage_date, seconds, datetime.now(UTC))
            result = sync_client.push_daily_usage(cfg, usage)
            log.info("%s: %ds -> %s", usage_date, seconds, result)
        except collector.CollectorError as exc:
            all_ok = False
            log.warning("%s: collection failed, not uploading: %s", usage_date, exc)
        except sync_client.SyncError as exc:
            all_ok = False
            log.warning("%s: upload failed, will retry next cycle: %s", usage_date, exc)
    return all_ok


def main() -> None:
    parser = argparse.ArgumentParser(description="Focus Tracker Screen Time Agent")
    parser.add_argument("--once", action="store_true", help="run one cycle and exit")
    parser.add_argument(
        "--backfill-days",
        type=int,
        help="days to sync this run (overrides AGENT_LOOKBACK_DAYS, e.g. after a long outage)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config()
    days = args.backfill_days or cfg.lookback_days

    while True:
        try:
            run_cycle(cfg, days)
        except NotImplementedError as exc:
            raise SystemExit(f"Collector not implemented yet: {exc}")
        except Exception:  # a bug in one cycle must not kill the daemon
            log.exception("unexpected error in sync cycle")
        if args.once:
            break
        time.sleep(cfg.sync_interval_seconds)


if __name__ == "__main__":
    main()
