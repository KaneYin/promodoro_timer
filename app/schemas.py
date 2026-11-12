"""Pydantic models = the API contract (see docs/api.md).

Only *shape* validation lives here (types, required fields, numeric lower bounds,
timezone-aware timestamps). *Business* validation (does the user exist, is the
duration plausible, ...) belongs to the services.
"""

from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field


def _to_utc_seconds(dt: datetime) -> datetime:
    """Normalise to UTC and drop microseconds so that equal instants compare equal.

    This is what makes "identical retry" detection for focus sessions reliable:
    '...T15:00:00Z' and '...T10:00:00-05:00' are the same request.
    """
    return dt.astimezone(UTC).replace(microsecond=0)


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_to_utc_seconds)]

Metric = Literal["focus", "screen"]
Period = Literal["day", "week", "month"]
Order = Literal["asc", "desc"]
DataStatus = Literal["available", "stale", "no_data"]


# --- Users -------------------------------------------------------------------
class UserOut(BaseModel):
    id: int
    display_name: str


# --- Health ------------------------------------------------------------------
class HealthOut(BaseModel):
    status: Literal["ok"]
    database: Literal["connected"]


# --- Focus -------------------------------------------------------------------
class FocusSessionIn(BaseModel):
    id: UUID
    user_id: int
    started_at_utc: UtcDatetime
    completed_at_utc: UtcDatetime
    focus_seconds: int = Field(gt=0)
    target_seconds: int = Field(gt=0)


class FocusSessionSavedOut(BaseModel):
    id: UUID
    saved: bool


class FocusSessionOut(BaseModel):
    id: str
    user_id: int
    started_at_utc: str
    completed_at_utc: str
    focus_seconds: int
    target_seconds: int


# --- Screen time -------------------------------------------------------------
class ScreenUsageIn(BaseModel):
    device_id: UUID
    usage_date: date
    active_seconds: int = Field(ge=0)
    collected_at_utc: UtcDatetime


class ScreenUsageSavedOut(BaseModel):
    device_id: UUID
    usage_date: date
    # created        -> first row for this (device, date)
    # updated        -> existing row replaced by a newer collection
    # ignored_stale  -> request is older than what the server already has (not an error)
    result: Literal["created", "updated", "ignored_stale"]


# --- Leaderboards ------------------------------------------------------------
class LeaderboardEntry(BaseModel):
    user_id: int
    display_name: str
    # None only when data_status == "no_data" (missing data is NOT zero).
    duration_seconds: int | None
    # None when the entry is not ranked (no_data, or stale per design 9.2).
    rank: int | None
    data_status: DataStatus
    # Screen metric only: when the device's data was last received. None for focus.
    last_synced_at_utc: str | None = None
    # Screen metric only: number of days in the period that have a row. None for focus.
    days_with_data: int | None = None


class LeaderboardOut(BaseModel):
    metric: Metric
    period: Period
    period_start: date
    period_end_exclusive: date
    timezone: str
    order: Order
    generated_at_utc: str
    entries: list[LeaderboardEntry]
