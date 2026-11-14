// Screen lock detector using the Idle Detection API (screenState).
// Pauses the timer when the operating system locks the screen, and
// automatically resumes when the screen is unlocked.

export class ScreenLockDetector {
  /**
   * @param {object} [opts]
   * @param {typeof IdleDetector} [opts.idleDetectorClass]
   * @param {Navigator} [opts.navigator]
   * @param {() => void} [opts.onLock]
   * @param {() => void} [opts.onUnlock]
   * @param {(state: string) => void} [opts.onChange]
   */
  constructor({
    idleDetectorClass = globalThis.IdleDetector,
    navigator = globalThis.navigator,
    onLock = () => {},
    onUnlock = () => {},
    onChange = () => {},
  } = {}) {
    this.idleDetectorClass = idleDetectorClass;
    this.navigator = navigator;
    this.onLock = onLock;
    this.onUnlock = onUnlock;
    this.onChange = onChange;
    this.detector = null;
    this.screenState = "unlocked";
    this.started = false;
    this.starting = false;
    this.abortController = null;
  }

  isSupported() {
    return typeof this.idleDetectorClass === "function";
  }

  async checkPermission() {
    if (!this.isSupported()) return "unsupported";
    if (this.navigator?.permissions?.query) {
      try {
        const status = await this.navigator.permissions.query({ name: "idle-detection" });
        return status.state;
      } catch {
        // Permissions query not supported or rejected
      }
    }
    return "prompt";
  }

  async start() {
    if (!this.isSupported() || this.started || this.starting) return false;
    this.starting = true;
    try {
      if (typeof this.idleDetectorClass.requestPermission === "function") {
        const perm = await this.idleDetectorClass.requestPermission();
        if (perm !== "granted") {
          return false;
        }
      }
      this.abortController = new (globalThis.AbortController ?? class { constructor() { this.signal = {}; } })();
      this.detector = new this.idleDetectorClass();
      this.detector.addEventListener("change", () => this.#handleStateChange());
      await this.detector.start({ threshold: 60000, signal: this.abortController.signal });
      this.started = true;
      this.#handleStateChange();
      return true;
    } catch {
      return false;
    } finally {
      this.starting = false;
    }
  }

  #handleStateChange() {
    if (!this.detector) return;
    const current = this.detector.screenState;
    if (current && current !== this.screenState) {
      this.screenState = current;
      this.onChange(current);
      if (current === "locked") {
        this.onLock();
      } else if (current === "unlocked") {
        this.onUnlock();
      }
    }
  }

  getScreenState() {
    return this.detector?.screenState ?? this.screenState;
  }

  stop() {
    if (this.abortController?.abort) {
      try {
        this.abortController.abort();
      } catch {
        // Abort might throw if already aborted
      }
    }
    this.detector = null;
    this.started = false;
    this.starting = false;
  }
}
