import test from "node:test";
import assert from "node:assert/strict";
import { PomodoroTimer } from "../../app/static/js/timer.js";
import { MemoryStorage } from "./storage.js";

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
