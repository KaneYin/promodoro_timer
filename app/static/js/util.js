// Small shared helpers. No dependencies.

// Must match LEADERBOARD_TZ_NAME in app/config.py. Day/week/month boundaries are defined in this zone.
export const LEADERBOARD_TZ = "America/Chicago";

/** Create a DOM element. Children are appended as text (never parsed as HTML). */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** 15780 -> "4h 23m", 600 -> "10m", 45 -> "45s", 0 -> "0m", null -> "—". */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return s === 0 ? "0m" : `${s}s`;
}

/** 90_000 ms -> "01:30" (rounds up so the display hits 00:00 exactly when time is up). */
export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** ISO timestamp -> "just now" / "3 min ago" / "2 h ago" / "4 d ago". */
export function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return "never";
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Today's calendar date as "YYYY-MM-DD" in the given IANA timezone. */
export function todayInTimezone(timeZone = LEADERBOARD_TZ, nowMs = Date.now()) {
  // Assemble parts explicitly: locale separators/order can vary by browser.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** "2026-11-09" -> "Nov 9" (pure calendar math, immune to the browser's timezone). */
export function formatDateOnly(isoDate, dayOffset = 0) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** UUID v4. crypto.randomUUID needs a secure context (https/localhost); fall back otherwise. */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Date -> "2026-11-11T15:25:00Z" (what the API expects). */
export function toUtcIso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
