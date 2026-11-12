"""Query local ActivityWatch; return only daily totals, never titles or URLs.

Needs the optional dependency:  uv sync --extra agent
"""

import json
import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

import httpx

from agent.config import AgentConfig


class CollectorError(Exception):
    """Base class: the data could not be read. NEVER upload a value after this."""


class ActivityWatchUnavailable(CollectorError):
    """ActivityWatch is not running / not reachable / the query failed."""


class BucketsMissing(CollectorError):
    """The window or AFK bucket does not exist on this machine."""


class DayNotTracked(CollectorError):
    """The requested day predates the required buckets; missing history is not zero."""


@dataclass(frozen=True)
class Buckets:
    window_id: str  # e.g. "aw-watcher-window_<hostname>"
    afk_id: str  # e.g. "aw-watcher-afk_<hostname>"
    tracking_since_utc: datetime | None = None


@dataclass(frozen=True)
class DailyUsage:
    usage_date: date
    active_seconds: int
    collected_at_utc: datetime  # aware UTC, when the value was computed


def open_client(cfg: AgentConfig):
    """Create an ActivityWatch SDK client with bounded HTTP request times."""
    try:
        from aw_client import ActivityWatchClient

        class BoundedClient(ActivityWatchClient):
            # aw-client's default requests have no timeout. Its read/query API can
            # use HTTPX responses too; keep one stalled AW request from freezing sync.
            def _get(self, endpoint, params=None):
                response = httpx.get(
                    self._url(endpoint), params=params, timeout=cfg.http_timeout_seconds
                )
                response.raise_for_status()
                return response

            def _post(self, endpoint, data, params=None):
                response = httpx.post(
                    self._url(endpoint),
                    json=data,
                    params=params,
                    timeout=cfg.http_timeout_seconds,
                )
                response.raise_for_status()
                return response

        return BoundedClient("focus-tracker-agent", host=cfg.aw_host, port=cfg.aw_port)
    except Exception as exc:
        raise ActivityWatchUnavailable(
            "Cannot initialize ActivityWatch client; install the agent extra"
        ) from exc


def discover_buckets(client) -> Buckets:
    """Find this machine's window and AFK buckets.

    Contract:
      - Use client.get_buckets() (dict keyed by bucket id).
      - Match bucket id prefixes ("aw-watcher-window_", "aw-watcher-afk_").
        Do not hardcode the full id (it contains the hostname).
      - ActivityWatch unreachable (requests.ConnectionError, timeout, ...)
                                              -> raise ActivityWatchUnavailable
      - A required bucket missing               -> raise BucketsMissing
    """
    try:
        available = client.get_buckets()
        if not isinstance(available, dict):
            raise ValueError("invalid bucket response")
        hosts = {}
        for bucket_id, info in available.items():
            kind = (
                "window"
                if bucket_id.startswith("aw-watcher-window_")
                else "afk"
                if bucket_id.startswith("aw-watcher-afk_")
                else None
            )
            if kind is None:
                continue
            host = (
                info.get("hostname")
                or (info.get("data") or {}).get("hostname")
                or bucket_id.split("_", 1)[1]
            )
            hosts.setdefault(host, {})[kind] = (bucket_id, info)
        pairs = {
            host: pair
            for host, pair in hosts.items()
            if "window" in pair and "afk" in pair
        }
        local_host = getattr(client, "client_hostname", None)
        if local_host in pairs:
            pair = pairs[local_host]
        elif len(pairs) == 1:
            pair = next(iter(pairs.values()))
        else:
            raise BucketsMissing(
                "Need one matching window/AFK host pair; imported or ambiguous buckets must be resolved"
            )
        created = []
        for _, info in pair.values():
            if info.get("created"):
                value = info["created"]
                dt = (
                    value
                    if isinstance(value, datetime)
                    else datetime.fromisoformat(value.replace("Z", "+00:00"))
                )
                if dt.tzinfo is None:
                    raise ValueError("bucket creation time has no timezone")
                created.append(dt.astimezone(UTC))
        return Buckets(
            pair["window"][0], pair["afk"][0], max(created) if created else None
        )
    except CollectorError:
        raise
    except Exception as exc:
        raise ActivityWatchUnavailable("Cannot discover ActivityWatch buckets") from exc


def compute_active_seconds(
    client, buckets: Buckets, usage_date: date, cfg: AgentConfig
) -> int:
    """Seconds of foreground-window time while NOT afk, on local day `usage_date`.

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
    try:
        start = datetime.combine(usage_date, time.min, cfg.timezone).astimezone(UTC)
        end = datetime.combine(
            usage_date + timedelta(days=1), time.min, cfg.timezone
        ).astimezone(UTC)
        if buckets.tracking_since_utc and end <= buckets.tracking_since_utc:
            raise DayNotTracked(f"{usage_date} predates ActivityWatch tracking")
        # Exact bucket ids, escaped as string literals. No category settings or browser overlay.
        query = "\n".join(
            [
                f"events = flood(query_bucket({json.dumps(buckets.window_id)}));",
                f"not_afk = flood(query_bucket({json.dumps(buckets.afk_id)}));",
                'not_afk = filter_keyvals(not_afk, "status", ["not-afk"]);',
                "events = filter_period_intersect(events, not_afk);",
                "RETURN = sum_durations(events);",
            ]
        )
        result = client.query(query, [(start, end)])
        if not isinstance(result, list) or len(result) != 1:
            raise ValueError("expected one daily query result")
        seconds = result[0]
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)):
            raise ValueError("duration must be numeric")
        if (
            not math.isfinite(seconds)
            or not 0 <= seconds <= (end - start).total_seconds()
        ):
            raise ValueError("duration outside the local day's bounds")
        return int(seconds)
    except CollectorError:
        raise
    except Exception as exc:
        raise ActivityWatchUnavailable(
            f"Cannot compute ActivityWatch total for {usage_date}"
        ) from exc
