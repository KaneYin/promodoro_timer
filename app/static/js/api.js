// HTTP client for the backend + the offline outbox for completed focus sessions.
// Contract: docs/api.md.  Outbox behaviour: docs/frontend-backend.md.

const REQUEST_TIMEOUT_MS = 8000;
const PENDING_PREFIX = "focusTracker.pending.v2.";
const REJECTED_PREFIX = "focusTracker.rejected.v2.";

/** status === 0 means the request never got an HTTP response (offline, timeout, DNS). */
export class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
  get isNetwork() {
    return this.status === 0;
  }
  get isNotImplemented() {
    return this.status === 501;
  }
}

async function request(method, path, { query, body } = {}) {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(0, err.name === "AbortError" ? "Request timed out" : "Network error");
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return response.json();

  // Error bodies are {"detail": "...", "code": "..."}; 422 from FastAPI has a list in detail.
  let detail = response.statusText;
  let code = null;
  try {
    const data = await response.json();
    code = data.code ?? null;
    detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(response.status, detail, code);
}

export const getHealth = () => request("GET", "/api/health");
export const getUsers = () => request("GET", "/api/users");
export const getFocusSessions = ({ userId, startDate, endDate }) =>
  request("GET", "/api/focus-sessions", {
    query: { user_id: userId, start_date: startDate, end_date: endDate },
  });
export const postFocusSession = (session) => request("POST", "/api/focus-sessions", { body: session });
export const getLeaderboard = ({ metric, period, date, order }) =>
  request("GET", "/api/leaderboards", { query: { metric, period, date, order } });

// --- Outbox: completed sessions waiting to reach the server ------------------

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function records(prefix) {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  return keys.filter((key) => key?.startsWith(prefix)).flatMap((key) => {
    try {
      const record = JSON.parse(localStorage.getItem(key));
      return record && typeof record.id === "string" ? [record] : [];
    } catch { return []; }
  }).sort((a, b) => String(a.completed_at_utc ?? "").localeCompare(String(b.completed_at_utc ?? "")) || a.id.localeCompare(b.id));
}

function migrateLegacyOutbox() {
  // Copy records before deleting the old arrays. A crash can only replay a UUID.
  for (const session of readList("focusTracker.rejectedSessions.v1")) {
    if (session?.id) localStorage.setItem(REJECTED_PREFIX + session.id, JSON.stringify(session));
  }
  for (const session of readList("focusTracker.pendingSessions.v1")) {
    if (session?.id && !localStorage.getItem(REJECTED_PREFIX + session.id)) {
      localStorage.setItem(PENDING_PREFIX + session.id, JSON.stringify(session));
    }
  }
  localStorage.removeItem("focusTracker.rejectedSessions.v1");
  localStorage.removeItem("focusTracker.pendingSessions.v1");
}

export function loadPending() {
  migrateLegacyOutbox();
  return records(PENDING_PREFIX).filter((s) => !localStorage.getItem(REJECTED_PREFIX + s.id));
}
export function loadRejected() {
  migrateLegacyOutbox();
  return records(REJECTED_PREFIX);
}

/** Store a completed session locally. Synchronous and idempotent by session id. */
export function enqueueSession(session) {
  if (!localStorage.getItem(REJECTED_PREFIX + session.id)) {
    // A separate atomic storage key per UUID prevents another tab's enqueue or
    // dequeue from overwriting unrelated sessions. Server dedup handles replay.
    localStorage.setItem(PENDING_PREFIX + session.id, JSON.stringify(session));
  }
}

function removePending(id) {
  localStorage.removeItem(PENDING_PREFIX + id);
}

function moveToRejected(session, reason) {
  localStorage.setItem(REJECTED_PREFIX + session.id, JSON.stringify({ ...session, rejected_reason: reason }));
  removePending(session.id);
}

// Retrying can never fix these: the server understood the request and said no.
const isPermanentFailure = (err) =>
  err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;

let flushing = null;

/**
 * Try to upload every pending session, oldest first.
 * - 2xx: remove from the outbox.
 * - network error / 5xx / 501: keep it, stop (the server is not usable right now).
 * - other 4xx (e.g. 409, 422, 404): park it in the rejected list so it is not retried forever and not lost.
 * Concurrent calls share one run. Returns { sent, rejected, remaining }.
 */
export function flushPending() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let rejected = 0;
    for (const session of loadPending()) {
      try {
        await postFocusSession(session);
        removePending(session.id);
        sent += 1;
      } catch (err) {
        if (err instanceof ApiError && isPermanentFailure(err)) {
          console.warn("Focus session rejected by server", session, err.message);
          moveToRejected(session, `${err.status} ${err.message}`);
          rejected += 1;
          continue;
        }
        break;
      }
    }
    return { sent, rejected, remaining: loadPending().length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
