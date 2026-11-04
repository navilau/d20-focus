#!/usr/bin/env node
// Claude Code status line for D20 Focus.
//
//   node cli/statusline.js [--chain <script>] [--file <log.json>]
//
// Prints one line, such as:
//   🎲 14 · Focus · Write project proposal · 23m left · today 1h 05m
//
// Claude Code sends session info as JSON on stdin. With --chain, that input
// is passed to another status line script first (for example Orca's), and
// its output, if any, is printed before ours. That way both keep working.
//
// Claude Code redraws the status line when the session changes, not every
// second, so "23m left" is as of the last redraw.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { summary } from "../lib/stats.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const expand = (p) => p?.replace(/^~(?=\/|$)/, homedir());

const file = expand(opt("--file")) || process.env.D20_FOCUS_LOG || join(homedir(), "Downloads", "d20-focus", "log.json");
const chain = expand(opt("--chain"));

// ---- pass Claude Code's input to the chained script --------------------

let input = "";
try { input = readFileSync(0, "utf8"); } catch { /* no stdin */ }

const lines = [];
if (chain) {
  const r = spawnSync("/bin/sh", [chain], { input, encoding: "utf8", timeout: 3000 });
  const out = (r.stdout || "").trimEnd();
  if (out) lines.push(out);
}

// ---- our line -----------------------------------------------------------

const color = process.env.NO_COLOR ? () => (s) => s : (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const C = {
  focus: color("38;5;141"), // purple
  break: color("38;5;43"),  // teal
  dim: color("2"),
  warn: color("38;5;214"),  // amber
};

const hm = (min) => {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
const short = (s, n = 32) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function d20Line() {
  let log;
  try {
    log = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return ""; // no log yet: stay quiet
  }
  const now = Date.now();
  const sessions = Array.isArray(log) ? log : log.sessions ?? [];
  const today = summary(sessions, new Date(now)).today;
  const todayText = C.dim(`today ${hm(today.focusMin)}`);
  const c = log.current;

  if (c) {
    const paint = C[c.type] ?? ((s) => s);
    const label = paint(c.type === "focus" ? "Focus" : "Break");
    const task = c.type === "focus" && c.task ? ` · ${short(c.task)}` : "";
    if (c.status === "paused") {
      return `⏸  ${label}${task} · ${C.warn(`paused (${c.pauseReason || "meeting"})`)} · ${todayText}`;
    }
    const leftMin = (new Date(c.endsAt).getTime() - now) / 60000;
    if (leftMin <= 0) {
      const next = c.type === "focus" ? "break" : "focus";
      return `🎲 ${label} time's up · roll for ${next} · ${todayText}`;
    }
    return `🎲 ${c.roll} · ${label}${task} · ${hm(Math.ceil(leftMin))} left · ${todayText}`;
  }

  if (log.next) return `🎲 Ready to roll for ${C[log.next]?.(log.next) ?? log.next} · ${todayText}`;
  return `🎲 D20 Focus · ${todayText}`;
}

const mine = d20Line();
if (mine) lines.push(mine);
if (lines.length) process.stdout.write(lines.join("\n") + "\n");
