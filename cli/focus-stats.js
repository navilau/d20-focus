#!/usr/bin/env node
// Prints focus/break stats from the log.json the extension writes.
//
//   node cli/focus-stats.js [today|week|all|<N>d] [--json] [--file <path>]
//
// The range (default: week) applies to the per-day, task and pause sections;
// the totals table always shows today, this week and all time.
// Uses the same lib/stats.js as the History page, so the numbers match.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  summary, focusByDay, focusByTask, pausesByReason, rollCounts, startOfDay, startOfWeek,
} from "../lib/stats.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const fileIdx = args.indexOf("--file");
const file = fileIdx >= 0 ? args[fileIdx + 1]
  : process.env.D20_FOCUS_LOG || join(homedir(), "Downloads", "d20-focus", "log.json");
const positional = args.filter((a, i) => !a.startsWith("--") && !(fileIdx >= 0 && i === fileIdx + 1));
const rangeArg = (positional[0] || "week").toLowerCase();

function parseRange(r, now) {
  if (r === "today") return { label: "today", from: startOfDay(now), days: 1 };
  if (r === "week") {
    const from = startOfWeek(now);
    return { label: "this week", from, days: Math.round((startOfDay(now) - from) / 864e5) + 1 };
  }
  if (r === "all") return { label: "all time", from: null, days: 14 };
  const m = r.match(/^(\d{1,3})d$/);
  if (m) {
    const days = Math.max(1, Number(m[1]));
    const from = startOfDay(now);
    from.setDate(from.getDate() - (days - 1));
    return { label: `last ${days} days`, from, days };
  }
  fail(`Unknown range "${r}". Use today, week, all or a number of days like 7d.`);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const hm = (min) => {
  const m = Math.round(min);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
const ago = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

// ---- load -------------------------------------------------------------

let raw;
try {
  raw = await readFile(file, "utf8");
} catch {
  fail(`No log found at ${file}.\nThe D20 Focus extension writes it after each session, or click "Download log" in its popup.`);
}
let log;
try {
  log = JSON.parse(raw);
} catch {
  fail(`${file} isn't valid JSON.`);
}
const sessions = Array.isArray(log) ? log : log.sessions ?? [];
const now = new Date();
const range = parseRange(rangeArg, now);
const exportedAt = log.exportedAt ? new Date(log.exportedAt) : (await stat(file)).mtime;

// ---- compute ----------------------------------------------------------

const totals = summary(sessions, now);
const perDay = focusByDay(sessions, Math.min(range.days, 31), now);
const tasks = focusByTask(sessions, range.from);
const pauses = pausesByReason(sessions, range.from);
const inRange = sessions.filter((s) => !range.from || new Date(s.startedAt) >= range.from);
const focusRolls = inRange.filter((s) => s.type === "focus").map((s) => s.roll).filter(Boolean);
const allRolls = rollCounts(inRange);
const rolls = {
  count: allRolls.reduce((n, r) => n + r.count, 0),
  avgFocusRoll: focusRolls.length ? Math.round((focusRolls.reduce((a, b) => a + b, 0) / focusRolls.length) * 10) / 10 : null,
  nat20: allRolls[19].count,
  nat1: allRolls[0].count,
};
let current = log.current ?? null;
if (current?.endsAt && new Date(current.endsAt) < now) current = { ...current, likelyEnded: true };

if (json) {
  console.log(JSON.stringify({ file, exportedAt, range: { ...range, from: range.from?.toISOString() ?? null },
    current, totals, perDay: perDay.map(({ date, ...r }) => r), tasks, pauses, rolls }, null, 2));
  process.exit(0);
}

// ---- print ------------------------------------------------------------

const out = [];
out.push(`D20 Focus · ${range.label}   (log updated ${time(exportedAt)}, ${ago(now - exportedAt)})`);
out.push("");

if (current) {
  const what = current.type === "focus" ? `Focus${current.task ? ` on "${current.task}"` : ""}` : "Break";
  if (current.status === "paused") {
    out.push(`Now: ${what}, paused (${current.pauseReason || "meeting"}). Rolled ${current.roll} → ${current.plannedMin} min.`);
  } else if (current.likelyEnded) {
    out.push(`Last known: ${what}, ${current.plannedMin} min, was due to end at ${time(current.endsAt)}.`);
  } else {
    const left = Math.ceil((new Date(current.endsAt) - now) / 60000);
    out.push(`Now: ${what}. Rolled ${current.roll} → ${current.plannedMin} min, ends ${time(current.endsAt)} (~${left} min left).`);
  }
  out.push("(The session in progress isn't counted in the totals below.)");
  out.push("");
}

out.push(`${pad("", 11)}${lpad("Focus", 9)}${lpad("Blocks", 8)}${lpad("Stopped", 9)}${lpad("Breaks", 9)}${lpad("Skipped", 9)}${lpad("Paused", 9)}`);
for (const [label, t] of [["Today", totals.today], ["This week", totals.week], ["All time", totals.all]]) {
  out.push(`${pad(label, 11)}${lpad(hm(t.focusMin), 9)}${lpad(t.focusCount, 8)}${lpad(t.stopped, 9)}${lpad(hm(t.breakMin), 9)}${lpad(t.skipped, 9)}${lpad(hm(t.pauseMin), 9)}`);
}

if (perDay.length > 1) {
  out.push("");
  out.push("Focus per day");
  const max = Math.max(...perDay.map((d) => d.focusMin), 1);
  for (const d of perDay) {
    const label = d.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const bar = "█".repeat(Math.round((d.focusMin / max) * 24));
    out.push(`  ${pad(label, 12)} ${pad(bar, 24)} ${hm(d.focusMin)}`);
  }
}

out.push("");
out.push(`Tasks (${range.label})`);
if (!tasks.length) out.push("  No focus blocks.");
for (const t of tasks.slice(0, 10)) {
  out.push(`  ${lpad(hm(t.focusMin), 7)}  ${t.task}  (${t.blocks} block${t.blocks === 1 ? "" : "s"})`);
}
if (tasks.length > 10) out.push(`  …and ${tasks.length - 10} more`);

const reasons = Object.entries(pauses);
if (reasons.length) {
  out.push("");
  out.push(`Pauses (${range.label})`);
  for (const [r, p] of reasons.sort((a, b) => b[1].minutes - a[1].minutes)) {
    out.push(`  ${lpad(hm(p.minutes), 7)}  ${r} (${p.count})`);
  }
}

if (rolls.count) {
  out.push("");
  out.push(`Rolls (${range.label}): ${rolls.count} total` +
    (rolls.avgFocusRoll ? `, average focus roll ${rolls.avgFocusRoll}` : "") +
    `, ${rolls.nat20} × natural 20, ${rolls.nat1} × natural 1`);
}

console.log(out.join("\n"));
