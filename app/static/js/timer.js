// Focus timer engine. No DOM or network access.
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
  COMPLETED: "COMPLETED", // durable count-up stop boundary, retried until the outbox is saved
  BREAK: "BREAK",
});

export const DEFAULT_FOCUS_MS = 25 * 60 * 1000;
export const DEFAULT_BREAK_MS = 5 * 60 * 1000;
export const COUNTUP_MAX_MS = 2 * 60 * 60 * 1000;
export const Mode = Object.freeze({ POMODORO: "pomodoro", COUNTUP: "countup" });
const STORAGE_KEY = "focusTracker.timer.v1";

const idleState = (mode = Mode.POMODORO) => ({
  state: State.IDLE,
  mode,
  userId: null,
  sessionId: null,
  startedAtMs: null, // when this phase first started (wall clock)
  targetMs: 0, // length of the current phase
  accumulatedMs: 0, // running time banked before the current segment (pauses)
  segmentStartMs: null, // start of the current running segment; null while paused/idle
  completedAtMs: null, // freezes a manual stop's timestamp before any network retry
  pausedByLock: false,
  activeSegments: [], // closed [startMs, endMs] pairs; null for an upgraded legacy session
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
      mode: this.data.mode,
      userId,
      sessionId: uuid(),
      startedAtMs: t,
      targetMs: this.data.mode === Mode.COUNTUP ? COUNTUP_MAX_MS : this.focusMs,
      accumulatedMs: 0,
      segmentStartMs: t,
      completedAtMs: null,
      pausedByLock: false,
      activeSegments: [],
    };
    this.#commit();
  }

  setMode(mode) {
    if (this.data.state !== State.IDLE || !Object.values(Mode).includes(mode)) return;
    this.data = idleState(mode);
    this.#commit();
  }

  /** Count-up Stop & save. Freeze the payload before handing it to the outbox.
   * A crash or quota error must not turn a later retry into different content
   * under the same UUID. Subsecond sessions remain running and are never saved.
   */
  stop() {
    if (this.#advance() || this.data.mode !== Mode.COUNTUP || ![State.FOCUSING, State.PAUSED].includes(this.data.state)) return;
    const stoppedAtMs = this.now();
    const elapsed = Math.min(this.elapsedMs(stoppedAtMs), COUNTUP_MAX_MS);
    if (elapsed < 1000) return;
    this.data = { ...this.data, activeSegments: this.#closedSegments(stoppedAtMs), state: State.COMPLETED, accumulatedMs: elapsed, segmentStartMs: null, completedAtMs: stoppedAtMs, pausedByLock: false };
    this.#commit({ silent: true });
    this.#advance();
  }

  /** FOCUSING -> PAUSED. */
  pause({ byLock = false } = {}) {
    if (this.#advance() || this.data.state !== State.FOCUSING) return;
    const pausedAtMs = this.now();
    this.data.activeSegments = this.#closedSegments(pausedAtMs);
    this.data.accumulatedMs = this.elapsedMs(pausedAtMs);
    this.data.segmentStartMs = null;
    this.data.state = State.PAUSED;
    this.data.pausedByLock = Boolean(byLock);
    this.#commit();
  }

  /** Convenience method for pausing due to screen lock. */
  pauseByScreenLock() {
    this.pause({ byLock: true });
  }

  /** PAUSED -> FOCUSING. Re-anchors the clock at "now". */
  resume({ byUnlock = false } = {}) {
    if (this.data.state !== State.PAUSED) return;
    if (byUnlock && !this.data.pausedByLock) return;
    this.data.segmentStartMs = this.now();
    this.data.state = State.FOCUSING;
    this.data.pausedByLock = false;
    this.#commit();
  }

  /** Convenience method for resuming when screen is unlocked. */
  resumeByScreenUnlock() {
    this.resume({ byUnlock: true });
  }

  /** Abandon the current focus session or skip the break. Never produces a session. */
  reset() {
    if ([State.IDLE, State.COMPLETED].includes(this.data.state)) return;
    this.data = idleState(this.data.mode);
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

  elapsedMs(atMs = this.now()) {
    const { accumulatedMs, segmentStartMs } = this.data;
    const running = segmentStartMs === null ? 0 : Math.max(0, atMs - segmentStartMs);
    return accumulatedMs + running;
  }

  remainingMs() {
    const idleTarget = this.data.mode === Mode.COUNTUP ? COUNTUP_MAX_MS : this.focusMs;
    return this.data.state === State.IDLE ? idleTarget : Math.max(0, this.data.targetMs - this.elapsedMs());
  }

  snapshot() {
    const { state, mode, userId, sessionId, targetMs, pausedByLock } = this.data;
    const total = state === State.IDLE ? (mode === Mode.COUNTUP ? COUNTUP_MAX_MS : this.focusMs) : targetMs;
    const remaining = this.remainingMs();
    return {
      state,
      mode,
      userId,
      sessionId,
      totalMs: total,
      remainingMs: remaining,
      elapsedMs: state === State.IDLE ? 0 : Math.min(this.elapsedMs(), total),
      progress: total > 0 ? 1 - remaining / total : 0,
      pausedByLock: Boolean(pausedByLock),
    };
  }

  // --- Internals ----------------------------------------------------------

  #closedSegments(endMs) {
    const d = this.data;
    if (d.activeSegments === null) return null;
    return [...d.activeSegments, ...(d.segmentStartMs !== null && endMs > d.segmentStartMs ? [[d.segmentStartMs, endMs]] : [])];
  }

  /**
   * Apply every phase transition that the clock says has already happened
   * (a tab may have been asleep for hours). Returns true if anything changed.
   */
  #advance() {
    let changed = false;
    for (let guard = 0; guard < 4; guard += 1) {
      const d = this.data;
      if (d.state === State.COMPLETED) {
        this.#completeFocus(d.completedAtMs, Math.floor(d.accumulatedMs / 1000));
        changed = true;
        continue;
      }
      if (d.segmentStartMs === null || this.elapsedMs() < d.targetMs) break;

      // The phase ended at segmentStart + remaining-at-segment-start, not "now".
      const endedAtMs = d.segmentStartMs + (d.targetMs - d.accumulatedMs);

      if (d.state === State.FOCUSING) {
        const seconds = Math.round(d.targetMs / 1000);
        this.#completeFocus(endedAtMs, seconds);
      } else if (d.state === State.BREAK) {
        this.data = idleState(d.mode);
        this.#commit({ silent: true });
        this.#emit("break-completed", { id: d.sessionId ?? String(d.startedAtMs), completedAtMs: endedAtMs });
      } else {
        break;
      }
      changed = true;
    }
    if (changed) this.#emit("change");
    return changed;
  }

  #completeFocus(endedAtMs, seconds) {
    const d = this.data;
    const session = {
      id: d.sessionId, user_id: d.userId, mode: d.mode,
      started_at_utc: toUtcIso(d.startedAtMs), completed_at_utc: toUtcIso(endedAtMs),
      focus_seconds: seconds, target_seconds: d.mode === Mode.COUNTUP ? COUNTUP_MAX_MS / 1000 : seconds,
    };
    const segments = this.#closedSegments(endedAtMs);
    if (segments !== null) session.active_segments = segments.map(([start, end]) => ({
      started_at_utc: new Date(start).toISOString(), ended_at_utc: new Date(end).toISOString(),
    }));
    this.persistCompletedSession(session);
    this.data = d.mode === Mode.COUNTUP ? idleState(d.mode) : {
      ...idleState(d.mode), state: State.BREAK, userId: d.userId, sessionId: d.sessionId,
      startedAtMs: endedAtMs, targetMs: this.breakMs, segmentStartMs: endedAtMs,
    };
    this.#commit({ silent: true });
    this.#emit("focus-completed", session);
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
      if (!Object.values(State).includes(parsed.state)) return idleState();
      const mode = parsed.mode ?? Mode.POMODORO;
      if (!Object.values(Mode).includes(mode)) return idleState();
      if (parsed.state === State.COMPLETED && (mode !== Mode.COUNTUP || !Number.isFinite(parsed.completedAtMs))) return idleState(mode);
      return { ...idleState(mode), ...parsed, mode, pausedByLock: Boolean(parsed.pausedByLock),
        activeSegments: parsed.activeSegments ?? (parsed.state === State.IDLE ? [] : null) };
    } catch {
      return idleState();
    }
  }

  #emit(event, payload) {
    const arg = event === "change" ? this.snapshot() : payload;
    for (const fn of this.listeners[event]) fn(arg);
  }
}
