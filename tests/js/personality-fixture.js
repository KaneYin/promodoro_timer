const WINDOWS = [
  ["before_dawn", "Before-Dawn Learner", "🌌", "2 AM–6 AM"],
  ["early_bird", "Early Bird", "🐦", "6 AM–10 AM"],
  ["midday", "Midday Focuser", "☀️", "10 AM–2 PM"],
  ["afternoon", "Afternoon Learner", "🌤️", "2 PM–6 PM"],
  ["evening", "Evening Learner", "🌆", "6 PM–10 PM"],
  ["night_owl", "Night Owl", "🦉", "10 PM–2 AM"],
];

export function rhythmFixture(key = "night_owl", period = "day") {
  const definition = WINDOWS.find((w) => w[0] === key) ?? {
    discovering: [key, "Discovering Your Rhythm", "🔎"],
    no_focus: [key, "No Focus Yet", "🌱"],
    flexible: [key, "Flexible Focuser", "🎨"],
  }[key];
  const [minimum_seconds, minimum_days] = { day: [1500, 1], week: [6000, 3], month: [18000, 7] }[period];
  const total_seconds = key === "no_focus" ? 0 : key === "discovering" ? 600 : minimum_seconds * 2;
  const shares = key === "early_bird" ? [0, .65, .05, .05, .05, .2]
    : key === "flexible" ? Array(6).fill(1 / 6) : [0, .2, .05, .05, .05, .65];
  return { key, label: definition[1], emoji: definition[2], total_seconds, active_days: total_seconds ? minimum_days : 0,
    minimum_seconds, minimum_days, estimated_seconds: 0,
    windows: WINDOWS.map(([key, label, emoji, time_range], i) => ({ key, label, emoji, time_range,
      duration_seconds: shares[i] * total_seconds, share: total_seconds ? shares[i] : 0 })),
  };
}
