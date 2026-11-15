// Today's Personality for the selected user only: a prominent icon, one small sentence and a short breakdown.
import { getFocusStats, ApiError } from "./api.js";
import { el, formatDuration, todayInTimezone } from "./util.js";

const article = (label) => (/^[aeiou]/i.test(label) ? "an" : "a");

export function rhythmSentence(rhythm) {
  if (rhythm.key === "no_focus") return "Complete a focus session to start discovering your personality.";
  if (rhythm.key === "discovering") {
    return `Still discovering your personality: ${formatDuration(rhythm.total_seconds)} of ${formatDuration(rhythm.minimum_seconds)} focused so far today.`;
  }
  const window = rhythm.windows.find((item) => item.key === rhythm.key);
  const name = `${article(rhythm.label)} ${rhythm.label}`;
  const detail = window
    ? `${Math.round(window.share * 100)}% of your focus today fell between ${window.time_range}.`
    : "your focus today spanned different parts of the day.";
  return `You're ${name}${window ? ". " : ": "}${detail}`;
}

export function rhythmCard(series) {
  const rhythm = series?.rhythm;
  if (!rhythm) return el("p", { class: "chart-message" }, "Personality unavailable. Refresh after updating the server.");
  const used = rhythm.windows.filter((item) => item.duration_seconds > 0);
  return el("article", { class: "rhythm-card", dataset: { rhythm: rhythm.key } },
    el("div", { class: "rhythm-icon", "aria-hidden": "true" }, rhythm.emoji),
    el("p", { class: "rhythm-sentence" }, rhythmSentence(rhythm)),
    used.length ? el("details", { class: "rhythm-distribution" },
      el("summary", {}, "View time-of-day breakdown"),
      el("ul", {}, ...used.map((item) => el("li", {},
        el("span", {}, `${item.emoji} ${item.time_range}`),
        el("strong", {}, `${Math.round(item.share * 100)}%`),
      ))),
    ) : null,
  );
}

export function createFocusRhythm({ root, getUserId, getToday = todayInTimezone }) {
  const list = root.querySelector("#rhythm-list");
  let sequence = 0, latest = null;

  const message = (text) => list.replaceChildren(el("p", { class: "chart-message" }, text));

  // The response holds every user's rhythm; only the selected user's is rendered.
  function show() {
    const userId = getUserId();
    if (userId === null || userId === undefined) return message("Select a user to see your personality.");
    if (!latest) return; // keep the loading or offline message until data arrives
    const mine = latest.series.find((series) => series.user_id === userId);
    if (mine) list.replaceChildren(rhythmCard(mine));
    else message("Personality unavailable for this user.");
  }

  async function refresh() {
    const seq = ++sequence;
    if (getUserId() === null || getUserId() === undefined) return show();
    try {
      const data = await getFocusStats({ period: "day", date: getToday() });
      if (seq !== sequence) return;
      latest = data;
      show();
    } catch (error) {
      if (seq !== sequence) return;
      message(error instanceof ApiError && error.isNetwork
        ? "Cannot reach the server. Personality will return after reconnecting."
        : `Could not load personality: ${error.message}`);
    }
  }

  function setOffline() {
    sequence += 1;
    latest = null;
    message("Cannot reach the server. Personality will return after reconnecting.");
  }

  return { refresh, show, setOffline };
}
