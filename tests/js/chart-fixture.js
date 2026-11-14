export function statsFixture(period = "day") {
  return {
    period, period_start: "2026-11-11", period_end_exclusive: "2026-11-12",
    timezone: "America/Chicago", bucket_unit: {day:"hour",week:"day",month:"week"}[period],
    attribution: "completion", generated_at_utc: "2026-11-12T18:00:00Z",
    buckets: [
      {label:"09:00 CST", start_utc:"2026-11-11T15:00:00Z", end_utc:"2026-11-11T16:00:00Z"},
      {label:"10:00 CST", start_utc:"2026-11-11T16:00:00Z", end_utc:"2026-11-11T17:00:00Z"},
    ],
    series: [
      {user_id:1,display_name:"Yinkun",duration_seconds:[1500,30],total_seconds:1530,session_count:2},
      {user_id:2,display_name:"Ruiping",duration_seconds:[600,1200],total_seconds:1800,session_count:2},
    ],
  };
}
