// Controller integration with a small DOM surface and controlled network. Real
// browser acceptance steps are also documented in docs/testing.md.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorage } from "./storage.js";
import { createDOM, contents } from "./dom.js";
import { statsFixture } from "./chart-fixture.js";

async function boot({usersAvailable=true, idleDetector=null}={}) {
  const events={},intervals=[],alerts=[],posted=[],chartRequests=[];
  const originalNow=Date.now;
  let now=originalNow();
  Date.now=()=>now;
  const {node,Element,document}=createDOM();
  globalThis.Node=Element;
  globalThis.document=document;
  globalThis.window={location:{origin:"http://localhost:8000"},addEventListener(k,fn){events[k]=fn;}};
  globalThis.location={search:""};
  globalThis.localStorage=new MemoryStorage();
  globalThis.alert=msg=>alerts.push(msg);
  globalThis.confirm=()=>true;
  if(idleDetector) globalThis.IdleDetector = idleDetector;
  const originalInterval=globalThis.setInterval;
  globalThis.setInterval=(fn,ms)=>{intervals.push({fn,ms});};
  let online=true,userCalls=0;
  globalThis.fetch=async (url,options)=>{
    if(options?.method==="POST"&&url.pathname==="/api/focus-sessions"){
      posted.push(JSON.parse(options.body));
      return {ok:true,json:async()=>({saved:true})};
    }
    if(url.pathname==="/api/users"){userCalls++;if(!usersAvailable)throw Error("offline");}
    if(!online)throw Error("offline");
    if(url.pathname==="/api/focus-stats/dates") return {ok:true,json:async()=>({timezone:"America/Chicago",dates:["2026-11-11"]})};
    if(url.pathname==="/api/focus-stats"){
      chartRequests.push(url);
      return {ok:true,json:async()=>statsFixture(url.searchParams.get("period"))};
    }
    const data=url.pathname==="/api/users"?[{id:1,display_name:"Yinkun"},{id:2,display_name:"Ruiping"}]:url.pathname==="/api/health"?{status:"ok"}:url.pathname==="/api/focus-sessions"?[{focus_seconds:1500}]:{metric:url.searchParams.get("metric"),period_start:"2026-11-11",period_end_exclusive:"2026-11-12",timezone:"America/Chicago",entries:[{user_id:1,display_name:"Yinkun",duration_seconds:1500,rank:1,data_status:"available",days_with_data:1,days_expected:1}]};
    return {ok:true,json:async()=>data};
  };
  await import(`../../app/static/js/app.js?test=${Math.random()}`);
  const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setTimeout(resolve,0));};
  await settle();
  return {node,document,events,intervals,alerts,posted,chartRequests,settle,advance:ms=>{now+=ms;},get userCalls(){return userCalls;},setOnline:v=>{online=v;},setUsers:v=>{usersAvailable=v;},cleanup:()=>{if(idleDetector) delete globalThis.IdleDetector;globalThis.setInterval=originalInterval;Date.now=originalNow;}};
}

test("disconnect clears statistics and old ranks",async()=>{
  const app=await boot();
  try{
    assert.equal(app.node("stat-today").textContent,"25m");
    assert.equal(app.node("lb-list").children[0].className,"lb-entry me first");
    app.setOnline(false);app.events.offline();
    await app.intervals.find(i=>i.ms===60000).fn();await app.settle();
    assert.equal(app.node("connection-text").textContent,"Offline");
    assert.equal(app.node("stat-today").textContent,"—");
    assert.match(app.node("lb-list").children[0].children[0].textContent,/Cannot reach/);
    assert.match(contents(app.node("chart-plot")),/Cannot reach/);
    assert.equal(app.node("chart-legend").children.length,0);
  }finally{app.cleanup();}
});

test("switching personal users leaves the same two-user chart unchanged",async()=>{
  const app=await boot();
  try{
    const before=contents(app.node("chart-legend")),requests=app.chartRequests.length;
    assert.match(before,/Yinkun/);assert.match(before,/Ruiping/);
    app.node("user-select").value="2";
    app.node("user-select").events.change();await app.settle();
    assert.equal(contents(app.node("chart-legend")),before);
    assert.equal(app.chartRequests.length,requests);
    assert.ok(app.chartRequests.every(url=>!url.searchParams.has("user_id")));
  }finally{app.cleanup();}
});

test("failed user lookup recovers after reconnect without page reload",async()=>{
  const app=await boot({usersAvailable:false});
  try{
    const attempts=app.userCalls;
    assert.equal(app.node("user-select").children.length,0);
    app.setUsers(true);await app.events.online();await app.settle();
    assert.ok(app.userCalls>attempts);
    assert.equal(app.node("user-select").children.length,2);
    app.node("btn-primary").events.click();await app.settle();
    assert.equal(app.alerts.length,0);
    assert.equal(app.node("phase").textContent,"Focus");
  }finally{app.cleanup();}
});

test("count-up Stop & save uploads actual elapsed time without starting a break",async()=>{
  const app=await boot();
  try{
    app.node("mode-countup").events.click();await app.settle();
    assert.equal(app.node("clock").textContent,"00:00");
    app.node("btn-primary").events.click();await app.settle();
    app.advance(12500);
    await app.intervals.find(i=>i.ms===250).fn();
    assert.equal(app.node("clock").textContent,"00:12");
    assert.equal(app.node("btn-stop").disabled,false);
    app.node("btn-stop").events.click();await app.settle();
    assert.equal(app.posted.length,1);
    assert.equal(app.posted[0].mode,"countup");
    assert.equal(app.posted[0].focus_seconds,12);
    assert.equal(app.posted[0].target_seconds,7200);
    assert.equal(app.node("phase").textContent,"Ready");
    assert.match(app.node("timer-message").textContent,/Count-up session complete/);
  }finally{app.cleanup();}
});

test("screen lock pauses timer with explanatory hint, and unlock auto-resumes", async () => {
  let detectorInstance = null;
  class MockIdleDetector {
    constructor() {
      this.screenState = "unlocked";
      this.listeners = {};
      detectorInstance = this;
    }
    static async requestPermission() { return "granted"; }
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
    async start() {}
    emit(state) {
      this.screenState = state;
      for (const fn of this.listeners.change || []) fn();
    }
  }

  const app = await boot({ idleDetector: MockIdleDetector });
  try {
    app.node("btn-primary").events.click();
    await app.settle();
    assert.equal(app.node("phase").textContent, "Focus");
    assert.ok(detectorInstance !== null);

    // Screen locks
    detectorInstance.emit("locked");
    await app.settle();
    assert.equal(app.node("phase").textContent, "Paused");
    assert.match(app.node("timer-hint").textContent, /screen was locked/);

    // Clock advancement while locked does not run down remaining time
    app.advance(10000);
    await app.intervals.find(i => i.ms === 250).fn();
    await app.settle();
    assert.equal(app.node("phase").textContent, "Paused");

    // Screen unlocks
    detectorInstance.emit("unlocked");
    await app.settle();
    assert.equal(app.node("phase").textContent, "Focus");
  } finally {
    app.cleanup();
  }
});

test("user manual pause is not auto-resumed on screen unlock in UI", async () => {
  let detectorInstance = null;
  class MockIdleDetector {
    constructor() {
      this.screenState = "unlocked";
      this.listeners = {};
      detectorInstance = this;
    }
    static async requestPermission() { return "granted"; }
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
    async start() {}
    emit(state) {
      this.screenState = state;
      for (const fn of this.listeners.change || []) fn();
    }
  }

  const app = await boot({ idleDetector: MockIdleDetector });
  try {
    app.node("btn-primary").events.click();
    await app.settle();
    assert.equal(app.node("phase").textContent, "Focus");

    // User manually clicks pause
    app.node("btn-primary").events.click();
    await app.settle();
    assert.equal(app.node("phase").textContent, "Paused");
    assert.doesNotMatch(app.node("timer-hint").textContent, /screen was locked/);

    // Screen locks and unlocks
    detectorInstance.emit("locked");
    await app.settle();
    detectorInstance.emit("unlocked");
    await app.settle();

    // Still paused because it was a manual pause
    assert.equal(app.node("phase").textContent, "Paused");
  } finally {
    app.cleanup();
  }
});

test("count-up screen lock pauses timer with explanatory hint, and unlock auto-resumes", async () => {
  let detectorInstance = null;
  class MockIdleDetector {
    constructor() {
      this.screenState = "unlocked";
      this.listeners = {};
      detectorInstance = this;
    }
    static async requestPermission() { return "granted"; }
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
    async start() {}
    emit(state) {
      this.screenState = state;
      for (const fn of this.listeners.change || []) fn();
    }
  }

  const app = await boot({ idleDetector: MockIdleDetector });
  try {
    app.node("mode-countup").events.click();
    await app.settle();
    assert.equal(app.node("clock").textContent, "00:00");

    app.node("btn-primary").events.click();
    await app.settle();
    assert.equal(app.node("phase").textContent, "Count up");
    assert.ok(detectorInstance !== null);

    app.advance(12500);
    await app.intervals.find(i => i.ms === 250).fn();
    assert.equal(app.node("clock").textContent, "00:12");

    // Screen locks
    detectorInstance.emit("locked");
    await app.settle();
    assert.equal(app.node("phase").textContent, "Paused");
    assert.match(app.node("timer-hint").textContent, /screen was locked/);

    // Advance clock while locked
    app.advance(20000);
    await app.intervals.find(i => i.ms === 250).fn();
    await app.settle();
    assert.equal(app.node("clock").textContent, "00:12");
    assert.equal(app.node("phase").textContent, "Paused");

    // Screen unlocks
    detectorInstance.emit("unlocked");
    await app.settle();
    assert.equal(app.node("phase").textContent, "Count up");

    // Advance running clock
    app.advance(8000);
    await app.intervals.find(i => i.ms === 250).fn();
    assert.equal(app.node("clock").textContent, "00:20");

    // Stop & save
    app.node("btn-stop").events.click();
    await app.settle();
    assert.equal(app.posted.length, 1);
    assert.equal(app.posted[0].mode, "countup");
    assert.equal(app.posted[0].focus_seconds, 20);
    assert.equal(app.node("phase").textContent, "Ready");
  } finally {
    app.cleanup();
  }
});
