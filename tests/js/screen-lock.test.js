import test from "node:test";
import assert from "node:assert/strict";
import { ScreenLockDetector } from "../../app/static/js/screen-lock.js";

function createMockIdleDetector({ permission = "granted", initialScreenState = "unlocked" } = {}) {
  const instances = [];
  let permissionRequests = 0;

  class MockIdleDetector {
    constructor() {
      this.userState = "active";
      this.screenState = initialScreenState;
      this.listeners = { change: [] };
      this.started = false;
      this.options = null;
      instances.push(this);
    }

    static async requestPermission() {
      permissionRequests++;
      return permission;
    }

    addEventListener(event, fn) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(fn);
    }

    async start(options) {
      this.started = true;
      this.options = options;
    }

    emitChange(newState) {
      if (newState) this.screenState = newState;
      for (const fn of this.listeners.change || []) {
        fn();
      }
    }
  }

  return { MockIdleDetector, instances, get permissionRequests() { return permissionRequests; } };
}

test("ScreenLockDetector reports unsupported when IdleDetector is unavailable", async () => {
  const detector = new ScreenLockDetector({ idleDetectorClass: undefined });
  assert.equal(detector.isSupported(), false);
  assert.equal(await detector.checkPermission(), "unsupported");
  const started = await detector.start();
  assert.equal(started, false);
});

test("ScreenLockDetector requests permission and aborts if denied", async () => {
  const mock = createMockIdleDetector({ permission: "denied" });
  const detector = new ScreenLockDetector({ idleDetectorClass: mock.MockIdleDetector });
  assert.equal(detector.isSupported(), true);
  const started = await detector.start();
  assert.equal(started, false);
  assert.equal(mock.permissionRequests, 1);
  assert.equal(detector.started, false);
});

test("ScreenLockDetector detects lock and unlock transitions", async () => {
  const locks = [], unlocks = [], changes = [];
  const { MockIdleDetector, instances } = createMockIdleDetector();
  const detector = new ScreenLockDetector({
    idleDetectorClass: MockIdleDetector,
    onLock: () => locks.push(true),
    onUnlock: () => unlocks.push(true),
    onChange: (state) => changes.push(state),
  });

  const started = await detector.start();
  assert.equal(started, true);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].started, true);

  // Transition to locked
  instances[0].emitChange("locked");
  assert.equal(locks.length, 1);
  assert.equal(unlocks.length, 0);
  assert.deepEqual(changes, ["locked"]);
  assert.equal(detector.getScreenState(), "locked");

  // Same state should not re-trigger
  instances[0].emitChange("locked");
  assert.equal(locks.length, 1);

  // Transition to unlocked
  instances[0].emitChange("unlocked");
  assert.equal(locks.length, 1);
  assert.equal(unlocks.length, 1);
  assert.deepEqual(changes, ["locked", "unlocked"]);
  assert.equal(detector.getScreenState(), "unlocked");
});

test("checkPermission queries navigator.permissions when available", async () => {
  const { MockIdleDetector } = createMockIdleDetector();
  const mockNavigator = {
    permissions: {
      async query({ name }) {
        assert.equal(name, "idle-detection");
        return { state: "granted" };
      },
    },
  };
  const detector = new ScreenLockDetector({
    idleDetectorClass: MockIdleDetector,
    navigator: mockNavigator,
  });
  assert.equal(await detector.checkPermission(), "granted");
});

test("stop cleans up detector and aborts signal", async () => {
  const { MockIdleDetector, instances } = createMockIdleDetector();
  let aborted = false;
  globalThis.AbortController = class {
    constructor() {
      this.signal = { aborted: false };
    }
    abort() {
      aborted = true;
      this.signal.aborted = true;
    }
  };

  const detector = new ScreenLockDetector({ idleDetectorClass: MockIdleDetector });
  await detector.start();
  assert.equal(detector.started, true);

  detector.stop();
  assert.equal(detector.started, false);
  assert.equal(detector.detector, null);
  assert.equal(aborted, true);
});
