"""Upload daily totals to the FastAPI backend with HTTPX."""

import httpx

from agent.collector import DailyUsage
from agent.config import AgentConfig


class SyncError(Exception):
    """The server was unreachable or rejected the upload."""


def push_daily_usage(cfg: AgentConfig, usage: DailyUsage) -> str:
    """PUT one day's cumulative total. Returns the server's `result` string.

    The call is idempotent (the server stores a snapshot, it does not add), so
    retrying after a timeout is always safe.
    """
    body = {
        "device_id": str(cfg.device_id),
        "usage_date": usage.usage_date.isoformat(),
        "active_seconds": usage.active_seconds,
        "collected_at_utc": usage.collected_at_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        response = httpx.put(
            f"{cfg.server_url}/api/screen-usage/daily",
            json=body,
            timeout=cfg.http_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        raise SyncError(f"server unreachable: {exc!r}") from exc

    if response.status_code != 200:
        raise SyncError(f"server returned {response.status_code}: {response.text[:200]}")
    return response.json()["result"]
