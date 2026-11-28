// script.js — AMD Mart storefront. All data comes from / goes to Firebase via amdmart-db.js
import { auth } from "./firebase.js";
import {
  onUser, register, login, logout, isAdmin, getUser, listenCategories, listenProducts,
  addProduct, getProductImages, markSold, deleteProduct, toggleFavourite, listenFavouriteIds, sendRequest,
  setRequestStatus, listenMyRequests, listenNotifications, markNotificationRead, saveLocationPref, getLocationPref,
  getMyPhone, savePhone, updateMyProfile, changeEmail, syncEmail, checkCoupon, normCoupon,
  googleSignIn, completeGoogleProfile, enablePush, listenPush
} from "./amdmart-db.js?v=10";
import { areaDistance } from "./distances.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICONS = { iot: "cpu", books: "book", "shoes-clothes": "shoe", electronics: "laptop", hostel: "bed", services: "cap", traditional: "hanger", projects: "bag", others: "grid", "hot-deals": "flame" };

/* ---------- category themes (Explore page background) ---------- */
const THEMES = {
  iot:             { c: "#0e8a8f", g: ["#e6f7f7", "#eaf0fb"], tile: "iot" },
  books:           { c: "#a8691a", g: ["#fdf4e1", "#fbece4"], icons: ["book", "tag", "cap"] },
  "shoes-clothes": { c: "#c0457a", g: ["#fdeaf1", "#f6eafd"], icons: ["shoe", "hanger", "tag"] },
  electronics:     { c: "#4453c9", g: ["#e8ebfd", "#e6f3fb"], icons: ["laptop", "cpu", "bell"] },
  hostel:          { c: "#7352b8", g: ["#f1eafd", "#eaf0fd"], icons: ["bed", "home", "heart"] },
  services:        { c: "#2a8a56", g: ["#e5f6ec", "#e8f4fb"], icons: ["cap", "check", "shield", "chat"] },
  traditional:     { c: "#c0561a", g: ["#fdeee0", "#fdeaea"], icons: ["hanger", "palace", "heart"] },
  projects:        { c: "#3567a6", g: ["#e6f0fb", "#eaf6f3"], icons: ["bag", "cpu", "target"] },
  others:          { c: "#5d6b7a", g: ["#eef1f4", "#f1eff9"], icons: ["grid", "tag", "plus"] },
  "hot-deals":     { c: "#d4402f", g: ["#fdebe8", "#fff2dc"], icons: ["flame", "tag", "heart"] }
};
// IoT: chip, Wi-Fi, resistor, LED, battery and circuit traces
const IOT_TILE = `<rect x="14" y="14" width="40" height="40" rx="5"/><rect x="26" y="26" width="16" height="16" rx="2"/>
<path d="M22 14V6M34 14V6M46 14V6M22 54v8M34 54v8M46 54v8M14 22H6M14 34H6M14 46H6M54 22h8M54 34h8M54 46h8"/>
<path d="M62 34h26l10 10h24"/><circle cx="126" cy="44" r="3"/>
<path d="M128 20a16 16 0 0 1 24 0M132 25a10 10 0 0 1 16 0M136 30a4 4 0 0 1 8 0"/><circle cx="140" cy="35" r="1.5"/>
<path d="M34 62v18H20v24"/><circle cx="20" cy="104" r="2.5"/>
<path d="M8 104h20l4-10 8 20 8-20 8 20 8-20 4 10h20h16l2 6h12"/>
<circle cx="130" cy="110" r="12"/><path d="M124 103v14l12-7zM136 103v14M142 110h14M142 94l8-8M148 100l8-8"/>
<rect x="20" y="136" width="38" height="18" rx="3"/><rect x="58" y="141" width="4" height="8"/><path d="M28 145h8M32 141v8M46 145h6"/>
<use href="#i-cpu" x="96" y="128" width="34" height="34"/>
<circle cx="96" cy="74" r="2"/><circle cx="150" cy="74" r="2"/><path d="M96 74h54" stroke-dasharray="3 5"/>`;
const SPOTS = [[8, 10, -14], [78, 22, 10], [40, 66, 6], [108, 70, -10], [12, 112, 12], [80, 110, -6]];
function themeSvg(id) {
  const t = THEMES[id] || THEMES.others, pid = "tp-" + id.replace(/[^a-z0-9]/gi, "");
  const iot = t.tile === "iot", W = iot ? 170 : 150;
  const tile = iot ? IOT_TILE : SPOTS.map(([x, y, r], i) =>
    `<use href="#i-${t.icons[i % t.icons.length]}" x="${x}" y="${y}" width="34" height="34" transform="rotate(${r} ${x + 17} ${y + 17})"/>`).join("")
    + `<circle cx="64" cy="14" r="2"/><circle cx="130" cy="44" r="2"/><circle cx="62" cy="128" r="2"/><circle cx="132" cy="132" r="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><pattern id="${pid}" width="${W}" height="${W}" patternUnits="userSpaceOnUse">` +
    `<g fill="none" stroke="${t.c}" stroke-width="${iot ? 1.4 : 1.2}" stroke-linecap="round" stroke-linejoin="round" opacity=".2">${tile}</g></pattern></defs>` +
    `<rect width="100%" height="100%" fill="url(#${pid})"/></svg>`;
}
let themeShown = "";
function applyTheme() {
  const bg = $("#cat-bg"); if (!bg) return;
  const id = S.view === "explore" ? S.cat : "";
  if (!id) { bg.classList.remove("on"); themeShown = ""; return; }
  if (themeShown === id) { bg.classList.add("on"); return; }
  themeShown = id;
  const t = THEMES[id] || THEMES.others;
  bg.classList.remove("on");
  bg.style.background = `linear-gradient(165deg, ${t.g[0]}, ${t.g[1]})`;
  bg.innerHTML = themeSvg(id);
  void bg.offsetWidth; bg.classList.add("on");
}

/* ---------- full-screen image zoom (pinch / wheel / drag / double-tap, 1:1 = original pixels) ---------- */
let zoomEl = null, zoomHist = false, ignorePop = false;
function closeZoom(viaPop) {
  if (!zoomEl) return;
  zoomEl.remove(); zoomEl = null;
  if (zoomHist) { zoomHist = false; if (!viaPop) { ignorePop = true; try { history.back(); } catch (_) {} } }
}
function openZoom(list, start = 0) {
  if (!list.length || zoomEl) return;
  let i = Math.min(Math.max(start, 0), list.length - 1), s = 1, tx = 0, ty = 0, fit = 1, nw = 1, nh = 1, W = 1, H = 1;
  const box = document.createElement("div"); box.id = "zoom"; zoomEl = box;
  box.innerHTML = `<div class="z-stage"><img class="z-img" alt="" draggable="false"></div>
    <div class="z-bar"><button class="z-b" data-z="close" aria-label="Close">✕</button><span class="z-n"></span><span class="z-pct"></span></div>
    <div class="z-ctl">${list.length > 1 ? '<button data-z="prev" aria-label="Previous">‹</button>' : ""}<button data-z="out" aria-label="Zoom out">−</button><button data-z="one">1:1</button><button data-z="in" aria-label="Zoom in">+</button>${list.length > 1 ? '<button data-z="next" aria-label="Next">›</button>' : ""}</div>`;
  dlgEl.appendChild(box);
  try { history.pushState({ z: 1 }, ""); zoomHist = true; } catch (_) {}
  const stage = box.querySelector(".z-stage"), img = box.querySelector(".z-img");
  const apply = () => {
    const iw = nw * s, ih = nh * s;
    tx = iw <= W ? (W - iw) / 2 : Math.min(0, Math.max(W - iw, tx));
    ty = ih <= H ? (H - ih) / 2 : Math.min(0, Math.max(H - ih, ty));
    img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    box.querySelector(".z-pct").textContent = Math.round(s * 100) + "%";
  };
  const zoomAt = (cx, cy, ns) => {
    ns = Math.min(Math.max(ns, fit), Math.max(4, fit));
    tx = cx - (cx - tx) * (ns / s); ty = cy - (cy - ty) * (ns / s); s = ns; apply();
  };
  const load = () => {
    img.style.width = "auto"; img.style.height = "auto";
    img.onload = () => {
      nw = img.naturalWidth || 1; nh = img.naturalHeight || 1;
      W = stage.clientWidth; H = stage.clientHeight;
      img.style.width = nw + "px"; img.style.height = nh + "px";
      fit = Math.min(1, W / nw, H / nh); s = fit; tx = ty = 0; apply();
    };
    img.src = list[i];
    box.querySelector(".z-n").textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
  };
  const toggle = (cx, cy) => zoomAt(cx, cy, s > fit * 1.05 ? fit : (fit >= 1 ? 2.5 : 1));
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-z]"); if (!b) return;
    const z = b.dataset.z, cx = W / 2, cy = H / 2;
    if (z === "close") closeZoom();
    else if (z === "in") zoomAt(cx, cy, s * 1.4);
    else if (z === "out") zoomAt(cx, cy, s / 1.4);
    else if (z === "one") zoomAt(cx, cy, s === 1 ? fit : 1);
    else if (z === "prev") { i = (i - 1 + list.length) % list.length; load(); }
    else if (z === "next") { i = (i + 1) % list.length; load(); }
  });
  stage.addEventListener("wheel", (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  const pts = new Map(); let pinch = 0, moved = 0, downAt = 0, lastTap = 0;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { moved = 0; downAt = Date.now(); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  stage.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const r = stage.getBoundingClientRect();
    if (pts.size === 1) { tx += e.clientX - p.x; ty += e.clientY - p.y; moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y); p.x = e.clientX; p.y = e.clientY; apply(); }
    else if (pts.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, s * (d / pinch));
      pinch = d; moved = 99;
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const wasOne = pts.size === 1; pts.delete(e.pointerId); pinch = 0;
    if (wasOne && moved < 8 && Date.now() - downAt < 300) {
      const now = Date.now(), r = stage.getBoundingClientRect();
      if (now - lastTap < 320) { toggle(e.clientX - r.left, e.clientY - r.top); lastTap = 0; } else lastTap = now;
    }
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  window.addEventListener("resize", () => { if (zoomEl !== box) return; W = stage.clientWidth; H = stage.clientHeight; fit = Math.min(1, W / nw, H / nh); s = Math.max(s, fit); apply(); });
  load();
}
const ic = (n, c = "") => `<svg class="ic ${c}"><use href="#i-${n}"/></svg>`;
const S = { me: {}, user: null, cats: [], products: [], mine: [], favs: [], reqs: [], notifs: [], cat: "", q: "", view: "home", admin: false, loc: null, loaded: false, loadErr: false, rf: "all" };
let userUnsubs = [];
let detailP = null, detailImgs = [];   // product currently open in the full-screen detail page
let histPushed = false;

function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 2500); }
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message.replace("Firebase: ", "")); } };
// Older iOS Safari (before 15.4) has no <dialog> support: fall back to a plain fixed popup.
const dlgEl = $("#dlg");
if (typeof dlgEl.showModal !== "function") {
  dlgEl.classList.add("dlg-poly");
  dlgEl.showModal = () => dlgEl.setAttribute("open", "");
  dlgEl.close = () => { dlgEl.removeAttribute("open"); dlgEl.dispatchEvent(new Event("close")); };
}
// full = true opens the popup as a full-screen page (used for product details)
function open(html, full = false) { $("#dlg-body").innerHTML = html; dlgEl.classList.toggle("full", full); if (!dlgEl.open) dlgEl.showModal(); }
dlgEl.addEventListener("cancel", (e) => { if (zoomEl) { e.preventDefault(); closeZoom(); } });   // Esc closes the zoom first
dlgEl.addEventListener("close", () => {
  if (zoomEl) { zoomEl.remove(); zoomEl = null; zoomHist = false; }
  dlgEl.classList.remove("full"); detailP = null;
  if (histPushed) { histPushed = false; history.back(); }   // drop the extra history entry we added
});
// phone/browser Back button closes the product page instead of leaving the site
window.addEventListener("popstate", () => { if (ignorePop) { ignorePop = false; return; } if (zoomEl) { closeZoom(true); return; } if (dlgEl.open && dlgEl.classList.contains("full")) { histPushed = false; dlgEl.close(); } });
$("#x").onclick = () => $("#dlg").close();
const need = () => { if (S.user) return true; authDialog(); return false; };

/* ---------- views ---------- */
function show(v) {
  S.view = v;
  document.querySelectorAll(".view").forEach((e) => e.classList.add("hidden"));
  $("#v-" + v).classList.remove("hidden");
  document.querySelectorAll(".nav [data-v], .dnav [data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  $("#wa").classList.toggle("hidden", v !== "profile");   // WhatsApp button only on the Profile page
  $("#ig").classList.toggle("hidden", v !== "profile");   // Instagram button sits beside it
  if (v === "profile") renderProfile();
  scrollTo(0, 0);
  applyTheme();
}

/* ---------- location: 5 km nearby ---------- */
/* LOC-LOGIC:START */
const RADIUS_M = 5000;
// Approximate centre point of each area (not any person's address). Add more areas here any time: ["Name", lat, lng].
const AREAS = [
  ["Vaishnodevi", 23.107, 72.541], ["Chandkheda", 23.106, 72.585], ["Gota", 23.0975, 72.5495],
  ["Vastrapur", 23.0396, 72.5285], ["Navrangpura", 23.0366, 72.5624], ["Satellite", 23.0286, 72.5156],
  ["Bopal", 23.0334, 72.466], ["South Bopal", 23.0245, 72.462], ["Thaltej", 23.0509, 72.5106],
  ["SG Highway", 23.031, 72.507], ["Naranpura", 23.0565, 72.556], ["Maninagar", 22.9968, 72.603],
  ["Bodakdev", 23.04, 72.51], ["Prahlad Nagar", 23.013, 72.509], ["Ambawadi", 23.028, 72.55],
  ["Paldi", 23.0105, 72.56], ["Ellisbridge", 23.0225, 72.56], ["Memnagar", 23.048, 72.537],
  ["Drive In Road", 23.044, 72.53], ["Ghatlodia", 23.067, 72.55], ["Ranip", 23.085, 72.565],
  ["Vadaj", 23.072, 72.56], ["Sabarmati", 23.075, 72.58], ["Shahibaug", 23.054, 72.589],
  ["Sola", 23.078, 72.51], ["Science City", 23.075, 72.49], ["Motera", 23.1, 72.597],
  ["Naroda", 23.068, 72.654], ["Nikol", 23.043, 72.668], ["Vastral", 22.993, 72.656],
  ["Isanpur", 22.977, 72.596], ["Ghuma", 23.003, 72.485], ["Sarkhej", 22.989, 72.493], ["Iscon", 23.0302, 72.5073]
].map(([name, lat, lng]) => ({ name, lat, lng }));
const toRad = (d) => (d * Math.PI) / 180;
function haversine(lat1, lng1, lat2, lng2) { // distance in metres
  const R = 6371000, dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const validCoords = (lat, lng) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
function fmtDist(m) {
  if (m < 100) return "Under 100 m away";
  if (m < 1000) return Math.min(990, Math.round(m / 10) * 10) + " m away";
  return (m / 1000).toFixed(1) + " km away";
}
// Nearby = products posted in the SAME AREA as the user, plus any other product within 5 km (the same distance shown on the card). Same area first, then nearest.
// (Not hidden until admin-verified: Explore shows them too, and the "Verified" badge still marks approved ones.)
const sameName = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
function nearbyProducts(list, loc) {
  if (!loc) return [];
  const hasLoc = validCoords(loc.lat, loc.lng);
  return list
    .filter((p) => p.status !== "sold")
    .map((p) => {
      const same = sameName(p.area || p.location, loc.area);
      const d = hasLoc && validCoords(p.lat, p.lng) ? haversine(loc.lat, loc.lng, p.lat, p.lng) : null;
      const km = areaDistance(loc.area, p.area || p.location);
      return { ...p, _same: same, _d: d, _dd: km != null ? km * 1000 : d };
    })
    .filter((p) => p._same || (p._dd != null && p._dd <= RADIUS_M))
    .sort((a, b) => (b._same - a._same) || ((a._dd ?? 0) - (b._dd ?? 0)));
}
// Approximate distance from the user's chosen area to the product's area (uses the saved table in distances.js)
function distText(p) {
  const to = p.area || p.location;
  if (!S.loc) return "Choose your area to see distance";
  if (sameName(S.loc.area, to)) return "Same area as you";
  const km = areaDistance(S.loc.area, to);
  if (km != null) return `≈ ${km.toFixed(1)} km from ${S.loc.area}`;
  if (validCoords(S.loc.lat, S.loc.lng) && validCoords(p.lat, p.lng))
    return `≈ ${(haversine(S.loc.lat, S.loc.lng, p.lat, p.lng) * 1.3 / 1000).toFixed(1)} km from ${S.loc.area}`;
  return "Distance not available";
}
const condClass = (c) => /^new$/i.test(c) ? "c-new" : /like/i.test(c) ? "c-like" : "c-used";
function nearestArea(lat, lng) {
  let best = null;
  for (const a of AREAS) { const d = haversine(lat, lng, a.lat, a.lng); if (!best || d < best.d) best = { ...a, d }; }
  return best;
}
/* LOC-LOGIC:END */

const LOC_KEY = "amdmart.loc";
function readSaved() {
  try { const l = JSON.parse(localStorage.getItem(LOC_KEY)); return l && l.area && validCoords(l.lat, l.lng) ? l : null; } catch (_) { return null; }
}
const saveLocal = (l) => { try { localStorage.setItem(LOC_KEY, JSON.stringify(l)); } catch (_) {} };
S.loc = readSaved();
let askedForLoc = false;

const renderLoc = () => { $("#loc-name").textContent = S.loc ? S.loc.area : "Select area"; };

async function setLoc(loc, { close = false } = {}) {
  S.loc = loc; saveLocal(loc);
  renderLoc(); renderProducts();
  if (close && $("#dlg").open) $("#dlg").close();
  toast(`Showing deals in and around ${loc.area}`);
  if (S.user) { try { await saveLocationPref(loc); } catch (_) { toast("Saved on this device only"); } }
}
// Runs once the login state is known: account preference wins, else this device's saved choice, else ask.
async function initLocation(u) {
  const local = readSaved();
  let cloud = null;
  if (u) { try { cloud = await getLocationPref(); } catch (_) {} }
  if (cloud && cloud.area && validCoords(cloud.lat, cloud.lng)) { S.loc = cloud; saveLocal(cloud); }
  else if (local) { S.loc = local; if (u) saveLocationPref(local).catch(() => {}); }
  renderLoc(); renderProducts();
  if (!S.loc && !askedForLoc) { askedForLoc = true; locDialog(); }
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej({ message: "This browser can't share your location. Please choose your area from the list." });
    if (!window.isSecureContext) return rej({ message: "Location needs a secure (https) connection. Please choose your area from the list." });
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
}
const geoMsg = (e) => e.code === 1 ? "Location permission was denied. Allow location access in your browser settings, or choose your area from the list below."
  : e.code === 2 ? "Your location isn't available right now. Please choose your area from the list below."
  : e.code === 3 ? "Finding your location took too long. Try again, or choose your area from the list below."
  : e.message || "Couldn't get your location. Please choose your area from the list below.";
async function useGps() {
  const btn = $("#loc-gps"), err = $("#loc-err"), label = btn.innerHTML;
  err.classList.add("hidden"); btn.disabled = true; btn.textContent = "Finding you…";
  try {
    const pos = await getPosition();
    // rounded to ~100 m: enough for a 5 km search, not a home address
    const lat = +pos.coords.latitude.toFixed(3), lng = +pos.coords.longitude.toFixed(3);
    const a = nearestArea(lat, lng);
    if (a.d > 25000) throw { message: "You seem to be outside Ahmedabad. Please choose your area from the list below." };
    await setLoc({ area: a.name, lat, lng, src: "gps" }, { close: true });
  } catch (e) {
    if (!$("#loc-err")) return;
    err.textContent = geoMsg(e); err.classList.remove("hidden");
    btn.disabled = false; btn.innerHTML = label;
  }
}
function drawAreas(q) {
  q = q.trim().toLowerCase();
  const l = AREAS.filter((a) => a.name.toLowerCase().includes(q));
  $("#loc-list").innerHTML = l.map((a) => `<button type="button" class="area ${S.loc && S.loc.src === "manual" && S.loc.area === a.name ? "on" : ""}" data-area="${esc(a.name)}">${ic("pin")}${esc(a.name)}</button>`).join("")
    || '<p class="empty">No matching area.</p>';
}
function locDialog() {
  open(`<h3>${S.loc ? "Change location" : "Choose your area"}</h3>
    ${S.loc ? `<p class="loc-cur">${ic("pin", "o")}<b>${esc(S.loc.area)}</b><small>your area + 5 km</small></p>`
      : '<p class="loc-sub">We show products from your area and within 5 km. No address needed.</p>'}
    <button class="btn full" id="loc-gps">${ic("target")} Use my current location</button>
    <div id="loc-err" class="loc-err hidden" role="alert"></div>
    <div class="or"><span>or select your area</span></div>
    <input id="loc-q" class="loc-q" placeholder="Search area, e.g. Gota" autocomplete="off">
    <div id="loc-list" class="loc-list"></div>`);
  drawAreas("");
  $("#loc-q").oninput = (e) => drawAreas(e.target.value);
}

/* ---------- rendering ---------- */
function filtered() {
  return S.products.filter((p) =>
    (!S.cat || (S.cat === "hot-deals" ? p.originalPrice > p.price : p.category === S.cat)) &&
    (!S.q || (p.title + " " + p.description).toLowerCase().includes(S.q)));
}
function card(p) {
  const img = p.thumb || "";
  return `<div class="card" data-open="${p.id}">
    <div class="imgw"><div class="img" style="background-image:url('${esc(img)}')"></div>
    ${p.status === "sold" ? '<div class="sold">SOLD</div>' : ""}
    ${p.verified ? '<span class="ver">Verified</span>' : ""}
    <button class="heart ${S.favs.includes(p.id) ? "on" : ""}" data-fav="${p.id}" aria-label="Favourite">${ic("heart")}</button></div>
    <div class="info"><div class="t">${esc(p.title)}</div>
    <div class="price">₹${Number(p.price).toLocaleString("en-IN")}${p.originalPrice > p.price ? `<s>₹${Number(p.originalPrice).toLocaleString("en-IN")}</s>` : ""}</div>
    <div class="loc">${ic("pin")}<span class="lt">${esc(p.area || p.location || "Ahmedabad")}</span>${(p._dd ?? p._d) != null ? `<span class="dist">${(p._dd ?? p._d) === 0 ? "Same area" : "≈ " + fmtDist(p._dd ?? p._d)}</span>` : ""}</div>
    ${p.status === "sold" || (S.user && S.user.uid === p.sellerId) ? "" : `<button type="button" class="btn sm card-cart" data-addcart="${p.id}">${cart.some((x) => x.id === p.id) ? "Added ✓" : "Add to Cart"}</button>`}</div></div>`;
}
function renderCats() {
  applyTheme();
  $("#cats").innerHTML = S.cats.map((c) => `<button class="cat" data-cat="${c.id}"><i>${ic(ICONS[c.id] || "tag")}</i>${esc(c.name)}</button>`).join("");
  $("#chips").innerHTML = `<button class="chip ${!S.cat ? "on" : ""}" data-chip="">All</button>` +
    S.cats.map((c) => `<button class="chip ${S.cat === c.id ? "on" : ""}" data-chip="${c.id}">${esc(c.name)}</button>`).join("");
}
function renderNearby() {
  const el = $("#nearby");
  if (S.loadErr) { el.innerHTML = '<div class="empty"><p>Couldn\'t load products. Check your connection.</p><div class="act"><button class="btn sm" data-retry>Try again</button></div></div>'; return; }
  if (!S.loc) { el.innerHTML = '<div class="empty"><p>Select your area to see deals near you.</p><div class="act"><button class="btn sm" data-loc>Choose area</button></div></div>'; return; }
  if (!S.loaded) { el.innerHTML = '<p class="empty">Loading nearby deals…</p>'; return; }
  const n = nearbyProducts(S.products, S.loc);
  el.innerHTML = n.map(card).join("") ||
    '<div class="empty"><p>No products found in your area yet.</p><div class="act"><button class="btn sm" data-loc>Explore other areas</button><button class="btn sm ghost" data-v="explore">View all products</button></div></div>';
}
function renderProducts() {
  renderNearby();
  const f = filtered();
  $("#grid").innerHTML = f.map(card).join("") || '<p class="empty">No products found.</p>';
}
// Buying requests go to the admin only (the seller just gets a heads-up notification). One live step: admin review.
const ADMIN_ST = { pending: ["Waiting for admin", "wait"], approved: ["Admin verified", "ok"], rejected: ["Admin rejected", "no"] };
function tracker(r) {
  const a = r.adminStatus || "pending", cancelled = r.status === "cancelled";
  const [txt, cls] = cancelled ? ["Cancelled by you", "no"] : (ADMIN_ST[a] || ADMIN_ST.pending);
  const closed = cancelled || a === "rejected", ok = !closed && a === "approved";
  const msg = closed ? "This request is closed." : ok ? "Admin verified your request. AMD Mart will contact you on WhatsApp with the next steps."
    : "Admin will review your request and contact you on WhatsApp.";
  return `<div class="trk" style="grid-template-columns:1fr"><div class="trk-s ${cls}"><i></i><div><small>Admin</small><b>${txt}</b></div></div></div><p class="trk-m ${ok ? "ok" : closed ? "no" : ""}">${msg}</p>`;
}
// My open request for a product (cancelled or admin-rejected ones don't count), so I can't request the same product again.
const activeReq = (pid) => S.user ? S.reqs.find((r) => r.buyerId === S.user.uid && r.productId === pid && r.status !== "cancelled" && r.adminStatus !== "rejected") : null;
const myReqHtml = (r) => `<b>Your request</b>${r.couponCode ? `<div class="hint" style="margin-top:4px">Coupon ${esc(r.couponCode)} applied · price ₹${Number(r.finalPrice).toLocaleString("en-IN")}</div>` : ""}${tracker(r)}`;
function renderRequests() {
  $("#req-tabs").innerHTML = "";   // no filters: this tab only lists requests for my own products
  if (!S.user) { $("#reqs").innerHTML = '<p class="empty">Log in to see requests for your products.</p>'; return; }
  const mine = S.reqs.filter((r) => r.sellerId === S.user.uid).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  $("#reqs").innerHTML = mine.map((r) => `<div class="row"><b>${esc(r.productTitle)}</b>
    <div>${r.status === "cancelled" ? "This request was cancelled." : "Someone wants to buy this product. AMD Mart will contact you on WhatsApp."}</div></div>`).join("")
    || '<p class="empty">No one has requested your products yet.</p>';
}
function renderProfile() {
  if (!S.user) {
    $("#profile").innerHTML = '<div class="row" style="text-align:center;margin-top:20px"><h3>Welcome to AMD Mart</h3><p style="margin:8px 0 14px">Log in to sell, save favourites and send requests.</p><button class="btn full" id="p-login">Login / Sign up</button></div>';
    return;
  }
  const favs = S.products.filter((p) => S.favs.includes(p.id));
  $("#profile").innerHTML = `<div class="row" style="margin-top:12px"><h3>${esc(S.user.displayName || "Student")}</h3>
    <div class="pf"><small>${esc(S.user.email)}</small>
    <small>${S.me.phone ? "Phone: " + esc(S.me.phone) : "Phone: not added yet"}</small>
    ${S.me.college ? `<small>${esc(S.me.college)}</small>` : ""}</div>
    <div class="act"><button class="btn sm" id="p-edit">Edit profile</button>${S.admin ? '<a class="btn sm ghost" href="admin/admin.html">Admin Panel</a>' : ""}<button class="btn sm ghost" id="p-logout">Logout</button></div></div>
    <h3 class="pad">My Listings</h3><div class="grid">${S.mine.map(card).join("") || '<p class="empty">Nothing listed yet.</p>'}</div>
    <h3 class="pad">Favourites</h3><div class="grid">${favs.map(card).join("") || '<p class="empty">No favourites yet.</p>'}</div>`;
}
// Requests for MY products that are still waiting for the admin ("pending")
const pendingReqs = () => S.user ? S.reqs.filter((r) => r.sellerId === S.user.uid && r.status !== "cancelled" && (r.adminStatus || "pending") === "pending") : [];
// Bell badge: a number (pending requests + unread notifications), hidden when 0
function renderBell() {
  const n = pendingReqs().length + S.notifs.filter((x) => !x.read).length, el = $("#dot");
  el.textContent = n > 99 ? "99+" : String(n);
  el.classList.toggle("hidden", !n);
}
// Number badge on the heart: counts only liked products that still exist (deleted / sold ones no longer count),
// so it always matches what the Liked Products list shows. Hidden when the number is 0.
function renderFavBtn() {
  const n = S.user ? favItems().length : 0, el = $("#fav-count");
  el.textContent = n > 99 ? "99+" : String(n);
  el.classList.toggle("hidden", !n);
}
const favItems = () => S.products.filter((p) => S.favs.includes(p.id));
const favListHtml = () => favItems().map(card).join("") || '<p class="empty">No liked products yet. Tap the heart on any product to save it here.</p>';
const renderAll = () => {
  renderCats(); renderProducts(); renderRequests(); if (S.view === "profile") renderProfile(); renderBell(); renderFavBtn(); pruneCart();
  const fl = $("#fav-list"); if (fl && $("#dlg").open) fl.innerHTML = favListHtml(); // keep open popup in sync
  const ml = $("#more-list"); if (ml && detailP && $("#dlg").open) ml.innerHTML = moreHtml(detailP);
  // product page open: keep my request status live, and swap the form / status when it changes (e.g. after cancelling)
  if (detailP && $("#dlg").open && S.user && S.user.uid !== detailP.sellerId) {
    const r = activeReq(detailP.id), box = $("#my-req");
    if (box && r) box.innerHTML = myReqHtml(r);
    else if ((box && !r) || ($("#add-cart") && r && !box)) detail(detailP.id);
  }
};

/* ---------- dialogs ---------- */
const G_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
let gProfilePending = false;   // true while a new Google user still has to add phone + college
// After a successful login: a short (2 second) "logging you in" animation, then close.
async function loginDone() {
  const ov = publishOverlay("Logging you in…", 2);
  await sleep(2000);
  ov.remove(); $("#dlg").close(); toast("Welcome to AMD Mart!"); askPush();
}
function authDialog(mode = "login") {
  const reg = mode === "register";
  // Create account = Google only (no email typing). Login = Google or email + password.
  open(`<h3>${reg ? "Create account" : "Login"}</h3>
    <button type="button" class="gbtn" id="g-btn">${G_LOGO}Continue with Google</button>
    ${reg ? '<p class="hint" style="margin:10px 0 0;text-align:center">Pick your Google email. In the next step you just make a password and add your name, mobile number and college.</p>' : `
    <div class="or"><span>or login with email</span></div>
    <form id="auth-f">
    <input name="email" type="email" placeholder="Email" required><input name="password" type="password" minlength="6" placeholder="Password (min 6)" required>
    <button class="btn">Login</button></form>`}
    <p style="margin-top:12px;font-size:14px">${reg ? "Have an account?" : "New here?"} <a href="#" id="sw" style="color:var(--o)">${reg ? "Login" : "Sign up"}</a></p>
    ${reg ? "" : '<div class="auth-note"><b>Forgot your password?</b> No problem at all. Tap “Continue with Google” above and sign in again with the same email.</div>'}`);
  $("#sw").onclick = (e) => { e.preventDefault(); authDialog(reg ? "login" : "register"); };
  // The Google window must open straight from the tap, so nothing is awaited before googleSignIn().
  $("#g-btn").onclick = safe(async () => {
    $("#g-btn").disabled = true;
    try {
      const r = await googleSignIn();
      if (r.needsProfile) googleProfileDialog(r.user);
      else await loginDone();
    } finally { $("#g-btn")?.removeAttribute("disabled"); }
  });
  if (!reg) $("#auth-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await login(d.email, d.password);
    await loginDone();
  });
}
// Step 2 of Google sign-up: password, name, mobile number and college (all required). The email comes from Google.
// Closing this popup without finishing signs the person out again, so no account is left half-made.
function googleProfileDialog(user) {
  gProfilePending = true;
  open(`<h3>Almost done</h3>
    <p class="loc-sub">Signed in as <b>${esc(user.email || "your Google account")}</b>. Fill these to finish. All are required.</p>
    <form id="gp-f">
      <input name="password" type="password" minlength="6" autocomplete="new-password" placeholder="Make a password (min 6)" required>
      <input name="name" value="${esc(user.displayName || "")}" maxlength="60" autocomplete="name" placeholder="Full name" required>
      <input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="Mobile number" pattern="[0-9+ ]{10,15}" title="Enter a valid 10-digit mobile number" required>
      <input name="college" placeholder="College (e.g. LD College)" maxlength="80" required>
      <button class="btn" id="gp-btn">Finish sign up</button>
    </form>`);
  $("#gp-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    $("#gp-btn").disabled = true;
    try {
      const r = await completeGoogleProfile(d);
      S.me = { phone: r.phone, college: r.college };
      gProfilePending = false;
      $("#dlg").close(); toast("Welcome to AMD Mart!"); renderAll(); askPush();
    } finally { $("#gp-btn")?.removeAttribute("disabled"); }
  });
}
dlgEl.addEventListener("close", () => {
  if (!gProfilePending) return;
  gProfilePending = false;
  logout().catch(() => {});
  toast("Sign up wasn't finished. Please sign in with Google again.");
});
async function loadMe() {
  const u = S.user; if (!u) return;
  try {
    const [phone, prof] = await Promise.all([getMyPhone(), getUser(u.uid)]);
    if (S.user !== u) return;   // logged out / switched while loading
    S.me = { phone, college: prof?.college || "" };
  } catch (_) {}
  if (S.view === "profile") renderProfile();
}
function editDialog() {
  if (!need()) return;
  open(`<h3>Edit profile</h3>
    <form id="ep-f">
      <label class="fl">Full name</label><input name="name" value="${esc(S.user.displayName || "")}" maxlength="60" required>
      <label class="fl">Mobile number</label><input name="phone" type="tel" inputmode="numeric" value="${esc(S.me.phone || "")}" placeholder="10-digit mobile number" required>
      <label class="fl">College (optional)</label><input name="college" value="${esc(S.me.college || "")}" maxlength="80" placeholder="e.g. LD College">
      <button class="btn" id="ep-btn">Save changes</button>
    </form>
    <div class="sep"></div>
    <h4>Change email</h4>
    <p class="loc-sub">Current: ${esc(S.user.email)}. We email a verification link to the new address; it changes once you open it.</p>
    <form id="em-f">
      <input name="email" type="email" placeholder="New email" required>
      <input name="pw" type="password" placeholder="Current password" autocomplete="current-password" required>
      <button class="btn ghost" id="em-btn">Send verification link</button>
    </form>`);
  $("#ep-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    $("#ep-btn").disabled = true;
    try {
      const r = await updateMyProfile(d);
      S.me = { phone: r.phone, college: r.college };
      $("#dlg").close(); toast("Profile updated"); renderAll();
    } finally { $("#ep-btn")?.removeAttribute("disabled"); }
  });
  $("#em-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    $("#em-btn").disabled = true;
    try {
      await changeEmail(d.email, d.pw);
      $("#dlg").close(); toast("Verification link sent. Open it to finish the change.");
    } finally { $("#em-btn")?.removeAttribute("disabled"); }
  });
}
// Older accounts may have no number saved: ask for it before they post or send a request.
function phoneDialog(onDone) {
  open(`<h3>Add your mobile number</h3><p class="loc-sub">Required so AMD Mart can contact you about buying and selling.</p>
    <form id="ph-f"><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="10-digit mobile number" required>
    <button class="btn">Save &amp; continue</button></form>`);
  $("#ph-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    S.me = { ...S.me, phone: await savePhone(e.target.phone.value) };
    $("#dlg").close(); toast("Number saved");
    if (onDone) onDone();
  });
}
const CLOTH_CATS = ["shoes-clothes", "traditional"];   // categories that ask for male/female + size
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let LOGO_URL = "https://i.ibb.co/Wp2hbzVr/71232172-DA72-42-D3-B817-511-E00-B931-F1.jpg";
async function postDialog() {
  if (!need()) return;
  if (!(await getMyPhone())) return phoneDialog(postDialog);
  const cats = S.cats.filter((c) => c.id !== "hot-deals");
  if (!cats.length) return toast("No categories yet — ask admin to set them up.");
  open(`<div class="sell-h"><button class="sell-back" id="sell-back" type="button" aria-label="Back">${ic("back")}</button><h2>Sell product</h2></div>
    <form id="post-f" class="sell-f">
    <label>Title<input name="title" placeholder="e.g. Engineering Mathematics book" maxlength="100" required></label>
    <label>Category<select name="category">${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
    <div id="cloth-box" class="cloth hidden">
      <b>For whom?</b>
      <div class="pills"><label><input type="radio" name="gender" value="Male"><span>Male</span></label><label><input type="radio" name="gender" value="Female"><span>Female</span></label></div>
      <b>Size</b>
      <div class="pills">${SIZES.map((z) => `<label><input type="radio" name="size" value="${z}"><span>${z}</span></label>`).join("")}</div>
    </div>
    <label>Price (₹)<input name="price" type="number" min="0" placeholder="Your price" required></label>
    <label>Original price (₹, optional)<input name="originalPrice" type="number" min="0" placeholder="MRP / new price"></label>
    <label>Condition<select name="condition"><option>Used</option><option>Like New</option><option>New</option></select></label>
    <div class="cloth">
      <b>Your current location <small style="font-weight:400">(required)</small></b>
      <button type="button" class="btn ghost" id="sell-loc">Share my current location</button>
      <small class="hint" id="sell-loc-m">Stand where the product is kept. Buyers only see an approximate area and distance, never your exact address.</small>
    </div>
    <label>Pickup area<select name="area" required><option value="">Pickup area (approximate)</option>${AREAS.map((a) => `<option ${S.loc && S.loc.area === a.name ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
    <small class="hint">Buyers only see this area, never your exact address.</small>
    <label>Description<textarea name="description" rows="4" placeholder="Describe your product" maxlength="2000"></textarea></label>
    <label>Photos (up to 3)<input name="images" type="file" accept="image/*" multiple></label>
    <button class="btn" id="post-btn">Publish</button></form>`, true);
  dlgEl.scrollTop = 0;
  if (!histPushed) { try { history.pushState({ d: 1 }, ""); histPushed = true; } catch (_) {} }
  $("#sell-back").onclick = () => dlgEl.close();
  const f = $("#post-f");
  const syncCloth = () => {
    const on = CLOTH_CATS.includes(f.category.value);
    $("#cloth-box").classList.toggle("hidden", !on);
    if (!on) f.querySelectorAll("#cloth-box input").forEach((i) => (i.checked = false));
  };
  f.category.onchange = syncCloth; syncCloth();
  // Seller shares their current location (compulsory). Saved rounded to about 1 km so the exact spot stays private;
  // buyers' delivery distance is worked out from it.
  let sellLoc = null;
  const locBtn = $("#sell-loc"), locMsg = $("#sell-loc-m");
  locBtn.onclick = () => {
    if (!navigator.geolocation) return toast("Location isn't available on this device or browser.");
    locBtn.disabled = true; locBtn.textContent = "Getting your location…";
    navigator.geolocation.getCurrentPosition((pos) => {
      sellLoc = { lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 };
      let best = null, bd = Infinity;
      for (const a of AREAS) { const d = haversine(pos.coords.latitude, pos.coords.longitude, a.lat, a.lng); if (d < bd) { bd = d; best = a; } }
      if (best) f.area.value = best.name;   // nearest known area (you can still change it)
      locBtn.disabled = false; locBtn.textContent = "Location shared ✓ (tap to update)";
      locMsg.textContent = best ? `Nearest area: ${best.name}. Change it below if it is wrong.` : "Location saved.";
    }, () => {
      locBtn.disabled = false; locBtn.textContent = "Share my current location";
      toast("Please allow location access (browser settings) to sell a product.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  f.onsubmit = safe(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const ar = AREAS.find((x) => x.name === d.area);
    if (!ar) throw new Error("Please choose a pickup area.");
    if (CLOTH_CATS.includes(d.category) && !d.gender) throw new Error("Please choose Male or Female.");
    if (!CLOTH_CATS.includes(d.category)) { delete d.gender; delete d.size; }
    if (!sellLoc) throw new Error("Please share your current location first.");
    d.lat = sellLoc.lat; d.lng = sellLoc.lng;
    d.sellerPrice = Number(d.price);   // seller's own price, kept for admin reports
    $("#post-btn").disabled = true;
    const ov = publishOverlay();
    try {
      await Promise.all([addProduct(d, [...f.images.files]), sleep(3200)]);   // show the animation for at least ~3 seconds
    } catch (err) { ov.remove(); $("#post-btn")?.removeAttribute("disabled"); throw err; }
    ov.classList.add("done"); ov.querySelector("p").textContent = "Your product is live!";
    await sleep(1300);
    ov.remove(); dlgEl.close(); toast("Product published!");
  });
}
// Full-screen "publishing" animation with the AMD Mart logo (lives inside the dialog so it sits above it)
function publishOverlay(text = "Publishing your product…", secs = 3.2) {
  const ov = document.createElement("div");
  ov.className = "pub-ov";
  ov.innerHTML = `<div class="pub-c"><div class="pub-ring"></div><img src="${LOGO_URL}" alt="AMD Mart"><svg class="pub-ok" viewBox="0 0 52 52"><path d="M14 27l8 8 16-17"/></svg></div>
    <h4>AMD <span>Mart</span></h4><p>${text}</p><div class="pub-bar"><i style="animation-duration:${secs}s"></i></div>`;
  dlgEl.appendChild(ov);
  return ov;
}
/* ---------- shopping cart (saved in this phone's browser, so it survives a refresh) ---------- */
const ORDER_WA = "918849110467";   // AMD Mart WhatsApp number that receives order requests
let cart = (() => {
  try { const a = JSON.parse(localStorage.getItem("amd_cart") || "[]"); return Array.isArray(a) ? a.filter((x) => x && typeof x.id === "string" && x.qty > 0).map((x) => ({ id: x.id, qty: 1 })) : []; }
  catch (_) { return []; }
})();
// What the buyer has chosen on the cart page (kept while the page is redrawn)
const C = { promo: null, promoText: "", note: "", lat: null, lng: null, house: "", building: "", area: "", ship: "" };
const rs = (n) => "₹" + Number(n).toLocaleString("en-IN");
const prodOf = (id) => S.products.find((p) => p.id === id);
const cartCount = () => cart.reduce((n, x) => n + x.qty, 0);
function renderCartFab() {
  const b = $("#cartfab"); if (!b) return;
  const n = cartCount();
  b.classList.toggle("hidden", n === 0);
  $("#cart-count").textContent = n > 99 ? "99+" : String(n);
  const nb = $("#nav-cart-n"); if (nb) { nb.textContent = n > 99 ? "99+" : String(n); nb.classList.toggle("hidden", n === 0); }
}
function saveCart() {
  try { localStorage.setItem("amd_cart", JSON.stringify(cart)); } catch (_) {}
  renderCartFab();
  document.querySelectorAll("[data-addcart]").forEach((b) => { b.textContent = cart.some((x) => x.id === b.dataset.addcart) ? "Added ✓" : "Add to Cart"; });
}
function addToCart(id) {
  if (cart.some((x) => x.id === id)) return false;   // one of each product only
  cart.push({ id, qty: 1 });
  C.promo = null; saveCart(); return true;
}
// Drop products that were deleted or sold since they were added
function pruneCart() {
  let redraw = false;
  if (S.loaded) {
    const n = cart.length;
    cart = cart.filter((x) => { const p = prodOf(x.id); return p && p.status !== "sold"; });
    if (cart.length !== n) { C.promo = null; saveCart(); redraw = true; }
    if ($("#cart-pg") && $("#cart-pg").textContent.includes("Loading your cart")) redraw = true;
  }
  renderCartFab();
  if (redraw && $("#cart-pg")) drawCart();   // only when something changed, so typing is never interrupted
}
const cartLines = () => cart.map((x) => ({ ...x, p: prodOf(x.id) })).filter((l) => l.p);
const cartTotal = (lines) => lines.reduce((t, l) => t + Number(l.p.price) * l.qty, 0);

/* delivery: free pickup, or Uber Parcel booked by AMD Mart */
// 1-4 km: minimum ₹50.  Over 4 km: ₹10.50 per km, rounded to the nearest rupee (never below ₹50).
const deliveryFee = (km) => (km <= 4 ? 50 : Math.max(50, Math.round(10.5 * km + 1e-9)));
function sellerPoint(p) {
  if (validCoords(p.lat, p.lng)) return { lat: p.lat, lng: p.lng };
  const a = AREAS.find((x) => x.name === (p.area || p.location));
  return a ? { lat: a.lat, lng: a.lng } : null;
}
function buyerPoint() { return C.lat != null ? { lat: C.lat, lng: C.lng } : null; }
const locOk = () => C.lat != null;   // live location is compulsory
// One Uber Parcel ride per seller, so the fee is worked out per seller and added up.
function deliveryCalc(lines) {
  const bp = buyerPoint();
  if (!bp) return { ok: false, why: "buyer" };
  const by = new Map();
  for (const l of lines) {
    const sp = sellerPoint(l.p);
    if (!sp) return { ok: false, why: "seller" };
    if (!by.has(l.p.sellerId)) by.set(l.p.sellerId, { sp, area: l.p.area || l.p.location || "seller" });
  }
  const rows = [...by.values()].map((s) => { const km = Math.round(haversine(s.sp.lat, s.sp.lng, bp.lat, bp.lng) / 100) / 10; return { area: s.area, km, fee: deliveryFee(km) }; });
  return { ok: true, rows, total: rows.reduce((t, r) => t + r.fee, 0) };
}
function cartMoney(lines) {
  const total = cartTotal(lines), disc = C.promo ? C.promo.discount : 0, after = total - disc;
  const del = locOk() ? deliveryCalc(lines) : null;
  const fee = C.ship === "home" && del && del.ok ? del.total : 0;
  return { total, disc, after, del, fee, final: after + fee };
}
const mapsLink = () => `https://www.google.com/maps?q=${C.lat},${C.lng}`;

function shipHtml(lines, m) {
  if (!locOk()) return '<p class="hint">Share your location above to see the delivery options.</p>';
  const d = m.del;
  const homeTxt = d.ok
    ? `${rs(d.total)}${d.rows.length > 1 ? `<small>${d.rows.map((r) => `${esc(r.area)} ≈ ${r.km} km · ${rs(r.fee)}`).join("<br>")}</small>` : `<small>≈ ${d.rows[0].km} km from the seller</small>`}`
    : `<small>${d.why === "seller" ? "Seller location is missing, so the fee can't be worked out. Choose free pickup." : "Share your location to see the fee."}</small>`;
  return `<h4>Delivery option</h4>
    <label class="opt ${C.ship === "pickup" ? "on" : ""}"><input type="radio" name="ship" data-ship="pickup" ${C.ship === "pickup" ? "checked" : ""}><span><b>Free Pickup from Seller</b><em>₹0</em><small>You collect the product directly from the seller.</small></span></label>
    <label class="opt ${C.ship === "home" ? "on" : ""} ${d.ok ? "" : "off"}"><input type="radio" name="ship" data-ship="home" ${C.ship === "home" ? "checked" : ""} ${d.ok ? "" : "disabled"}><span><b>Home Delivery via Uber Parcel</b><em>${d.ok ? rs(d.total) : ""}</em>${d.ok ? homeTxt.replace(rs(d.total), "") : homeTxt}</span></label>
    ${C.ship === "home" ? '<p class="hint">Uber Parcel will be booked manually by AMD Mart after order confirmation. Delivery charges may be confirmed before dispatch.</p>' : ""}`;
}
function sumHtml(m) {
  return `<div class="sr"><span>Product total</span><b>${rs(m.total)}</b></div>
    ${C.promo ? `<div class="sr ok"><span>Promo discount (${esc(C.promo.code)})</span><b>− ${rs(m.disc)}</b></div><div class="sr"><span>Amount after discount</span><b>${rs(m.after)}</b></div>` : ""}
    ${C.ship === "home" && m.del && m.del.ok ? `<div class="sr"><span>Delivery (Uber Parcel)</span><b>${rs(m.fee)}</b></div>` : C.ship === "pickup" ? '<div class="sr"><span>Delivery (free pickup)</span><b>₹0</b></div>' : ""}
    <div class="sr fin"><span>Final payable</span><b>${rs(m.final)}</b></div>`;
}
// Shows "about X km from the seller" under each product once the buyer's location is known
function fillDist() {
  const bp = buyerPoint();
  document.querySelectorAll("[data-dist]").forEach((el) => {
    const p = prodOf(el.dataset.dist), sp = p && sellerPoint(p);
    el.textContent = bp && sp ? `Approx. ${(Math.round(haversine(sp.lat, sp.lng, bp.lat, bp.lng) / 100) / 10).toFixed(1)} km from seller (${p.area || p.location || "seller area"})` : "";
  });
}
function refreshShip() {
  fillDist();
  const lines = cartLines(), m = cartMoney(lines);
  if (C.ship === "home" && !(m.del && m.del.ok)) C.ship = "";
  if (!locOk()) C.ship = "";
  const sb = $("#ship-box"), su = $("#sum-box");
  if (sb) sb.innerHTML = shipHtml(lines, m);
  if (su) su.innerHTML = sumHtml(m);
}
function drawCart() {
  const lines = cartLines(), body = $("#dlg-body");
  if (!body) return;
  const st = dlgEl.scrollTop, m = cartMoney(lines);
  let inner;
  if (!cart.length) inner = '<div class="empty"><p>Your cart is empty.</p><div class="act"><button class="btn sm" id="cart-shop" type="button">Browse products</button></div></div>';
  else if (!lines.length) inner = '<p class="empty">Loading your cart…</p>';
  else inner = `
    <div class="cbox">${lines.map((l) => `<div class="ci"><img src="${esc(l.p.thumb || "")}" alt="${esc(l.p.title)}"><div class="ci-b"><b>${esc(l.p.title)}</b><span>${rs(l.p.price)}</span><small class="ci-d" data-dist="${esc(l.id)}"></small></div>
      <button type="button" class="ci-x" data-crm="${esc(l.id)}">Remove</button></div>`).join("")}
      <div class="sr fin"><span>Total product amount</span><b>${rs(m.total)}</b></div></div>
    <div class="cbox"><h4>Promo code</h4>
      <div class="cpn"><input id="c-promo" value="${esc(C.promo ? C.promo.code : C.promoText)}" placeholder="Enter promo code" autocomplete="off" autocapitalize="characters" maxlength="20" ${C.promo ? "readonly" : ""}>
      ${C.promo ? '<button type="button" class="btn ghost sm" id="promo-x">Remove</button>' : '<button type="button" class="btn ghost sm" id="promo-v">Verify Promo Code</button>'}</div>
      ${C.promo ? `<small class="cpn-m ok">Promo applied. You save ${rs(C.promo.discount)}.</small>` : ""}</div>
    <div class="cbox"><h4>Order instructions <small>(optional)</small></h4><textarea id="c-note" rows="3" maxlength="500" placeholder="Anything the admin should know about this order">${esc(C.note)}</textarea></div>
    <div class="cbox"><h4>Your location <small>(required)</small></h4>
      <button type="button" class="btn ${C.lat != null ? "ghost" : ""}" id="loc-live">${C.lat != null ? "Location shared ✓ (tap to update)" : "Share my location"}</button>
      ${C.lat != null ? '<small class="cpn-m ok">Location saved. It is sent only to AMD Mart on WhatsApp.</small>' : '<small class="cpn-m no">You must share your location to place an order.</small>'}</div>
    <div class="cbox" id="ship-box">${shipHtml(lines, m)}</div>
    <div class="cbox" id="sum-box">${sumHtml(m)}</div>
    <button class="btn" id="place-order" type="button">Place Order on WhatsApp</button>
    <p class="hint" style="text-align:center">This sends an order request only. AMD Mart confirms availability and payment with you on WhatsApp.</p>`;
  body.innerHTML = `<div class="sell-h"><button class="sell-back" id="cart-back" type="button" aria-label="Back">${ic("back")}</button><h2>My Cart</h2></div><div class="cart-pg" id="cart-pg">${inner}</div>`;
  dlgEl.scrollTop = st; fillDist();
  const back = $("#cart-back"); if (back) back.onclick = () => dlgEl.close();
  const root = $("#cart-pg");
  root.onclick = safe(cartClick);
  root.oninput = (e) => {
    const t = e.target;
    if (t.id === "c-note") C.note = t.value;
    else if (t.id === "c-promo") C.promoText = t.value;
  };
  root.onchange = (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.ship) { C.ship = t.dataset.ship; refreshShip(); }
  };
}
function cartPage() {
  open("", true);
  dlgEl.scrollTop = 0;
  if (!histPushed) { try { history.pushState({ d: 1 }, ""); histPushed = true; } catch (_) {} }
  drawCart();
}
async function cartClick(e) {
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "cart-shop") { dlgEl.close(); show("explore"); return; }
  if (t.dataset.crm) { cart = cart.filter((x) => x.id !== t.dataset.crm); C.promo = null; saveCart(); drawCart(); return; }
  if (t.id === "promo-x") { C.promo = null; C.promoText = ""; drawCart(); return; }
  if (t.id === "promo-v") {
    if (!need()) return;
    const raw = $("#c-promo").value; C.promoText = raw;
    if (!raw.trim()) return toast("Enter a promo code first.");
    const code = normCoupon(raw);
    if (S.reqs.some((r) => r.buyerId === S.user.uid && r.couponCode === code)) return toast("You have reached the maximum use limit of this coupon.");
    t.disabled = true; t.textContent = "Checking…";
    try { C.promo = await checkCoupon(raw, cartTotal(cartLines())); C.promoText = C.promo.code; drawCart(); }
    catch (err) { t.disabled = false; t.textContent = "Verify Promo Code"; throw err; }
    return;
  }
  if (t.id === "loc-live") {
    if (!navigator.geolocation) return toast("Live location isn't available on this device or browser.");
    t.disabled = true; t.textContent = "Getting your location…";
    navigator.geolocation.getCurrentPosition(
      (pos) => { C.lat = pos.coords.latitude; C.lng = pos.coords.longitude; drawCart(); },
      () => { toast("Please allow location access (browser settings) to place an order."); drawCart(); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    return;
  }
  if (t.id === "place-order") placeOrder();
}
// Opens WhatsApp with the order written out. Nothing is saved or confirmed here: it is only a request.
function placeOrder() {
  const lines = cartLines();
  if (!lines.length) return toast("Your cart is empty.");
  if (!locOk()) return toast("Please share your location to place an order.");
  const m = cartMoney(lines);
  if (!C.ship) return toast("Please choose a delivery option.");
  if (C.ship === "home" && !(m.del && m.del.ok)) return toast("Delivery fee can't be worked out. Choose free pickup or fix your location.");
  const name = (S.user && (S.me.name || S.user.displayName)) || "", phone = (S.me && S.me.phone) || "";
  const L = [];
  L.push("AMD MART - NEW ORDER REQUEST", "");
  if (name) L.push("Customer: " + name);
  if (phone) L.push("Phone: " + phone);
  if (name || phone) L.push("");
  L.push("Products:");
  lines.forEach((l, i) => L.push(`${i + 1}. ${l.p.title} × ${l.qty} @ ${rs(l.p.price)} = ${rs(Number(l.p.price) * l.qty)} (Seller area: ${l.p.area || l.p.location || "Ahmedabad"})`));
  L.push("", "Product Total: " + rs(m.total));
  if (C.promo) L.push("Promo Code: " + C.promo.code, "Promo Discount: " + rs(m.disc), "Amount after Discount: " + rs(m.after));
  if (C.ship === "home") L.push("Delivery: Home Delivery via Uber Parcel - " + rs(m.fee) + (m.del.rows.length === 1 ? ` (about ${m.del.rows[0].km} km)` : ` (${m.del.rows.length} pickups)`));
  else L.push("Delivery: Free Pickup from Seller - ₹0");
  L.push("", "Final Total: " + rs(m.final), "");
  if (C.lat != null) L.push("Customer Location: " + mapsLink());
  L.push("Order Instructions: " + (C.note.trim() || "None"), "", "Please confirm my order.");
  const url = `https://wa.me/${ORDER_WA}?text=${encodeURIComponent(L.join("\n"))}`;
  const w = window.open(url, "_blank");
  if (!w) location.href = url;
  toast("Opening WhatsApp. Your order is not confirmed until AMD Mart replies.");
}
const catName = (id) => (S.cats.find((c) => c.id === id) || {}).name || "this category";
function moreHtml(p) {
  const list = S.products.filter((x) => x.id !== p.id && x.category === p.category && x.status !== "sold").slice(0, 8);
  return list.map(card).join("") || '<p class="empty">No other items in this category yet.</p>';
}
const slides = (imgs) => (imgs.length ? imgs : [""]).map((u) => `<div class="slide" style="background-image:url('${esc(u)}')"></div>`).join("");
const dots = (n) => n > 1 ? Array.from({ length: n }, (_, i) => `<i class="${i ? "" : "on"}" data-g="${i}"></i>`).join("") : "";

async function detail(id) {
  const p = S.products.find((x) => x.id === id) || S.mine.find((x) => x.id === id);
  if (!p) return;
  detailP = p; detailImgs = p.thumb ? [p.thumb] : [];
  const own = S.user && S.user.uid === p.sellerId, myReq = own ? null : activeReq(id);
  // Opens instantly (thumbnail + info); full photos and seller name fill in a moment later.
  open(`<div class="dt-bar"><button class="dt-back" id="dt-back" aria-label="Back">${ic("back")}</button></div>
    <div class="gal-w"><div class="gal" id="gal">${slides(p.thumb ? [p.thumb] : [])}</div><div class="gdots" id="gdots"></div></div>
    <div class="dt-body">
    <h3>${esc(p.title)} ${p.verified ? '<span class="badge">Verified</span>' : ""}</h3>
    <div class="price" id="d-price" style="font-size:22px">₹${Number(p.price).toLocaleString("en-IN")}${p.originalPrice > p.price ? `<s>₹${p.originalPrice}</s>` : ""}</div>
    <div class="dt-info">
      <div class="ir"><span>${ic("pin")}Location</span><b>${esc(p.area || p.location || "Ahmedabad")}</b></div>
      <div class="ir"><span>${ic("pin")}Distance</span><b>${esc(distText(p))}</b></div>
      <div class="ir"><span>${ic("check")}Condition</span><b><i class="cond ${condClass(p.condition || "Used")}">${esc(p.condition || "Used")}</i></b></div>
      ${p.gender ? `<div class="ir"><span>${ic("tag")}For</span><b>${esc(p.gender)}</b></div>` : ""}${p.size ? `<div class="ir"><span>${ic("tag")}Size</span><b>${esc(p.size)}</b></div>` : ""}<div class="ir"><span>${ic("cap")}Seller's college</span><b id="d-college">…</b></div>
    </div>
    ${own ? `<div class="act" style="display:flex;gap:8px"><button class="btn" id="d-sold" ${p.status === "sold" ? "disabled" : ""}>Mark sold</button><button class="btn red" id="d-del">Delete</button></div>`
      : p.status === "sold" ? "<p><b>This item is sold.</b></p>"
      : `${myReq ? `<div class="row" id="my-req">${myReqHtml(myReq)}</div>` : ""}<div class="act" style="display:flex;gap:8px"><button class="btn" id="add-cart" type="button">Add to Cart</button><button class="btn ghost hidden" id="view-cart" type="button">View cart</button></div>`}
    <h4 class="more-h">More in ${esc(catName(p.category))}</h4>
    <div id="more-list" class="grid">${moreHtml(p)}</div></div>`, true);
  dlgEl.scrollTop = 0;
  if (!histPushed) { try { history.pushState({ d: 1 }, ""); histPushed = true; } catch (_) {} }
  $("#dt-back").onclick = () => dlgEl.close();
  const gal = $("#gal");
  gal.onclick = () => openZoom(detailImgs, Math.round(gal.scrollLeft / (gal.clientWidth || 1)));
  gal.onscroll = () => {
    const i = Math.round(gal.scrollLeft / (gal.clientWidth || 1));
    document.querySelectorAll("#gdots i").forEach((d, k) => d.classList.toggle("on", k === i));
  };
  $("#gdots").onclick = (e) => { const i = e.target.dataset.g; if (i !== undefined) gal.scrollTo({ left: i * gal.clientWidth, behavior: "smooth" }); };
  if (own) {
    $("#d-sold").onclick = safe(async () => { await markSold(id); $("#dlg").close(); toast("Marked as sold"); });
    $("#d-del").onclick = safe(async () => { if (confirm("Delete this listing?")) { await deleteProduct(id); $("#dlg").close(); toast("Deleted"); } });
  } else if ($("#add-cart")) {
    const ab = $("#add-cart"), vb = $("#view-cart");
    const sync = () => { const q = cart.some((x) => x.id === id); ab.textContent = q ? "Added to cart ✓" : "Add to Cart"; ab.disabled = q; vb.classList.toggle("hidden", !q); };
    ab.onclick = () => { if (addToCart(id)) toast("Added to cart"); sync(); };
    vb.onclick = () => cartPage();
    sync();
  }
  const [imgs, seller] = await Promise.all([getProductImages(id), getUser(p.sellerId).catch(() => null)]);
  if (detailP !== p || !dlgEl.open || !$("#gal")) return;   // user already left or opened another item
  if (!imgs.length && p.thumb) imgs.push(p.thumb);
  detailImgs = imgs.slice();
  $("#gal").innerHTML = slides(imgs); $("#gdots").innerHTML = dots(imgs.length);
  $("#d-college").textContent = seller?.college || "Not shared";
}
const REQ_STATUS = { pending: ["Pending", "wait"], approved: ["Confirmed", "ok"], rejected: ["Rejected", "no"], cancelled: ["Cancelled", "no"] };
function bellDialog() {
  if (!need()) return;
  const reqs = S.reqs.filter((r) => r.sellerId === S.user.uid).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const reqHtml = reqs.length ? `<h4 style="margin:2px 0 6px">Requests for your products</h4><div class="list">${reqs.map((r) => {
    const [txt, cls] = r.status === "cancelled" ? REQ_STATUS.cancelled : (REQ_STATUS[r.adminStatus || "pending"] || REQ_STATUS.pending);
    return `<div class="row"><b>${esc(r.productTitle)}</b> <span class="badge ${cls}">${txt}</span><div>Someone wants to buy this product.${cls === "wait" ? " AMD Mart will contact you on WhatsApp." : ""}</div></div>`;
  }).join("")}</div><h4 style="margin:14px 0 6px">Updates</h4>` : "";
  open(`<h3>Notifications</h3>${reqHtml}<div class="list nlist">${S.notifs.map((n) => `<div class="row" data-n="${n.id}" style="${n.read ? "opacity:.6" : ""}"><b>${esc(n.title)}</b><div>${esc(n.message)}</div></div>`).join("") || '<p class="empty">Nothing new.</p>'}</div>`);
  // Opening the list counts as seeing the updates: mark every unread one as read so the number goes down.
  S.notifs.filter((n) => !n.read).forEach((n) => markNotificationRead(n.id).catch(() => {}));
  renderBell();
}

function favDialog() {
  if (!need()) return;
  open(`<h3>Liked Products</h3><div id="fav-list" class="grid">${favListHtml()}</div>`);
}

/* ---------- events ---------- */
document.addEventListener("click", safe(async (e) => {
  const t = e.target.closest("[data-v],[data-cat],[data-chip],[data-rf],[data-fav],[data-open],[data-addcart],[data-st],[data-n],[data-loc],[data-area],[data-retry],#loc-gps,#p-login,#p-logout,#p-edit");
  if (!t) return;
  if (t.dataset.addcart) { e.stopPropagation(); if (addToCart(t.dataset.addcart)) toast("Added to cart"); else toast("Already in your cart"); }
  else if (t.dataset.v) { e.preventDefault(); show(t.dataset.v); }
  else if (t.dataset.cat) { S.cat = t.dataset.cat; renderCats(); renderProducts(); show("explore"); }
  else if (t.dataset.chip !== undefined) { S.cat = t.dataset.chip; renderCats(); renderProducts(); }
  else if (t.dataset.rf) { S.rf = t.dataset.rf; renderRequests(); }
  else if (t.dataset.fav) { e.stopPropagation(); if (need()) await toggleFavourite(t.dataset.fav); }
  else if (t.dataset.open) await detail(t.dataset.open);
  else if (t.dataset.st) { const r = S.reqs.find((x) => x.id === t.dataset.r); await setRequestStatus(r.id, t.dataset.st, r.sellerId === S.user.uid ? r.buyerId : r.sellerId, r.productTitle); }
  else if (t.dataset.n) await markNotificationRead(t.dataset.n);
  else if (t.dataset.area) { const a = AREAS.find((x) => x.name === t.dataset.area); if (a) await setLoc({ area: a.name, lat: a.lat, lng: a.lng, src: "manual" }, { close: true }); }
  else if (t.dataset.loc !== undefined) locDialog();
  else if (t.dataset.retry !== undefined) startProducts();
  else if (t.id === "loc-gps") await useGps();
  else if (t.id === "p-login") authDialog();
  else if (t.id === "p-edit") editDialog();
  else if (t.id === "p-logout") { await logout(); toast("Logged out"); }
}));
$("#fab").onclick = safe(postDialog);
$("#q-home").onfocus = () => { show("explore"); $("#q").focus(); };
$("#bell").onclick = bellDialog;
$("#fav-btn").onclick = favDialog;
$("#loc-btn").onclick = locDialog;
$("#q").oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); if (S.view !== "explore") show("explore"); renderProducts(); };

/* ---------- live data ---------- */
// Category order shown on Home and Explore (electronics removed)
const CAT_ORDER = ["shoes-clothes", "projects", "hostel", "traditional", "books", "iot"];
const catRank = (id) => { const i = CAT_ORDER.indexOf(id); return i < 0 ? 99 : i; };
listenCategories((c) => { S.cats = c.filter((x) => x.id !== "electronics").sort((a, b) => catRank(a.id) - catRank(b.id)); renderAll(); });
let prodUnsub = null;
function startProducts() {
  prodUnsub?.(); S.loaded = false; S.loadErr = false; renderProducts();
  prodUnsub = listenProducts((p) => { S.products = p; S.loaded = true; S.loadErr = false; renderAll(); },
    {}, () => { S.loadErr = true; renderProducts(); });
}
startProducts();
renderLoc();

/* ---------- push messages (Firebase Cloud Messaging) ---------- */
// Right after a successful sign-in the browser asks "Allow notifications?". Never blocks or breaks sign-in if it fails.
const askPush = () => { enablePush(true).catch((e) => console.warn("Push setup:", e && e.message)); };
let pushListening = false;
function startPushListener() {
  if (pushListening) return; pushListening = true;
  // while the website is open the browser doesn't show pushes itself, so show a small toast instead
  listenPush((p) => { const n = p.notification || p.data || {}; toast([n.title, n.body].filter(Boolean).join(": ") || "New message from AMD Mart"); });
}

onUser(async (u) => {
  userUnsubs.forEach((f) => f()); userUnsubs = [];
  S.user = u; S.favs = []; S.mine = []; S.reqs = []; S.notifs = []; S.admin = false; S.me = {};
  initLocation(u);
  if (u) {
    enablePush(false).then((t) => { if (t) startPushListener(); }).catch(() => {});   // already allowed earlier: just keep the token fresh
    loadMe();
    syncEmail().catch(() => {});
    userUnsubs.push(
      listenFavouriteIds((ids) => { S.favs = ids; renderAll(); }),
      listenProducts((p) => { S.mine = p; renderAll(); }, { sellerId: u.uid }),
      listenMyRequests((r) => { S.reqs = r; renderAll(); }),
      listenNotifications((n) => { S.notifs = n; renderAll(); })
    );
    S.admin = await isAdmin();
  }
  renderAll();
});

renderCartFab();
$("#cartfab").onclick = cartPage;
$("#nav-cart").onclick = cartPage;

/* ---------- logo: remove the white background in the browser (flood-fills only the white that touches the edges) ---------- */
(function cleanLogo() {
  const im = new Image(); im.crossOrigin = "anonymous";
  im.onload = () => {
    try {
      const k = Math.min(1, 300 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.drawImage(im, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h), px = d.data, seen = new Uint8Array(w * h), st = [];
      const white = (i) => px[i * 4] > 228 && px[i * 4 + 1] > 228 && px[i * 4 + 2] > 228;
      const push = (x, y) => { const i = y * w + x; if (!seen[i] && white(i)) { seen[i] = 1; st.push(i); } };
      for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
      for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
      while (st.length) {
        const i = st.pop(), x = i % w, y = (i / w) | 0;
        if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
      }
      for (let i = 0; i < w * h; i++) if (seen[i]) px[i * 4 + 3] = 0;
      // soften the edge: pale pixels touching the removed area become half see-through (no white halo)
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (seen[i] || !(px[i * 4] > 190 && px[i * 4 + 1] > 190 && px[i * 4 + 2] > 190)) continue;
        if (seen[i - 1] || seen[i + 1] || seen[i - w] || seen[i + w]) px[i * 4 + 3] = 110;
      }
      g.putImageData(d, 0, 0);
      const url = c.toDataURL("image/png");
      LOGO_URL = url;
      document.querySelectorAll("img.amd-logo").forEach((e) => { e.src = url; });
      document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').forEach((e) => { e.href = url; });
    } catch (_) { /* image host blocked pixel access: keep the normal logo */ }
  };
  im.src = LOGO_URL;
})();