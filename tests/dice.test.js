import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  rollD20, focusMinutes, breakMinutes, minutesFor, canReroll, isFlowState,
} from "../lib/dice.js";

const fill = (arr) => webcrypto.getRandomValues(arr);

test("rollD20 returns integers 1–20 and hits every face", () => {
  const counts = new Array(21).fill(0);
  const N = 200_000;
  for (let i = 0; i < N; i++) {
    const r = rollD20(fill);
    assert.ok(Number.isInteger(r) && r >= 1 && r <= 20, `bad roll ${r}`);
    counts[r]++;
  }
  // Each face expected ~10,000; allow ±5% (well over 10 standard deviations).
  for (let f = 1; f <= 20; f++) {
    assert.ok(Math.abs(counts[f] - N / 20) < N / 20 * 0.05, `face ${f}: ${counts[f]}`);
  }
});

test("rollD20 rejects biased values above the limit", () => {
  const seq = [2 ** 32 - 1, 2 ** 32 - 2, 41]; // first two are in the biased tail
  let i = 0;
  const r = rollD20((arr) => { arr[0] = seq[i++]; });
  assert.equal(i, 3);
  assert.equal(r, (41 % 20) + 1);
});

test("focusMinutes is roll × 2", () => {
  assert.equal(focusMinutes(1), 2);
  assert.equal(focusMinutes(14), 28);
  assert.equal(focusMinutes(20), 40);
});

test("breakMinutes mapping and crits", () => {
  assert.equal(breakMinutes(1), 1);
  assert.equal(breakMinutes(2), 3);
  assert.equal(breakMinutes(4), 3);
  assert.equal(breakMinutes(5), 4);
  assert.equal(breakMinutes(19), 7);
  assert.equal(breakMinutes(20), 20);
  assert.equal(breakMinutes(12, { longBreak: true }), 12);
  assert.equal(breakMinutes(1, { longBreak: true }), 1);
});

test("minutesFor dispatches by phase", () => {
  assert.equal(minutesFor("focus", 10), 20);
  assert.equal(minutesFor("break", 10), 5);
  assert.throws(() => minutesFor("nap", 10));
});

test("invalid rolls throw", () => {
  for (const bad of [0, 21, 1.5, "3", undefined]) {
    assert.throws(() => focusMinutes(bad), RangeError);
  }
});

test("re-roll on a natural 1, once, for either phase", () => {
  assert.equal(canReroll(1, false), true);
  assert.equal(canReroll(1, true), false);
  assert.equal(canReroll(2, false), false);
});

test("flow state only on focus nat 20", () => {
  assert.equal(isFlowState("focus", 20), true);
  assert.equal(isFlowState("break", 20), false);
  assert.equal(isFlowState("focus", 19), false);
});

test("focus multiplier setting", () => {
  assert.equal(focusMinutes(10, 1), 10);
  assert.equal(focusMinutes(10, 3), 30);
  assert.equal(focusMinutes(7, 1.5), 11);
});

test("crits off: 1 and 20 use the normal break formula", () => {
  assert.equal(breakMinutes(1, { crits: false }), 3);
  assert.equal(breakMinutes(20, { crits: false }), 7);
  assert.equal(breakMinutes(20, { crits: false, longBreak: true }), 20);
});
