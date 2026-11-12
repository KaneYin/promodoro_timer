"""Read ActivityWatch and compute active seconds per local day (design doc 4.2, 8).

Needs the optional dependency:  uv sync --extra agent
"""

from dataclasses import dataclass
from datetime import date, datetime

from agent.config import AgentConfig


class CollectorError(Exception):
    """Base class: the data could not be read. NEVER upload a value after this."""


class ActivityWatchUnavailable(CollectorError):
    """ActivityWatch is not running / not reachable / the query failed."""


class BucketsMissing(CollectorError):
    """The window or AFK bucket does not exist on this machine."""


@dataclass(frozen=True)
class Buckets:
    window_id: str  # e.g. "aw-watcher-window_<hostname>"
    afk_id: str  # e.g. "aw-watcher-afk_<hostname>"


@dataclass(frozen=True)
class DailyUsage:
    usage_date: date
    active_seconds: int
    collected_at_utc: datetime  # aware UTC, when the value was computed


def open_client(cfg: AgentConfig):
    """Create the ActivityWatch client. Provided."""
    from aw_client import ActivityWatchClient

    return ActivityWatchClient("focus-tracker-agent", host=cfg.aw_host, port=cfg.aw_port)


def discover_buckets(client) -> Buckets:
    """Find this machine's window and AFK buckets.

    TODO(core): implement. See docs/implementation-guide.md, item 8.

    Contract:
      - Use client.get_buckets() (dict keyed by bucket id).
      - Match by bucket id prefix / type ("aw-watcher-window_", "aw-watcher-afk_").
        Do not hardcode the full id (it contains the hostname).
      - ActivityWatch unreachable (requests.ConnectionError, timeout, ...)
                                              -> raise ActivityWatchUnavailable
      - A required bucket missing               -> raise BucketsMissing
    """
    raise NotImplementedError("TODO(core): discover_buckets")


def compute_active_seconds(
    client, buckets: Buckets, usage_date: date, cfg: AgentConfig
) -> int:
    """Seconds of foreground-window time while NOT afk, on local day `usage_date`.

    TODO(core): implement. See docs/implementation-guide.md, item 8.

    Contract:
      - The day is [00:00, next 00:00) in cfg.timezone, built from aware datetimes
        (DST days are 23/25 hours). Convert to UTC before passing to ActivityWatch.
      - Count only the intersection of window events and not-afk events; do not sum
        buckets (they overlap). Prefer an ActivityWatch query
        (client.query / aw_client.queries) over reimplementing interval maths.
      - Do not look at or return titles/URLs. Only a total.
      - Return whole seconds (int).
      - Return 0 ONLY if the query succeeded and found no active time.
        Any failure -> raise ActivityWatchUnavailable. Never return 0 on error.
    """
    raise NotImplementedError("TODO(core): compute_active_seconds")
