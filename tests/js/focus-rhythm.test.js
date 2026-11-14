import test from "node:test";
import assert from "node:assert/strict";
import { personalityBadge, personalityDetails, pieData } from "../../app/static/js/focus-rhythm.js";
import { createDOM, contents, descendants } from "./dom.js";
import { rhythmFixture } from "./personality-fixture.js";

function setup() {
  const {document,Element}=createDOM();globalThis.document=document;globalThis.Node=Element;
}

test("compact badge exposes the established name to hover and keyboard focus",()=>{
  setup();const badge=personalityBadge(rhythmFixture(),1);
  assert.equal(badge.children[0].children[0].textContent,"🦉");
  assert.equal(badge.children[0].getAttribute("aria-label"),"Focus personality: Night Owl");
  assert.equal(badge.children[0].getAttribute("tabindex"),"0");
  assert.equal(badge.children[1].getAttribute("role"),"tooltip");
  assert.equal(contents(badge.children[1]),"Night Owl");
  assert.equal(personalityBadge(null,1),null);
});

test("Details stays collapsed and contains an accessible pie with all six percentages",()=>{
  setup();const toggles=[];
  const panel=personalityDetails({display_name:"Ruiping",rhythm:rhythmFixture()},{onToggle:open=>toggles.push(open)});
  assert.equal(panel.open,false);
  assert.equal(contents(panel.children[0]),"Details");
  const pie=descendants(panel).find(n=>n.tagName==="svg");
  assert.match(pie.getAttribute("aria-label"),/Ruiping.*Night Owl: 65%/);
  assert.equal(descendants(panel).filter(n=>n.tagName==="li").length,6);
  assert.match(contents(panel),/Before-Dawn Learner.*0%.*Early Bird.*20%.*Night Owl.*65%/);
  panel.open=true;panel.events.toggle();assert.deepEqual(toggles,[true]);
});

test("zero and 100 percent pies are finite and preserve discovery/estimate notes",()=>{
  setup();const rhythm=rhythmFixture("no_focus");
  let panel=personalityDetails({display_name:"Yinkun",rhythm});
  assert.match(contents(panel),/No completed focus time/);
  assert.equal(descendants(panel).filter(n=>n.tagName==="path").length,0);
  rhythm.key="early_bird";rhythm.total_seconds=1500;rhythm.windows[1].duration_seconds=1500;
  panel=personalityDetails({display_name:"Yinkun",rhythm});
  assert.equal(descendants(panel).filter(n=>n.tagName==="circle").length,1);
  assert.match(contents(panel),/Early Bird.*100%/);
  const discovery={...rhythmFixture("discovering","week"),estimated_seconds:600};
  panel=personalityDetails({display_name:"Yinkun",rhythm:discovery});
  assert.match(contents(panel),/Discovering Your Rhythm: 10m of 1h 40m/);
  assert.match(contents(panel),/Includes 10m of estimated timing/);
});

test("pie geometry uses unrounded durations, including tiny slices",()=>{
  const data=pieData([{duration_seconds:1,share:0},{duration_seconds:9999,share:1}]);
  assert.equal(data[0].share,.0001);assert.equal(data[1].share,.9999);
  assert.ok(data.every(w=>w.path&&!/NaN|Infinity/.test(w.path)));
  assert.equal(pieData([{duration_seconds:0}])[0].share,0);
});
