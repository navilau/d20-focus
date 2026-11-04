// User settings, edited on the options page. Pure helpers plus a loader.

export const DEFAULT_SETTINGS = {
  // Focus block = roll × this many minutes.
  focusMultiplier: 2,
  // Every Nth break is a long break (roll minutes). 0 turns long breaks off.
  longBreakEvery: 4,
  // Critical rolls: nat 20 focus → +10 min once; nat 20 break → 20 min; nat 1 break → 1 min.
  crits: true,
  // Chime when a focus block or break ends.
  sound: true,
  volume: 0.6,
  // Sites that never get the break overlay. A domain also covers its subdomains.
  allowList: ["claude.ai", "meet.google.com", "zoom.us"],
};

export const LIMITS = {
  focusMultiplier: [1, 3],
  longBreakEvery: [0, 10],
  volume: [0, 1],
};

const clamp = (v, [lo, hi], fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Cleans a domain the user typed: "https://www.Zoom.us/j/1" → "www.zoom.us". */
export function cleanDomain(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z]+:\/\//, "").replace(/[/?#:].*$/, "").replace(/^\*\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : "";
}

/** Fills in defaults and fixes out-of-range values. */
export function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const allow = Array.isArray(raw.allowList) ? raw.allowList : d.allowList;
  return {
    focusMultiplier: clamp(raw.focusMultiplier, LIMITS.focusMultiplier, d.focusMultiplier),
    longBreakEvery: Math.round(clamp(raw.longBreakEvery, LIMITS.longBreakEvery, d.longBreakEvery)),
    crits: typeof raw.crits === "boolean" ? raw.crits : d.crits,
    sound: typeof raw.sound === "boolean" ? raw.sound : d.sound,
    volume: clamp(raw.volume, LIMITS.volume, d.volume),
    allowList: [...new Set(allow.map(cleanDomain).filter(Boolean))],
  };
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return normalizeSettings(settings);
}

export async function saveSettings(settings) {
  const clean = normalizeSettings(settings);
  await chrome.storage.local.set({ settings: clean });
  return clean;
}

export function isAllowed(url, allowList) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return allowList.some((d) => host === d || host.endsWith(`.${d}`));
}
