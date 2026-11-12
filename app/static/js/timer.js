// Pomodoro timer engine. No DOM access, so it can be tested in isolation.
//
// Design rules (docs/frontend-backend.md, "Timer"):
//  - Time is always derived from wall-clock timestamps, never from counting setInterval ticks.
//  - Everything needed to resume is persisted, so a reload or a throttled background tab loses nothing.
//  - Finishing a focus phase hands the session to `persistCompletedSession` BEFORE the new state
//    is saved. A crash in between only replays the same session id, which the server de-duplicates.

import { toUtcIso, uuid } from "./util.js";

export const State = Object.freeze({
  IDLE: "IDLE",
  FOCUSING: "FOCUSING",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED", // transient: emitted via "focus-completed", then BREAK starts at once
  BREAK: "BREAK",
});

export const DEFAULT_FOCUS_MS = 25 * 60 * 1000;
export const DEFAULT_BREAK_MS = 5 * 60 * 1000;
const STORAGE_KEY = "focusTracker.timer.v1";

const idleState = () => ({
  state: State.IDLE,
  userId: null,
  sessionId: null,
  startedAtMs: null, // when this phase first started (wall clock)
  targetMs: 0, // length of the current phase
  accumulatedMs: 0, // running time banked before the current segment (pauses)
  segmentStartMs: null, // start of the current running segment; null while paused/idle
});

export class PomodoroTimer {
  /**
   * @param {object} opts
   * @param {Storage} opts.storage                 localStorage-compatible
   * @param {() => number} [opts.now]              clock, injectable for tests
   * @param {number} [opts.focusMs]
   * @param {number} [opts.breakMs]
   * @param {(session: object) => void} opts.persistCompletedSession
   *        Must durably store the session synchronously (it is the local outbox write).
   * @param {boolean} [opts.autoAdvance]           false when boot reconciliation needs a cross-tab lock
   */
  constructor({ storage, now = () => Date.now(), focusMs = DEFAULT_FOCUS_MS, breakMs = DEFAULT_BREAK_MS, persistCompletedSession, autoAdvance = true }) {
    this.storage = storage;
    this.now = now;
    this.focusMs = focusMs;
    this.breakMs = breakMs;
    this.persistCompletedSession = persistCompletedSession;
    this.listeners = { change: [], "focus-completed": [], "break-completed": [] };
    this.data = this.#load();
    if (autoAdvance) this.#advance();
  }

  // --- Public API ---------------------------------------------------------

  on(event, fn) {
    this.listeners[event].push(fn);
    return () => {
      this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
    };
  }

  /** IDLE -> FOCUSING. The session belongs to `userId` even if the selector changes later. */
  start(userId) {
    if (this.data.state !== State.IDLE) return;
    const t = this.now();
    this.data = {
      state: State.FOCUSING,
      userId,
      sessionId: uuid(),
      startedAtMs: t,
      targetMs: this.focusMs,
      accumulatedMs: 0,
      segmentStartMs: t,
    };
    this.#commit();
  }

  /** FOCUSING -> PAUSED. */
  pause() {
    if (this.#advance() || this.data.state !== State.FOCUSING) return;
    this.data.accumulatedMs = this.elapsedMs();
    this.data.segmentStartMs = null;
    this.data.state = State.PAUSED;
    this.#commit();
  }

  /** PAUSED -> FOCUSING. Re-anchors the clock at "now". */
  resume() {
    if (this.data.state !== State.PAUSED) return;
    this.data.segmentStartMs = this.now();
    this.data.state = State.FOCUSING;
    this.#commit();
  }

  /** Abandon the current focus session or skip the break. Never produces a session. */
  reset() {
    if (this.data.state === State.IDLE) return;
    this.data = idleState();
    this.#commit();
  }

  /** Re-evaluate against the clock. Call on a timer, on tab visibility change, and on load. */
  tick() {
    this.#advance();
    this.#emit("change");
  }

  /** Pick up state written by another tab. */
  reload() {
    this.data = this.#load();
    this.#advance();
    this.#emit("change");
  }

  elapsedMs() {
    const { accumulatedMs, segmentStartMs } = this.data;
    const running = segmentStartMs === null ? 0 : Math.max(0, this.now() - segmentStartMs);
    return accumulatedMs + running;
  }

  remainingMs() {
    return this.data.state === State.IDLE ? this.focusMs : Math.max(0, this.data.targetMs - this.elapsedMs());
  }

  snapshot() {
    const { state, userId, sessionId, targetMs } = this.data;
    const total = state === State.IDLE ? this.focusMs : targetMs;
    const remaining = this.remainingMs();
    return {
      state,
      userId,
      sessionId,
      totalMs: total,
      remainingMs: remaining,
      progress: total > 0 ? 1 - remaining / total : 0,
    };
  }

  // --- Internals ----------------------------------------------------------

  /**
   * Apply every phase transition that the clock says has already happened
   * (a tab may have been asleep for hours). Returns true if anything changed.
   */
  #advance() {
    let changed = false;
    for (let guard = 0; guard < 4; guard += 1) {
      const d = this.data;
      if (d.segmentStartMs === null || this.elapsedMs() < d.targetMs) break;

      // The phase ended at segmentStart + remaining-at-segment-start, not "now".
      const endedAtMs = d.segmentStartMs + (d.targetMs - d.accumulatedMs);

      if (d.state === State.FOCUSING) {
        const seconds = Math.round(d.targetMs / 1000);
        const session = {
          id: d.sessionId,
          user_id: d.userId,
          started_at_utc: toUtcIso(d.startedAtMs),
          completed_at_utc: toUtcIso(endedAtMs),
          focus_seconds: seconds,
          target_seconds: seconds,
        };
        this.persistCompletedSession(session); // outbox write first
        this.data = {
          ...idleState(),
          state: State.BREAK,
          userId: d.userId,
          startedAtMs: endedAtMs,
          targetMs: this.breakMs,
          segmentStartMs: endedAtMs,
        };
        this.#commit({ silent: true });
        this.#emit("focus-completed", session);
      } else if (d.state === State.BREAK) {
        this.data = idleState();
        this.#commit({ silent: true });
        this.#emit("break-completed");
      } else {
        break;
      }
      changed = true;
    }
    if (changed) this.#emit("change");
    return changed;
  }

  #commit({ silent = false } = {}) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    if (!silent) this.#emit("change");
  }

  #load() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return idleState();
      const parsed = JSON.parse(raw);
      if (!Object.values(State).includes(parsed.state) || parsed.state === State.COMPLETED) return idleState();
      return { ...idleState(), ...parsed };
    } catch {
      return idleState();
    }
  }

  #emit(event, payload) {
    const arg = event === "change" ? this.snapshot() : payload;
    for (const fn of this.listeners[event]) fn(arg);
  }
}
