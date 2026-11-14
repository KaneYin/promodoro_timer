import { el, formatDuration } from "./util.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const percent = (share) => `${Math.round(share * 1000) / 10}%`;

function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  for (const child of children) node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

// Use durations, not rounded display percentages, to draw exact proportions.
export function pieData(windows) {
  const durations = windows.map((w) => Number.isFinite(w.duration_seconds) ? Math.max(0, w.duration_seconds) : 0);
  const total = durations.reduce((sum, seconds) => sum + seconds, 0);
  let angle = -Math.PI / 2;
  return windows.map((window, index) => {
    const share = total ? durations[index] / total : 0;
    const start = angle;
    angle += share * Math.PI * 2;
    const x = (a) => 100 + 82 * Math.cos(a), y = (a) => 100 + 82 * Math.sin(a);
    return { ...window, share, color: `var(--personality-${index})`,
      path: share > 0 && share < 1 ? `M 100 100 L ${x(start)} ${y(start)} A 82 82 0 ${share > .5 ? 1 : 0} 1 ${x(angle)} ${y(angle)} Z` : null };
  });
}

export function personalityBadge(rhythm, userId) {
  if (!rhythm) return null;
  const id = `personality-label-${userId}`;
  return el("span", { class: "personality-badge", dataset: { personality: rhythm.key } },
    el("span", { class: "personality-icon", tabindex: "0", role: "img",
      "aria-label": `Focus personality: ${rhythm.label}`, "aria-describedby": id }, rhythm.emoji),
    el("span", { class: "personality-tooltip", id, role: "tooltip" }, rhythm.label),
  );
}

export function personalityDetails(entry, { open = false, onToggle = () => {} } = {}) {
  const rhythm = entry.rhythm;
  if (!rhythm) return null;
  const windows = pieData(rhythm.windows);
  const active = windows.filter((w) => w.share > 0);
  const label = active.length ? active.map((w) => `${w.label}: ${percent(w.share)}`).join(", ") : "No completed focus time in the selected period.";
  const chart = svg("svg", { viewBox: "0 0 200 200", class: "personality-pie", role: "img",
    "aria-label": `${entry.display_name}'s focus time by time of day. ${label}` }, svg("title", {}, label));
  if (!active.length) chart.append(svg("circle", { cx: 100, cy: 100, r: 82, fill: "var(--line)" }));
  for (const w of active) {
    const shape = w.share === 1 ? svg("circle", { cx: 100, cy: 100, r: 82, fill: w.color }) : svg("path", { d: w.path, fill: w.color });
    shape.append(svg("title", {}, `${w.label}: ${percent(w.share)}`));
    chart.append(shape);
  }
  const note = rhythm.key === "no_focus" ? "No completed focus time in this period."
    : rhythm.key === "discovering" ? `Discovering Your Rhythm: ${formatDuration(rhythm.total_seconds)} of ${formatDuration(rhythm.minimum_seconds)}, ${rhythm.active_days} of ${rhythm.minimum_days} active days recorded.`
    : `${formatDuration(rhythm.total_seconds)} of focus · ${rhythm.active_days} active ${rhythm.active_days === 1 ? "day" : "days"}`;
  const panel = el("details", { class: "personality-details" },
    el("summary", { "aria-label": `Focus personality details for ${entry.display_name}` }, "Details"),
    el("div", { class: "personality-breakdown" }, chart,
      el("ul", { class: "personality-legend" }, ...windows.map((w) => el("li", {},
        el("span", { class: "personality-window" },
          el("span", { class: "personality-swatch", style: `background:${w.color}`, "aria-hidden": "true" }),
          el("span", {}, w.label, el("small", {}, w.time_range)),
        ),
        el("span", { class: "personality-share" }, el("strong", {}, percent(w.share)), el("small", {}, formatDuration(w.duration_seconds))),
      ))),
    ),
    el("p", { class: "personality-note" }, note),
    rhythm.estimated_seconds > 0 ? el("p", { class: "personality-note" }, `Includes ${formatDuration(rhythm.estimated_seconds)} of estimated timing from older sessions.`) : null,
  );
  panel.open = open;
  panel.addEventListener("toggle", () => onToggle(panel.open));
  return panel;
}
