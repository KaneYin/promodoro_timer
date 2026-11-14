"""Rhythm/service regressions; also runnable without an HTTP server via unittest."""

import sqlite3
import unittest
from datetime import UTC, date, datetime
from unittest.mock import patch
from uuid import uuid4

from pydantic import ValidationError

from app import config
from app.errors import ConflictError, InvalidDataError
from app.periods import resolve_window
from app.schemas import FocusSessionIn
from app.services.focus_rhythm_service import classify, get_focus_rhythms
from app.services.focus_service import save_focus_session
from app.services.focus_stats_service import get_focus_dates, get_focus_stats


class FocusRhythmTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(config.SCHEMA_PATH.read_text())
        self.conn.executescript(config.SEED_PATH.read_text())
        self.clock = patch("app.services.focus_service.utc_now", lambda: datetime(2027, 1, 1, tzinfo=UTC))
        self.clock.start()

    def tearDown(self):
        self.clock.stop()
        self.conn.close()

    def save(self, pairs, seconds=None, user=1, legacy=False):
        intervals = [(datetime.fromisoformat(a), datetime.fromisoformat(b)) for a, b in pairs]
        seconds = seconds if seconds is not None else int(sum((b-a).total_seconds() for a, b in intervals))
        data = dict(id=str(uuid4()), user_id=user,
                    started_at_utc=intervals[0][0], completed_at_utc=intervals[-1][1],
                    focus_seconds=seconds, target_seconds=seconds)
        if not legacy:
            data["active_segments"] = [dict(started_at_utc=a, ended_at_utc=b) for a, b in intervals]
        payload = FocusSessionIn(**data)
        save_focus_session(self.conn, payload)
        return payload

    def rhythm(self, anchor="2026-11-11", period="day", user=1):
        return get_focus_rhythms(self.conn, resolve_window(period, date.fromisoformat(anchor)))[user]

    def test_all_six_labels_and_boundaries(self):
        for hour, key in [(2,"before_dawn"),(6,"early_bird"),(10,"midday"),(14,"afternoon"),(18,"evening"),(22,"night_owl")]:
            with self.subTest(hour=hour):
                self.conn.execute("DELETE FROM focus_session_segments")
                self.conn.execute("DELETE FROM focus_sessions")
                self.conn.commit()
                self.save([(f"2026-11-11T{hour:02}:00:00-06:00", f"2026-11-11T{hour:02}:25:00-06:00")])
                rhythm = self.rhythm()
                self.assertEqual(rhythm.key, key)
                self.assertEqual(rhythm.total_seconds, 1500)
                self.assertEqual(rhythm.estimated_seconds, 0)

    def test_inclusive_thresholds_without_rounding(self):
        self.assertEqual(classify([1500,1050,450,0,0,0], 1, "day")[0], "before_dawn")
        self.assertEqual(classify([1500,1051,449,0,0,0], 1, "day")[0], "flexible")
        self.assertEqual(classify([1499,1000,501,0,0,0], 1, "day")[0], "flexible")
        self.assertEqual(classify([1499,0,0,0,0,0], 1, "day")[0], "discovering")
        self.assertEqual(classify([0]*6, 0, "day")[0], "no_focus")

    def test_pauses_excluded_and_users_independent(self):
        self.save([("2026-11-11T06:00:00-06:00","2026-11-11T06:10:00-06:00"),
                   ("2026-11-11T22:00:00-06:00","2026-11-11T22:15:00-06:00")])
        rhythm = self.rhythm()
        self.assertEqual((rhythm.key, rhythm.total_seconds), ("night_owl",1500))
        self.assertEqual([w.duration_seconds for w in rhythm.windows], [0,600,0,0,0,900])
        self.assertEqual(self.rhythm(user=2).key, "no_focus")

    def test_midnight_and_month_split_keep_night_owl(self):
        self.save([("2026-11-30T23:30:00-06:00","2026-12-01T00:30:00-06:00")])
        for day in ("2026-11-30", "2026-12-01"):
            self.assertEqual((self.rhythm(day).key, self.rhythm(day).total_seconds), ("night_owl",1800))
        self.assertEqual(self.rhythm("2026-11-30","month").total_seconds,1800)
        self.assertEqual(self.rhythm("2026-12-01","month").total_seconds,1800)
        # The existing chart keeps completion attribution while rhythm splits.
        chart = get_focus_stats(self.conn,"day",date(2026,11,30)).series[0]
        self.assertEqual(chart.total_seconds,0)
        self.assertEqual(chart.rhythm.total_seconds,1800)
        self.assertEqual(get_focus_dates(self.conn).dates,[date(2026,12,1),date(2026,11,30)])

    def test_time_window_split_and_history_do_not_credit_paused_dates(self):
        self.save([("2026-11-10T09:30:00-06:00","2026-11-10T10:30:00-06:00"),
                   ("2026-11-12T22:00:00-06:00","2026-11-12T22:25:00-06:00")])
        day = self.rhythm("2026-11-10")
        self.assertEqual(day.key,"flexible")
        self.assertEqual([w.duration_seconds for w in day.windows],[0,1800,1800,0,0,0])
        self.assertEqual(get_focus_dates(self.conn).dates,[date(2026,11,12),date(2026,11,10)])

    def test_exact_end_boundary_does_not_credit_following_day(self):
        self.save([("2026-11-10T23:30:00-06:00","2026-11-11T00:00:00-06:00")])
        self.assertEqual(self.rhythm().key,"no_focus")
        self.assertEqual(self.rhythm("2026-11-10").total_seconds,1800)

    def test_week_month_require_duration_and_distinct_days(self):
        self.save([("2026-11-09T06:00:00-06:00","2026-11-09T08:00:00-06:00")])
        self.assertEqual(self.rhythm(period="week").key,"discovering")
        for day in (10,11):
            self.save([(f"2026-11-{day}T06:00:00-06:00",f"2026-11-{day}T06:25:00-06:00")])
        self.assertEqual(self.rhythm(period="week").key,"early_bird")
        for day in (12,13,14,15):
            self.save([(f"2026-11-{day}T06:00:00-06:00",f"2026-11-{day}T06:35:00-06:00")])
        month = self.rhythm(period="month")
        self.assertEqual((month.key,month.active_days,month.total_seconds),("early_bird",7,18600))
        self.assertEqual(classify([6000,0,0,0,0,0],3,"week")[0],"before_dawn")
        self.assertEqual(classify([5999,0,0,0,0,0],3,"week")[0],"discovering")
        self.assertEqual(classify([18000,0,0,0,0,0],7,"month")[0],"before_dawn")

    def test_dst_counts_real_elapsed_time(self):
        self.save([("2026-11-01T00:30:00-05:00","2026-11-01T02:30:00-06:00")])
        fall = self.rhythm("2026-11-01")
        self.assertEqual(fall.total_seconds,10800)
        self.assertEqual(fall.windows[5].duration_seconds,9000)
        self.assertEqual(fall.windows[0].duration_seconds,1800)
        self.save([("2026-03-08T01:30:00-06:00","2026-03-08T03:30:00-05:00")])
        spring = self.rhythm("2026-03-08")
        self.assertEqual((spring.key,spring.total_seconds),("flexible",3600))
        self.assertEqual(spring.windows[0].duration_seconds,1800)

    def test_legacy_estimates_preserve_total_and_are_disclosed(self):
        self.save([("2026-11-11T09:30:00-06:00","2026-11-11T10:30:00-06:00")],seconds=1500,legacy=True)
        rhythm = self.rhythm()
        self.assertEqual((rhythm.total_seconds,rhythm.estimated_seconds),(1500,1500))
        self.assertEqual([w.duration_seconds for w in rhythm.windows],[0,750,750,0,0,0])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM focus_session_segments").fetchone()[0],0)

    def test_segments_retry_is_immutable_and_offsets_normalize(self):
        payload = self.save([("2026-11-11T06:00:00-06:00","2026-11-11T06:25:00-06:00")])
        save_focus_session(self.conn,payload)
        data = payload.model_dump()
        data["active_segments"] = [{"started_at_utc":"2026-11-11T12:00:00Z","ended_at_utc":"2026-11-11T12:25:00Z"}]
        save_focus_session(self.conn,FocusSessionIn(**data))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM focus_session_segments").fetchone()[0],1)
        with self.assertRaises(ConflictError):
            save_focus_session(self.conn,payload.model_copy(update={"active_segments":None}))

    def test_invalid_segments_are_rejected_atomically(self):
        baseline = dict(id=str(uuid4()),user_id=1,started_at_utc="2026-11-11T12:00:00Z",
                        completed_at_utc="2026-11-11T13:00:00Z",focus_seconds=1500,target_seconds=1500)
        for pairs in [
            [("11:59:00","12:24:00")], [("12:50:00","13:15:00")],
            [("12:20:00","12:10:00")], [("12:00:00","12:24:59")],
            [("12:00:00","12:15:00"),("12:10:00","12:20:00")],
        ]:
            with self.subTest(pairs=pairs), self.assertRaises(InvalidDataError):
                active_segments = [dict(started_at_utc=f"2026-11-11T{a}Z",ended_at_utc=f"2026-11-11T{b}Z") for a,b in pairs]
                save_focus_session(self.conn,FocusSessionIn(**baseline,active_segments=active_segments))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM focus_sessions").fetchone()[0],0)
        with self.assertRaises(ValidationError):
            FocusSessionIn(**baseline,active_segments=[])

    def test_subsecond_segments_keep_recorded_whole_second_total(self):
        self.save([("2026-11-11T09:59:59.500-06:00","2026-11-11T10:00:00.250-06:00"),
                   ("2026-11-11T10:01:00.125-06:00","2026-11-11T10:26:00.500-06:00")])
        rhythm = self.rhythm()
        self.assertAlmostEqual(rhythm.total_seconds,1501)
        self.assertEqual(rhythm.key,"midday")


if __name__ == "__main__":
    unittest.main()
