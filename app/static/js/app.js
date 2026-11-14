// Page controller: wires the timer, user selector, personal stats and leaderboards together.

import {
  ApiError,
  enqueueSession,
  flushPending,
  getFocusSessions,
  getHealth,
  getLeaderboard,
  getUsers,
  loadPending,
  loadRejected,
} from "./api.js";
import { createLeaderboard } from "./leaderboard.js";
import { createFocusChart } from "./focus-chart.js";
import { PomodoroTimer, State, Mode } from "./timer.js";
import { SilentNotifications } from "./notifications.js";
import { ScreenLockDetector } from "./screen-lock.js";
import { LEADERBOARD_TZ, el, formatClock, formatDuration, timeAgo, todayInTimezone } from "./util.js";

const USER_KEY = "focusTracker.userId";
const REFRESH_MS = 60_000;
const HEALTH_MS = 30_000;
const RING_LENGTH = 2 * Math.PI * 54; // circle r=54 in index.html

const $ = (id) => document.getElementById(id);
const ui = {
  userSelect: $("user-select"),
  connection: $("connection"),
  connectionText: $("connection-text"),
  phase: $("phase"),
  clock: $("clock"),
  ring: $("ring-progress"),
  primary: $("btn-primary"),
  reset: $("btn-reset"),
  stop: $("btn-stop"),
  pomodoroMode: $("mode-pomodoro"),
  countupMode: $("mode-countup"),
  timerMessage: $("timer-message"),
  notifications: $("btn-notifications"),
  notificationStatus: $("notification-status"),
  timerHint: $("timer-hint"),
  syncBanner: $("sync-banner"),
  statCount: $("stat-count"),
  statToday: $("stat-today"),
  statWeek: $("stat-week"),
  statScreen: $("stat-screen"),
  statScreenSync: $("stat-screen-sync"),
};

// Dev shortcut: /?focus=10&break=5 uses 10 s / 5 s phases. The server still enforces its own minimum target.
const query = new URLSearchParams(location.search);
const secondsParam = (name) => {
  const n = Number(query.get(name));
  return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
};

const app = { users: [], userId: null, usersLoaded: false, statsSeq: 0, storageError: "" };
const notifications = new SilentNotifications({ storage: localStorage, onChange: renderNotificationControls });
const screenLock = new ScreenLockDetector({
  onLock: () => runTimer(() => timer.pauseByScreenLock()),
  onUnlock: () => runTimer(() => timer.resumeByScreenUnlock()),
});

// --- Timer -------------------------------------------------------------------

const timer = new PomodoroTimer({
  storage: localStorage,
  focusMs: secondsParam("focus"),
  breakMs: secondsParam("break"),
  persistCompletedSession: enqueueSession,
  autoAdvance: false, // reconcile on boot under the same cross-tab lock as controls
});

const PHASE_LABEL = {
  [State.IDLE]: "Ready",
  [State.FOCUSING]: "Focus",
  [State.PAUSED]: "Paused",
  [State.BREAK]: "Break",
  [State.COMPLETED]: "Saving",
};

function renderTimer(snap) {
  const countup = snap.mode === Mode.COUNTUP;
  const text = formatClock(countup ? Math.floor(snap.elapsedMs / 1000) * 1000 : snap.remainingMs);
  const active = snap.state !== State.IDLE;

  ui.phase.textContent = countup && snap.state === State.FOCUSING ? "Count up" : PHASE_LABEL[snap.state] ?? "Ready";
  ui.clock.textContent = text;
  ui.ring.style.strokeDasharray = String(RING_LENGTH);
  ui.ring.style.strokeDashoffset = String(RING_LENGTH * (countup ? 1 - snap.progress : active ? snap.progress : 0));
  document.body.dataset.phase = snap.state.toLowerCase();
  document.title = active ? `${text} · ${PHASE_LABEL[snap.state]} — Focus Tracker` : "Focus Tracker";

  // Primary button: Start / Pause / Resume (disabled during break). Reset: abandon focus or skip break.
  const primary = {
    [State.IDLE]: ["Start", "start"],
    [State.FOCUSING]: ["Pause", "pause"],
    [State.PAUSED]: ["Resume", "resume"],
    [State.BREAK]: ["Break running", "none"],
    [State.COMPLETED]: ["Saving session", "none"],
  }[snap.state];
  ui.primary.textContent = primary[0];
  ui.primary.dataset.action = primary[1];
  ui.primary.disabled = primary[1] === "none";
  ui.reset.disabled = [State.IDLE, State.COMPLETED].includes(snap.state);
  ui.reset.textContent = snap.state === State.BREAK ? "Skip break" : countup ? "Discard" : "Reset";
  ui.stop.hidden = !countup || snap.state === State.IDLE;
  ui.stop.disabled = snap.elapsedMs < 1000 || snap.state === State.COMPLETED;
  for (const [button, mode] of [[ui.pomodoroMode, Mode.POMODORO], [ui.countupMode, Mode.COUNTUP]]) {
    button.disabled = active;
    button.setAttribute("aria-pressed", String(snap.mode === mode));
  }

  // The session belongs to whoever started it, so lock the selector while it is in progress.
  const locked = [State.FOCUSING, State.PAUSED, State.COMPLETED].includes(snap.state);
  ui.userSelect.disabled = locked;
  if (locked && snap.userId && snap.userId !== app.userId) selectUser(snap.userId);

  const hints = {
    [State.IDLE]: "Pick a user and press Start. Cancelled sessions are never counted.",
    [State.FOCUSING]: "Pausing stops the clock. Only a completed session counts.",
    [State.PAUSED]: snap.pausedByLock
      ? "Paused automatically because your screen was locked. Will resume when unlocked."
      : "Paused. Time does not accumulate until you resume.",
    [State.BREAK]: "Breaks are not counted as focus time.",
    [State.COMPLETED]: "Saving this session on your device. Its duration is fixed while storage retries.",
  };
  if (countup) {
    hints[State.IDLE] = "Count up from zero. Stop & save records one session; the limit is 2 hours.";
    hints[State.FOCUSING] = "Pause anytime. Stop & save records elapsed focus time. Automatically saves at 2 hours.";
    hints[State.PAUSED] = snap.pausedByLock
      ? "Paused automatically because your screen was locked. Will resume when unlocked."
      : "Paused. Stop & save keeps your focused time; Discard removes this session.";
  }
  ui.timerHint.textContent = hints[snap.state];
}

ui.primary.addEventListener("click", () => {
  const action = ui.primary.dataset.action;
  if (action === "start") {
    if (app.userId === null) return alert("Select a user first.");
    ui.timerMessage.hidden = true;
    void screenLock.start();
    runTimer(() => timer.start(app.userId));
  } else if (action === "pause") runTimer(() => timer.pause());
  else if (action === "resume") runTimer(() => timer.resume());
});

ui.stop.addEventListener("click", () => runTimer(() => timer.stop()));
for (const [button, mode] of [[ui.pomodoroMode, Mode.POMODORO], [ui.countupMode, Mode.COUNTUP]]) {
  button.addEventListener("click", () => {
    ui.timerMessage.hidden = true;
    void screenLock.start();
    runTimer(() => timer.setMode(mode));
  });
}

function renderNotificationControls() {
  const status = notifications.status();
  ui.notificationStatus.textContent = status.message;
  ui.notifications.textContent = status.enabled ? "Disable notifications" : "Enable silent notifications";
  ui.notifications.disabled = !status.supported || status.permission === "denied";
}

ui.notifications.addEventListener("click", async () => {
  ui.notifications.disabled = true;
  if (notifications.status().enabled) notifications.disable();
  else await notifications.enable();
  renderNotificationControls();
});

function completionMessage(title, body, tag) {
  ui.timerMessage.textContent = `${title}. ${body}`;
  ui.timerMessage.hidden = false;
  void notifications.show(title, body, tag);
}

ui.reset.addEventListener("click", () => {
  const { state } = timer.snapshot();
  if ((state === State.FOCUSING || state === State.PAUSED) && !confirm("Discard this focus session? It will not be counted.")) return;
  runTimer(() => timer.reset());
});

timer.on("change", renderTimer);
timer.on("focus-completed", (session) => {
  const title = session.mode === Mode.COUNTUP ? (session.focus_seconds === 7200 ? "2-hour limit reached" : "Count-up session complete") : "Focus complete";
  completionMessage(title, `${formatDuration(session.focus_seconds)} recorded and queued for sync.`, `focus-${session.id}`);
  renderSyncBanner();
  syncAndRefresh();
});
timer.on("break-completed", ({ id }) => completionMessage("Break complete", "Ready for another focus session.", `break-${id}`));

// Web Locks serialize state-changing controls/completions between tabs. The
// per-session outbox remains safe even in browsers without Web Locks.
async function runTimer(action = () => timer.tick()) {
  try {
    const perform = () => { timer.reload(); action(); };
    if (globalThis.navigator?.locks) await navigator.locks.request("focusTracker.timer", perform);
    else perform();
    app.storageError = "";
  } catch (err) {
    app.storageError = `Cannot save timer data on this device: ${err.message}. Free browser storage before continuing.`;
  }
  renderSyncBanner();
}

setInterval(() => runTimer(), 250);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    if (screenLock.getScreenState() === "unlocked") {
      runTimer(() => timer.resumeByScreenUnlock());
    }
    runTimer();
    refreshAll();
  } else {
    if (screenLock.getScreenState() === "locked") {
      runTimer(() => timer.pauseByScreenLock());
    }
  }
});
// Another tab changed the timer (start/pause/reset): follow it.
window.addEventListener("storage", (e) => {
  if (e.key === "focusTracker.timer.v1") runTimer(() => {});
  if (e.key?.startsWith("focusTracker.pending.") || e.key?.startsWith("focusTracker.rejected.")) renderSyncBanner();
});

// --- Users -------------------------------------------------------------------

function selectUser(id) {
  app.userId = id;
  ui.userSelect.value = String(id);
  localStorage.setItem(USER_KEY, String(id));
}

async function loadUsers() {
  try {
    app.users = await getUsers();
    app.usersLoaded = true;
  } catch {
    if (app.users.length) return; // keep usable remembered users until the retry succeeds
    // Offline at startup: fall back to the remembered user so the timer still works.
    const saved = Number(localStorage.getItem(USER_KEY));
    app.users = saved ? [{ id: saved, display_name: `User ${saved}` }] : [];
  }
  ui.userSelect.replaceChildren(...app.users.map((u) => el("option", { value: u.id }, u.display_name)));

  const saved = Number(localStorage.getItem(USER_KEY));
  const timerUser = timer.snapshot().userId;
  const initial = [timerUser, saved].find((id) => app.users.some((u) => u.id === id)) ?? app.users[0]?.id ?? null;
  if (initial !== null) selectUser(initial);
  renderTimer(timer.snapshot());
}

ui.userSelect.addEventListener("change", () => {
  selectUser(Number(ui.userSelect.value));
  refreshStats();
  leaderboard.refresh();
});

// --- Personal stats ----------------------------------------------------------

const dash = "—";

async function refreshStats() {
  const seq = ++app.statsSeq;
  if (app.userId === null) return;
  const userId = app.userId;
  const today = todayInTimezone(LEADERBOARD_TZ);

  const [sessions, focusWeek, screenDay] = await Promise.allSettled([
    getFocusSessions({ userId, startDate: today, endDate: today }),
    getLeaderboard({ metric: "focus", period: "week", date: today }),
    getLeaderboard({ metric: "screen", period: "day", date: today }),
  ]);
  if (userId !== app.userId || seq !== app.statsSeq) return;

  const mine = (r) => (r.status === "fulfilled" ? r.value.entries.find((e) => e.user_id === userId) : undefined);

  if (sessions.status === "fulfilled") {
    ui.statCount.textContent = String(sessions.value.length);
    ui.statToday.textContent = formatDuration(sessions.value.reduce((sum, s) => sum + s.focus_seconds, 0));
  } else {
    ui.statCount.textContent = ui.statToday.textContent = dash;
  }

  const week = mine(focusWeek);
  ui.statWeek.textContent = week ? formatDuration(week.duration_seconds) : dash;

  const screen = mine(screenDay);
  if (!screen || screen.data_status === "no_data") {
    ui.statScreen.textContent = screen ? "No Data" : dash;
    ui.statScreenSync.textContent = screen ? "Agent has not reported today" : "";
  } else {
    ui.statScreen.textContent = formatDuration(screen.duration_seconds);
    ui.statScreenSync.textContent =
      `Last sync ${timeAgo(screen.last_synced_at_utc)}` + (screen.data_status === "stale" ? " (stale)" : "");
  }
}

// --- Server connection + outbox ----------------------------------------------

function renderSyncBanner() {
  const pending = loadPending().length;
  const rejected = loadRejected().length;
  const parts = [];
  if (app.storageError) parts.push(app.storageError);
  if (pending > 0) parts.push(`${pending} completed session${pending === 1 ? "" : "s"} saved on this device, waiting to sync.`);
  if (rejected > 0) parts.push(`${rejected} session${rejected === 1 ? " was" : "s were"} rejected by the server (see browser console).`);
  ui.syncBanner.hidden = parts.length === 0;
  ui.syncBanner.textContent = parts.join(" ");
}

async function checkHealth() {
  try {
    await getHealth();
    setConnection(true);
    return true;
  } catch {
    setConnection(false);
    return false;
  }
}

function setConnection(online) {
  ui.connection.dataset.online = String(online);
  ui.connectionText.textContent = online ? "Connected" : "Offline";
  if (!online) {
    app.statsSeq += 1;
    ui.statCount.textContent = ui.statToday.textContent = ui.statWeek.textContent = ui.statScreen.textContent = dash;
    ui.statScreenSync.textContent = "Server unavailable";
    leaderboard.setOffline();
    focusChart.setOffline();
  }
}

async function syncAndRefresh() {
  try {
    if (loadPending().length > 0) await flushPending();
  } catch (err) {
    app.storageError = `Cannot update the local sync queue: ${err.message}`;
  }
  renderSyncBanner();
  refreshStats();
  leaderboard.refresh();
  focusChart.refresh();
}

async function refreshAll() {
  if (await checkHealth()) {
    if (!app.usersLoaded) await loadUsers();
    await syncAndRefresh();
  }
}

window.addEventListener("online", refreshAll);
window.addEventListener("offline", () => setConnection(false));

// --- Boot --------------------------------------------------------------------

const leaderboard = createLeaderboard({
  root: $("leaderboard"),
  getCurrentUserId: () => app.userId,
});
const focusChart = createFocusChart({ root: $("focus-chart") });

(async function init() {
  renderNotificationControls();
  if ((await screenLock.checkPermission()) === "granted") {
    void screenLock.start();
  }
  await runTimer();
  renderTimer(timer.snapshot());
  renderSyncBanner();
  await loadUsers();
  await refreshAll();
  setInterval(refreshAll, REFRESH_MS);
  setInterval(checkHealth, HEALTH_MS);
})().catch((err) => {
  console.error(err);
  if (!(err instanceof ApiError)) alert(`Startup error: ${err.message}`);
});
