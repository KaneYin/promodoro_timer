import test from "node:test";
import assert from "node:assert/strict";
import { createLeaderboard } from "../../app/static/js/leaderboard.js";
import { createDOM, contents, descendants } from "./dom.js";
import { rhythmFixture } from "./personality-fixture.js";

function response(url) {
  const period=url.searchParams.get("period"), date=url.searchParams.get("date");
  const key=period==="week"?"flexible":period==="month"?"discovering":date==="2026-11-13"?"night_owl":"early_bird";
  return {metric:url.searchParams.get("metric"),period,period_start:date,period_end_exclusive:date,
    timezone:"America/Chicago",entries:[{user_id:1,display_name:"Yinkun",duration_seconds:3000,rank:1,
      data_status:"available",rhythm:rhythmFixture(key,period)}]};
}

function setup() {
  const {node,Element,document}=createDOM();globalThis.document=document;globalThis.Node=Element;
  globalThis.window={location:{origin:"https://focus.example"}};
  const requests=[];let today="2026-11-14";
  globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>response(url)};};
  const board=createLeaderboard({root:node("leaderboard"),getCurrentUserId:()=>1,getToday:()=>today});
  return {node,board,requests,setToday:value=>{today=value;}};
}

const icons = x => descendants(x.node("lb-list")).filter(n=>n.className==="personality-icon");
const panels = x => descendants(x.node("lb-list")).filter(n=>n.tagName==="details");

test("leaderboard icons follow historical day, week and month queries",async()=>{
  const x=setup();await x.board.refresh();
  assert.equal(icons(x)[0].getAttribute("aria-label"),"Focus personality: Early Bird");
  await x.board.setSelection({period:"day",date:"2026-11-13",followToday:false});
  assert.equal(x.requests.at(-1).searchParams.get("date"),"2026-11-13");
  assert.equal(icons(x)[0].getAttribute("aria-label"),"Focus personality: Night Owl");
  assert.equal(panels(x)[0].open,false);
  await x.board.setSelection({period:"week",date:"2026-11-13",followToday:false});
  assert.equal(icons(x)[0].getAttribute("aria-label"),"Focus personality: Flexible Focuser");
  await x.board.setSelection({period:"month",date:"2026-11-13",followToday:false});
  assert.equal(icons(x)[0].getAttribute("aria-label"),"Focus personality: Discovering Your Rhythm");
});

test("older replies cannot replace a newly selected day's personality",async()=>{
  const x=setup();const pending=[];
  globalThis.fetch=url=>new Promise(resolve=>pending.push(()=>resolve({ok:true,json:async()=>response(url)})));
  const old=x.board.refresh();
  const newer=x.board.setSelection({period:"day",date:"2026-11-13",followToday:false});
  pending[0]();await old;
  assert.equal(icons(x).length,0);assert.match(contents(x.node("lb-list")),/Loading/);
  pending[1]();await newer;
  assert.equal(icons(x)[0].getAttribute("aria-label"),"Focus personality: Night Owl");
});

test("Details survives polling and resets for a different period",async()=>{
  const x=setup();await x.board.refresh();
  panels(x)[0].open=true;panels(x)[0].events.toggle();
  await x.board.refresh();assert.equal(panels(x)[0].open,true);
  await x.board.setSelection({period:"day",date:"2026-11-13",followToday:false});
  assert.equal(panels(x)[0].open,false);
});

test("historical personalities stay on their date after midnight and reconnect",async()=>{
  const x=setup();await x.board.setSelection({period:"day",date:"2026-11-13",followToday:false});
  x.board.setOffline();assert.equal(icons(x).length,0);
  x.setToday("2026-11-15");await x.board.refresh();
  assert.equal(x.requests.at(-1).searchParams.get("date"),"2026-11-13");
  assert.equal(icons(x)[0].getAttribute("aria-label"),"Focus personality: Night Owl");
});

test("current leaderboard follows the local date and ignores late offline replies",async()=>{
  const x=setup();await x.board.refresh();x.setToday("2026-11-15");await x.board.refresh();
  assert.equal(x.requests.at(-1).searchParams.get("date"),"2026-11-15");
  let release;globalThis.fetch=url=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>response(url)});});
  const pending=x.board.refresh();x.board.setOffline();release();await pending;
  assert.equal(icons(x).length,0);assert.match(contents(x.node("lb-list")),/Cannot reach/);
});
