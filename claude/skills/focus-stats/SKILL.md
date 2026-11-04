---
name: focus-stats
description: Show D20 Focus stats (focus, break and pause time, per-day and per-task totals) from the Chrome extension's log, or answer a question about them. Use when the user runs /focus-stats or asks how much they focused, took breaks or were interrupted.
argument-hint: "[today|week|all|7d] [question]"
allowed-tools: Bash(node:*), Bash(realpath:*), Read
---

# D20 Focus stats

The D20 Focus extension writes its log to `~/Downloads/d20-focus/log.json`. This skill's script (`cli/focus-stats.js` in the d20-focus repo) reads it with the same code as the extension's History page.

Stats for the requested range (default: this week):

!`node "$(realpath ~/.claude/skills/focus-stats)/../../../cli/focus-stats.js" $ARGUMENTS 2>&1`

## How to respond

- If the user only ran `/focus-stats`, optionally with a range, show the stats above in a code block. Then add one or two plain observations at most, such as the best day or what took the most focus. Don't lecture or coach.
- If they asked a question, answer it from the numbers. For anything the summary doesn't cover, such as a specific day, a time of day or one task's history, run the script with `--json` or read the log file directly.
- Ranges: `today`, `week` (from Monday), `all`, or `<N>d` (for example `7d`).
- The log is rewritten only when a session ends. A session still in progress isn't in the totals; mention it if the output shows one.
- If the script says no log was found, tell the user to click **Download log** in the extension popup.
