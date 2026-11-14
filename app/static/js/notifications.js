// Silent, opt-in completion notifications. Never play audio or request permission
// from a timer callback. Unsupported silent delivery falls back to the page notice.
const PREFERENCE_KEY = "focusTracker.notifications.v1";
const DELIVERED_KEY = "focusTracker.deliveredNotifications.v1";

export class SilentNotifications {
  constructor({ storage, notification = globalThis.Notification, navigator = globalThis.navigator, secure = globalThis.isSecureContext, onChange = () => {} }) {
    this.storage = storage;
    this.api = notification;
    this.navigator = navigator;
    this.secure = secure;
    this.onChange = onChange;
    this.inFlight = new Set();
    this.workerPromise = null;
    this.deliveryError = false;
    try { this.enabled = storage.getItem(PREFERENCE_KEY) === "true"; }
    catch { this.enabled = false; }
  }

  status() {
    const supported = Boolean(this.secure && this.api && "silent" in this.api.prototype);
    const permission = this.api?.permission ?? "denied";
    const enabled = supported && this.enabled && permission === "granted";
    let message = "Get silent alerts when focus or breaks end.";
    if (!supported) message = "Silent browser notifications are unavailable here. Completions still appear on this page.";
    else if (permission === "denied") message = "Notifications are blocked. Allow them in your browser's site settings.";
    else if (this.deliveryError) message = "Browser notification delivery failed. Completions still appear on this page.";
    else if (enabled) message = "Silent notifications on. No sound or vibration.";
    return { supported, permission, enabled, message };
  }

  // Call directly from an explicit button click, before losing user activation.
  async enable() {
    if (!this.status().supported || this.api.permission === "denied") return;
    try {
      const permission = this.api.permission === "granted" ? "granted" : await this.api.requestPermission();
      this.enabled = permission === "granted";
      this.deliveryError = false;
      try { this.storage.setItem(PREFERENCE_KEY, String(this.enabled)); } catch { /* session preference still applies */ }
      if (this.enabled) void this.#worker();
    } catch { this.enabled = false; }
    this.onChange();
  }

  disable() {
    this.enabled = false;
    try { this.storage.setItem(PREFERENCE_KEY, "false"); } catch { /* keep disabled in memory */ }
    this.onChange();
  }

  async show(title, body, tag) {
    if (!this.status().enabled || this.inFlight.has(tag)) return false;
    let delivered = [];
    try { delivered = JSON.parse(this.storage.getItem(DELIVERED_KEY) ?? "[]"); } catch { /* best effort dedup */ }
    if (!Array.isArray(delivered)) delivered = [];
    if (delivered.includes(tag)) return false;
    this.inFlight.add(tag);
    const options = { body, tag, silent: true, renotify: false };
    try {
      const worker = await this.#worker();
      // The preference can change while a service worker is installing.
      if (!this.status().enabled) return false;
      if (worker) await worker.showNotification(title, options);
      else new this.api(title, options); // desktop fallback; never drop silent:true
      try {
        const latest = JSON.parse(this.storage.getItem(DELIVERED_KEY) ?? "[]");
        this.storage.setItem(DELIVERED_KEY, JSON.stringify([...(Array.isArray(latest) ? latest : []), tag].slice(-50)));
      } catch { /* notification itself succeeded */ }
      return true;
    } catch {
      this.deliveryError = true;
      this.onChange();
      return false; // notification failure must never prevent saving a session
    } finally { this.inFlight.delete(tag); }
  }

  #worker() {
    if (!this.navigator?.serviceWorker) return Promise.resolve(null);
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const registration = await this.navigator.serviceWorker.register("/notification-worker.js");
        if (registration.active?.state === "activated") return registration;
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker) return null;
        await new Promise((resolve, reject) => {
          const done = () => {
            if (worker.state === "activated") { cleanup(); resolve(); }
            else if (worker.state === "redundant") { cleanup(); reject(new Error("Worker unavailable")); }
          };
          const cleanup = () => { clearTimeout(timeout); worker.removeEventListener("statechange", done); };
          const timeout = setTimeout(() => { cleanup(); reject(new Error("Worker activation timed out")); }, 5000);
          worker.addEventListener("statechange", done);
          done();
        });
        return registration;
      })().catch(() => null);
    }
    return this.workerPromise;
  }
}
