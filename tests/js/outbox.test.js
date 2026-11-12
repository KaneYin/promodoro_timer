import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { enqueueSession, loadPending, loadRejected, flushPending } from "../../app/static/js/api.js";
import { MemoryStorage } from "./storage.js";

beforeEach(()=>{
  globalThis.localStorage=new MemoryStorage();
  globalThis.window={location:{origin:"http://localhost:8000"}};
});
const ok=()=>({ok:true,json:async()=>({saved:true})});

test("uploading an old session cannot remove another tab's new session",async()=>{
  enqueueSession({id:"old"});
  let release;
  globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(ok());});
  const flushing=flushPending();
  enqueueSession({id:"new"}); // another tab completes while the upload is in flight
  release();
  assert.deepEqual(await flushing,{sent:1,rejected:0,remaining:1});
  assert.deepEqual(loadPending().map(s=>s.id),["new"]);
});

test("concurrent flushes share a run and UUID enqueue is idempotent",async()=>{
  enqueueSession({id:"one"}); enqueueSession({id:"one"});
  let requests=0;
  globalThis.fetch=async()=>{requests++;return ok();};
  const a=flushPending(),b=flushPending();
  assert.equal(a,b);
  await a;
  assert.equal(requests,1);
  assert.equal(loadPending().length,0);
});

test("legacy arrays migrate without dropping pending or rejected records",()=>{
  localStorage.setItem("focusTracker.pendingSessions.v1",JSON.stringify([{id:"pending"}]));
  localStorage.setItem("focusTracker.rejectedSessions.v1",JSON.stringify([{id:"rejected",rejected_reason:"422"}]));
  assert.deepEqual(loadPending().map(s=>s.id),["pending"]);
  assert.equal(loadRejected()[0].rejected_reason,"422");
  assert.equal(localStorage.getItem("focusTracker.pendingSessions.v1"),null);
});

test("permanent rejection is retained durably and cannot be re-enqueued",async()=>{
  enqueueSession({id:"invalid"});
  globalThis.fetch=async()=>({ok:false,status:422,statusText:"bad",json:async()=>({detail:"too short",code:"target_out_of_range"})});
  assert.deepEqual(await flushPending(),{sent:0,rejected:1,remaining:0});
  assert.match(loadRejected()[0].rejected_reason,/422/);
  enqueueSession({id:"invalid"});
  assert.equal(loadPending().length,0);
});

test("network and server failures retain sessions for retry",async()=>{
  enqueueSession({id:"retry"});
  globalThis.fetch=async()=>{throw Error("offline");};
  assert.equal((await flushPending()).remaining,1);
  globalThis.fetch=async()=>({ok:false,status:503,statusText:"unavailable",json:async()=>({detail:"offline"})});
  assert.equal((await flushPending()).remaining,1);
  globalThis.fetch=async()=>ok();
  assert.equal((await flushPending()).sent,1);
});
