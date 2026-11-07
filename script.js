// script.js — AMD Mart storefront. All data comes from / goes to Firebase via amdmart-db.js
import { auth } from "./firebase.js";
import {
  onUser, register, login, logout, isAdmin, getUser, listenCategories, listenProducts,
  addProduct, markSold, deleteProduct, toggleFavourite, listenFavouriteIds, sendRequest,
  setRequestStatus, listenMyRequests, listenNotifications, markNotificationRead
} from "./amdmart-db.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICONS = { iot: "cpu", books: "book", "shoes-clothes": "shoe", electronics: "laptop", hostel: "bed", services: "cap", traditional: "hanger", projects: "bag", others: "grid", "hot-deals": "flame" };
const ic = (n, c = "") => `<svg class="ic ${c}"><use href="#i-${n}"/></svg>`;
const S = { user: null, cats: [], products: [], mine: [], favs: [], reqs: [], notifs: [], cat: "", q: "", view: "home", admin: false };
let userUnsubs = [];

function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 2500); }
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message.replace("Firebase: ", "")); } };
function open(html) { $("#dlg-body").innerHTML = html; if (!$("#dlg").open) $("#dlg").showModal(); }
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

/* ---------- rendering ---------- */
function filtered() {
  return S.products.filter((p) =>
    (!S.cat || (S.cat === "hot-deals" ? p.originalPrice > p.price : p.category === S.cat)) &&
    (!S.q || (p.title + " " + p.description).toLowerCase().includes(S.q)));
}
function card(p) {
  const img = p.imageUrls ? Object.values(p.imageUrls)[0] : "";
  return `<div class="card" data-open="${p.id}">
    <div class="imgw"><div class="img" style="background-image:url('${esc(img)}')"></div>
    ${p.status === "sold" ? '<div class="sold">SOLD</div>' : ""}
    ${p.verified ? '<span class="ver">Verified</span>' : ""}
    <button class="heart ${S.favs.includes(p.id) ? "on" : ""}" data-fav="${p.id}" aria-label="Favourite">${ic("heart")}</button></div>
    <div class="info"><div class="t">${esc(p.title)}</div>
    <div class="price">₹${Number(p.price).toLocaleString("en-IN")}${p.originalPrice > p.price ? `<s>₹${Number(p.originalPrice).toLocaleString("en-IN")}</s>` : ""}</div>
    <div class="loc">${ic("pin")} ${esc(p.location || "Ahmedabad")}</div></div></div>`;
}
function renderCats() {
  $("#cats").innerHTML = S.cats.map((c) => `<button class="cat" data-cat="${c.id}"><i>${ic(ICONS[c.id] || "tag")}</i>${esc(c.name)}</button>`).join("");
  $("#chips").innerHTML = `<button class="chip ${!S.cat ? "on" : ""}" data-chip="">All</button>` +
    S.cats.map((c) => `<button class="chip ${S.cat === c.id ? "on" : ""}" data-chip="${c.id}">${esc(c.name)}</button>`).join("");
}
function renderProducts() {
  $("#nearby").innerHTML = S.products.slice(0, 10).map(card).join("") || '<p class="empty">No listings yet — be the first to sell!</p>';
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
    <input name="location" placeholder="Area (e.g. Near Vastrapur)" maxlength="100">
    <textarea name="description" rows="3" placeholder="Description" maxlength="2000"></textarea>
    <input name="images" type="file" accept="image/*" multiple>
    <button class="btn" id="post-btn">Publish</button></form>`);
  $("#post-f").onsubmit = safe(async (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    $("#post-btn").disabled = true; $("#post-btn").textContent = "Uploading…";
    try { await addProduct(d, [...f.images.files]); } finally { $("#post-btn")?.removeAttribute("disabled"); }
    $("#dlg").close(); toast("Ad published!");
  });
}
async function detail(id) {
  const p = S.products.find((x) => x.id === id) || S.mine.find((x) => x.id === id);
  if (!p) return;
  const imgs = Object.values(p.imageUrls || {});
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
  const t = e.target.closest("[data-v],[data-cat],[data-chip],[data-fav],[data-open],[data-st],[data-n],#p-login,#p-logout");
  if (!t) return;
  if (t.dataset.v) { e.preventDefault(); show(t.dataset.v); }
  else if (t.dataset.cat) { S.cat = t.dataset.cat; renderCats(); renderProducts(); show("explore"); }
  else if (t.dataset.chip !== undefined) { S.cat = t.dataset.chip; renderCats(); renderProducts(); }
  else if (t.dataset.fav) { e.stopPropagation(); if (need()) await toggleFavourite(t.dataset.fav); }
  else if (t.dataset.open) await detail(t.dataset.open);
  else if (t.dataset.st) { const r = S.reqs.find((x) => x.id === t.dataset.r); await setRequestStatus(r.id, t.dataset.st, r.sellerId === S.user.uid ? r.buyerId : r.sellerId, r.productTitle); }
  else if (t.dataset.n) await markNotificationRead(t.dataset.n);
  else if (t.id === "p-login") authDialog();
  else if (t.id === "p-logout") { await logout(); toast("Logged out"); }
}));
$("#fab").onclick = postDialog;
$("#q-home").onfocus = () => { show("explore"); $("#q").focus(); };
$("#bell").onclick = bellDialog;
$("#q").oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); if (S.view !== "explore") show("explore"); renderProducts(); };

/* ---------- live data ---------- */
listenCategories((c) => { S.cats = c; renderAll(); });
listenProducts((p) => { S.products = p; renderAll(); });

onUser(async (u) => {
  userUnsubs.forEach((f) => f()); userUnsubs = [];
  S.user = u; S.favs = []; S.mine = []; S.reqs = []; S.notifs = []; S.admin = false;
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