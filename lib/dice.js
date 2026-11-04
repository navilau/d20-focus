// Dice rules for D20 Focus. Pure functions, shared by the popup, the
// background worker and the Node tests.

export const SIDES = 20;
const RANGE = 2 ** 32;
// Largest multiple of 20 below 2^32; values at or above it are rejected so
// every face is exactly equally likely (no modulo bias).
const LIMIT = RANGE - (RANGE % SIDES);

/** Fills a Uint32Array with random values. Defaults to Web Crypto. */
const defaultFill = (arr) => globalThis.crypto.getRandomValues(arr);

/** Returns a fair integer 1–20. */
export function rollD20(fill = defaultFill) {
  const buf = new Uint32Array(1);
  do {
    fill(buf);
  } while (buf[0] >= LIMIT);
  return (buf[0] % SIDES) + 1;
}

/** Focus length in minutes: roll × multiplier (default 2 → 2–40). */
export function focusMinutes(roll, multiplier = 2) {
  assertRoll(roll);
  return Math.round(roll * multiplier);
}

/**
 * Break length in minutes.
 *  - Nat 20 → 20-minute break  (critical rolls on)
 *  - Nat 1  → 1-minute break   (critical rolls on; the player may re-roll first)
 *  - Long break (every Nth break) → roll minutes.
 *  - Otherwise ceil(roll / 4) + 2 → 3–7 minutes.
 */
export function breakMinutes(roll, { longBreak = false, crits = true } = {}) {
  assertRoll(roll);
  if (crits && roll === 20) return 20;
  if (crits && roll === 1) return 1;
  if (longBreak) return roll;
  return Math.ceil(roll / 4) + 2;
}

/** Minutes for a phase ("focus" | "break"). */
export function minutesFor(phase, roll, opts = {}) {
  if (phase === "focus") return focusMinutes(roll, opts.focusMultiplier);
  if (phase === "break") return breakMinutes(roll, opts);
  throw new Error(`Unknown phase: ${phase}`);
}

/** A natural 1 may be re-rolled once, on focus or break. */
export function canReroll(roll, alreadyRerolled) {
  return roll === 1 && !alreadyRerolled;
}

/** Nat 20 on a focus roll lets you extend the block by 10 minutes once. */
export function isFlowState(phase, roll) {
  return phase === "focus" && roll === 20;
}

function assertRoll(roll) {
  if (!Number.isInteger(roll) || roll < 1 || roll > SIDES) {
    throw new RangeError(`Roll must be an integer 1–${SIDES}, got ${roll}`);
  }
}
