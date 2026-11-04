#!/usr/bin/env node
// Claude Code status line for D20 Focus.
//
//   node cli/statusline.js [--chain <script>] [--file <log.json>]
//
// Prints one line, such as:
//   🎲 14 · Focus · 23m left · in d20-focus · today 1h 05m
// "in d20-focus" is this Claude Code session's project folder.
//
// Claude Code sends session info as JSON on stdin. With --chain, that input
// is passed to another status line script first (for example Orca's), and
// its output, if any, is printed before ours. That way both keep working.
//
// Set "refreshInterval": 15 on the statusLine setting so Claude Code re-runs
// this while idle; otherwise it only redraws when the session changes.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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

// The Claude Code session's project, from the JSON Claude Code sends on
// stdin. Shown in place of the Chrome task, because you may be working on
// something different here. Nothing is shown for the home folder.
function claudeProject() {
  let info;
  try { info = JSON.parse(input); } catch { return ""; }
  const dir = info?.workspace?.project_dir || info?.workspace?.current_dir || info?.cwd;
  if (!dir || dir.replace(/\/+$/, "") === homedir()) return "";
  return basename(dir.replace(/\/+$/, ""));
}
const project = claudeProject();
const where = project ? C.dim(` · in ${short(project, 28)}`) : "";

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
    if (c.status === "paused") {
      return `⏸  ${label} · ${C.warn(`paused (${c.pauseReason || "meeting"})`)}${where} · ${todayText}`;
    }
    const leftMin = (new Date(c.endsAt).getTime() - now) / 60000;
    if (leftMin <= 0) {
      const next = c.type === "focus" ? "break" : "focus";
      return `🎲 ${label} time's up · roll for ${next}${where} · ${todayText}`;
    }
    return `🎲 ${c.roll} · ${label} · ${hm(Math.ceil(leftMin))} left${where} · ${todayText}`;
  }

  if (log.next) return `🎲 Ready to roll for ${C[log.next]?.(log.next) ?? log.next}${where} · ${todayText}`;
  return `🎲 D20 Focus${where} · ${todayText}`;
}

const mine = d20Line();
if (mine) lines.push(mine);
if (lines.length) process.stdout.write(lines.join("\n") + "\n");
