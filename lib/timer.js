// The timer's state machine, as pure functions.
//
// Every function takes the current state (plus "now" in ms) and returns
// { state, sessions }: the new state, and any finished sessions to log.
// Nothing here touches Chrome APIs, so it can be tested in Node.
// background.js applies the results (saving, alarms, badge, notifications).
//
// status:  idle    → waiting for a roll; `phase` is the phase you'll roll for
//          rolled  → a roll is showing; Start (or Re-roll/Keep on a nat 1)
//          running → timer counting down to `endsAt`
//          paused  → paused (meeting, incident, call…); `remainingMs` is frozen

import { minutesFor, canReroll, isFlowState } from "./dice.js";

export const MIN = 60_000;
export const FLOW_EXTEND_MIN = 10;

// The settings the timer cares about. background.js passes the user's
// settings in; these defaults keep the functions usable on their own.
const DEFAULT_CFG = { focusMultiplier: 2, longBreakEvery: 4, crits: true };
export const PAUSE_REASONS = ["meeting", "incident", "call", "other"];

export function initialState() {
  return { status: "idle", phase: "focus", rolls: [], kept: false, task: "", breakCount: 0 };
}

const ok = (state, sessions = []) => ({ state, sessions });

function fail(msg) {
  throw new Error(msg);
}

/** True when a nat 1 is showing and the player hasn't chosen Re-roll or Keep. */
export function awaitingRerollChoice(s) {
  const last = s.rolls.at(-1);
  return s.status === "rolled" && !s.kept && canReroll(last, s.rolls.length > 1);
}

export function isLongBreak(s, cfg = DEFAULT_CFG) {
  const n = cfg.longBreakEvery;
  return s.phase === "break" && n > 0 && (s.breakCount + 1) % n === 0;
}

/** Minutes the current roll would give if started now (shown before Start). */
export function plannedMinutes(s, cfg = DEFAULT_CFG) {
  return minutesFor(s.phase, s.rolls.at(-1), {
    focusMultiplier: cfg.focusMultiplier,
    longBreak: isLongBreak(s, cfg),
    crits: cfg.crits,
  });
}

export function setTask(s, task) {
  return ok({ ...s, task: String(task ?? "").slice(0, 120) });
}

export function roll(s, value) {
  if (s.status === "idle") {
    return ok({ ...s, status: "rolled", rolls: [value], kept: false });
  }
  if (awaitingRerollChoice(s)) {
    return ok({ ...s, rolls: [...s.rolls, value] });
  }
  fail(`Can't roll while ${s.status}`);
}

export function keep(s) {
  if (!awaitingRerollChoice(s)) fail("Nothing to keep");
  return ok({ ...s, kept: true });
}

export function start(s, now, cfg = DEFAULT_CFG) {
  if (s.status !== "rolled") fail(`Can't start while ${s.status}`);
  if (awaitingRerollChoice(s)) fail("Choose Re-roll or Keep first");
  const plannedMin = plannedMinutes(s, cfg);
  return ok({
    ...s,
    status: "running",
    roll: s.rolls.at(-1),
    plannedMin,
    longBreak: isLongBreak(s, cfg),
    crits: cfg.crits, // fixed for this block, even if settings change mid-way
    startedAt: now,
    endsAt: now + plannedMin * MIN,
    pausedMs: 0,
    extended: false,
  });
}

export function pause(s, now, reason = "meeting") {
  if (s.status !== "running") fail(`Can't pause while ${s.status}`);
  if (!PAUSE_REASONS.includes(reason)) fail(`Unknown pause reason: ${reason}`);
  return ok({ ...s, status: "paused", pausedAt: now, pauseReason: reason, remainingMs: Math.max(0, s.endsAt - now) });
}

export function resume(s, now) {
  if (s.status !== "paused") fail(`Can't resume while ${s.status}`);
  const { pausedAt, remainingMs, pauseReason, ...rest } = s;
  return ok(
    { ...rest, status: "running", endsAt: now + remainingMs, pausedMs: s.pausedMs + (now - pausedAt) },
    [pauseSession(s, now)],
  );
}

/** Stop ends a focus block early. Breaks can't be stopped (they're forced). */
export function stop(s, now) {
  if (s.phase !== "focus") fail("Breaks can't be stopped");
  if (s.status !== "running" && s.status !== "paused") fail(`Can't stop while ${s.status}`);
  const sessions = [];
  let pausedMs = s.pausedMs;
  if (s.status === "paused") {
    sessions.push(pauseSession(s, now));
    pausedMs += now - s.pausedAt;
  }
  sessions.push(phaseSession(s, now, pausedMs, "stopped"));
  return ok(toIdle(s, "break"), sessions);
}

/** After pausing a break for an incident, you may skip the rest of it. */
export function canSkipBreak(s) {
  return s.status === "paused" && s.phase === "break" && s.pauseReason === "incident";
}

export function skipBreak(s, now) {
  if (!canSkipBreak(s)) fail("Only a break paused for an incident can be skipped");
  const pausedMs = s.pausedMs + (now - s.pausedAt);
  const state = toIdle(s, "focus");
  state.breakCount = s.breakCount + 1;
  return ok(state, [pauseSession(s, now), phaseSession(s, now, pausedMs, "skipped")]);
}

/** Nat 20 on focus: add 10 minutes, once. */
export function extend(s) {
  if (!canExtend(s)) fail("Can't extend");
  return ok({
    ...s,
    endsAt: s.endsAt + FLOW_EXTEND_MIN * MIN,
    plannedMin: s.plannedMin + FLOW_EXTEND_MIN,
    extended: true,
  });
}

/** Called when the alarm fires. Ignored if the phase isn't actually over. */
export function complete(s, now) {
  if (s.status !== "running" || now < s.endsAt) return ok(s);
  const session = phaseSession(s, s.endsAt, s.pausedMs, s.extended ? "extended" : "completed");
  const next = s.phase === "focus" ? "break" : "focus";
  const state = toIdle(s, next);
  if (s.phase === "break") state.breakCount = s.breakCount + 1;
  return ok(state, [session]);
}

export function canExtend(s) {
  return s.status === "running" && s.crits !== false && isFlowState(s.phase, s.roll) && !s.extended;
}

function toIdle(s, nextPhase) {
  // Keep the task so it carries over to the next focus block. Per-block
  // fields (roll, crits, longBreak…) are dropped and set again on Start.
  return { ...initialState(), phase: nextPhase, task: s.task, breakCount: s.breakCount };
}

function phaseSession(s, endedAt, pausedMs, status) {
  return {
    type: s.phase,
    rolls: s.rolls,
    roll: s.roll,
    plannedMin: s.plannedMin,
    longBreak: s.longBreak || undefined,
    startedAt: new Date(s.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    actualMin: round1((endedAt - s.startedAt - pausedMs) / MIN),
    pausedMin: round1(pausedMs / MIN),
    status,
    task: s.phase === "focus" ? s.task || undefined : undefined,
  };
}

function pauseSession(s, now) {
  return {
    type: "pause",
    reason: s.pauseReason,
    during: s.phase,
    startedAt: new Date(s.pausedAt).toISOString(),
    endedAt: new Date(now).toISOString(),
    actualMin: round1((now - s.pausedAt) / MIN),
    status: "completed",
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
