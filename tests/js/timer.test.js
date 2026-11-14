import test from "node:test";
import assert from "node:assert/strict";
import { PomodoroTimer, Mode, COUNTUP_MAX_MS } from "../../app/static/js/timer.js";
import { MemoryStorage } from "./storage.js";

test("active intervals exclude manual and lock pauses, survive reload, and stop at the deadline",()=>{
  const {timer,options,advance,sessions}=setup();
  timer.start(1);advance(10500);timer.pause();advance(60000);
  timer.resume();advance(20250);timer.pauseByScreenLock();advance(120000);
  const restored=new PomodoroTimer(options);
  restored.resumeByScreenUnlock();advance(3600000);restored.tick();
  assert.deepEqual(sessions[0].active_segments,[
    {started_at_utc:"2026-11-11T15:00:00.000Z",ended_at_utc:"2026-11-11T15:00:10.500Z"},
    {started_at_utc:"2026-11-11T15:01:10.500Z",ended_at_utc:"2026-11-11T15:01:30.750Z"},
    {started_at_utc:"2026-11-11T15:03:30.750Z",ended_at_utc:"2026-11-11T15:04:00.000Z"},
  ]);
});

test("count-up stop while paused preserves subsecond segments through outbox failure",()=>{
  const {timer,options,advance}=setup();
  const attempts=[];
  timer.setMode(Mode.COUNTUP);timer.start(1);advance(1234);timer.pause();advance(60000);
  timer.resume();advance(2345);timer.pause();advance(30000);
  timer.persistCompletedSession=s=>{attempts.push(structuredClone(s));throw Error("full");};
  assert.throws(()=>timer.stop(),/full/);
  advance(60000);
  const reopened=new PomodoroTimer({...options,persistCompletedSession:s=>attempts.push(s)});
  assert.equal(reopened.snapshot().state,"IDLE");
  assert.equal(attempts[0].focus_seconds,3);
  assert.equal(attempts[0].active_segments.length,2);
  assert.deepEqual(attempts[0],attempts[1]);
});

test("upgraded running sessions omit unknown segments instead of inventing pause times",()=>{
  const {storage,options,advance,sessions}=setup();
  const timer=new PomodoroTimer(options);timer.start(1);advance(10000);timer.pause();
  const state=JSON.parse(storage.getItem("focusTracker.timer.v1"));delete state.activeSegments;
  storage.setItem("focusTracker.timer.v1",JSON.stringify(state));
  const reopened=new PomodoroTimer(options);advance(30000);reopened.resume();advance(50000);reopened.tick();
  assert.equal(sessions[0].focus_seconds,60);
  assert.equal("active_segments" in sessions[0],false);
});

function setup() {
  let now = Date.parse("2026-11-11T15:00:00Z");
  const storage = new MemoryStorage(), sessions = [];
  const options = {storage, now:()=>now, focusMs:60000, breakMs:10000, persistCompletedSession:s=>sessions.push(s)};
  return {timer:new PomodoroTimer(options),options,storage,sessions,advance:ms=>{now+=ms;}};
}

test("pause excludes idle time, completion uses exact deadline and breaks are not counted",()=>{
  const {timer,sessions,advance}=setup();
  timer.start(1); advance(20000); timer.pause(); advance(30000);
  assert.equal(timer.remainingMs(),40000);
  timer.resume(); advance(40000); timer.tick();
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].completed_at_utc,"2026-11-11T15:01:30Z");
  assert.equal(sessions[0].focus_seconds,60);
  assert.equal(timer.snapshot().state,"BREAK");
  advance(10000); timer.tick();
  assert.equal(timer.snapshot().state,"IDLE");
  assert.equal(sessions.length,1);
});

test("late reopen preserves original user and deadline, without inventing more sessions",()=>{
  const {timer,options,sessions,advance}=setup();
  timer.start(2); advance(3600000);
  const reopened=new PomodoroTimer(options);
  assert.equal(reopened.snapshot().state,"IDLE");
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].user_id,2);
  assert.equal(sessions[0].completed_at_utc,"2026-11-11T15:01:00Z");
  reopened.tick(); assert.equal(sessions.length,1);
});

test("cancel produces no session",()=>{
  const {timer,sessions,advance}=setup();
  timer.start(1); advance(30000); timer.reset(); advance(60000); timer.tick();
  assert.equal(sessions.length,0);
});

test("failed durable outbox write leaves focus recoverable",()=>{
  const {timer,options,storage,advance}=setup();
  timer.start(1); advance(60000);
  timer.persistCompletedSession=()=>{throw Error("quota");};
  assert.throws(()=>timer.tick(),/quota/);
  assert.equal(JSON.parse(storage.getItem("focusTracker.timer.v1")).state,"FOCUSING");
  assert.equal(new PomodoroTimer(options).snapshot().state,"BREAK");
});

test("boot can defer completion until the controller acquires the cross-tab lock",()=>{
  const {timer,options,sessions,advance}=setup();
  timer.start(1); advance(60000);
  const reopened=new PomodoroTimer({...options,autoAdvance:false});
  assert.equal(sessions.length,0);
  reopened.reload();
  assert.equal(sessions.length,1);
  assert.equal(reopened.snapshot().state,"BREAK");
});

test("count-up starts at zero, locks its mode and saves actual whole seconds",()=>{
  const {timer,sessions,advance}=setup();
  timer.setMode(Mode.COUNTUP);
  assert.equal(timer.snapshot().elapsedMs,0);
  timer.start(2);
  timer.setMode(Mode.POMODORO);
  assert.equal(timer.snapshot().mode,Mode.COUNTUP);
  advance(12500); timer.stop();
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].user_id,2);
  assert.equal(sessions[0].mode,"countup");
  assert.equal(sessions[0].focus_seconds,12);
  assert.equal(sessions[0].target_seconds,7200);
  assert.equal(timer.snapshot().state,"IDLE");
  assert.equal(timer.snapshot().mode,Mode.COUNTUP);
  timer.stop(); assert.equal(sessions.length,1);
});

test("count-up pause excludes paused time and Stop works while paused",()=>{
  const {timer,sessions,advance}=setup();
  timer.setMode(Mode.COUNTUP); timer.start(1);
  advance(5000); timer.pause(); advance(60000); timer.stop();
  assert.equal(sessions[0].focus_seconds,5);
  assert.equal(sessions[0].completed_at_utc,"2026-11-11T15:01:05Z");
});

test("count-up cap saves exactly two hours even on a much later reopen",()=>{
  const {timer,options,sessions,advance}=setup();
  timer.setMode(Mode.COUNTUP); timer.start(1);
  advance(COUNTUP_MAX_MS+3600000);
  const reopened=new PomodoroTimer(options);
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].focus_seconds,7200);
  assert.equal(sessions[0].completed_at_utc,"2026-11-11T17:00:00Z");
  assert.equal(reopened.snapshot().state,"IDLE");
  reopened.tick(); assert.equal(sessions.length,1);
});

test("count-up resumes from storage, rejects subsecond saves and supports discard",()=>{
  const {timer,options,sessions,advance}=setup();
  timer.setMode(Mode.COUNTUP); timer.start(1);
  advance(500);timer.stop();assert.equal(sessions.length,0);
  advance(1000);
  const reopened=new PomodoroTimer(options);
  assert.equal(reopened.snapshot().elapsedMs,1500);
  reopened.reset();
  assert.equal(sessions.length,0);
  assert.equal(reopened.snapshot().mode,Mode.COUNTUP);
});

test("manual stop payload stays immutable across an outbox error and late retry",()=>{
  const {timer,options,storage,advance}=setup();
  const attempts=[];
  let fail=true;
  options.persistCompletedSession=session=>{attempts.push({...session});if(fail)throw Error("quota");};
  timer.persistCompletedSession=options.persistCompletedSession;
  timer.setMode(Mode.COUNTUP); timer.start(1); advance(12345);
  assert.throws(()=>timer.stop(),/quota/);
  assert.equal(JSON.parse(storage.getItem("focusTracker.timer.v1")).state,"COMPLETED");
  advance(90000);fail=false;
  assert.equal(new PomodoroTimer(options).snapshot().state,"IDLE");
  assert.equal(attempts.length,2);
  assert.deepEqual(attempts[0],attempts[1]);
});

test("legacy timer state without mode still completes as Pomodoro",()=>{
  const {timer,options,storage,sessions,advance}=setup();
  timer.start(1);
  const legacy=JSON.parse(storage.getItem("focusTracker.timer.v1"));
  delete legacy.mode;
  storage.setItem("focusTracker.timer.v1",JSON.stringify(legacy));
  advance(60000);
  new PomodoroTimer(options);
  assert.equal(sessions[0].mode,Mode.POMODORO);
});

test("screen lock pauses timer and unlock automatically resumes with accurate duration",()=>{
  const {timer,sessions,advance}=setup();
  timer.start(1); advance(20000);
  timer.pauseByScreenLock();
  assert.equal(timer.snapshot().state,"PAUSED");
  assert.equal(timer.snapshot().pausedByLock,true);
  advance(30000); // 30 seconds locked
  assert.equal(timer.remainingMs(),40000);
  timer.resumeByScreenUnlock();
  assert.equal(timer.snapshot().state,"FOCUSING");
  assert.equal(timer.snapshot().pausedByLock,false);
  advance(40000); timer.tick();
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].focus_seconds,60);
  assert.equal(sessions[0].completed_at_utc,"2026-11-11T15:01:30Z");
});

test("user manual pause is not auto-resumed on screen unlock",()=>{
  const {timer,advance}=setup();
  timer.start(1); advance(15000);
  timer.pause(); // manual pause by user
  assert.equal(timer.snapshot().state,"PAUSED");
  assert.equal(timer.snapshot().pausedByLock,false);
  timer.pauseByScreenLock(); // screen lock while already paused
  assert.equal(timer.snapshot().pausedByLock,false);
  advance(20000);
  timer.resumeByScreenUnlock(); // unlock should not resume manual pause
  assert.equal(timer.snapshot().state,"PAUSED");
  timer.resume(); // manual resume works
  assert.equal(timer.snapshot().state,"FOCUSING");
});

test("screen lock pause state persists in storage across reloads",()=>{
  const {timer,options,advance}=setup();
  timer.start(1); advance(10000);
  timer.pauseByScreenLock();
  advance(15000);
  const reopened=new PomodoroTimer(options);
  assert.equal(reopened.snapshot().state,"PAUSED");
  assert.equal(reopened.snapshot().pausedByLock,true);
  reopened.resumeByScreenUnlock();
  assert.equal(reopened.snapshot().state,"FOCUSING");
  assert.equal(reopened.snapshot().pausedByLock,false);
});

test("count-up screen lock pauses timer and unlock automatically resumes, excluding locked duration on save",()=>{
  const {timer,sessions,advance}=setup();
  timer.setMode(Mode.COUNTUP);
  timer.start(1);
  advance(15000);
  assert.equal(timer.snapshot().elapsedMs,15000);

  timer.pauseByScreenLock();
  assert.equal(timer.snapshot().state,"PAUSED");
  assert.equal(timer.snapshot().pausedByLock,true);
  assert.equal(timer.snapshot().mode,Mode.COUNTUP);

  advance(45000); // 45 seconds locked
  assert.equal(timer.snapshot().elapsedMs,15000);

  timer.resumeByScreenUnlock();
  assert.equal(timer.snapshot().state,"FOCUSING");
  assert.equal(timer.snapshot().pausedByLock,false);
  assert.equal(timer.snapshot().mode,Mode.COUNTUP);

  advance(10000);
  assert.equal(timer.snapshot().elapsedMs,25000);

  timer.stop();
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].focus_seconds,25);
  assert.equal(sessions[0].mode,"countup");
  assert.equal(timer.snapshot().state,"IDLE");
});

test("count-up user manual pause is not auto-resumed on screen unlock",()=>{
  const {timer,advance}=setup();
  timer.setMode(Mode.COUNTUP);
  timer.start(1);
  advance(10000);
  timer.pause();
  assert.equal(timer.snapshot().state,"PAUSED");
  assert.equal(timer.snapshot().pausedByLock,false);

  timer.pauseByScreenLock();
  assert.equal(timer.snapshot().pausedByLock,false);

  advance(20000);
  timer.resumeByScreenUnlock();
  assert.equal(timer.snapshot().state,"PAUSED");

  timer.resume();
  assert.equal(timer.snapshot().state,"FOCUSING");
});

test("count-up screen lock pause allows Stop & save while paused by lock",()=>{
  const {timer,sessions,advance}=setup();
  timer.setMode(Mode.COUNTUP);
  timer.start(1);
  advance(30000);
  timer.pauseByScreenLock();
  advance(60000);
  timer.stop();
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].focus_seconds,30);
  assert.equal(sessions[0].mode,"countup");
  assert.equal(timer.snapshot().state,"IDLE");
  assert.equal(timer.snapshot().pausedByLock,false);
});
