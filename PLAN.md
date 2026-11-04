# D20 Focus — Plan

A Chrome extension where you roll a d20 to set the length of each focus block or break. Focus and break blocks take turns. Breaks are forced: the browser is blocked until the break ends. Every session is logged.

## 1. Why a Chrome extension (and not a background agent)

| Option | Pros | Cons |
|---|---|---|
| **Chrome extension (MV3)** ✅ | Runs whenever Chrome is open, keeps working when the popup is closed (`chrome.alarms`), sends system notifications, can block every tab during a break, has built-in storage, needs no install beyond "Load unpacked" | Can only force breaks inside Chrome |
| macOS background agent (launchd + menu-bar app) | Can block the whole screen | Needs Swift/Electron, signing and more upkeep; too heavy for v1 |

**Decision:** build a Manifest V3 extension in plain HTML/CSS/JS with no build step. A native "whole-screen" agent can come later if blocking only Chrome isn't enough.

## 2. Core loop

```
 ┌──────────── Idle ────────────┐
 │  [Roll for Focus] (d20)      │
 └──────────────┬───────────────┘
                ▼
        FOCUS (roll × focusMultiplier min)
                │  alarm fires → notification + sound
                ▼
        [Roll for Break] (auto-prompt)
                ▼
        BREAK (roll → break minutes) ── every tab is covered by the break overlay
                │  alarm fires → overlay lifts
                ▼
        back to [Roll for Focus] … repeat
```

- The phases alternate automatically: **Focus → Break → Focus → …**
- Rolls use `crypto.getRandomValues` so every face from 1 to 20 is equally likely.
- **Default duration mapping** (all values can be changed in Options):
  - Focus: `roll × 2` min → 2–40 min
  - Break: `ceil(roll / 4) + 2` min → 3–7 min
  - Every 4th break is a long break: `roll` min → 1–20 min
- **Critical rolls** (optional, on by default):
  - Nat 20 on focus → "Flow state": you may extend the block by 10 min once.
  - Nat 1 on **any** roll (focus or break) → you may re-roll once, or keep it (a 2-min focus or a 1-min break). Both rolls are logged.
  - Nat 20 on break → a full 20-minute break.

## 3. Forced break behaviour

- When a break starts, a content script injects a full-viewport overlay into every open tab and every tab opened later. The overlay shows a countdown, a short message and the d20 result.
- The overlay can't be closed. An optional **"Emergency skip"** needs you to type a phrase, and it is logged as `skipped`.
- Sites in the **allow-list** (for example Google Meet or Zoom) never get the overlay, so calls aren't broken.
- Pages the extension can't reach (`chrome://`, the Web Store) are covered by opening a dedicated `break.html` tab and focusing it.

## 4. Logging

Each session is saved to `chrome.storage.local` as one record:

```json
{
  "id": "uuid",
  "type": "focus | break",
  "roll": 14,
  "plannedMin": 28,
  "startedAt": "2026-11-04T10:12:00Z",
  "endedAt": "2026-11-04T10:40:00Z",
  "actualMin": 28,
  "status": "completed | stopped | skipped | extended",
  "task": "Write project proposal"
}
```

- **Task label:** before a focus roll you can type what you're working on (optional).
- **History page** (`history.html`):
  - Today, this week, and all-time totals of focus and break minutes
  - A table of sessions
  - A simple bar chart of focus minutes per day
  - A roll distribution chart (just for fun)
- **Export / import:** CSV and JSON.
- **Auto-sync for Claude CLI:**
  - After each session ends, the extension writes the full log to `~/Downloads/d20-focus/log.json` and overwrites the previous copy.
  - It uses `chrome.downloads` with `conflictAction: "overwrite"`, and `downloads.ui` hides the download bubble.
  - The file is read-only data for Claude Code to answer questions from, such as "how much did I focus this week?"
  - A `/focus-stats` command can come later.

## 5. UI surfaces

| Surface | Purpose |
|---|---|
| `popup.html` | An animated d20 roll, the current phase, the countdown, a task input, and Start / Pause / Stop buttons |
| Toolbar badge | Minutes left, green during focus and blue during a break |
| `break.html` / overlay | The forced break screen |
| `options.html` | Duration mapping, critical-roll toggles, long-break interval, allow-list, sound on/off, auto-start next phase |
| `history.html` | The log, stats and export |

**d20 visual:** an SVG icosahedron face with a CSS tumble animation that lands on the rolled number, similar to rolladie.net. It uses no external libraries.

## 6. File structure

```
chrome-extensions/
  d20-focus/
    manifest.json          # MV3; permissions: alarms, storage, notifications, tabs, scripting; host_permissions: <all_urls>
    background.js          # service worker: state machine, alarms, badge, logging
    lib/
      dice.js              # rollD20(), duration mapping, crit rules
      store.js             # read/write state + sessions, CSV/JSON export
    popup/  popup.html  popup.css  popup.js
    content/ overlay.js  overlay.css
    pages/  break.html  history.html  options.html (+ js/css)
    assets/ icons (16/32/48/128), d20.svg, chime.mp3
    tests/  dice.test.js   # node --test, covers mapping + distribution
```

## 7. Key technical notes

- MV3 service workers get put to sleep, so they can't hold timers. The state is `{ phase, endsAt, roll, task }` and is kept in `chrome.storage`. The extension uses `chrome.alarms` for when each phase ends (minimum 30 s), and both the popup and the overlay calculate the time left from `endsAt`.
- When the browser restarts during a phase, `chrome.runtime.onStartup` checks `endsAt`. If the phase has already ended it is closed out and logged; otherwise the alarm is set again.
- Pausing stores the remaining time. Resuming sets a new `endsAt`.

## 8. Milestones

1. **M1 – Skeleton:** the manifest, the dice module with unit tests, and a popup that rolls and shows the number. Load it unpacked in Chrome.
2. **M2 – Timer state machine:** alarms, the badge, notifications, Focus and Break taking turns, pause and stop.
3. **M3 – Forced break:** the overlay on all tabs, the fallback tab, the allow-list and the emergency skip.
4. **M4 – Logging:** session records, the history page, stats and CSV/JSON export.
5. **M5 – Polish:** the d20 tumble animation, sound, the options page, critical-roll effects and icons.

**Done when:**
- A full Focus → Break → Focus cycle runs with the popup closed.
- During a break, every tab is blocked.
- The cycle still works after Chrome restarts mid-phase.
- The history shows correct minutes and exports a CSV that opens in a spreadsheet.

## 9. Decisions (2026-11-04)

1. **Duration mapping:** use the formula `roll × 2` for focus, which gives a looser structure than a fixed table.
2. **Next phase:** never starts by itself. When a phase ends, the extension waits for you to click Roll.
3. **Breaks:** there is no emergency skip. Instead, a **"Pause for meeting"** button freezes the current phase, whether it's a focus block or a break, and lifts the overlay. The pause is logged as a `meeting` entry with its own start and end times. Resume picks up the remaining time.
4. **Scope:** Chrome only.
5. **Never block Claude:** an agent may be running during a break.
   - `claude.ai/*` is on the default allow-list, so its tabs never get the overlay.
   - Even on blocked tabs, the overlay is only a visual layer: it never pauses, reloads or closes the page, so anything running there carries on.
   - Any future CLI add-on will be read-only (`/roll` and the status-line countdown). It won't have a hook that blocks prompts or tool calls.
6. **Stop is relaxed:**
   - Stopping a focus block early has no penalty. It's logged as `stopped` with the actual minutes, and the next roll is for a break as usual.
   - It doesn't change the stats either: there's no completion rate or other tracking of how often you stop.
7. **Breaks are forced:**
   - Stop is shown only during focus blocks.
   - During a break, **Pause for meeting** is the only way to lift the overlay. The break's remaining time resumes afterwards.
8. **Pause has a reason; incidents can end a break** (replaces "Pause for meeting"):
   - **Pause** asks for a reason: Meeting, Incident, Call or Other. It's in the popup and on the break overlay.
   - Each pause is logged as `type: "pause"` with its `reason`.
   - After pausing a break for an **Incident**, you may **skip the rest of the break**. The break is logged as `skipped`, and the next roll is for focus.
   - Other pause reasons resume the remaining time.
9. **Popup footer:**
   - **History** opens the history page.
   - **Download log** writes `log.json` straight away, including the session in progress (under `current`).
