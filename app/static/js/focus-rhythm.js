import { el, formatDuration } from "./util.js";

export function rhythmCard(series, period, { current = true } = {}) {
  const rhythm = series.rhythm;
  if (!rhythm) return el("article", { class: "rhythm-card" },
    el("strong", {}, series.display_name), el("p", {}, "Focus rhythm unavailable. Refresh after updating the server."));
  const window = rhythm.windows.find((item) => item.key === rhythm.key);
  const periodName = { day: "day", week: "week", month: "month" }[period];
  const scope = current ? `this ${periodName}` : `the selected ${periodName}`;
  let explanation;
  if (rhythm.key === "no_focus") explanation = "Complete a focus session to start discovering your rhythm.";
  else if (rhythm.key === "discovering") explanation = `Keep going: ${formatDuration(rhythm.total_seconds)} of ${formatDuration(rhythm.minimum_seconds)}, ${rhythm.active_days} of ${rhythm.minimum_days} active days recorded.`;
  else if (window) explanation = `${Math.round(window.share * 100)}% of your focus time ${scope} fell in the ${window.time_range} window.`;
  else explanation = `Your focus ${scope} spanned different parts of the day.`;
  return el("article", { class: "rhythm-card", dataset: { rhythm: rhythm.key } },
    el("div", { class: "rhythm-user" }, series.display_name),
    el("strong", { class: "rhythm-badge" }, `${rhythm.emoji} ${rhythm.label}`),
    el("p", { class: "rhythm-explanation" }, explanation),
    el("small", { class: "rhythm-summary" }, `${formatDuration(rhythm.total_seconds)} · ${rhythm.active_days} active ${rhythm.active_days === 1 ? "day" : "days"}`),
    rhythm.estimated_seconds > 0 ? el("p", { class: "rhythm-estimate" }, `Includes ${formatDuration(rhythm.estimated_seconds)} of estimated timing from older sessions.`) : null,
    el("details", { class: "rhythm-distribution" },
      el("summary", {}, "View time-of-day breakdown"),
      el("ul", {}, ...rhythm.windows.map((item) => el("li", {},
        el("span", {}, `${item.emoji} ${item.label} (${item.time_range})`),
        el("strong", {}, `${formatDuration(item.duration_seconds)} · ${Math.round(item.share * 100)}%`),
      ))),
    ),
  );
}
