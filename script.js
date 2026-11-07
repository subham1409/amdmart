// script.js — AMD Mart storefront. All data comes from / goes to Firebase via amdmart-db.js
import { auth } from "./firebase.js";
import {
  onUser, register, login, logout, isAdmin, getUser, listenCategories, listenProducts,
  addProduct, getProductImages, markSold, deleteProduct, toggleFavourite, listenFavouriteIds, sendRequest,
  setRequestStatus, listenMyRequests, listenNotifications, markNotificationRead, saveLocationPref, getLocationPref
} from "./amdmart-db.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICONS = { iot: "cpu", books: "book", "shoes-clothes": "shoe", electronics: "laptop", hostel: "bed", services: "cap", traditional: "hanger", projects: "bag", others: "grid", "hot-deals": "flame" };
const ic = (n, c = "") => `<svg class="ic ${c}"><use href="#i-${n}"/></svg>`;
const S = { user: null, cats: [], products: [], mine: [], favs: [], reqs: [], notifs: [], cat: "", q: "", view: "home", admin: false, loc: null, loaded: false, loadErr: false };
let userUnsubs = [];

function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 2500); }
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message.replace("Firebase: ", "")); } };
// Older iOS Safari (before 15.4) has no <dialog> support: fall back to a plain fixed popup.
const dlgEl = $("#dlg");
if (typeof dlgEl.showModal !== "function") {
  dlgEl.classList.add("dlg-poly");
  dlgEl.showModal = () => dlgEl.setAttribute("open", "");
  dlgEl.close = () => dlgEl.removeAttribute("open");
}
function open(html) { $("#dlg-body").innerHTML = html; if (!dlgEl.open) dlgEl.showModal(); }
$("#x").onclick = () => $("#dlg").close();
const need = () => { if (S.user) return true; authDialog(); return false; };

/* ---------- views ---------- */
function show(v) {
  S.view = v;
  document.querySelectorAll(".view").forEach((e) => e.classList.add("hidden"));
  $("#v-" + v).classList.remove("hidden");
  document.querySelectorAll(".nav [data-v], .dnav [data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  if (v === "profile") renderProfile();
  scrollTo(0, 0);
}

/* ---------- location: 2 km nearby ---------- */
/* LOC-LOGIC:START */
const RADIUS_M = 2000;
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
  ["Isanpur", 22.977, 72.596], ["Ghuma", 23.003, 72.485], ["Sarkhej", 22.989, 72.493]
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
// Approved by admin (verified), not sold, valid coordinates, within 2 km. Nearest first.
function nearbyProducts(list, loc) {
  if (!loc || !validCoords(loc.lat, loc.lng)) return [];
  return list
    .filter((p) => p.verified === true && p.status !== "sold" && validCoords(p.lat, p.lng))
    .map((p) => ({ ...p, _d: haversine(loc.lat, loc.lng, p.lat, p.lng) }))
    .filter((p) => p._d <= RADIUS_M)
    .sort((a, b) => a._d - b._d);
}
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
  toast(`Showing deals within 2 km of ${loc.area}`);
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
    // rounded to ~100 m: enough for a 2 km search, not a home address
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
    ${S.loc ? `<p class="loc-cur">${ic("pin", "o")}<b>${esc(S.loc.area)}</b><small>deals within 2 km</small></p>`
      : '<p class="loc-sub">We show products within 2 km of you. No address needed.</p>'}
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
    <div class="loc">${ic("pin")} ${esc(p.area || p.location || "Ahmedabad")}</div>${p._d != null ? `<div class="dist">${fmtDist(p._d)}</div>` : ""}</div></div>`;
}
function renderCats() {
  $("#cats").innerHTML = S.cats.map((c) => `<button class="cat" data-cat="${c.id}"><i>${ic(ICONS[c.id] || "tag")}</i>${esc(c.name)}</button>`).join("");
  $("#chips").innerHTML = `<button class="chip ${!S.cat ? "on" : ""}" data-chip="">All</button>` +
    S.cats.map((c) => `<button class="chip ${S.cat === c.id ? "on" : ""}" data-chip="${c.id}">${esc(c.name)}</button>`).join("");
}
function renderNearby() {
  const el = $("#nearby");
  if (S.loadErr) { el.innerHTML = '<div class="empty"><p>Couldn\'t load products. Check your connection.</p><div class="act"><button class="btn sm" data-retry>Try again</button></div></div>'; return; }
  if (!S.loc) { el.innerHTML = '<div class="empty"><p>Select your area to see deals within 2 km.</p><div class="act"><button class="btn sm" data-loc>Choose area</button></div></div>'; return; }
  if (!S.loaded) { el.innerHTML = '<p class="empty">Loading nearby deals…</p>'; return; }
  const n = nearbyProducts(S.products, S.loc);
  el.innerHTML = n.map(card).join("") ||
    '<div class="empty"><p>No products found within 2 km.</p><div class="act"><button class="btn sm" data-loc>Explore other areas</button><button class="btn sm ghost" data-v="explore">View all products</button></div></div>';
}
function renderProducts() {
  renderNearby();
  const f = filtered();
  $("#grid").innerHTML = f.map(card).join("") || '<p class="empty">No products found.</p>';
}
function renderRequests() {
  if (!S.user) { $("#reqs").innerHTML = '<p class="empty">Log in to see your requests.</p>'; return; }
  $("#reqs").innerHTML = S.reqs.map((r) => {
    const seller = r.sellerId === S.user.uid;
    return `<div class="row"><b>${esc(r.productTitle)}</b> <span class="badge">${r.status}</span>
      <div>${seller ? "From " + esc(r.buyerName) : "You requested"}${r.message ? ": " + esc(r.message) : ""}</div>
      ${r.status === "pending" ? `<div class="act">${seller
        ? `<button class="btn sm" data-st="accepted" data-r="${r.id}">Accept</button><button class="btn sm red" data-st="rejected" data-r="${r.id}">Reject</button>`
        : `<button class="btn sm ghost" data-st="cancelled" data-r="${r.id}">Cancel</button>`}</div>` : ""}</div>`;
  }).join("") || '<p class="empty">No requests yet.</p>';
}
function renderProfile() {
  if (!S.user) {
    $("#profile").innerHTML = '<div class="row" style="text-align:center;margin-top:20px"><h3>Welcome to AMD Mart</h3><p style="margin:8px 0 14px">Log in to sell, save favourites and send requests.</p><button class="btn full" id="p-login">Login / Sign up</button></div>';
    return;
  }
  const favs = S.products.filter((p) => S.favs.includes(p.id));
  $("#profile").innerHTML = `<div class="row" style="margin-top:12px"><h3>${esc(S.user.displayName || "Student")}</h3><small>${esc(S.user.email)}</small>
    <div class="act">${S.admin ? '<a class="btn sm" href="admin/admin.html">Admin Panel</a>' : ""}<button class="btn sm ghost" id="p-logout">Logout</button></div></div>
    <h3 class="pad">My Listings</h3><div class="grid">${S.mine.map(card).join("") || '<p class="empty">Nothing listed yet.</p>'}</div>
    <h3 class="pad">Favourites</h3><div class="grid">${favs.map(card).join("") || '<p class="empty">No favourites yet.</p>'}</div>`;
}
function renderBell() { $("#dot").classList.toggle("hidden", !S.notifs.some((n) => !n.read)); }
const renderAll = () => { renderCats(); renderProducts(); renderRequests(); if (S.view === "profile") renderProfile(); renderBell(); };

/* ---------- dialogs ---------- */
function authDialog(mode = "login") {
  const reg = mode === "register";
  open(`<h3>${reg ? "Create account" : "Login"}</h3><form id="auth-f">
    ${reg ? '<input name="name" placeholder="Full name" required><input name="college" placeholder="College (e.g. LD College)"><input name="phone" placeholder="Phone (optional)">' : ""}
    <input name="email" type="email" placeholder="Email" required><input name="password" type="password" minlength="6" placeholder="Password (min 6)" required>
    <button class="btn">${reg ? "Sign up" : "Login"}</button></form>
    <p style="margin-top:10px;font-size:14px">${reg ? "Have an account?" : "New here?"} <a href="#" id="sw" style="color:var(--o)">${reg ? "Login" : "Sign up"}</a></p>`);
  $("#sw").onclick = (e) => { e.preventDefault(); authDialog(reg ? "login" : "register"); };
  $("#auth-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (reg) await register(d); else await login(d.email, d.password);
    $("#dlg").close(); toast("Welcome to AMD Mart!");
  });
}
function postDialog() {
  if (!need()) return;
  const cats = S.cats.filter((c) => c.id !== "hot-deals");
  if (!cats.length) return toast("No categories yet — ask admin to set them up.");
  open(`<h3>Post an Ad</h3><form id="post-f">
    <input name="title" placeholder="Title" maxlength="100" required>
    <select name="category">${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
    <input name="price" type="number" min="0" placeholder="Price (₹)" required>
    <input name="originalPrice" type="number" min="0" placeholder="Original price (₹, optional)">
    <select name="condition"><option>Used</option><option>Like New</option><option>New</option></select>
    <select name="area" required><option value="">Pickup area (approximate)</option>${AREAS.map((a) => `<option ${S.loc && S.loc.area === a.name ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
    <small class="hint">Buyers only see this area, never your exact address.</small>
    <textarea name="description" rows="3" placeholder="Description" maxlength="2000"></textarea>
    <input name="images" type="file" accept="image/*" multiple>
    <button class="btn" id="post-btn">Publish</button></form>`);
  $("#post-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    const ar = AREAS.find((x) => x.name === d.area);
    if (!ar) throw new Error("Please choose a pickup area.");
    d.lat = ar.lat; d.lng = ar.lng;
    $("#post-btn").disabled = true; $("#post-btn").textContent = "Compressing & saving…";
    try { await addProduct(d, [...f.images.files]); } finally { $("#post-btn")?.removeAttribute("disabled"); }
    $("#dlg").close(); toast("Ad published!");
  });
}
async function detail(id) {
  const p = S.products.find((x) => x.id === id) || S.mine.find((x) => x.id === id);
  if (!p) return;
  const imgs = await getProductImages(id);
  if (!imgs.length && p.thumb) imgs.push(p.thumb);
  const seller = await getUser(p.sellerId);
  const own = S.user && S.user.uid === p.sellerId;
  open(`<div class="dgrid"><div><div class="detail-img" style="background-image:url('${esc(imgs[0] || "")}')"></div>
    <div class="thumbs">${imgs.slice(1).map((u) => `<div style="background-image:url('${esc(u)}')"></div>`).join("")}</div></div><div>
    <h3>${esc(p.title)} ${p.verified ? '<span class="badge">Verified</span>' : ""}</h3>
    <div class="price" style="font-size:22px">₹${Number(p.price).toLocaleString("en-IN")}${p.originalPrice > p.price ? `<s>₹${p.originalPrice}</s>` : ""}</div>
    <p class="loc">${ic("pin")} ${esc(p.location)} · ${esc(p.condition)} · Seller: ${esc(seller?.name || "Student")}${seller?.college ? ", " + esc(seller.college) : ""}</p>
    <p style="margin:10px 0">${esc(p.description)}</p>
    ${own ? `<div class="act" style="display:flex;gap:8px"><button class="btn" id="d-sold" ${p.status === "sold" ? "disabled" : ""}>Mark sold</button><button class="btn red" id="d-del">Delete</button></div>`
      : p.status === "sold" ? "<p><b>This item is sold.</b></p>"
      : `<form id="req-f"><textarea name="m" rows="2" maxlength="500" placeholder="Message to seller (optional)"></textarea><button class="btn">Request to Buy</button></form>`}</div></div>`);
  if (own) {
    $("#d-sold").onclick = safe(async () => { await markSold(id); $("#dlg").close(); toast("Marked as sold"); });
    $("#d-del").onclick = safe(async () => { if (confirm("Delete this listing?")) { await deleteProduct(id); $("#dlg").close(); toast("Deleted"); } });
  } else if ($("#req-f")) {
    $("#req-f").onsubmit = safe(async (e) => {
      e.preventDefault();
      if (!need()) return;
      await sendRequest(p, e.target.m.value); $("#dlg").close(); toast("Request sent to seller!"); show("requests");
    });
  }
}
function bellDialog() {
  if (!need()) return;
  open(`<h3>Notifications</h3><div class="list">${S.notifs.map((n) => `<div class="row" data-n="${n.id}" style="${n.read ? "opacity:.6" : ""}"><b>${esc(n.title)}</b><div>${esc(n.message)}</div></div>`).join("") || '<p class="empty">Nothing new.</p>'}</div>`);
}

/* ---------- events ---------- */
document.addEventListener("click", safe(async (e) => {
  const t = e.target.closest("[data-v],[data-cat],[data-chip],[data-fav],[data-open],[data-st],[data-n],[data-loc],[data-area],[data-retry],#loc-gps,#p-login,#p-logout");
  if (!t) return;
  if (t.dataset.v) { e.preventDefault(); show(t.dataset.v); }
  else if (t.dataset.cat) { S.cat = t.dataset.cat; renderCats(); renderProducts(); show("explore"); }
  else if (t.dataset.chip !== undefined) { S.cat = t.dataset.chip; renderCats(); renderProducts(); }
  else if (t.dataset.fav) { e.stopPropagation(); if (need()) await toggleFavourite(t.dataset.fav); }
  else if (t.dataset.open) await detail(t.dataset.open);
  else if (t.dataset.st) { const r = S.reqs.find((x) => x.id === t.dataset.r); await setRequestStatus(r.id, t.dataset.st, r.sellerId === S.user.uid ? r.buyerId : r.sellerId, r.productTitle); }
  else if (t.dataset.n) await markNotificationRead(t.dataset.n);
  else if (t.dataset.area) { const a = AREAS.find((x) => x.name === t.dataset.area); if (a) await setLoc({ area: a.name, lat: a.lat, lng: a.lng, src: "manual" }, { close: true }); }
  else if (t.dataset.loc !== undefined) locDialog();
  else if (t.dataset.retry !== undefined) startProducts();
  else if (t.id === "loc-gps") await useGps();
  else if (t.id === "p-login") authDialog();
  else if (t.id === "p-logout") { await logout(); toast("Logged out"); }
}));
$("#fab").onclick = postDialog;
$("#q-home").onfocus = () => { show("explore"); $("#q").focus(); };
$("#bell").onclick = bellDialog;
$("#loc-btn").onclick = locDialog;
$("#q").oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); if (S.view !== "explore") show("explore"); renderProducts(); };

/* ---------- live data ---------- */
listenCategories((c) => { S.cats = c; renderAll(); });
let prodUnsub = null;
function startProducts() {
  prodUnsub?.(); S.loaded = false; S.loadErr = false; renderProducts();
  prodUnsub = listenProducts((p) => { S.products = p; S.loaded = true; S.loadErr = false; renderAll(); },
    {}, () => { S.loadErr = true; renderProducts(); });
}
startProducts();
renderLoc();

onUser(async (u) => {
  userUnsubs.forEach((f) => f()); userUnsubs = [];
  S.user = u; S.favs = []; S.mine = []; S.reqs = []; S.notifs = []; S.admin = false;
  initLocation(u);
  if (u) {
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