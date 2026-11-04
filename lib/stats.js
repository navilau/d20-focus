// Turns the session log into totals, chart data and CSV. Pure functions.

const DAY = 86_400_000;

/** Local midnight for a date. */
export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Local Monday 00:00 of the week containing d. */
export function startOfWeek(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}

/** "2026-11-04" in local time. */
export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** Minutes of focus, break and pause, plus counts, for sessions since `from`. */
export function totals(sessions, from = null) {
  const t = { focusMin: 0, breakMin: 0, pauseMin: 0, focusCount: 0, breakCount: 0, pauseCount: 0, stopped: 0, skipped: 0 };
  for (const s of sessions) {
    if (from && new Date(s.startedAt) < from) continue;
    t[`${s.type}Min`] += s.actualMin || 0;
    t[`${s.type}Count`] += 1;
    if (s.status === "stopped") t.stopped += 1;
    if (s.status === "skipped") t.skipped += 1;
  }
  for (const k of ["focusMin", "breakMin", "pauseMin"]) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}

/** Totals for today, this week and all time. */
export function summary(sessions, now = new Date()) {
  return {
    today: totals(sessions, startOfDay(now)),
    week: totals(sessions, startOfWeek(now)),
    all: totals(sessions),
  };
}

/** Focus minutes per day for the last `days` days (oldest first), zeros included. */
export function focusByDay(sessions, days = 14, now = new Date()) {
  const out = [];
  const index = new Map();
  const today = startOfDay(now);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const row = { day: dayKey(d), date: d, focusMin: 0 };
    index.set(row.day, row);
    out.push(row);
  }
  for (const s of sessions) {
    if (s.type !== "focus") continue;
    const row = index.get(dayKey(s.startedAt));
    if (row) row.focusMin += s.actualMin || 0;
  }
  for (const r of out) r.focusMin = Math.round(r.focusMin * 10) / 10;
  return out;
}

/** How many times each face 1–20 came up, counting every roll (re-rolls too). */
export function rollCounts(sessions) {
  const counts = Array.from({ length: 20 }, (_, i) => ({ face: i + 1, count: 0 }));
  for (const s of sessions) {
    for (const r of s.rolls ?? []) if (r >= 1 && r <= 20) counts[r - 1].count++;
  }
  return counts;
}

/** Focus minutes per task, biggest first. Blank tasks are grouped as "(no task)". */
export function focusByTask(sessions, from = null) {
  const map = new Map();
  for (const s of sessions) {
    if (s.type !== "focus" || (from && new Date(s.startedAt) < from)) continue;
    const key = (s.task || "").trim() || "(no task)";
    const row = map.get(key) ?? { task: key, focusMin: 0, blocks: 0 };
    row.focusMin += s.actualMin || 0;
    row.blocks += 1;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, focusMin: Math.round(r.focusMin * 10) / 10 }))
    .sort((a, b) => b.focusMin - a.focusMin);
}

/** Pause minutes and counts per reason. */
export function pausesByReason(sessions, from = null) {
  const out = {};
  for (const s of sessions) {
    if (s.type !== "pause" || (from && new Date(s.startedAt) < from)) continue;
    const r = (out[s.reason || "other"] ??= { count: 0, minutes: 0 });
    r.count += 1;
    r.minutes = Math.round((r.minutes + (s.actualMin || 0)) * 10) / 10;
  }
  return out;
}

export const CSV_COLUMNS = [
  "id", "type", "status", "reason", "during", "task", "roll", "rolls",
  "plannedMin", "actualMin", "pausedMin", "longBreak", "startedAt", "endedAt",
];

export function toCSV(sessions) {
  const esc = (v) => {
    if (v === undefined || v === null) return "";
    const s = Array.isArray(v) ? v.join(" ") : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.join(",")];
  for (const s of sessions) lines.push(CSV_COLUMNS.map((c) => esc(s[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Merge imported sessions into existing ones by id, sorted by start time. */
export function mergeSessions(existing, incoming) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) {
    if (s && s.id && s.type && s.startedAt && !byId.has(s.id)) byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** The JSON written to Downloads/d20-focus/log.json for Claude CLI to read. */
export function logFile(sessions, state, now = new Date()) {
  let current = null;
  if (state && (state.status === "running" || state.status === "paused")) {
    current = {
      type: state.phase,
      status: state.status,
      roll: state.roll,
      plannedMin: state.plannedMin,
      task: state.phase === "focus" ? state.task || undefined : undefined,
      startedAt: new Date(state.startedAt).toISOString(),
      endsAt: state.status === "running" ? new Date(state.endsAt).toISOString() : undefined,
      pauseReason: state.status === "paused" ? state.pauseReason : undefined,
    };
  }
  return {
    app: "d20-focus",
    version: 1,
    exportedAt: now.toISOString(),
    note: "Times are UTC ISO strings. actualMin excludes paused time. type is focus | break | pause.",
    current,
    // When nothing is running: which phase the next roll is for.
    next: current ? null : state?.phase ?? null,
    sessions,
  };
}

export { DAY };
