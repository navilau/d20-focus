// Break overlay. Chrome injects this into every web page; it does nothing
// until a break is running, then covers the page with a countdown screen.
// It never pauses, reloads or closes the page: anything running underneath
// (an agent, a build, a video) carries on.
//
// Also loaded by pages/break.html, which covers tabs that extensions can't
// inject into (chrome:// pages, the New Tab page).
//
// Content scripts can't use ES module imports, so this file is self-contained.
(() => {
  if (window.__d20FocusOverlay) return; // already injected
  window.__d20FocusOverlay = true;

  const DEFAULT_ALLOW = ["claude.ai", "meet.google.com", "zoom.us"];
  const isBreakPage = location.protocol === "chrome-extension:";
  let host = null;
  let ticker = null;
  let current = null;

  function allowed(allowList) {
    const h = location.hostname;
    return !isBreakPage && allowList.some((d) => h === d || h.endsWith(`.${d}`));
  }

  async function refresh() {
    let data;
    try {
      data = await chrome.storage.local.get(["state", "settings"]);
    } catch {
      return; // extension was reloaded; this old copy is orphaned
    }
    current = data.state;
    const allowList = data.settings?.allowList ?? DEFAULT_ALLOW;
    const inBreak = current?.status === "running" && current.phase === "break";
    if (inBreak && !allowed(allowList)) show();
    else hide();
  }

  // ---- overlay ----------------------------------------------------------

  function show() {
    if (!host) build();
    if (!host.isConnected) document.documentElement.append(host);
    tick();
    clearInterval(ticker);
    ticker = setInterval(tick, 500);
    document.addEventListener("keydown", trapKeys, true);
  }

  function hide() {
    clearInterval(ticker);
    document.removeEventListener("keydown", trapKeys, true);
    host?.remove();
    // The break page closes itself once the break ends or is paused;
    // the background reopens it on Resume if it's still needed.
    if (isBreakPage) window.close();
  }

  // Stop keystrokes reaching the page underneath (Tab, typing, shortcuts),
  // except inside the overlay itself.
  function trapKeys(e) {
    if (e.composedPath().includes(host)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  function tick() {
    if (!current || !host) return;
    const ms = Math.max(0, current.endsAt - Date.now());
    const total = Math.ceil(ms / 1000);
    host.shadowRoot.getElementById("time").textContent =
      `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    host.shadowRoot.getElementById("roll").textContent = current.roll ?? "";
    host.shadowRoot.getElementById("sub").textContent =
      `You rolled ${current.roll}: ${current.plannedMin}-minute ${current.longBreak ? "long " : ""}break.`;
  }

  function build() {
    host = document.createElement("d20-focus-overlay");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .veil {
          position: fixed; inset: 0; z-index: 2147483647;
          display: grid; place-items: center;
          background: rgba(11, 31, 28, .94);
          backdrop-filter: blur(6px);
          color: #ecfdf9;
          font: 16px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
          padding: 16px; box-sizing: border-box;
        }
        .card { text-align: center; max-width: 420px; display: grid; gap: 14px; justify-items: center; }
        svg { width: 96px; height: 96px; }
        .face { fill: #22c3ae; }
        .edges { fill: none; stroke: #0b1f1c; stroke-opacity: .35; stroke-width: 1.4; stroke-linejoin: round; }
        svg text { fill: #0b1f1c; font: 700 26px system-ui, sans-serif; }
        h1 { margin: 0; font-size: 22px; font-weight: 600; }
        .time { font: 700 64px/1 ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; }
        p { margin: 0; color: #a7d8cf; }
        .hint { font-size: 13px; }
        details { margin-top: 10px; }
        summary {
          cursor: pointer; list-style: none; display: inline-block;
          padding: 8px 14px; border-radius: 8px; border: 1px solid #2f5e57;
          color: #ecfdf9; font-size: 14px; font-weight: 600;
        }
        summary::-webkit-details-marker { display: none; }
        .reasons { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 10px; }
        button {
          font: 600 14px system-ui, sans-serif; cursor: pointer;
          padding: 8px 14px; border-radius: 8px;
          background: #22c3ae; color: #0b1f1c; border: 0;
        }
        button:focus-visible, summary:focus-visible { outline: 2px solid #ecfdf9; outline-offset: 2px; }
      </style>
      <div class="veil" role="dialog" aria-modal="true" aria-label="Break time">
        <div class="card">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <polygon class="face" points="50,4 90,27 90,73 50,96 10,73 10,27"/>
            <g class="edges">
              <polygon points="50,22 78,66 22,66"/>
              <path d="M50,22 L50,4 M50,22 L10,27 M50,22 L90,27 M78,66 L90,27 M78,66 L90,73 M78,66 L50,96 M22,66 L10,27 M22,66 L10,73 M22,66 L50,96"/>
            </g>
            <text id="roll" x="50" y="55" text-anchor="middle" dominant-baseline="middle"></text>
          </svg>
          <h1>Break time</h1>
          <div class="time" id="time">0:00</div>
          <p id="sub"></p>
          <p class="hint">Step away from the screen. Anything running in this tab keeps going.</p>
          <details>
            <summary>Need to pause?</summary>
            <div class="reasons">
              <button data-reason="meeting">Meeting</button>
              <button data-reason="incident">Incident</button>
              <button data-reason="call">Call</button>
              <button data-reason="other">Other</button>
            </div>
          </details>
        </div>
      </div>`;
    // Swallow scrolling so the page underneath doesn't move.
    root.querySelector(".veil").addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    root.querySelector(".reasons").addEventListener("click", (e) => {
      const reason = e.target.closest("button")?.dataset.reason;
      if (reason) chrome.runtime.sendMessage({ type: "pause", reason });
    });
  }

  // ---- wiring -----------------------------------------------------------

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.state || changes.settings)) refresh();
    });
  } catch {
    return;
  }
  refresh();
})();
