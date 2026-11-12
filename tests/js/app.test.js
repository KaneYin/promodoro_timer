// Controller integration with a small DOM surface and controlled network. Real
// browser acceptance steps are also documented in docs/testing.md.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorage } from "./storage.js";

async function boot({usersAvailable=true}={}) {
  const nodes=new Map(),events={},intervals=[],alerts=[];
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={};this.events={};this.textContent="";this.value="";}
    setAttribute(k,v){this[k]=v;}
    append(v){this.children.push(v);}
    replaceChildren(...v){this.children=v;}
    addEventListener(k,fn){this.events[k]=fn;}
    querySelector(s){return node(s.slice(1));}
    querySelectorAll(s){
      const values={"[data-metric]":["focus","screen"],"[data-period]":["day","week","month"],"[data-order]":["asc","desc"]}[s]??[];
      return values.map(v=>Object.assign(new Element(),{dataset:{[s.slice(6,-1)]:v}}));
    }
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  globalThis.Node=Element;
  globalThis.document={getElementById:node,createElement:()=>new Element(),createTextNode:t=>Object.assign(new Element(),{textContent:t}),body:new Element(),addEventListener(){}};
  globalThis.window={location:{origin:"http://localhost:8000"},addEventListener(k,fn){events[k]=fn;}};
  globalThis.location={search:""};
  globalThis.localStorage=new MemoryStorage();
  globalThis.alert=msg=>alerts.push(msg);
  globalThis.confirm=()=>true;
  const originalInterval=globalThis.setInterval;
  globalThis.setInterval=(fn,ms)=>{intervals.push({fn,ms});};
  let online=true,userCalls=0;
  globalThis.fetch=async url=>{
    if(url.pathname==="/api/users"){userCalls++;if(!usersAvailable)throw Error("offline");}
    if(!online)throw Error("offline");
    const data=url.pathname==="/api/users"?[{id:1,display_name:"Yinkun"},{id:2,display_name:"Ruiping"}]:url.pathname==="/api/health"?{status:"ok"}:url.pathname==="/api/focus-sessions"?[{focus_seconds:1500}]:{metric:url.searchParams.get("metric"),period_start:"2026-11-11",period_end_exclusive:"2026-11-12",timezone:"America/Chicago",entries:[{user_id:1,display_name:"Yinkun",duration_seconds:1500,rank:1,data_status:"available",days_with_data:1,days_expected:1}]};
    return {ok:true,json:async()=>data};
  };
  await import(`../../app/static/js/app.js?test=${Math.random()}`);
  const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setTimeout(resolve,0));};
  await settle();
  return {node,events,intervals,alerts,settle,get userCalls(){return userCalls;},setOnline:v=>{online=v;},setUsers:v=>{usersAvailable=v;},cleanup:()=>{globalThis.setInterval=originalInterval;}};
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
