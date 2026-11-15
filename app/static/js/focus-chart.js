// Shared comparison chart: no current-user input, fixed colors by user id.
// Each session is assigned to its completion bucket, matching Focus rankings.
import { getFocusStats, getFocusDates, ApiError } from "./api.js";
import { el, formatDateOnly, formatDuration, todayInTimezone } from "./util.js";

const COLORS = ["var(--chart-user-1)", "var(--chart-user-2)"];
const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 560, HEIGHT = 260, LEFT = 48, RIGHT = 12, TOP = 16, BOTTOM = 52;

export const seriesColor = (userId) => COLORS[(userId - 1) % COLORS.length];

export function durationLabel(seconds) {
  const rest = seconds % 60;
  return formatDuration(seconds) + (seconds >= 60 && rest ? ` ${rest}s` : "");
}

export function chartScale(maxSeconds) {
  if (maxSeconds === 0) return { ceiling: 3600, step: 900 };
  const steps = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400];
  const step = steps.find((value) => value >= maxSeconds / 4) ?? Math.ceil(maxSeconds / 4 / 86400) * 86400;
  return { ceiling: Math.ceil(maxSeconds / step) * step, step };
}

export function periodAnchor(isoDate, period) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (period === "month") date.setUTCDate(1);
  if (period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function periodLabel(isoDate, period) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (period === "month") return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
  const label = (value) => value.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const start = label(date);
  if (period === "day") return start;
  date.setUTCDate(date.getUTCDate() + 6);
  return `${start} - ${label(date)}`;
}

export function periodOptions(dates, period, today) {
  const current = periodAnchor(today, period);
  const history = [...new Set(dates.map((date) => periodAnchor(date, period)))].filter((date) => date !== current).sort().reverse();
  return [
    { value: "current", label: `${{ day: "Today", week: "This week", month: "This month" }[period]} · ${periodLabel(current, period)}` },
    ...history.map((date) => ({ value: date, label: periodLabel(date, period) })),
  ];
}

function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  for (const child of children) node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

export function createFocusChart({ root, getToday = todayInTimezone }) {
  const find = (id) => root.querySelector(`#${id}`);
  const ui = Object.fromEntries(["day", "week", "month", "date", "range", "legend", "plot", "detail", "empty", "table", "updated"].map((name) => [name, find(`chart-${name}`)]));
  const state = { period: "day", date: getToday(), followToday: true, sequence: 0, dates: [] };

  function controls() {
    for (const period of ["day", "week", "month"]) ui[period].setAttribute("aria-pressed", String(state.period === period));
    ui.date.replaceChildren(...periodOptions(state.dates, state.period, getToday()).map(({ value, label }) => el("option", { value }, label)));
    ui.date.value = state.followToday ? "current" : state.date;
  }

  for (const period of ["day", "week", "month"]) ui[period].addEventListener("click", () => {
    state.period = period;
    state.followToday = true;
    state.date = getToday();
    controls();
    void refresh({ loading: true });
  });
  ui.date.addEventListener("change", () => {
    if (!ui.date.value) return;
    state.followToday = ui.date.value === "current";
    state.date = state.followToday ? getToday() : ui.date.value;
    void refresh({ loading: true });
  });

  function message(text) {
    ui.plot.replaceChildren(el("p", { class: "chart-message" }, text));
    ui.legend.replaceChildren();
    ui.table.replaceChildren();
    ui.detail.textContent = "";
    ui.empty.hidden = true;
    ui.updated.textContent = "";
  }

  function render(data) {
    const first = formatDateOnly(data.period_start), last = formatDateOnly(data.period_end_exclusive, -1);
    ui.range.textContent = `${first === last ? first : `${first} - ${last}`}, ${data.period_start.slice(0, 4)} · ${data.timezone}`;
    ui.legend.replaceChildren(...data.series.map((series) => el("div", { class: "chart-user" },
      el("span", { class: "chart-swatch", style: `background:${seriesColor(series.user_id)}`, "aria-hidden": "true" }),
      el("span", { class: "chart-user-name" }, series.display_name),
      el("strong", { title: `${durationLabel(series.total_seconds)} · ${series.session_count} sessions` }, durationLabel(series.total_seconds)),
    )));
    const max = Math.max(0, ...data.series.flatMap((series) => series.duration_seconds));
    const { ceiling, step } = chartScale(max);
    const plotWidth = WIDTH - LEFT - RIGHT, plotHeight = HEIGHT - TOP - BOTTOM;
    const baseline = TOP + plotHeight;
    const chart = svg("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "focus-chart-svg", role: "group", "aria-label": "Both users' focused time by completion period" });
    const y = (seconds) => baseline - seconds / ceiling * plotHeight;
    for (let value = 0; value <= ceiling; value += step) {
      chart.append(svg("line", { x1: LEFT, x2: WIDTH - RIGHT, y1: y(value), y2: y(value), class: "chart-grid" }));
      chart.append(svg("text", { x: LEFT - 7, y: y(value) + 4, "text-anchor": "end", class: "chart-axis" }, formatDuration(value)));
    }
    function detail(index) {
      ui.detail.textContent = `${data.buckets[index].label}: ${data.series.map((s) => `${s.display_name} ${durationLabel(s.duration_seconds[index])}`).join(" · ")}`;
    }
    const groupWidth = plotWidth / data.buckets.length;
    const barWidth = Math.min(24, groupWidth * 0.72 / Math.max(1, data.series.length));
    for (const [index, bucket] of data.buckets.entries()) {
      const center = LEFT + groupWidth * (index + 0.5);
      for (const [seriesIndex, series] of data.series.entries()) {
        const seconds = series.duration_seconds[index];
        const label = `${bucket.label}, ${series.display_name}: ${durationLabel(seconds)}`;
        const bar = svg("rect", {
          x: center - barWidth * data.series.length / 2 + seriesIndex * barWidth + 1,
          y: y(seconds), width: Math.max(1, barWidth - 2), height: baseline - y(seconds), rx: 2,
          fill: seriesColor(series.user_id), class: "chart-bar", tabindex: seconds ? "0" : "-1",
          role: "button", "aria-label": label, "data-user-id": series.user_id,
        }, svg("title", {}, label));
        for (const event of ["pointerenter", "focus", "click"]) bar.addEventListener(event, () => detail(index));
        bar.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); detail(index); }
        });
        chart.append(bar);
      }
      if (data.period !== "day" || index % 4 === 0 || index === data.buckets.length - 1) {
        chart.append(svg("text", { x: center, y: baseline + 20, "text-anchor": "middle", class: "chart-axis" }, data.period === "day" ? bucket.label.slice(0, 5) : bucket.label));
      }
    }
    chart.append(svg("text", { x: LEFT + plotWidth / 2, y: HEIGHT - 6, "text-anchor": "middle", class: "chart-axis chart-axis-title" }, `Completion ${data.bucket_unit}`));
    ui.plot.replaceChildren(chart);
    ui.empty.hidden = max > 0;
    ui.detail.textContent = "Select a bar to compare exact durations.";
    ui.table.replaceChildren(el("table", { class: "chart-data-table" },
      el("caption", { class: "sr-only" }, "Recorded focus duration by completion period"),
      el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Completed"), ...data.series.map((s) => el("th", { scope: "col" }, s.display_name)))),
      el("tbody", {}, ...data.buckets.map((bucket, index) => el("tr", {}, el("th", { scope: "row" }, bucket.label), ...data.series.map((s) => el("td", {}, durationLabel(s.duration_seconds[index])))))),
    ));
    ui.updated.textContent = `Updated ${new Date(data.generated_at_utc).toLocaleTimeString()}`;
  }

  async function refresh({ loading = false } = {}) {
    const sequence = ++state.sequence;
    if (state.followToday) state.date = getToday();
    controls();
    if (loading) message("Loading focus chart...");
    try {
      // The chart can still render if only the history lookup fails. Never
      // replace a useful chart with a blank area because of the optional menu.
      const [data, dates] = await Promise.allSettled([
        getFocusStats({ period: state.period, date: state.date }), getFocusDates(),
      ]);
      if (sequence !== state.sequence) return;
      if (data.status === "rejected") throw data.reason;
      if (dates.status === "fulfilled") state.dates = dates.value.dates;
      controls();
      render(data.value);
      if (dates.status === "rejected") ui.updated.textContent += " · Recorded periods unavailable; retrying automatically.";
    } catch (error) {
      if (sequence !== state.sequence) return;
      message(error instanceof ApiError && error.isNetwork ? "Cannot reach the server. Focus chart will return after reconnecting." : `Could not load focus chart: ${error.message}`);
    }
  }

  function setOffline() {
    state.sequence += 1;
    message("Cannot reach the server. Focus chart will return after reconnecting.");
    ui.range.textContent = "";
  }
  controls();
  return { refresh, setOffline };
}
