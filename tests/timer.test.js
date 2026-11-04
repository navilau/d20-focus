import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../lib/timer.js";

const MIN = T.MIN;
const t0 = Date.UTC(2026, 10, 4, 10, 0);

// Helper: run a sequence of steps, collecting logged sessions.
function run(steps, s = T.initialState()) {
  const logged = [];
  for (const [fn, ...args] of steps) {
    const r = fn(s, ...args);
    s = r.state;
    logged.push(...r.sessions);
  }
  return { s, logged };
}

test("full cycle: focus completes, then break completes, phases alternate", () => {
  const { s, logged } = run([
    [T.setTask, "Write ticket"],
    [T.roll, 14],
    [T.start, t0],
    [T.complete, t0 + 28 * MIN],
    [T.roll, 9],
    [T.start, t0 + 30 * MIN],
    [T.complete, t0 + 35 * MIN],
  ]);
  assert.equal(s.status, "idle");
  assert.equal(s.phase, "focus");
  assert.equal(s.breakCount, 1);
  assert.equal(logged.length, 2);
  assert.deepEqual(
    logged.map((x) => [x.type, x.roll, x.plannedMin, x.actualMin, x.status, x.task]),
    [["focus", 14, 28, 28, "completed", "Write ticket"], ["break", 9, 5, 5, "completed", undefined]],
  );
});

test("next phase never starts by itself", () => {
  const { s } = run([[T.roll, 5], [T.start, t0], [T.complete, t0 + 10 * MIN]]);
  assert.equal(s.status, "idle");
  assert.equal(s.phase, "break");
});

test("complete before endsAt is ignored", () => {
  const { s, logged } = run([[T.roll, 5], [T.start, t0], [T.complete, t0 + 9 * MIN]]);
  assert.equal(s.status, "running");
  assert.equal(logged.length, 0);
});

test("nat 1: must choose re-roll or keep; only one re-roll", () => {
  let { s } = run([[T.roll, 1]]);
  assert.ok(T.awaitingRerollChoice(s));
  assert.throws(() => T.start(s, t0), /Re-roll or Keep/);

  ({ s } = run([[T.roll, 1]], s)); // re-roll is another 1: it stands
  assert.equal(T.awaitingRerollChoice(s), false);
  assert.throws(() => T.roll(s, 7));
  const { logged } = run([[T.start, t0], [T.complete, t0 + 2 * MIN]], s);
  assert.deepEqual(logged[0].rolls, [1, 1]);
  assert.equal(logged[0].plannedMin, 2);
});

test("nat 1 kept → start allowed, no further rolls", () => {
  const { s } = run([[T.roll, 1], [T.keep], [T.start, t0]]);
  assert.equal(s.plannedMin, 2);
});

test("can't roll again on a normal result (no re-roll by reopening popup)", () => {
  const { s } = run([[T.roll, 3]]);
  assert.throws(() => T.roll(s, 18));
});

test("pause for meeting: freezes time, logs meeting, resume continues", () => {
  const { s, logged } = run([
    [T.roll, 10],               // 20 min focus
    [T.start, t0],
    [T.pause, t0 + 5 * MIN],    // 15 min left
    [T.resume, t0 + 35 * MIN],  // 30 min meeting
  ]);
  assert.equal(s.status, "running");
  assert.equal(s.endsAt, t0 + 50 * MIN);
  assert.equal(logged[0].type, "pause");
  assert.equal(logged[0].reason, "meeting");
  assert.equal(logged[0].actualMin, 30);
  assert.equal(logged[0].during, "focus");

  const end = run([[T.complete, t0 + 50 * MIN]], s).logged[0];
  assert.equal(end.actualMin, 20);
  assert.equal(end.pausedMin, 30);
});

test("breaks can be paused for a meeting", () => {
  const { s } = run([[T.roll, 2], [T.start, t0], [T.complete, t0 + 4 * MIN], [T.roll, 8], [T.start, t0], [T.pause, t0 + MIN]]);
  assert.equal(s.status, "paused");
  assert.equal(s.phase, "break");
});

test("stop ends focus early with no penalty: next roll is a break", () => {
  const { s, logged } = run([[T.roll, 15], [T.start, t0], [T.stop, t0 + 7 * MIN]]);
  assert.equal(s.status, "idle");
  assert.equal(s.phase, "break");
  assert.equal(logged[0].status, "stopped");
  assert.equal(logged[0].actualMin, 7);
});

test("stop while paused logs the meeting and the focus block", () => {
  const { logged } = run([[T.roll, 15], [T.start, t0], [T.pause, t0 + 4 * MIN], [T.stop, t0 + 10 * MIN]]);
  assert.deepEqual(logged.map((x) => x.type), ["pause", "focus"]);
  assert.equal(logged[1].actualMin, 4);
});

test("breaks are forced: stop is refused", () => {
  const { s } = run([[T.roll, 2], [T.start, t0], [T.complete, t0 + 4 * MIN], [T.roll, 8], [T.start, t0]]);
  assert.throws(() => T.stop(s, t0 + MIN), /Breaks can't be stopped/);
});

test("nat 20 focus: extend +10 once", () => {
  let { s } = run([[T.roll, 20], [T.start, t0]]);
  assert.ok(T.canExtend(s));
  ({ s } = run([[T.extend]], s));
  assert.equal(s.plannedMin, 50);
  assert.equal(s.endsAt, t0 + 50 * MIN);
  assert.throws(() => T.extend(s));
  const { logged } = run([[T.complete, t0 + 50 * MIN]], s);
  assert.equal(logged[0].status, "extended");
});

test("every 4th break is a long break (roll minutes)", () => {
  let s = T.initialState();
  const breaks = [];
  for (let i = 0; i < 4; i++) {
    ({ s } = run([[T.roll, 2], [T.start, t0], [T.complete, t0 + 4 * MIN], [T.roll, 12], [T.start, t0]], s));
    breaks.push(s.plannedMin);
    ({ s } = run([[T.complete, s.endsAt]], s));
  }
  assert.deepEqual(breaks, [5, 5, 5, 12]);
});

test("task carries over to the next focus block", () => {
  const { s } = run([[T.setTask, "Docs"], [T.roll, 2], [T.start, t0], [T.complete, t0 + 4 * MIN]]);
  assert.equal(s.task, "Docs");
});

// Helper: get to a running break.
const inBreak = () => run([[T.roll, 2], [T.start, t0], [T.complete, t0 + 4 * MIN], [T.roll, 8], [T.start, t0]]).s;

test("pause records its reason; unknown reasons are refused", () => {
  const { logged } = run([[T.pause, t0 + MIN, "call"], [T.resume, t0 + 3 * MIN]], inBreak());
  assert.equal(logged[0].reason, "call");
  assert.throws(() => T.pause(inBreak(), t0, "lunch"));
});

test("incident during a break: skip the rest, logged as skipped, next roll is focus", () => {
  let { s } = run([[T.pause, t0 + MIN, "incident"]], inBreak());
  assert.ok(T.canSkipBreak(s));
  const r = run([[T.skipBreak, t0 + 20 * MIN]], s);
  assert.equal(r.s.status, "idle");
  assert.equal(r.s.phase, "focus");
  assert.equal(r.s.breakCount, 1);
  assert.deepEqual(r.logged.map((x) => [x.type, x.status]), [["pause", "completed"], ["break", "skipped"]]);
  assert.equal(r.logged[0].reason, "incident");
  assert.equal(r.logged[1].actualMin, 1);
});

test("skip is only for breaks paused for an incident", () => {
  assert.throws(() => T.skipBreak(run([[T.pause, t0, "meeting"]], inBreak()).s, t0));
  assert.throws(() => T.skipBreak(inBreak(), t0));
  const focusPaused = run([[T.roll, 5], [T.start, t0], [T.pause, t0, "incident"]]).s;
  assert.throws(() => T.skipBreak(focusPaused, t0));
});

test("settings: multiplier and long-break interval are applied at Start", () => {
  const cfg = { focusMultiplier: 3, longBreakEvery: 2, crits: true };
  let { s } = run([[T.roll, 10]]);
  assert.equal(T.plannedMinutes(s, cfg), 30);
  s = T.start(s, t0, cfg).state;
  assert.equal(s.plannedMin, 30);
  // second break is long with longBreakEvery 2
  s = { ...T.initialState(), phase: "break", breakCount: 1 };
  s = T.roll(s, 9).state;
  assert.equal(T.start(s, t0, cfg).state.plannedMin, 9);
});

test("settings: long breaks off when interval is 0", () => {
  const s = T.roll({ ...T.initialState(), phase: "break", breakCount: 3 }, 12).state;
  assert.equal(T.start(s, t0, { focusMultiplier: 2, longBreakEvery: 0, crits: true }).state.plannedMin, 5);
});

test("settings: crits off means no flow-state extend", () => {
  const s = T.start(T.roll(T.initialState(), 20).state, t0, { focusMultiplier: 2, longBreakEvery: 4, crits: false }).state;
  assert.equal(T.canExtend(s), false);
  assert.throws(() => T.extend(s));
});
