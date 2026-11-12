"""Agent configuration, read from environment variables.

AGENT_DEVICE_ID          (required) UUID from `uv run python scripts/init_db.py`
AGENT_SERVER_URL         default http://127.0.0.1:8000
                         (use your Tailscale Serve URL on a remote Mac)
AGENT_AW_URL             default http://localhost:5600 (ActivityWatch, local only)
AGENT_TIMEZONE           default America/Chicago (must match the server's day boundaries)
AGENT_SYNC_INTERVAL      seconds between sync cycles, default 300
AGENT_LOOKBACK_DAYS      days re-synced every cycle incl. today, default 7
AGENT_HTTP_TIMEOUT       seconds, default 10
"""

import os
from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import UUID
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class AgentConfig:
    device_id: UUID
    server_url: str
    aw_url: str
    timezone: ZoneInfo
    sync_interval_seconds: int
    lookback_days: int
    http_timeout_seconds: float

    @property
    def aw_host(self) -> str:
        return urlparse(self.aw_url).hostname or "localhost"

    @property
    def aw_port(self) -> int:
        return urlparse(self.aw_url).port or 5600


def load_config() -> AgentConfig:
    device_id = os.environ.get("AGENT_DEVICE_ID")
    if not device_id:
        raise SystemExit(
            "AGENT_DEVICE_ID is not set. Run `uv run python scripts/init_db.py` "
            "on the server and copy this Mac's device UUID."
        )
    cfg = AgentConfig(
        device_id=UUID(device_id),
        server_url=os.environ.get("AGENT_SERVER_URL", "http://127.0.0.1:8000").rstrip(
            "/"
        ),
        aw_url=os.environ.get("AGENT_AW_URL", "http://localhost:5600"),
        timezone=ZoneInfo(os.environ.get("AGENT_TIMEZONE", "America/Chicago")),
        sync_interval_seconds=int(os.environ.get("AGENT_SYNC_INTERVAL", "300")),
        lookback_days=int(os.environ.get("AGENT_LOOKBACK_DAYS", "7")),
        http_timeout_seconds=float(os.environ.get("AGENT_HTTP_TIMEOUT", "10")),
    )
    for name, value in (
        ("AGENT_SERVER_URL", cfg.server_url),
        ("AGENT_AW_URL", cfg.aw_url),
    ):
        parsed = urlparse(value)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise SystemExit(
                f"{name} must be an http(s) origin without a path, query or fragment"
            )
    if urlparse(cfg.aw_url).scheme != "http":
        raise SystemExit(
            "AGENT_AW_URL must use http for the local ActivityWatch client"
        )
    if cfg.timezone.key != "America/Chicago":
        raise SystemExit("AGENT_TIMEZONE must be America/Chicago to match the server")
    if (
        cfg.sync_interval_seconds <= 0
        or cfg.lookback_days <= 0
        or cfg.http_timeout_seconds <= 0
    ):
        raise SystemExit("Agent interval, lookback and timeout must be positive")
    return cfg
