import test from "node:test";
import assert from "node:assert/strict";
import { createFocusChart, chartScale, periodAnchor, periodOptions, seriesColor } from "../../app/static/js/focus-chart.js";
import { createDOM, contents, descendants } from "./dom.js";
import { statsFixture } from "./chart-fixture.js";

function setup({getToday=()=>"2026-11-13"}={}) {
  const {node,Element,document}=createDOM();
  globalThis.Node=Element;
  globalThis.document=document;
  globalThis.window={location:{origin:"https://focus.example"}};
  const requests=[];
  globalThis.fetch=async url=>{
    requests.push(url);
    return {ok:true,json:async()=>url.pathname.endsWith("/dates") ? {dates:["2026-11-11","2026-11-02"]} : statsFixture(url.searchParams.get("period"))};
  };
  return {node,requests,chart:createFocusChart({root:node("focus-chart"),getToday}),settle:async()=>{for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));}};
}

test("grouped bars and legend use stable user colors and both totals",async()=>{
  const x=setup();await x.chart.refresh();
  const bars=descendants(x.node("chart-plot")).filter(n=>n.tagName==="rect");
  assert.equal(bars.length,4);
  for(const bar of bars) assert.equal(bar.fill,seriesColor(Number(bar["data-user-id"])));
  assert.match(contents(x.node("chart-legend")),/Yinkun.*25m 30s.*Ruiping.*30m/);
  bars[0].events.click();
  assert.match(x.node("chart-detail").textContent,/09:00 CST: Yinkun 25m · Ruiping 10m/);
  assert.match(contents(x.node("chart-table")),/Completed.*Yinkun.*Ruiping/);
});

test("browser date is the default and SQL-backed periods need no manual date input",async()=>{
  const x=setup();await x.chart.refresh();
  const statsRequest=()=>x.requests.filter(url=>url.pathname==="/api/focus-stats").at(-1);
  assert.equal(statsRequest().searchParams.get("date"),"2026-11-13");
  assert.deepEqual(x.node("chart-date").children.map(n=>n.value),["current","2026-11-11","2026-11-02"]);
  assert.equal(x.node("chart-date").value,"current");
  x.node("chart-week").events.click();await x.settle();
  assert.equal(statsRequest().searchParams.get("period"),"week");
  assert.equal(x.node("chart-week").getAttribute("aria-pressed"),"true");
  assert.deepEqual(x.node("chart-date").children.map(n=>n.value),["current","2026-11-02"]);
  x.node("chart-date").value="2026-11-02";
  x.node("chart-date").events.change();await x.settle();
  assert.equal(statsRequest().searchParams.get("date"),"2026-11-02");
  x.node("chart-date").value="current";
  x.node("chart-date").events.change();await x.settle();
  assert.equal(statsRequest().searchParams.get("date"),"2026-11-13");
  assert.ok(x.requests.every(url=>!url.searchParams.has("user_id")));
});

test("empty periods have finite geometry and an explicit empty state",async()=>{
  const x=setup();
  const data=statsFixture();
  for(const series of data.series){series.duration_seconds=[0,0];series.total_seconds=0;series.session_count=0;}
  globalThis.fetch=async url=>({ok:true,json:async()=>url.pathname.endsWith("/dates") ? {dates:[]} : data});
  await x.chart.refresh();
  assert.equal(x.node("chart-empty").hidden,false);
  for(const bar of descendants(x.node("chart-plot")).filter(n=>n.tagName==="rect")) assert.equal(Number(bar.height),0);
  assert.ok(chartScale(1).ceiling>=1);
  assert.ok(chartScale(1000000).ceiling>=1000000);
});

test("offline invalidates an in-flight response and clears old totals",async()=>{
  const x=setup();await x.chart.refresh();
  let release;
  globalThis.fetch=url=>url.pathname.endsWith("/dates") ? Promise.resolve({ok:true,json:async()=>({dates:[]})}) : new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>statsFixture()});});
  const pending=x.chart.refresh();x.chart.setOffline();release();await pending;
  assert.match(contents(x.node("chart-plot")),/Cannot reach/);
  assert.equal(x.node("chart-legend").children.length,0);
});

test("older replies cannot overwrite a newer period selection",async()=>{
  const x=setup();
  const resolvers=[];
  globalThis.fetch=url=>url.pathname.endsWith("/dates") ? Promise.resolve({ok:true,json:async()=>({dates:[]})}) : new Promise(resolve=>resolvers.push(()=>resolve({ok:true,json:async()=>statsFixture(url.searchParams.get("period"))})));
  const old=x.chart.refresh();
  x.node("chart-month").events.click();
  resolvers[1]();await x.settle();
  resolvers[0]();await old;
  assert.equal(x.node("chart-month").getAttribute("aria-pressed"),"true");
  assert.match(contents(x.node("chart-plot")),/Completion week/);
});

test("recorded weeks/months are deduplicated, with an empty current period always available",()=>{
  const dates=["2026-11-02","2026-11-03","2026-10-31","2026-10-30"];
  assert.equal(periodAnchor("2026-01-01","week"),"2025-12-29");
  assert.deepEqual(periodOptions(dates,"week","2026-11-13").map(x=>x.value),["current","2026-11-02","2026-10-26"]);
  assert.deepEqual(periodOptions(dates,"month","2026-11-13").map(x=>x.value),["current","2026-10-01"]);
  assert.deepEqual(periodOptions([],"day","2026-11-13").map(x=>x.value),["current"]);
});

test("current period follows browser midnight, while a selected history period stays fixed",async()=>{
  let today="2026-11-13";
  const x=setup({getToday:()=>today});await x.chart.refresh();
  today="2026-11-14";await x.chart.refresh();
  const lastRequest=()=>x.requests.filter(url=>url.pathname==="/api/focus-stats").at(-1);
  assert.equal(lastRequest().searchParams.get("date"),"2026-11-14");
  x.node("chart-date").value="2026-11-11";x.node("chart-date").events.change();await x.settle();
  today="2026-11-15";await x.chart.refresh();
  assert.equal(lastRequest().searchParams.get("date"),"2026-11-11");
});

test("history lookup failure still renders chart and explains unavailable menu",async()=>{
  const x=setup();
  globalThis.fetch=async url=>{
    if(url.pathname.endsWith("/dates"))throw Error("offline");
    return {ok:true,json:async()=>statsFixture()};
  };
  await x.chart.refresh();
  assert.ok(descendants(x.node("chart-plot")).some(n=>n.tagName==="svg"));
  assert.match(x.node("chart-updated").textContent,/Recorded periods unavailable/);
});
