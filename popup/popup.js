// The popup only shows state and sends button clicks to background.js.
// The background worker owns the timer, so closing the popup changes nothing.

import { awaitingRerollChoice, canExtend, canSkipBreak, isLongBreak, plannedMinutes } from "../lib/timer.js";
import { loadSettings } from "../lib/settings.js";

const $ = (id) => document.getElementById(id);
const ROLL_MS = 900;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let state = null;
let settings = null;
let ticker = null;
let rolling = false;
let pickingReason = false; // the "Pause for…" reason picker is open

const send = async (type, extra = {}) => {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error || "No response from background");
  return res.state;
};

async function act(type, extra) {
  $("error").textContent = "";
  try {
    state = await send(type, extra);
    render();
  } catch (err) {
    $("error").textContent = err.message;
  }
}

// ---- rendering ---------------------------------------------------------

const PHASE = { focus: "Focus", break: "Break" };
const REASON = { meeting: "Meeting", incident: "Incident", call: "Call", other: "Other" };

function render() {
  if (!state) return;
  const s = state;
  document.body.dataset.phase = s.phase;
  document.body.dataset.status = s.status;

  // Header pill
  const label = PHASE[s.phase] + (s.status === "running" && s.longBreak ? " (long)" : "");
  $("phaseLabel").textContent = {
    idle: `Next: ${PHASE[s.phase]}`,
    rolled: `Rolled for ${PHASE[s.phase]}`,
    running: label,
    paused: `Paused · ${REASON[s.pauseReason] ?? "Meeting"} · ${PHASE[s.phase]}`,
  }[s.status];

  // Task
  if (document.activeElement !== $("task")) $("task").value = s.task || "";
  $("taskShow").textContent = s.phase === "focus" && s.status !== "idle" && s.task ? `📝 ${s.task}` : "";

  // Die
  const shown = s.status === "idle" ? null : (s.roll ?? s.rolls.at(-1));
  if (!rolling) $("dieNum").textContent = shown ?? "20";

  // Result line & crit message
  $("result").textContent = "";
  $("crit").textContent = "";
  if (s.status === "rolled") {
    const r = s.rolls.at(-1);
    const long = isLongBreak(s, settings);
    $("result").textContent = `${r} → ${plannedMinutes(s, settings)} min ${s.phase}${long ? " (long break)" : ""}`;
    $("crit").textContent = critText(s, r);
  } else if (s.status === "running" && canExtend(s)) {
    $("crit").textContent = "Natural 20! Flow state: you can extend by 10 min once.";
  }

  // Buttons
  if (s.status !== "running") pickingReason = false;
  let view = s.status;
  if (s.status === "rolled" && awaitingRerollChoice(s)) view = "reroll";
  if (s.status === "running" && pickingReason) view = "pickReason";
  for (const row of document.querySelectorAll(".actions")) {
    row.classList.toggle("active", row.dataset.show === view);
  }
  $("rollBtn").textContent = `Roll for ${PHASE[s.phase]}`;
  $("startBtn").textContent = `Start ${PHASE[s.phase].toLowerCase()}`;
  $("extendBtn").classList.toggle("hidden", !canExtend(s));
  // Breaks are forced: Stop only exists for focus blocks.
  $("stopBtn").classList.toggle("hidden", s.phase !== "focus");
  $("stopBtn2").classList.toggle("hidden", s.phase !== "focus");
  $("skipBtn").classList.toggle("hidden", !canSkipBreak(s));

  renderCountdown();
  clearInterval(ticker);
  if (s.status === "running") ticker = setInterval(renderCountdown, 250);
}

function critText(s, r) {
  if (awaitingRerollChoice(s)) return "Natural 1! Re-roll once, or keep it.";
  if (r === 1 && s.rolls.length > 1) return "Another 1. It stands.";
  if (!settings.crits) return "";
  if (r === 20 && s.phase === "focus") return "Natural 20! Flow state: you can extend by 10 min once you start.";
  if (r === 20 && s.phase === "break") return "Natural 20! Full 20-minute break.";
  return "";
}

function renderCountdown() {
  const s = state;
  let ms = null;
  if (s.status === "running") ms = Math.max(0, s.endsAt - Date.now());
  if (s.status === "paused") ms = s.remainingMs;
  $("countdown").textContent = ms === null ? "" : fmt(ms);
}

function fmt(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

// ---- rolling (animation + background roll) ----------------------------

async function doRoll() {
  if (rolling) return;
  rolling = true;
  $("rollBtn").disabled = $("rerollBtn").disabled = true;
  const die = $("die");
  let flicker;
  if (!reducedMotion) {
    die.classList.remove("landed");
    die.classList.add("rolling");
    flicker = setInterval(() => { $("dieNum").textContent = 1 + Math.floor(Math.random() * 20); }, 60);
  }
  // Ask the background for the real roll while the die tumbles.
  const [result] = await Promise.allSettled([
    send("roll"),
    new Promise((r) => setTimeout(r, reducedMotion ? 0 : ROLL_MS)),
  ]);
  clearInterval(flicker);
  die.classList.remove("rolling");
  void die.offsetWidth;
  die.classList.add("landed");
  rolling = false;
  $("rollBtn").disabled = $("rerollBtn").disabled = false;
  if (result.status === "fulfilled") {
    state = result.value;
    $("error").textContent = "";
    const r = state.rolls.at(-1);
    if (r === 20 || r === 1) {
      die.classList.remove("landed");
      void die.offsetWidth;
      die.classList.add(r === 20 ? "crit-high" : "crit-low");
      setTimeout(() => die.classList.remove("crit-high", "crit-low"), 3500);
    }
  } else {
    $("error").textContent = result.reason.message;
  }
  render();
}

// ---- wiring ------------------------------------------------------------

$("rollBtn").addEventListener("click", doRoll);
$("rerollBtn").addEventListener("click", doRoll);
$("keepBtn").addEventListener("click", () => act("keep"));
$("startBtn").addEventListener("click", () => act("start"));
$("pauseBtn").addEventListener("click", () => { pickingReason = true; render(); });
$("cancelPause").addEventListener("click", () => { pickingReason = false; render(); });
for (const btn of document.querySelectorAll("[data-reason]")) {
  btn.addEventListener("click", () => { pickingReason = false; act("pause", { reason: btn.dataset.reason }); });
}
$("skipBtn").addEventListener("click", () => act("skipBreak"));
$("historyBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/history.html") });
});
$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("downloadBtn").addEventListener("click", async () => {
  $("saved").textContent = "";
  const res = await chrome.runtime.sendMessage({ type: "exportLog" });
  $("saved").textContent = res?.ok ? "Saved to Downloads/d20-focus/log.json" : `Couldn't save: ${res?.error}`;
});
$("resumeBtn").addEventListener("click", () => act("resume"));
$("stopBtn").addEventListener("click", () => act("stop"));
$("stopBtn2").addEventListener("click", () => act("stop"));
$("extendBtn").addEventListener("click", () => act("extend"));

let taskTimer;
$("task").addEventListener("input", (e) => {
  clearTimeout(taskTimer);
  taskTimer = setTimeout(() => send("setTask", { task: e.target.value }).catch(() => {}), 300);
});

// If a phase ends while the popup is open, the background updates storage;
// re-render from it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) loadSettings().then((x) => { settings = x; render(); });
  if (changes.state && !rolling) {
    state = changes.state.newValue;
    render();
  }
});

settings = await loadSettings();
act("getState");
