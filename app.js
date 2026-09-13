/* Seat Plan — office seating chart tool.
   State lives in one object; it autosaves to localStorage, snapshots into named
   versions, and packs into the URL hash (gzip + base64url) for sharing. */

const GRID = 10;
const DESK_W = 120, DESK_H = 72;
const FLOOR_W = 2000, FLOOR_H = 1300;
const AUTOSAVE = "seatplan.autosave";
const VERSIONS = "seatplan.versions";

const TEAM_COLORS = ["#4338ca", "#0f7a5a", "#b4531f", "#8a2f6b", "#1f6f9c", "#7a6a12", "#a83232", "#3d6b2f"];

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const snap = (n) => Math.round(n / GRID) * GRID;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* "platform" typed against an existing "Platform" should be the same team,
   not a second one with its own colour. */
function canonicalTeam(input) {
  const t = (input || "").trim();
  if (!t) return "";
  const existing = state.people.map((p) => (p.team || "").trim()).filter(Boolean);
  return existing.find((e) => e.toLowerCase() === t.toLowerCase()) || t;
}

function teamColor(team) {
  if (!team) return null;
  let h = 0;
  for (const ch of team.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

/* ---------------- state ---------------- */

let state = null;
let mode = "assign";          // "assign" | "layout"
let zoom = 1;
let sel = new Set();          // selected layout items (ids)
let armedPerson = null;       // click-to-assign
let past = [], future = [];

function sampleState() {
  const people = [
    ["Avery Chen", "Eng"], ["Jordan Ruiz", "Eng"], ["Priya Nair", "Eng"], ["Sam Okafor", "Eng"],
    ["Dana Whitfield", "Design"], ["Miles Aoki", "Design"],
    ["Rosa Delgado", "CX"], ["Theo Lindqvist", "CX"], ["Nina Barros", "CX"],
    ["Wes Halloran", "Sales"], ["Ivy Zhang", "Sales"],
    ["Cam Petrov", "Ops"],
  ].map(([name, team]) => ({ id: uid(), name, team }));

  const items = [];
  const pod = (x, y, label) => {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      items.push({
        id: uid(), type: "desk", label: `${label}${r * 2 + c + 1}`,
        x: x + c * (DESK_W + 10), y: y + r * (DESK_H + 10), w: DESK_W, h: DESK_H,
      });
    }
  };
  items.push({ id: uid(), type: "zone", label: "Main floor", x: 60, y: 60, w: 700, h: 480 });
  items.push({ id: uid(), type: "zone", label: "Quiet room", x: 820, y: 60, w: 340, h: 220 });
  pod(100, 110, "A");
  pod(400, 110, "B");
  pod(100, 320, "C");
  items.push({ id: uid(), type: "desk", label: "Q1", x: 860, y: 110, w: DESK_W, h: DESK_H });
  items.push({ id: uid(), type: "desk", label: "Q2", x: 990, y: 110, w: DESK_W, h: DESK_H });

  const desks = items.filter((i) => i.type === "desk");
  const assign = {};
  people.slice(0, 8).forEach((p, i) => { assign[desks[i].id] = p.id; });

  return { v: 1, title: "Alix HQ — sample layout", people, items, assign };
}

/* ---------------- persistence ---------------- */

const b64url = {
  enc(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

async function pack(s) {
  const json = JSON.stringify(s);
  if (typeof CompressionStream === "function") {
    const cs = new CompressionStream("gzip");
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(json)); w.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return "z" + b64url.enc(new Uint8Array(buf));
  }
  return "j" + b64url.enc(new TextEncoder().encode(json));
}

async function unpack(str) {
  const kind = str[0], body = b64url.dec(str.slice(1));
  if (kind === "z") {
    const ds = new DecompressionStream("gzip");
    const w = ds.writable.getWriter();
    w.write(body); w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  }
  return JSON.parse(new TextDecoder().decode(body));
}

const store = {
  get(k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function autosave() {
  store.set(AUTOSAVE, state);
  const el = $("#savedat");
  if (el) el.textContent = "Saved " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* ---------------- history ---------------- */

function commit(fn) {
  past.push(JSON.stringify(state));
  if (past.length > 60) past.shift();
  future = [];
  fn();
  autosave();
  render();
}
function undo() {
  if (!past.length) return;
  future.push(JSON.stringify(state));
  state = JSON.parse(past.pop());
  autosave(); render();
}
function redo() {
  if (!future.length) return;
  past.push(JSON.stringify(state));
  state = JSON.parse(future.pop());
  autosave(); render();
}

/* ---------------- lookups ---------------- */

const personById = (id) => state.people.find((p) => p.id === id);
const itemById = (id) => state.items.find((i) => i.id === id);
const desks = () => state.items.filter((i) => i.type === "desk");
const seatOf = (pid) => Object.keys(state.assign).find((k) => state.assign[k] === pid);

function assignPerson(personId, deskId) {
  const prevSeat = seatOf(personId);
  const displaced = state.assign[deskId];
  if (prevSeat) delete state.assign[prevSeat];
  if (displaced && prevSeat) state.assign[prevSeat] = displaced;   // swap
  else if (displaced) delete state.assign[displaced];               // bump to pool
  state.assign[deskId] = personId;
}

/* ---------------- render ---------------- */

function render() {
  $("#title").value = state.title;
  renderTeams();
  renderRail();
  renderFloor();
  $("#undo").disabled = !past.length;
  $("#redo").disabled = !future.length;
  document.body.classList.toggle("mode-layout", mode === "layout");
  $("#m-assign").setAttribute("aria-pressed", String(mode === "assign"));
  $("#m-layout").setAttribute("aria-pressed", String(mode === "layout"));
  $("#layouttools").hidden = mode !== "layout";
  updateSelCount();
  $("#hint").innerHTML = mode === "assign"
    ? "<b>Assign:</b> drag a name onto a desk, or click a name then click a desk. Drag between desks to swap. Drag a seated name to the list to unseat. Double-click a name or a desk to rename it."
    : "<b>Layout:</b> drag across the floor to rubber-band a group, <b>⇧-click</b> to add or drop one, <b>⌘A</b> for all. Dragging any selected desk moves the whole group. Click an area to select it before dragging it. Corner handle resizes, double-click renames; <b>R</b> rotates, <b>⌫</b> deletes, arrows nudge, <b>⌘C</b>/<b>⌘V</b> copy and paste.";
}

function renderTeams() {
  const counts = new Map();
  for (const p of state.people) {
    const t = (p.team || "").trim();
    if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $("#teams").innerHTML = sorted.map(([t, n]) => `<option value="${esc(t)}">${n}</option>`).join("");
}

function renderRail() {
  const q = $("#search").value.trim().toLowerCase();
  const match = (p) => !q || p.name.toLowerCase().includes(q) || (p.team || "").toLowerCase().includes(q);
  const seatedIds = new Set(Object.values(state.assign));
  const unseated = state.people.filter((p) => !seatedIds.has(p.id) && match(p));
  const seated = state.people.filter((p) => seatedIds.has(p.id) && match(p))
    .sort((a, b) => (itemById(seatOf(a.id))?.label || "").localeCompare(itemById(seatOf(b.id))?.label || "", undefined, { numeric: true }));

  const openSeats = desks().length - seatedIds.size;
  $("#counts").innerHTML =
    `<b>${state.people.length - seatedIds.size}</b> to seat<span>·</span><b>${openSeats}</b> open desk${openSeats === 1 ? "" : "s"}`;

  const chip = (p, where) => `
    <div class="chip${where ? " seated" : ""}${armedPerson === p.id ? " armed" : ""}" data-person="${p.id}" title="Drag to a desk · double-click to rename">
      <span class="dot" style="background:${teamColor(p.team) || "var(--ink-3)"}"></span>
      <span class="nm">${esc(p.name)}${p.team ? ` <span style="color:var(--ink-3);font-size:12px">${esc(p.team)}</span>` : ""}</span>
      ${where ? `<span class="where">${esc(where)}</span>` : ""}
      <button class="x" data-edit="${p.id}" title="Rename" aria-label="Rename ${esc(p.name)}">✎</button>
      <button class="x" data-remove="${p.id}" title="Remove person" aria-label="Remove ${esc(p.name)}">×</button>
    </div>`;

  $("#pool").innerHTML =
    `<div class="group-label"><span>Unseated</span><span>${unseated.length}</span></div>` +
    (unseated.length
      ? `<div class="chips">${unseated.map((p) => chip(p, null)).join("")}</div>`
      : `<p class="empty-note">${state.people.length ? "Everyone has a desk." : "Add people above to get started."}</p>`) +
    (seated.length
      ? `<div class="group-label"><span>Seated</span><span>${seated.length}</span></div>
         <div class="chips">${seated.map((p) => chip(p, itemById(seatOf(p.id))?.label || "?")).join("")}</div>`
      : "");
}

function renderFloor() {
  const f = $("#floor");
  f.style.width = FLOOR_W + "px";
  f.style.height = FLOOR_H + "px";
  f.style.transform = `scale(${zoom})`;
  $("#floorsizer").style.width = FLOOR_W * zoom + "px";
  $("#floorsizer").style.height = FLOOR_H * zoom + "px";
  $("#zoomval").textContent = Math.round(zoom * 100) + "%";

  const zones = state.items.filter((i) => i.type === "zone");
  const ds = desks();
  f.innerHTML = [...zones, ...ds].map((it) => {
    const base = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px`;
    const picked = sel.has(it.id);
    const handle = mode === "layout" && picked && sel.size === 1 ? '<span class="handle" data-resize></span>' : "";
    const selCls = picked ? " sel" : "";
    if (it.type === "zone") {
      return `<div class="item zone${selCls}" style="${base}" data-item="${it.id}">${esc(it.label)}${handle}</div>`;
    }
    const p = personById(state.assign[it.id]);
    const stripe = p ? teamColor(p.team) || "var(--seated)" : "";
    return `<div class="item desk${p ? " filled" : ""}${selCls}" style="${base}${stripe ? `;--stripe:${stripe}` : ""}"
       data-item="${it.id}" data-desk="${it.id}">
      <span class="id">${esc(it.label)}</span>
      ${p ? `<span class="who">${esc(p.name)}</span><span class="team">${esc(p.team || "")}</span>` : ""}
      ${handle}
    </div>`;
  }).join("");
}

const FLOOR_PAD = 16;   // .floorwrap padding; scroll space starts there

/* Zooms around a fixed point — the pointer, or the middle of what you are looking
   at — so the plan grows under your eyes instead of away from the corner. */
function setZoom(next, anchor) {
  const wrap = $(".floorwrap");
  const rect = wrap.getBoundingClientRect();
  const ax = anchor ? anchor.x - rect.left : rect.width / 2;
  const ay = anchor ? anchor.y - rect.top : rect.height / 2;
  const fx = (wrap.scrollLeft + ax - FLOOR_PAD) / zoom;
  const fy = (wrap.scrollTop + ay - FLOOR_PAD) / zoom;

  const prev = zoom;
  zoom = clamp(+next.toFixed(3), 0.25, 2.5);
  if (zoom === prev) return;
  renderFloor();
  wrap.scrollLeft = fx * zoom + FLOOR_PAD - ax;
  wrap.scrollTop = fy * zoom + FLOOR_PAD - ay;
}

function zoomFit() {
  const wrap = $(".floorwrap");
  const rect = wrap.getBoundingClientRect();
  const items = state.items.length ? state.items : null;
  const bb = items ? bbox(items) : { x: 0, y: 0, w: FLOOR_W, h: FLOOR_H };
  const pad = 40;
  zoom = clamp(+Math.min((rect.width - pad) / (bb.w || FLOOR_W), (rect.height - pad) / (bb.h || FLOOR_H)).toFixed(3), 0.25, 2.5);
  renderFloor();
  wrap.scrollLeft = bb.x * zoom + FLOOR_PAD - (rect.width - bb.w * zoom) / 2;
  wrap.scrollTop = bb.y * zoom + FLOOR_PAD - (rect.height - bb.h * zoom) / 2;
}

let renaming = null;   // { kind: "item" | "person", id }

function openRename(kind, id) {
  const subject = kind === "item" ? itemById(id) : personById(id);
  if (!subject) return;
  renaming = { kind, id };
  armedPerson = null;

  const isPerson = kind === "person";
  $("#rn-kind").textContent = isPerson ? "Person" : subject.type === "desk" ? "Desk" : "Area";
  $("#rn-title").textContent = isPerson ? "Edit person" : subject.type === "desk" ? "Rename desk" : "Rename area";
  $("#rn-name").value = isPerson ? subject.name : subject.label;
  $("#rn-team").value = isPerson ? subject.team || "" : "";
  $("#rn-teamwrap").hidden = !isPerson;

  $("#dlg-rename").showModal();
  $("#rn-name").select();
}

function applyRename(e) {
  e.preventDefault();
  const r = renaming;
  $("#dlg-rename").close();
  renaming = null;
  if (!r) return;

  const name = $("#rn-name").value.trim();
  const team = canonicalTeam($("#rn-team").value);
  const subject = r.kind === "item" ? itemById(r.id) : personById(r.id);
  if (!subject) return;
  if (!name) { toast("A name can't be empty."); return; }

  if (r.kind === "person") {
    if (subject.name === name && (subject.team || "") === team) return;
    commit(() => { subject.name = name; subject.team = team; });
  } else {
    if (subject.label === name) return;
    commit(() => { subject.label = name; });
  }
  renderRail();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------------- person drag ---------------- */

let drag = null;
let lastChipClick = null;

function startPersonDrag(personId, ev, fromDeskId) {
  drag = { personId, fromDeskId, moved: false, x: ev.clientX, y: ev.clientY };
  window.addEventListener("pointermove", onPersonMove);
  window.addEventListener("pointerup", onPersonUp, { once: true });
}

function onPersonMove(ev) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    const g = $("#ghost");
    g.textContent = personById(drag.personId)?.name || "";
    g.hidden = false;
  }
  const g = $("#ghost");
  g.style.left = ev.clientX + "px";
  g.style.top = ev.clientY + "px";

  const desk = deskUnder(ev.clientX, ev.clientY);
  document.querySelectorAll(".desk.drop").forEach((d) => d.classList.remove("drop", "swap"));
  if (desk) {
    desk.classList.add("drop");
    if (state.assign[desk.dataset.desk] && state.assign[desk.dataset.desk] !== drag.personId) desk.classList.add("swap");
  }
}

function deskUnder(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest(".desk") : null;
}

function onPersonUp(ev) {
  window.removeEventListener("pointermove", onPersonMove);
  const d = drag; drag = null;
  $("#ghost").hidden = true;
  document.querySelectorAll(".desk.drop").forEach((el) => el.classList.remove("drop", "swap"));
  if (!d) return;

  if (!d.moved) {                                   // a click, not a drag
    // Arming re-renders the rail, which replaces the chip element — so the
    // browser never sees a native dblclick on it. Pair the clicks ourselves.
    const now = Date.now();
    if (lastChipClick && lastChipClick.id === d.personId && now - lastChipClick.t < 450) {
      lastChipClick = null;
      openRename("person", d.personId);
      renderRail();
      return;
    }
    lastChipClick = { id: d.personId, t: now };
    armedPerson = armedPerson === d.personId ? null : d.personId;
    renderRail();
    return;
  }
  const desk = deskUnder(ev.clientX, ev.clientY);
  if (desk) {
    commit(() => assignPerson(d.personId, desk.dataset.desk));
  } else if ($(".rail").contains(document.elementFromPoint(ev.clientX, ev.clientY)) && d.fromDeskId) {
    commit(() => { delete state.assign[d.fromDeskId]; });
  } else {
    render();
  }
}

/* ---------------- layout drag ---------------- */

const selItems = () => state.items.filter((i) => sel.has(i.id));

function bbox(items) {
  const x = Math.min(...items.map((i) => i.x)), y = Math.min(...items.map((i) => i.y));
  const r = Math.max(...items.map((i) => i.x + i.w)), b = Math.max(...items.map((i) => i.y + i.h));
  return { x, y, w: r - x, h: b - y };
}

function startResize(item, ev) {
  const el = $(`[data-item="${item.id}"]`);
  const start = { x: ev.clientX, y: ev.clientY, w: item.w, h: item.h };
  let changed = false;

  const move = (e) => {
    const dx = (e.clientX - start.x) / zoom, dy = (e.clientY - start.y) / zoom;
    if (!changed && Math.hypot(dx, dy) * zoom < 3) return;
    changed = true;
    item.w = clamp(snap(start.w + dx), GRID * 4, FLOOR_W - item.x);
    item.h = clamp(snap(start.h + dy), GRID * 3, FLOOR_H - item.y);
    el.style.width = item.w + "px"; el.style.height = item.h + "px";
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    if (!changed) { render(); return; }
    const after = { w: item.w, h: item.h };
    Object.assign(item, { w: start.w, h: start.h });        // rewind so undo lands pre-drag
    commit(() => Object.assign(item, after));
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

/* Moves every selected item together, snapped to the grid and clamped so the
   whole group stays on the floor. */
function startGroupDrag(ev) {
  const items = selItems();
  if (!items.length) return;
  const origin = items.map((i) => ({ i, x: i.x, y: i.y, el: $(`[data-item="${i.id}"]`) }));
  const bb = bbox(items);
  const start = { x: ev.clientX, y: ev.clientY };
  let changed = false;

  const move = (e) => {
    let dx = (e.clientX - start.x) / zoom, dy = (e.clientY - start.y) / zoom;
    if (!changed && Math.hypot(dx, dy) * zoom < 3) return;
    changed = true;
    dx = clamp(snap(dx), -bb.x, FLOOR_W - (bb.x + bb.w));
    dy = clamp(snap(dy), -bb.y, FLOOR_H - (bb.y + bb.h));
    for (const o of origin) {
      o.i.x = o.x + dx; o.i.y = o.y + dy;
      o.el.style.left = o.i.x + "px"; o.el.style.top = o.i.y + "px";
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    if (!changed) { render(); return; }
    const after = origin.map((o) => ({ i: o.i, x: o.i.x, y: o.i.y }));
    for (const o of origin) { o.i.x = o.x; o.i.y = o.y; }   // rewind so undo lands pre-drag
    commit(() => after.forEach((a) => { a.i.x = a.x; a.i.y = a.y; }));
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

/* Rubber-band select on empty floor. Shift/⌘ adds to the current selection. */
function startMarquee(ev, fallbackId) {
  const rect = $("#floor").getBoundingClientRect();
  const base = ev.shiftKey || ev.metaKey || ev.ctrlKey ? new Set(sel) : new Set();
  const x0 = (ev.clientX - rect.left) / zoom, y0 = (ev.clientY - rect.top) / zoom;
  const band = $("#marquee");
  let moved = false;

  const move = (e) => {
    const x1 = (e.clientX - rect.left) / zoom, y1 = (e.clientY - rect.top) / zoom;
    if (!moved && Math.hypot(x1 - x0, y1 - y0) * zoom < 4) return;
    moved = true;
    band.hidden = false;
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    band.style.left = x * zoom + "px"; band.style.top = y * zoom + "px";
    band.style.width = w * zoom + "px"; band.style.height = h * zoom + "px";

    sel = new Set(base);
    for (const it of state.items) {
      const touches = x < it.x + it.w && x + w > it.x && y < it.y + it.h && y + h > it.y;
      // areas enclose desks, so they only join the selection when the band contains them whole
      const whole = it.x >= x && it.y >= y && it.x + it.w <= x + w && it.y + it.h <= y + h;
      if (it.type === "zone" ? whole : touches) sel.add(it.id);
    }
    document.querySelectorAll(".item").forEach((el) => el.classList.toggle("sel", sel.has(el.dataset.item)));
    updateSelCount();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    band.hidden = true;
    if (!moved) { sel = fallbackId ? new Set([fallbackId]) : base; }  // a click, not a band
    render();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

function updateSelCount() {
  const n = sel.size;
  $("#selcount").textContent = n ? `${n} selected` : "none selected";
  $("#selcount").classList.toggle("on", n > 0);
}

/* ---------------- item creation ---------------- */

function nextDeskLabel() {
  const used = new Set(desks().map((d) => d.label));
  for (let i = 1; i < 999; i++) if (!used.has("D" + i)) return "D" + i;
  return "D" + Date.now();
}

function freeSpot() {
  // first grid position in a left-to-right sweep that doesn't overlap an existing desk
  for (let y = 40; y < FLOOR_H - DESK_H; y += DESK_H + 10) {
    for (let x = 40; x < FLOOR_W - DESK_W; x += DESK_W + 10) {
      const hit = desks().some((d) => x < d.x + d.w && x + DESK_W > d.x && y < d.y + d.h && y + DESK_H > d.y);
      if (!hit) return { x, y };
    }
  }
  return { x: 40, y: 40 };
}

function addDesk() {
  const { x, y } = freeSpot();
  const it = { id: uid(), type: "desk", label: nextDeskLabel(), x, y, w: DESK_W, h: DESK_H };
  commit(() => { state.items.push(it); sel = new Set([it.id]); });
}

function addZone() {
  const it = { id: uid(), type: "zone", label: "Area", x: snap(60 + Math.random() * 200), y: snap(60 + Math.random() * 200), w: 300, h: 200 };
  commit(() => { state.items.unshift(it); sel = new Set([it.id]); });
}

function addRow(count, dir, prefix) {
  const { x, y } = freeSpot();
  const made = [];
  for (let i = 0; i < count; i++) {
    made.push({
      id: uid(), type: "desk", label: `${prefix}${i + 1}`,
      x: dir === "h" ? x + i * (DESK_W + 10) : x,
      y: dir === "h" ? y : y + i * (DESK_H + 10),
      w: DESK_W, h: DESK_H,
    });
  }
  commit(() => { state.items.push(...made); sel = new Set(made.map((m) => m.id)); });
}

/* ---------------- share / versions / data ---------------- */

async function share() {
  const hash = await pack(state);
  const url = location.origin + location.pathname + location.search + "#d=" + hash;
  $("#shareurl").value = url;
  const framed = window.top !== window.self;
  $("#sharesize").textContent = `${url.length.toLocaleString()} characters` +
    (url.length > 8000 ? " — long; some chat clients may truncate it, so fall back to Data → Copy data." : " — fits in a link, no server needed.");
  $("#framednote").hidden = !framed;
  $("#dlg-share").showModal();
  try {
    await navigator.clipboard.writeText(url);
    toast("Share link copied");
  } catch {}
}

function slug(t) {
  return (t || "seating-chart").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "seating-chart";
}

function downloadFile() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(state.title)}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(window.top !== window.self
    ? "Downloading — if nothing arrives, this embed blocks downloads; use Data → Copy data."
    : `Saved ${a.download}`);
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const next = JSON.parse(reader.result);
      if (!next || !Array.isArray(next.people) || !Array.isArray(next.items)) throw new Error("shape");
      commit(() => { state = next; });
      $("#dlg-versions").close();
      toast(`Opened ${file.name}`);
    } catch {
      toast(`${file.name} isn't a Seat Plan file — expected the JSON this tool saves.`);
    }
  };
  reader.onerror = () => toast("That file couldn't be read.");
  reader.readAsText(file);
}

function saveVersion() {
  const name = $("#vname").value.trim() || new Date().toLocaleString();
  const list = store.get(VERSIONS, []);
  list.unshift({ id: uid(), name, ts: Date.now(), data: state });
  store.set(VERSIONS, list.slice(0, 40));
  $("#vname").value = "";
  renderVersions();
  toast(`Saved "${name}"`);
}

function renderVersions() {
  const list = store.get(VERSIONS, []);
  $("#vlist").innerHTML = list.length
    ? list.map((v) => `
      <div class="vrow">
        <div class="meta"><b>${esc(v.name)}</b><span>${new Date(v.ts).toLocaleString()} · ${v.data.people.length} people · ${v.data.items.filter((i) => i.type === "desk").length} desks</span></div>
        <button class="btn" data-restore="${v.id}">Restore</button>
        <button class="btn icon" data-delv="${v.id}" title="Delete version">×</button>
      </div>`).join("")
    : `<p class="empty-note">No saved versions yet. Versions stay in this browser; use Share to send a layout to someone else.</p>`;
}

/* ---------------- boot ---------------- */

async function boot() {
  const hash = location.hash.match(/^#d=(.+)$/);
  let loaded = null;
  if (hash) {
    try { loaded = await unpack(hash[1]); } catch { toast("That share link couldn't be read — starting from your last layout."); }
  }
  state = loaded || store.get(AUTOSAVE, null) || sampleState();
  if (loaded) toast("Opened a shared layout — edits stay local until you share again.");
  wire();
  $("#savedat").textContent = loaded ? "Shared copy" : store.get(AUTOSAVE, null) ? "Saved in this browser" : "";
  renderVersions();
  render();
}

function wire() {
  /* top bar */
  $("#title").addEventListener("change", (e) => commit(() => { state.title = e.target.value.trim() || "Untitled layout"; }));
  $("#m-assign").onclick = () => { mode = "assign"; sel.clear(); render(); };
  $("#m-layout").onclick = () => { mode = "layout"; armedPerson = null; render(); };
  $("#undo").onclick = undo;
  $("#redo").onclick = redo;
  $("#share").onclick = share;
  $("#save").onclick = () => {
    renderVersions();
    $("#dlg-versions").showModal();
    $("#vname").focus();
  };
  $("#datadlg").onclick = () => { $("#datatext").value = JSON.stringify(state, null, 2); $("#dlg-data").showModal(); };

  /* people */
  $("#addform").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#pname").value.trim();
    if (!name) return;
    const team = canonicalTeam($("#team").value);
    $("#team").value = team;                 // keep it for the next person
    commit(() => {
      name.split(/\s*,\s*/).filter(Boolean).forEach((n) => state.people.push({ id: uid(), name: n, team }));
    });
    $("#pname").value = "";
    $("#pname").focus();
  });
  $("#search").addEventListener("input", renderRail);

  $("#pool").addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-remove]") || e.target.closest("[data-edit]")) return;
    const chip = e.target.closest("[data-person]");
    if (!chip) return;
    e.preventDefault();
    const pid = chip.dataset.person;
    startPersonDrag(pid, e, seatOf(pid));
  });
  $("#pool").addEventListener("dblclick", (e) => {
    const chip = e.target.closest("[data-person]");
    if (chip && !$("#dlg-rename").open) openRename("person", chip.dataset.person);
  });

  $("#pool").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { openRename("person", ed.dataset.edit); return; }
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    const id = rm.dataset.remove;
    commit(() => {
      state.people = state.people.filter((p) => p.id !== id);
      const seat = Object.keys(state.assign).find((k) => state.assign[k] === id);
      if (seat) delete state.assign[seat];
    });
  });

  /* floor */
  const floor = $("#floor");
  floor.addEventListener("pointerdown", (e) => {
    const itemEl = e.target.closest(".item");
    if (!itemEl) {
      if (mode === "layout" && e.button === 0) { e.preventDefault(); startMarquee(e); }
      else if (sel.size) { sel.clear(); render(); }
      return;
    }
    const item = itemById(itemEl.dataset.item);
    if (!item) return;

    if (mode === "layout") {
      e.preventDefault();
      if (e.target.closest("[data-resize]")) { startResize(item, e); return; }

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (additive) {
        sel.has(item.id) ? sel.delete(item.id) : sel.add(item.id);
        render();
        if (!sel.has(item.id)) return;          // just deselected — nothing to drag
      } else if (!sel.has(item.id)) {
        if (item.type === "zone") { startMarquee(e, item.id); return; }
        sel = new Set([item.id]);
        render();
      }
      startGroupDrag(e);
      return;
    }
    // assign mode: dragging a filled desk picks the person up
    const pid = state.assign[item.id];
    if (item.type === "desk" && pid) {
      e.preventDefault();
      startPersonDrag(pid, e, item.id);
    }
  });

  floor.addEventListener("click", (e) => {
    if (mode !== "assign" || !armedPerson) return;
    const deskEl = e.target.closest(".desk");
    if (!deskEl) return;
    const pid = armedPerson;
    armedPerson = null;
    commit(() => assignPerson(pid, deskEl.dataset.desk));
  });

  floor.addEventListener("dblclick", (e) => {
    const itemEl = e.target.closest(".item");
    if (itemEl) openRename("item", itemEl.dataset.item);
  });

  /* layout tools */
  $("#add-desk").onclick = addDesk;
  $("#add-zone").onclick = addZone;
  $("#add-row").onclick = () => $("#dlg-row").showModal();
  $("#rowform").addEventListener("submit", (e) => {
    e.preventDefault();
    addRow(clamp(parseInt($("#rowcount").value, 10) || 4, 1, 40), $("#rowdir").value, $("#rowprefix").value.trim() || "D");
    $("#dlg-row").close();
  });
  $("#rename").onclick = () => {
    if (sel.size !== 1) return toast(sel.size ? "Select just one desk or area to rename" : "Select a desk or area first");
    openRename("item", [...sel][0]);
  };
  $("#dup").onclick = () => {
    const items = selItems();
    if (!items.length) return toast("Select a desk or area first");
    const bb = bbox(items);
    const dx = clamp(bb.w + 10, 0, FLOOR_W - (bb.x + bb.w));   // drop the copy beside the original
    const made = [];
    commit(() => {
      for (const it of items) {
        const copy = { ...it, id: uid(), x: it.x + dx };
        if (it.type === "desk") copy.label = nextDeskLabel();  // scans state.items, so push as we go
        state.items.push(copy);
        made.push(copy.id);
      }
      sel = new Set(made);
    });
  };
  $("#rot").onclick = () => rotateSel();
  $("#del").onclick = () => deleteSel();

  /* zoom */
  $("#zoomin").onclick = () => setZoom(zoom * 1.25);
  $("#zoomout").onclick = () => setZoom(zoom / 1.25);
  $("#zoom100").onclick = () => setZoom(1);
  $("#zoomfit").onclick = zoomFit;

  // trackpad pinch and ctrl-wheel zoom, anchored under the pointer
  $(".floorwrap").addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  /* dialogs */
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  $("#renameform").addEventListener("submit", applyRename);
  $("#savever").onclick = saveVersion;
  $("#download").onclick = downloadFile;
  $("#openfile").onclick = () => $("#fileinput").click();
  $("#fileinput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) loadFile(file);
    e.target.value = "";                       // so the same file can be opened twice
  });
  $("#vlist").addEventListener("click", (e) => {
    const r = e.target.closest("[data-restore]"), d = e.target.closest("[data-delv]");
    const list = store.get(VERSIONS, []);
    if (r) {
      const v = list.find((x) => x.id === r.dataset.restore);
      if (v) { commit(() => { state = JSON.parse(JSON.stringify(v.data)); }); $("#dlg-versions").close(); toast(`Restored "${v.name}"`); }
    } else if (d) {
      store.set(VERSIONS, list.filter((x) => x.id !== d.dataset.delv));
      renderVersions();
    }
  });
  $("#copydata").onclick = async () => {
    try { await navigator.clipboard.writeText($("#datatext").value); toast("Data copied"); }
    catch { $("#datatext").select(); toast("Press ⌘C to copy"); }
  };
  $("#loaddata").onclick = () => {
    try {
      const next = JSON.parse($("#datatext").value);
      if (!next || !Array.isArray(next.people) || !Array.isArray(next.items)) throw new Error("shape");
      commit(() => { state = next; });
      $("#dlg-data").close();
      toast("Data loaded");
    } catch {
      toast("That isn't a valid layout — paste the full JSON block.");
    }
  };
  $("#copyurl").onclick = async () => {
    try { await navigator.clipboard.writeText($("#shareurl").value); toast("Link copied"); }
    catch { $("#shareurl").select(); toast("Press ⌘C to copy"); }
  };
  $("#reset").onclick = () => {
    if (!confirm("Clear all people, desks and assignments? Saved versions are kept.")) return;
    commit(() => { state = { v: 1, title: "Untitled layout", people: [], items: [], assign: {} }; });
    $("#dlg-data").close();
  };
  $("#sample").onclick = () => { commit(() => { state = sampleState(); }); $("#dlg-data").close(); };
  $("#print").onclick = () => window.print();

  /* clipboard — layout mode only, and never while typing in a field */
  const clipboardBusy = () =>
    /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "") || document.querySelector("dialog[open]");

  let lastClipEvent = 0;   // some browsers/embeds never deliver these events; keydown covers that

  document.addEventListener("copy", (e) => {
    if (mode !== "layout" || clipboardBusy() || !sel.size) return;
    e.preventDefault();
    lastClipEvent = Date.now();
    copySel(e, false);
  });
  document.addEventListener("cut", (e) => {
    if (mode !== "layout" || clipboardBusy() || !sel.size) return;
    e.preventDefault();
    lastClipEvent = Date.now();
    copySel(e, true);
  });
  document.addEventListener("paste", (e) => {
    if (mode !== "layout" || clipboardBusy()) return;
    e.preventDefault();
    lastClipEvent = Date.now();
    pasteClip(e.clipboardData ? e.clipboardData.getData("text/plain") : "");
  });

  window.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || mode !== "layout" || clipboardBusy()) return;
    const k = e.key.toLowerCase();
    if (k !== "c" && k !== "x" && k !== "v") return;
    const at = lastClipEvent;
    setTimeout(() => {
      if (Date.now() - at < 400) return;                  // the real clipboard event handled it
      if (k === "v") pasteClip("");
      else if (sel.size) copySel(null, k === "x");
    }, 80);
  });

  /* keyboard */
  window.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (typing || document.querySelector("dialog[open]")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      $("#save").click();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); setZoom(zoom * 1.25); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "-") { e.preventDefault(); setZoom(zoom / 1.25); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "0") { e.preventDefault(); setZoom(1); return; }
    if (e.key === "Escape") { armedPerson = null; sel.clear(); render(); return; }
    if (mode !== "layout") return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      sel = new Set(state.items.map((i) => i.id));
      render();
      return;
    }
    if (!sel.size) return;
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); deleteSel(); }
    else if (e.key.toLowerCase() === "r") rotateSel();
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? GRID * 5 : GRID;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      nudge(d[0], d[1]);
    }
  });
}

function rotateSel() {
  const items = selItems();
  if (!items.length) return toast("Select a desk or area first");
  commit(() => {
    for (const it of items) {                    // each turns about its own centre, so a row stays a row
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      [it.w, it.h] = [it.h, it.w];
      it.x = clamp(snap(cx - it.w / 2), 0, FLOOR_W - it.w);
      it.y = clamp(snap(cy - it.h / 2), 0, FLOOR_H - it.h);
    }
  });
}

function deleteSel() {
  const items = selItems();
  if (!items.length) return toast("Select a desk or area first");
  const seated = items.filter((it) => state.assign[it.id]).length;
  commit(() => {
    for (const it of items) delete state.assign[it.id];
    state.items = state.items.filter((x) => !sel.has(x.id));
    sel = new Set();
  });
  if (seated) toast(`${seated} ${seated === 1 ? "person" : "people"} moved back to the pool`);
}

let clip = null;   // in-page fallback when the system clipboard isn't readable

function copySel(ev, cut) {
  const items = selItems();
  if (!items.length) { toast("Select a desk or area first"); return; }
  const bb = bbox(items);
  const payload = { seatplan: 1, ax: bb.x, ay: bb.y, items: items.map((i) => ({ ...i, x: i.x - bb.x, y: i.y - bb.y })) };
  clip = payload;
  if (ev && ev.clipboardData) ev.clipboardData.setData("text/plain", JSON.stringify(payload));
  if (cut) deleteSel();
  else toast(`${items.length} ${items.length === 1 ? "item" : "items"} copied`);
}

function pasteClip(text) {
  let p = null;
  try {
    const o = JSON.parse(text || "");
    if (o && o.seatplan && Array.isArray(o.items)) p = o;
  } catch {}
  if (!p) p = clip;
  if (!p || !p.items.length) return;

  // step the copy clear of whatever already sits at the source position
  const occupied = (x, y) => state.items.some((i) => i.x === x && i.y === y);
  let ox = p.ax + GRID * 2, oy = p.ay + GRID * 2;
  for (let n = 0; n < 20 && occupied(ox + p.items[0].x, oy + p.items[0].y); n++) { ox += GRID * 2; oy += GRID * 2; }

  const made = [];
  commit(() => {
    for (const src of p.items) {
      const copy = { ...src, id: uid() };
      copy.x = clamp(snap(ox + src.x), 0, FLOOR_W - copy.w);
      copy.y = clamp(snap(oy + src.y), 0, FLOOR_H - copy.h);
      if (copy.type === "desk" && desks().some((d) => d.label === copy.label)) copy.label = nextDeskLabel();
      copy.type === "zone" ? state.items.unshift(copy) : state.items.push(copy);
      made.push(copy.id);
    }
    sel = new Set(made);
  });
  toast(`${made.length} pasted`);
}

function nudge(dx, dy) {
  const items = selItems();
  if (!items.length) return;
  const bb = bbox(items);
  dx = clamp(dx, -bb.x, FLOOR_W - (bb.x + bb.w));
  dy = clamp(dy, -bb.y, FLOOR_H - (bb.y + bb.h));
  if (!dx && !dy) return;
  commit(() => items.forEach((i) => { i.x += dx; i.y += dy; }));
}

boot();
