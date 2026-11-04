import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, cleanDomain, isAllowed, DEFAULT_SETTINGS } from "../lib/settings.js";

test("defaults fill in missing values", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
});

test("out-of-range values are clamped", () => {
  const s = normalizeSettings({ focusMultiplier: 9, longBreakEvery: -2, volume: "loud", crits: "yes" });
  assert.equal(s.focusMultiplier, 3);
  assert.equal(s.longBreakEvery, 0);
  assert.equal(s.volume, DEFAULT_SETTINGS.volume);
  assert.equal(s.crits, true);
});

test("cleanDomain accepts URLs and wildcards, rejects junk", () => {
  assert.equal(cleanDomain("https://www.Zoom.us/j/123"), "www.zoom.us");
  assert.equal(cleanDomain("*.slack.com"), "slack.com");
  assert.equal(cleanDomain("localhost"), "");
  assert.equal(cleanDomain("not a domain"), "");
});

test("allow-list is cleaned and de-duplicated", () => {
  assert.deepEqual(normalizeSettings({ allowList: ["claude.ai", "CLAUDE.AI", "bad one", "https://meet.google.com/abc"] }).allowList,
    ["claude.ai", "meet.google.com"]);
});

test("isAllowed matches domain and subdomains only", () => {
  const list = ["claude.ai", "zoom.us"];
  assert.ok(isAllowed("https://claude.ai/code", list));
  assert.ok(isAllowed("https://us02web.zoom.us/j/1", list));
  assert.ok(!isAllowed("https://notclaude.ai/", list));
  assert.ok(!isAllowed("https://claude.ai.evil.com/", list));
});
