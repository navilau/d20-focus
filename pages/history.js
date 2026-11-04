import { summary, focusByDay, rollCounts, toCSV, mergeSessions, logFile } from "../lib/stats.js";
import { loadSessions, saveSessions, loadState } from "../lib/store.js";

const $ = (id) => document.getElementById(id);
const PAGE = 200;
let sessions = [];
let filter = "all";
let showAll = false;

// ---- formatting -------------------------------------------------------

function hm(min) {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : "";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- tiles ------------------------------------------------------------

function renderTiles() {
  const s = summary(sessions);
  const tile = (title, t) => `
    <article class="tile">
      <h3>${title}</h3>
      <div class="hero">${hm(t.focusMin)}<small>focus</small></div>
      <dl>
        <dt><span class="dot" style="background:var(--focus)"></span>Focus blocks</dt><dd>${t.focusCount}${t.stopped ? ` (${t.stopped} stopped)` : ""}</dd>
        <dt><span class="dot" style="background:var(--break)"></span>Break time</dt><dd>${hm(t.breakMin)} · ${t.breakCount}${t.skipped ? ` (${t.skipped} skipped)` : ""}</dd>
        <dt><span class="dot" style="background:var(--pause)"></span>Paused</dt><dd>${hm(t.pauseMin)} · ${t.pauseCount}</dd>
      </dl>
    </article>`;
  $("tiles").innerHTML = tile("Today", s.today) + tile("This week", s.week) + tile("All time", s.all);
}

// ---- bar chart --------------------------------------------------------

/**
 * Single-series bar chart in SVG, sized to its container.
 * rows: [{ label, value, tip }]. Every row gets a hover tooltip; only the
 * largest bar is labelled directly.
 */
function barChart(el, rows, { unit = "", tickEvery = 1 } = {}) {
  const W = el.clientWidth || 600;
  const H = el.clientHeight || 220;
  const m = { top: 18, right: 4, bottom: 22, left: 34 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(...rows.map((r) => r.value), 0);
  const step = niceStep(max || 1);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const y = (v) => m.top + ih - (v / top) * ih;
  const band = iw / rows.length;
  const gap = Math.max(2, band * 0.25);
  const bw = Math.max(2, band - gap);
  const maxIdx = rows.findIndex((r) => r.value === max && max > 0);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(el.dataset.label || "")}">`;
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="grid" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis-label" x="${m.left - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}${unit}</text>`;
  }
  rows.forEach((r, i) => {
    const x = m.left + i * band + gap / 2;
    const h = (r.value / top) * ih;
    svg += `<g data-i="${i}">`;
    svg += `<rect class="hit" x="${m.left + i * band}" y="${m.top}" width="${band}" height="${ih}"/>`;
    if (h > 0) svg += `<path class="bar" d="${roundedTop(x, y(r.value), bw, h, 4)}"/>`;
    svg += `</g>`;
    if (i % tickEvery === 0 || i === rows.length - 1) {
      svg += `<text class="axis-label" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text>`;
    }
    if (i === maxIdx) {
      svg += `<text class="value-label" x="${x + bw / 2}" y="${y(r.value) - 5}" text-anchor="middle">${r.value}${unit}</text>`;
    }
  });
  svg += `</svg><div class="tip" hidden></div>`;
  el.innerHTML = svg;

  const tip = el.querySelector(".tip");
  el.querySelectorAll("g[data-i]").forEach((g) => {
    const r = rows[g.dataset.i];
    const i = Number(g.dataset.i);
    g.addEventListener("mouseenter", () => {
      g.classList.add("on");
      tip.innerHTML = r.tip;
      tip.hidden = false;
      const px = ((m.left + i * band + band / 2) / W) * el.clientWidth;
      tip.style.left = `${Math.min(Math.max(px, 60), el.clientWidth - 60)}px`;
      tip.style.top = `${(y(r.value) / H) * el.clientHeight}px`;
    });
    g.addEventListener("mouseleave", () => { g.classList.remove("on"); tip.hidden = true; });
  });
}

function niceStep(max) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

// Bar anchored to the baseline with only the top corners rounded.
function roundedTop(x, yTop, w, h, r) {
  r = Math.min(r, w / 2, h);
  const yb = yTop + h;
  return `M${x},${yb} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yb} Z`;
}

function renderCharts() {
  const days = focusByDay(sessions, 14);
  barChart($("dayChart"), days.map((d) => ({
    label: d.date.toLocaleDateString(undefined, { day: "numeric" }),
    value: Math.round(d.focusMin),
    tip: `${fmtDate(d.date)}: <b>${hm(d.focusMin)}</b> focus`,
  })), { unit: "m" });

  const rolls = rollCounts(sessions);
  const total = rolls.reduce((n, r) => n + r.count, 0);
  barChart($("rollChart"), rolls.map((r) => ({
    label: String(r.face),
    value: r.count,
    tip: `Rolled ${r.face}: <b>${r.count}</b> time${r.count === 1 ? "" : "s"}${total ? ` (${Math.round((r.count / total) * 100)}%)` : ""}`,
  })));
}

// ---- table ------------------------------------------------------------

function renderTable() {
  const list = sessions.filter((s) => filter === "all" || s.type === filter).slice().reverse();
  const shown = showAll ? list : list.slice(0, PAGE);
  const color = { focus: "var(--focus)", break: "var(--break)", pause: "var(--pause)" };
  $("rows").innerHTML = shown.map((s) => {
    const what = s.type === "pause" ? `${cap(s.reason)} (during ${s.during})` : s.task || "";
    const rolls = s.rolls?.length > 1 ? `${s.rolls.join("→")}` : (s.roll ?? "");
    return `<tr>
      <td>${fmtDate(s.startedAt)}</td>
      <td>${fmtTime(s.startedAt)}</td>
      <td><span class="type"><span class="dot" style="background:${color[s.type]}"></span>${cap(s.type)}${s.longBreak ? " (long)" : ""}</span></td>
      <td class="task">${esc(what)}</td>
      <td class="num">${rolls}</td>
      <td class="num">${s.plannedMin != null ? `${s.plannedMin}m` : ""}</td>
      <td class="num">${hm(s.actualMin || 0)}</td>
      <td>${cap(s.status)}</td>
    </tr>`;
  }).join("");
  $("moreBtn").hidden = showAll || list.length <= PAGE;
  $("moreBtn").textContent = `Show all ${list.length}`;
  $("empty").hidden = sessions.length > 0;
}

function renderAll() {
  renderTiles();
  renderCharts();
  renderTable();
}

// ---- export / import --------------------------------------------------

function save(name, type, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

$("csvBtn").addEventListener("click", () => save(`d20-focus-${stamp()}.csv`, "text/csv", toCSV(sessions)));
$("jsonBtn").addEventListener("click", async () => {
  save(`d20-focus-${stamp()}.json`, "application/json", JSON.stringify(logFile(sessions, await loadState()), null, 2));
});
$("importInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.sessions;
    if (!Array.isArray(incoming)) throw new Error("no sessions found in that file");
    const before = sessions.length;
    const merged = mergeSessions(sessions, incoming);
    await saveSessions(merged);
    $("status").textContent = `Imported ${merged.length - before} new session(s).`;
  } catch (err) {
    $("status").textContent = `Import failed: ${err.message}`;
  }
});

// ---- wiring -----------------------------------------------------------

document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
  filter = b.dataset.filter;
  showAll = false;
  document.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderTable();
}));
$("moreBtn").addEventListener("click", () => { showAll = true; renderTable(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sessions) {
    sessions = changes.sessions.newValue ?? [];
    renderAll();
  }
});
let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderCharts, 100); });

sessions = await loadSessions();
renderAll();
