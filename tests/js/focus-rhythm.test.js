import test from "node:test";
import assert from "node:assert/strict";
import { rhythmCard } from "../../app/static/js/focus-rhythm.js";
import { createDOM, contents } from "./dom.js";

function card(changes={}) {
  const {document,Element}=createDOM();globalThis.document=document;globalThis.Node=Element;
  return rhythmCard({display_name:"Ruiping",rhythm:{key:"night_owl",label:"Night Owl",emoji:"🦉",
    total_seconds:6000,active_days:3,minimum_seconds:6000,minimum_days:3,estimated_seconds:0,
    windows:[{key:"night_owl",label:"Night Owl",emoji:"🦉",time_range:"10 PM–2 AM",duration_seconds:4080,share:.68}],...changes}},"week");
}

test("rhythm card explains its time window and exposes a duration breakdown",()=>{
  const node=card();
  assert.match(contents(node),/Ruiping.*🦉 Night Owl.*68%.*10 PM–2 AM.*3 active days.*View time-of-day breakdown.*1h 8m/);
  assert.doesNotMatch(contents(node),/estimated/);
});

test("discovery, empty, flexible and legacy states have clear English explanations",()=>{
  assert.match(contents(card({key:"discovering",label:"Discovering Your Rhythm",total_seconds:1500,active_days:1})),/Keep going: 25m of 1h 40m, 1 of 3/);
  assert.match(contents(card({key:"no_focus",label:"No Focus Yet",total_seconds:0,active_days:0})),/Complete a focus session/);
  assert.match(contents(card({key:"flexible",label:"Flexible Focuser"})),/spanned different parts of the day/);
  assert.match(contents(card({estimated_seconds:1500})),/Includes 25m of estimated timing from older sessions/);
});
