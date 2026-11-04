// Background service worker: owns the timer.
//
// The popup sends messages ("roll", "start", "pause", ...). Each one runs
// through the pure state machine in lib/timer.js; this file then saves the
// result and syncs Chrome: the end-of-phase alarm, the toolbar badge and
// notifications. Chrome can put this worker to sleep at any time, so nothing
// important lives in variables: it's all in chrome.storage.

import * as T from "./lib/timer.js";
import { rollD20 } from "./lib/dice.js";
import { loadState, saveState, appendSessions, loadSessions } from "./lib/store.js";
import { logFile } from "./lib/stats.js";
import { loadSettings, isAllowed } from "./lib/settings.js";

const PHASE_END = "phase-end";
const BADGE_TICK = "badge-tick";
const COLORS = { focus: "#6d4aff", break: "#0e9f8e", paused: "#9c98b3" };
const BREAK_PAGE = chrome.runtime.getURL("pages/break.html");

// Run updates one at a time so two quick clicks can't overwrite each other.
let queue = Promise.resolve();
function update(fn) {
  const run = queue.then(async () => {
    const before = await loadState();
    const settings = await loadSettings();
    const { state, sessions } = fn(before, Date.now(), settings);
    await appendSessions(sessions);
    await saveState(state);
    await syncChrome(state);
    if (sessions.length) writeLogFile(state).catch((e) => console.warn("log.json:", e));
    return { state, sessions };
  });
  queue = run.catch(() => {});
  return run;
}

const actions = {
  getState: (s) => ({ state: s, sessions: [] }),
  setTask: (s, now, msg) => T.setTask(s, msg.task),
  roll: (s) => T.roll(s, rollD20()),
  keep: (s) => T.keep(s),
  start: (s, now, _msg, settings) => T.start(s, now, settings),
  pause: (s, now, msg) => T.pause(s, now, msg.reason),
  skipBreak: (s, now) => T.skipBreak(s, now),
  resume: (s, now) => T.resume(s, now),
  stop: (s, now) => T.stop(s, now),
  extend: (s) => T.extend(s),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "exportLog") {
    loadState()
      .then(writeLogFile)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  const action = actions[msg?.type];
  if (!action) return false;
  update((s, now, settings) => action(s, now, msg, settings))
    .then(({ state }) => sendResponse({ ok: true, state }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // keep the channel open for the async response
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PHASE_END) finishIfDue();
  if (alarm.name === BADGE_TICK) loadState().then(updateBadge);
});

// After a browser restart or an extension reload, close out a phase that
// ended while Chrome was shut, or re-arm the alarm for one still running.
chrome.runtime.onStartup.addListener(finishIfDue);
chrome.runtime.onInstalled.addListener(() => {
  finishIfDue();
  injectIntoOpenTabs();
});

async function finishIfDue() {
  const { sessions } = await update((s, now) => T.complete(s, now));
  const done = sessions.find((x) => x.type === "focus" || x.type === "break");
  if (done) {
    notifyPhaseEnd(done.type);
    playChime(done.type);
  }
}

async function syncChrome(after) {
  if (after.status === "running") {
    await chrome.alarms.create(PHASE_END, { when: after.endsAt });
    await chrome.alarms.create(BADGE_TICK, { periodInMinutes: 0.5 });
  } else {
    await chrome.alarms.clear(PHASE_END);
    if (after.status !== "paused") await chrome.alarms.clear(BADGE_TICK);
  }
  await updateBadge(after);
  if (inBreak(after)) await coverActiveTabs();
}

const inBreak = (s) => s.status === "running" && s.phase === "break";

// ---- covering tabs during a break -------------------------------------

// Chrome only injects content scripts into pages loaded after install, so
// add the overlay to tabs that were already open.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["content/overlay.js"] })
      .catch(() => {}); // some pages (e.g. the Web Store) refuse injection
  }
}

// Pages like chrome://settings or the New Tab page can't be injected into.
// If one is in front during a break, switch that window to the break page.
const injectable = (url = "") => /^(https?|file):/.test(url);

async function coverTab(tab) {
  if (!tab?.active || injectable(tab.url) || tab.url?.startsWith(BREAK_PAGE)) return;
  const { allowList } = await loadSettings();
  if (isAllowed(tab.url, allowList)) return;
  const [existing] = await chrome.tabs.query({ windowId: tab.windowId, url: BREAK_PAGE });
  if (existing) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({ windowId: tab.windowId, url: BREAK_PAGE, active: true });
}

async function coverActiveTabs() {
  const tabs = await chrome.tabs.query({ active: true });
  for (const tab of tabs) await coverTab(tab).catch(() => {});
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!inBreak(await loadState())) return;
  coverTab(await chrome.tabs.get(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener(async (_id, change, tab) => {
  if (!change.url) return;
  if (!inBreak(await loadState())) return;
  coverTab(tab).catch(() => {});
});

async function updateBadge(s) {
  let text = "";
  let color = COLORS[s.phase];
  if (s.status === "running") {
    text = `${Math.max(1, Math.ceil((s.endsAt - Date.now()) / T.MIN))}`;
  } else if (s.status === "paused") {
    text = "||";
    color = COLORS.paused;
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

function notifyPhaseEnd(phase) {
  const msg = phase === "focus"
    ? { title: "Focus done 🎲", message: "Time for a break. Open D20 Focus and roll for it." }
    : { title: "Break over 🎲", message: "Ready when you are. Roll for your next focus block." };
  chrome.notifications.create({
    type: "basic",
    iconUrl: "assets/icon-128.png",
    priority: 2,
    ...msg,
  });
}

// ---- chime ----------------------------------------------------------------

const OFFSCREEN = "pages/offscreen.html";

async function playChime(kind, { force = false } = {}) {
  const { sound, volume } = await loadSettings();
  if ((!sound && !force) || volume <= 0) return;
  try {
    const open = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (!open.length) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play a chime when a focus block or break ends.",
      });
    }
    await chrome.runtime.sendMessage({ target: "offscreen", type: "chime", kind, volume });
  } catch (err) {
    console.warn("chime:", err);
  }
}

// The options page's "Test sound" button.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "testChime") playChime(msg.kind || "focus", { force: true });
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  chrome.action.openPopup?.().catch(() => {});
});

// ---- log.json for Claude CLI ------------------------------------------

// Extensions can only save inside the Downloads folder. The file is
// overwritten each time, the download bubble is hidden, and the entry is
// removed from chrome://downloads (the file itself stays).
export const LOG_PATH = "d20-focus/log.json";
const ownDownloads = new Set();

async function writeLogFile(state) {
  const json = JSON.stringify(logFile(await loadSessions(), state), null, 2);
  // Service workers can't make blob URLs, so use a data URL.
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  await chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});
  const id = await chrome.downloads.download({
    url,
    filename: LOG_PATH,
    conflictAction: "overwrite",
    saveAs: false,
  });
  ownDownloads.add(id);
}

chrome.downloads.onChanged.addListener(async ({ id, state }) => {
  if (!ownDownloads.has(id) || !state || state.current === "in_progress") return;
  ownDownloads.delete(id);
  await chrome.downloads.erase({ id }).catch(() => {});
  if (!ownDownloads.size) await chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
});
