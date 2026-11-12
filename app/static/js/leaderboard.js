// Leaderboard panel: metric tabs (Focus / Screen Time), period buttons, order toggle, ranked list.
// Renders only what the API says. Missing data is shown as "No Data", never as zero.

import { ApiError, getLeaderboard } from "./api.js";
import { LEADERBOARD_TZ, el, formatDateOnly, formatDuration, timeAgo, todayInTimezone } from "./util.js";

const DEFAULT_ORDER = { focus: "desc", screen: "asc" };

export function createLeaderboard({ root, getCurrentUserId }) {
  const state = { metric: "focus", period: "day", order: DEFAULT_ORDER.focus, requestSeq: 0 };

  const metricButtons = root.querySelectorAll("[data-metric]");
  const periodButtons = root.querySelectorAll("[data-period]");
  const orderRow = root.querySelector("#order-row");
  const orderButtons = root.querySelectorAll("[data-order]");
  const rangeLabel = root.querySelector("#lb-range");
  const list = root.querySelector("#lb-list");
  const notice = root.querySelector("#lb-notice");
  const updated = root.querySelector("#lb-updated");

  function syncControls() {
    for (const b of metricButtons) b.setAttribute("aria-selected", String(b.dataset.metric === state.metric));
    for (const b of periodButtons) b.setAttribute("aria-pressed", String(b.dataset.period === state.period));
    for (const b of orderButtons) b.setAttribute("aria-pressed", String(b.dataset.order === state.order));
    orderRow.hidden = state.metric !== "screen";
  }

  for (const b of metricButtons) {
    b.addEventListener("click", () => {
      state.metric = b.dataset.metric;
      state.order = DEFAULT_ORDER[state.metric];
      syncControls();
      refresh();
    });
  }
  for (const b of periodButtons) {
    b.addEventListener("click", () => {
      state.period = b.dataset.period;
      syncControls();
      refresh();
    });
  }
  for (const b of orderButtons) {
    b.addEventListener("click", () => {
      state.order = b.dataset.order;
      syncControls();
      refresh();
    });
  }

  function renderMessage(text, kind = "info") {
    list.replaceChildren(el("li", { class: `lb-message ${kind}` }, text));
    notice.hidden = true;
  }

  function entryRow(entry, isMe, metric) {
    const noData = entry.data_status === "no_data";
    const stale = entry.data_status === "stale";

    const sub = [];
    if (metric === "screen") {
      if (noData) sub.push("No data synced for this period");
      else {
        sub.push(`Synced ${timeAgo(entry.last_synced_at_utc)}`);
        if (state.period !== "day" && entry.days_with_data != null) {
          sub.push(`${entry.days_with_data} day${entry.days_with_data === 1 ? "" : "s"} of data`);
        }
      }
    }

    return el(
      "li",
      { class: ["lb-entry", isMe ? "me" : "", entry.rank === 1 ? "first" : "", noData ? "nodata" : ""].join(" ").trim() },
      el("span", { class: "lb-rank", "aria-label": entry.rank ? `Rank ${entry.rank}` : "Unranked" }, entry.rank ?? "–"),
      el(
        "div",
        { class: "lb-who" },
        el("span", { class: "lb-name" }, entry.display_name, isMe && el("span", { class: "tag" }, "you")),
        sub.length > 0 && el("span", { class: "lb-sub" }, sub.join(" · ")),
      ),
      el(
        "div",
        { class: "lb-value" },
        noData ? el("span", { class: "badge badge-muted" }, "No Data") : el("strong", {}, formatDuration(entry.duration_seconds)),
        stale && el("span", { class: "badge badge-warn" }, "Stale"),
      ),
    );
  }

  function render(data) {
    const lastDay = formatDateOnly(data.period_end_exclusive, -1);
    const first = formatDateOnly(data.period_start);
    rangeLabel.textContent = first === lastDay ? `${first} · ${data.timezone}` : `${first} – ${lastDay} · ${data.timezone}`;

    const me = getCurrentUserId();
    list.replaceChildren(...data.entries.map((e) => entryRow(e, e.user_id === me, data.metric)));

    const hasGap = data.metric === "screen" && data.entries.some((e) => e.data_status !== "available");
    notice.hidden = !hasGap;
    if (hasGap) {
      notice.textContent =
        "Users with missing or stale data are not ranked. Missing data does not mean zero usage; it means the device has not reported.";
    }
    updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  async function refresh() {
    const seq = ++state.requestSeq; // ignore responses that arrive after a newer request
    try {
      const data = await getLeaderboard({
        metric: state.metric,
        period: state.period,
        date: todayInTimezone(LEADERBOARD_TZ),
        order: state.order,
      });
      if (seq === state.requestSeq) render(data);
    } catch (err) {
      if (seq !== state.requestSeq) return;
      if (err instanceof ApiError && err.isNotImplemented) renderMessage("This leaderboard is not implemented on the server yet.", "warn");
      else if (err instanceof ApiError && err.isNetwork) renderMessage("Cannot reach the server. Showing nothing rather than stale numbers.", "warn");
      else renderMessage(`Could not load leaderboard: ${err.message}`, "error");
    }
  }

  syncControls();
  return { refresh };
}
