import test from "node:test";
import assert from "node:assert/strict";
import { SilentNotifications } from "../../app/static/js/notifications.js";
import { MemoryStorage } from "./storage.js";

function setup({permission="default",silent=true,secure=true,navigator={}}={}) {
  const delivered=[],storage=new MemoryStorage();
  let requests=0;
  class Notification {
    constructor(title,options){delivered.push({title,options});}
    static permission=permission;
    static async requestPermission(){requests++;return this.permission="granted";}
  }
  if(silent)Object.defineProperty(Notification.prototype,"silent",{get:()=>true});
  const notifier=new SilentNotifications({storage,notification:Notification,navigator,secure});
  return {notifier,storage,Notification,delivered,get requests(){return requests;}};
}

test("permission is requested only when explicitly enabled, never on completion",async()=>{
  const x=setup();
  assert.equal(await x.notifier.show("Done","Focus complete","one"),false);
  assert.equal(x.requests,0);
  await x.notifier.enable();
  assert.equal(x.requests,1);
  assert.equal(x.notifier.status().enabled,true);
});

test("desktop delivery always requests silence and omits vibration",async()=>{
  const x=setup();await x.notifier.enable();
  assert.equal(await x.notifier.show("Done","Focus complete","one"),true);
  assert.deepEqual(x.delivered[0].options,{body:"Focus complete",tag:"one",silent:true,renotify:false});
  assert.equal(await x.notifier.show("Done","Focus complete","one"),false);
  assert.equal(x.delivered.length,1);
  x.notifier.disable();
  assert.equal(await x.notifier.show("Done","Other session","two"),false);
});

test("service-worker delivery supports mobile without constructing a Notification",async()=>{
  const delivered=[];
  const registration={active:{state:"activated"},showNotification:async(title,options)=>delivered.push({title,options})};
  const x=setup({navigator:{serviceWorker:{register:async path=>{assert.equal(path,"/notification-worker.js");return registration;}}}});
  await x.notifier.enable();
  await x.notifier.show("Done","Count-up complete","two");
  assert.equal(x.delivered.length,0);
  assert.equal(delivered[0].options.silent,true);
  assert.equal("vibrate" in delivered[0].options,false);
});

test("denied permission, insecure origins and unsupported silence never produce a notification",async()=>{
  for(const settings of [{permission:"denied"},{secure:false},{silent:false}]){
    const x=setup(settings);await x.notifier.enable();
    assert.equal(await x.notifier.show("Done","Focus complete","one"),false);
    assert.equal(x.requests,0);
    assert.equal(x.delivered.length,0);
  }
});

test("worker registration failure uses only the silent desktop fallback",async()=>{
  const x=setup({navigator:{serviceWorker:{register:async()=>{throw Error("offline");}}}});
  await x.notifier.enable();
  assert.equal(await x.notifier.show("Done","Focus complete","one"),true);
  assert.equal(x.delivered[0].options.silent,true);
});

test("delivery errors are non-fatal and leave an explanatory page status",async()=>{
  class BrokenNotification {
    static permission="granted";
    get silent(){return true;}
    constructor(){throw Error("notifications unavailable");}
  }
  const notifier=new SilentNotifications({storage:new MemoryStorage(),notification:BrokenNotification,secure:true,navigator:{}});
  await notifier.enable();
  assert.equal(await notifier.show("Done","Focus complete","one"),false);
  assert.match(notifier.status().message,/delivery failed/);
});

test("a pending worker cannot deliver after notifications are disabled",async()=>{
  let release;
  const delivered=[];
  const x=setup({navigator:{serviceWorker:{register:()=>new Promise(resolve=>{release=()=>resolve({active:{state:"activated"},showNotification:async(...args)=>delivered.push(args)});})}}});
  await x.notifier.enable();
  const result=x.notifier.show("Done","Focus complete","one");
  x.notifier.disable();release();
  assert.equal(await result,false);
  assert.equal(delivered.length,0);
});
