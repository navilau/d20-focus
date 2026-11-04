// Thin wrapper over chrome.storage.local.
import { initialState } from "./timer.js";

export async function loadState() {
  const { state } = await chrome.storage.local.get("state");
  return state ?? initialState();
}

export async function saveState(state) {
  await chrome.storage.local.set({ state });
}

export async function loadSessions() {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  return sessions;
}

export async function saveSessions(sessions) {
  await chrome.storage.local.set({ sessions });
}

export async function appendSessions(newSessions) {
  if (!newSessions.length) return;
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  for (const s of newSessions) sessions.push({ id: crypto.randomUUID(), ...s });
  await chrome.storage.local.set({ sessions });
}
