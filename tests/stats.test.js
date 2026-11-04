import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../lib/stats.js";

// Wednesday 4 Nov 2026, 15:00 local
const now = new Date(2026, 10, 4, 15, 0);
const at = (d, h) => new Date(2026, 10, d, h, 0).toISOString();

const sessions = [
  { id: "a", type: "focus", status: "completed", roll: 14, rolls: [14], plannedMin: 28, actualMin: 28, startedAt: at(4, 9), task: "Ticket, \"urgent\"" },
  { id: "b", type: "break", status: "completed", roll: 9, rolls: [9], plannedMin: 5, actualMin: 5, startedAt: at(4, 10) },
  { id: "c", type: "pause", reason: "incident", during: "break", actualMin: 12, startedAt: at(4, 11) },
  { id: "d", type: "break", status: "skipped", roll: 3, rolls: [1, 3], plannedMin: 3, actualMin: 1, startedAt: at(4, 11) },
  { id: "e", type: "focus", status: "stopped", roll: 10, rolls: [10], plannedMin: 20, actualMin: 7.5, startedAt: at(2, 14) }, // Monday
  { id: "f", type: "focus", status: "completed", roll: 20, rolls: [20], plannedMin: 40, actualMin: 40, startedAt: at(1, 14) }, // last Sunday
];

test("summary: today / this week (Mon–) / all time", () => {
  const s = S.summary(sessions, now);
  assert.equal(s.today.focusMin, 28);
  assert.equal(s.today.breakMin, 6);
  assert.equal(s.today.pauseMin, 12);
  assert.equal(s.today.skipped, 1);
  assert.equal(s.week.focusMin, 35.5);
  assert.equal(s.week.stopped, 1);
  assert.equal(s.all.focusMin, 75.5);
  assert.equal(s.all.focusCount, 3);
});

test("startOfWeek is Monday", () => {
  assert.equal(S.startOfWeek(now).getDay(), 1);
  assert.equal(S.startOfWeek(new Date(2026, 10, 8)).getDate(), 2); // Sunday → previous Monday
});

test("focusByDay fills empty days with zero", () => {
  const rows = S.focusByDay(sessions, 7, now);
  assert.equal(rows.length, 7);
  assert.equal(rows.at(-1).day, "2026-11-04");
  assert.equal(rows.at(-1).focusMin, 28);
  assert.deepEqual(rows.map((r) => r.focusMin), [0, 0, 0, 40, 7.5, 0, 28]);
});

test("rollCounts counts every roll including re-rolls", () => {
  const c = S.rollCounts(sessions);
  assert.equal(c.length, 20);
  assert.equal(c[0].count, 1); // the re-rolled 1
  assert.equal(c[19].count, 1);
  assert.equal(c.reduce((n, x) => n + x.count, 0), 6);
});

test("CSV escapes quotes and commas, joins rolls", () => {
  const csv = S.toCSV(sessions);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], S.CSV_COLUMNS.join(","));
  assert.equal(lines.length, 7);
  assert.ok(lines[1].includes('"Ticket, ""urgent"""'));
  assert.ok(lines[4].includes(",1 3,"));
});

test("mergeSessions dedupes by id and drops junk", () => {
  const merged = S.mergeSessions(sessions.slice(0, 2), [sessions[1], sessions[4], { nope: 1 }, null]);
  assert.deepEqual(merged.map((s) => s.id), ["e", "a", "b"]);
});

test("logFile includes the session in progress", () => {
  const state = { status: "running", phase: "focus", roll: 7, plannedMin: 14, task: "x", startedAt: now.getTime(), endsAt: now.getTime() + 14 * 60e3 };
  const f = S.logFile(sessions, state, now);
  assert.equal(f.current.type, "focus");
  assert.equal(f.current.plannedMin, 14);
  assert.equal(f.sessions.length, 6);
  assert.equal(S.logFile(sessions, { status: "idle" }, now).current, null);
});

test("focusByTask groups and sorts by minutes", () => {
  const rows = S.focusByTask(sessions);
  assert.deepEqual(rows.map((r) => [r.task, r.focusMin, r.blocks]), [
    ["(no task)", 47.5, 2],
    ["Ticket, \"urgent\"", 28, 1],
  ]);
  assert.equal(S.focusByTask(sessions, S.startOfDay(now)).length, 1);
});

test("pausesByReason totals per reason", () => {
  assert.deepEqual(S.pausesByReason(sessions), { incident: { count: 1, minutes: 12 } });
});
