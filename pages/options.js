import { loadSettings, saveSettings } from "../lib/settings.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
let savedTimer;

function fill(s) {
  $("focusMultiplier").value = s.focusMultiplier;
  $("longBreakEvery").value = s.longBreakEvery;
  $("crits").checked = s.crits;
  $("sound").checked = s.sound;
  $("volume").value = s.volume;
  $("volume").disabled = !s.sound;
  $("allowList").value = s.allowList.join("\n");
  const m = s.focusMultiplier;
  $("focusHint").textContent = `Focus blocks run ${Math.round(m)}–${Math.round(20 * m)} minutes.`;
}

function read() {
  return {
    focusMultiplier: Number($("focusMultiplier").value),
    longBreakEvery: Number($("longBreakEvery").value),
    crits: $("crits").checked,
    sound: $("sound").checked,
    volume: Number($("volume").value),
    allowList: $("allowList").value.split(/[\n,]+/),
  };
}

async function save() {
  const clean = await saveSettings(read());
  // Re-fill so out-of-range numbers and messy domains show their cleaned value,
  // but don't fight the user while they're typing in the text box.
  if (document.activeElement !== $("allowList")) fill(clean);
  else $("volume").disabled = !clean.sound;
  $("saved").textContent = "Saved ✓";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
}

form.addEventListener("change", save);
$("allowList").addEventListener("blur", async () => fill(await loadSettings()));
form.addEventListener("submit", (e) => e.preventDefault());
$("testFocus").addEventListener("click", () => chrome.runtime.sendMessage({ type: "testChime", kind: "focus" }));
$("testBreak").addEventListener("click", () => chrome.runtime.sendMessage({ type: "testChime", kind: "break" }));

fill(await loadSettings());
