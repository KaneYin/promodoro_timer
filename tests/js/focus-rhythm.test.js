import test from "node:test";
import assert from "node:assert/strict";
import { rhythmCard, rhythmSentence, createFocusRhythm } from "../../app/static/js/focus-rhythm.js";
import { createDOM, contents, descendants } from "./dom.js";

const owl = {key:"night_owl",label:"Night Owl",emoji:"🦉",total_seconds:6000,active_days:1,minimum_seconds:1500,minimum_days:1,estimated_seconds:1500,
  windows:[{key:"night_owl",label:"Night Owl",emoji:"🦉",time_range:"10 PM–2 AM",duration_seconds:4080,share:.68},
    {key:"early_bird",label:"Early Bird",emoji:"🐦",time_range:"6 AM–10 AM",duration_seconds:0,share:0}]};

function setup() {
  const {node,Element,document}=createDOM();globalThis.document=document;globalThis.Node=Element;
  return {node};
}

test("sentence names the personality with the right article",()=>{
  assert.equal(rhythmSentence(owl),"You're a Night Owl. 68% of your focus today fell between 10 PM–2 AM.");
  assert.match(rhythmSentence({...owl,key:"early_bird",label:"Early Bird",emoji:"🐦",windows:[{...owl.windows[1],duration_seconds:1,share:.7}]}),/You're an Early Bird/);
  assert.match(rhythmSentence({...owl,key:"flexible",label:"Flexible Focuser",emoji:"🎨"}),/You're a Flexible Focuser: your focus today spanned different parts of the day\./);
  assert.match(rhythmSentence({...owl,key:"discovering",total_seconds:600}),/Still discovering your personality: 10m of 25m/);
  assert.match(rhythmSentence({...owl,key:"no_focus",total_seconds:0}),/Complete a focus session/);
});

test("card is simple: no totals, estimates or user name, and the breakdown lists only used windows",()=>{
  setup();
  const text=contents(rhythmCard({display_name:"Ruiping",rhythm:owl}));
  assert.match(text,/🦉.*You're a Night Owl.*View time-of-day breakdown.*10 PM–2 AM.*68%/);
  assert.doesNotMatch(text,/Ruiping|estimated|active day|1h 8m|6 AM/);
  assert.doesNotMatch(contents(rhythmCard({rhythm:{...owl,key:"no_focus",windows:[{...owl.windows[1]}]}})),/breakdown/);
});

test("only the selected user's rhythm is requested for today and shown",async()=>{
  const x=setup();const requests=[];let userId=2;
  globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>({series:[
    {user_id:1,display_name:"Yinkun",rhythm:{...owl,key:"flexible",label:"Flexible Focuser",emoji:"🎨"}},
    {user_id:2,display_name:"Ruiping",rhythm:owl}]})};};
  globalThis.window={location:{origin:"https://focus.example"}};
  const rhythm=createFocusRhythm({root:x.node("focus-rhythm"),getUserId:()=>userId,getToday:()=>"2026-11-13"});
  await rhythm.refresh();
  assert.equal(requests[0].searchParams.get("period"),"day");
  assert.equal(requests[0].searchParams.get("date"),"2026-11-13");
  const text=contents(x.node("rhythm-list"));
  assert.match(text,/Night Owl/);assert.doesNotMatch(text,/Flexible|Yinkun|Ruiping/);
  userId=1;rhythm.show();
  assert.equal(requests.length,1);
  assert.match(contents(x.node("rhythm-list")),/Flexible Focuser/);
  userId=null;await rhythm.refresh();
  assert.match(contents(x.node("rhythm-list")),/Select a user/);
});

test("offline and request errors replace the sentence",async()=>{
  const x=setup();
  globalThis.fetch=async()=>{throw Error("offline");};
  globalThis.window={location:{origin:"https://focus.example"}};
  const rhythm=createFocusRhythm({root:x.node("focus-rhythm"),getUserId:()=>1});
  await rhythm.refresh();
  assert.match(contents(x.node("rhythm-list")),/Cannot reach|Could not load/);
  rhythm.setOffline();
  assert.match(contents(x.node("rhythm-list")),/Cannot reach/);
  assert.ok(descendants(x.node("rhythm-list")).every(n=>!/Night Owl/.test(n.textContent)));
});
