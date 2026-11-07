// admin.js — admin UI. This is only a convenience layer: every action is enforced by
// database.rules.json (admins/<uid> must exist), so editing this file grants nothing.
import { db } from "../firebase.js";
import { onUser, login, logout, isAdmin, seedCategories, verifyProduct, setAdminStatus } from "../amdmart-db.js";
import { ref, onValue, remove, set, get, update } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const D = { products: [], requests: [], users: [], categories: [] };
let tab = "products", started = false;

const list = (snap) => { const a = []; snap.forEach((c) => { a.push({ id: c.key, ...c.val() }); }); return a; };
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message); } };

// Fallback lookup: if someone isn't in the bulk users list, fetch their profile directly (users/<uid> + userPrivate/<uid>).
const person = {};
async function loadPerson(id) {
  person[id] = { id, loading: true };
  const u = { id };
  try { Object.assign(u, (await get(ref(db, `users/${id}`))).val() || {}); } catch (e) { u.err = e.message; }
  try { u.email = (await get(ref(db, `userPrivate/${id}/email`))).val(); } catch (_) {}
  try { u.phone = (await get(ref(db, `userPrivate/${id}/phone`))).val(); } catch (_) {}
  person[id] = u; draw();
}
function userOf(id) {
  if (!id) return {};
  const u = D.users.find((x) => x.id === id) || person[id];
  if (!u) loadPerson(id);
  return u || { id, loading: true };
}
const nameOf = (id, fallback) => { const u = userOf(id); return u.name || fallback || (u.loading ? "Loading…" : "No profile (" + id.slice(0, 6) + ")"); };

/* ---------- WhatsApp click-to-chat (admin reviews and presses Send in WhatsApp) ---------- */
// Returns digits with country code (default 91 for India), or "" if the stored number is unusable.
function waNumber(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}
const WA_MSG = {
  seller: (product) => `Hello! We are contacting you from AMD Mart.
Someone is interested in purchasing your product: ${product}.
Before proceeding, please:

1. Send us a recent photo or short video of the product.
2. Confirm that the product is available.
3. Tell us a suitable time when the buyer can visit your location and collect it.

Our admin team will verify the product and coordinate with the buyer.
Thank you!
AMD Mart Team`,
  buyer: (product) => `Hello! We are contacting you from AMD Mart.
Good news! The seller has confirmed the availability of ${product}, and our admin team has completed the initial product verification.
Would you still like to purchase this product?
If yes, we will share the seller's contact details and pickup location so you can collect it directly.
Please remember that AMD Mart does not provide home delivery.
Thank you!
AMD Mart Team`
};
const WA_ICON = '<svg viewBox="0 0 32 32" width="16" height="16" aria-hidden="true"><path fill="#fff" d="M16.04 5.33A10.6 10.6 0 0 0 6.9 21.2L5.33 26.67l5.6-1.47a10.6 10.6 0 1 0 5.1-19.87zm0 19.4a8.8 8.8 0 0 1-4.5-1.23l-.32-.19-3.32.87.89-3.24-.21-.33a8.8 8.8 0 1 1 7.46 4.12zm4.83-6.6c-.27-.13-1.57-.78-1.81-.87-.24-.09-.42-.13-.6.13-.17.27-.69.87-.84 1.05-.16.18-.31.2-.58.07-.26-.13-1.12-.41-2.13-1.31-.79-.7-1.32-1.57-1.47-1.83-.15-.27-.02-.41.12-.54.12-.12.27-.31.4-.47.13-.16.18-.27.27-.45.09-.18.04-.33-.02-.47-.07-.13-.6-1.45-.82-1.98-.21-.52-.43-.45-.6-.46h-.51c-.18 0-.47.07-.71.33-.24.27-.93.91-.93 2.22s.95 2.57 1.09 2.75c.13.18 1.87 2.86 4.54 4.01.63.27 1.13.44 1.52.56.64.2 1.22.17 1.68.1.51-.08 1.57-.64 1.79-1.26.22-.62.22-1.15.15-1.26-.06-.11-.24-.18-.51-.31z"/></svg>';
// role: "seller" | "buyer". Always renders something so the layout stays consistent.
function waButton(phone, role, product) {
  const label = role === "seller" ? "seller" : "buyer";
  const num = waNumber(phone);
  if (!num) return `<span class="wa wa-off" title="No valid phone number on file" aria-disabled="true">${WA_ICON}<span>No valid number</span></span>`;
  const title = product && String(product).trim() ? String(product).trim() : "the product";
  const url = `https://wa.me/${num}?text=${encodeURIComponent(WA_MSG[role](title))}`;
  return `<a class="wa" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Contact on WhatsApp" aria-label="Contact ${label} on WhatsApp">${WA_ICON}<span>Contact on WhatsApp</span></a>`;
}

function start() {
  if (started) return; started = true;
  onValue(ref(db, "products"), (s) => { D.products = list(s); draw(); });
  onValue(ref(db, "requests"), (s) => { D.requests = list(s); draw(); });
  onValue(ref(db, "categories"), (s) => { D.categories = list(s).sort((a, b) => a.order - b.order); draw(); });
  onValue(ref(db, "users"), async (s) => {
    const users = list(s);
    await Promise.all(users.map(async (u) => {
      try { u.email = (await get(ref(db, `userPrivate/${u.id}/email`))).val(); } catch (_) {}
      try { u.phone = (await get(ref(db, `userPrivate/${u.id}/phone`))).val(); } catch (_) {}
    }));
    D.users = users; draw();
  });
}

function draw() {
  $("#stats").innerHTML = ["products", "requests", "users", "categories"]
    .map((k) => `<div><b>${D[k].length}</b>${k}</div>`).join("");
  const name = (id) => nameOf(id);
  const waiting = D.requests.filter((r) => (r.adminStatus || "pending") === "pending" && r.status !== "cancelled").length;
  const rt = document.querySelector('.tabs [data-t="requests"]'); if (rt) rt.textContent = waiting ? `Requests (${waiting} new)` : "Requests";
  let h = "";
  if (tab === "products") {
    h = `<table><tr><th>Title</th><th>Price</th><th>Category</th><th>Seller</th><th>Status</th><th>Verified</th><th></th></tr>${D.products.map((p) =>
      `<tr><td>${esc(p.title)}</td><td>₹${p.price}${p.originalPrice && p.originalPrice !== p.price ? `<br><small>MRP ₹${p.originalPrice}</small>` : ""}</td><td>${esc((D.categories.find((c) => c.id === p.category) || {}).name || p.category)}</td><td>${esc(name(p.sellerId))}</td><td><span class="tag">${p.status}</span></td>
      <td>${p.verified ? "✔" : "—"}</td><td><button class="edit" data-editp="${p.id}">Edit</button><button data-ver="${p.id}" data-val="${!p.verified}">${p.verified ? "Unverify" : "Verify"}</button><button class="red" data-delp="${p.id}">Delete</button></td></tr>`).join("")}</table>`;
  } else if (tab === "requests") {
    const who = (id, fallback, role, product) => {
      const u = userOf(id);
      return `<b>${esc(nameOf(id, fallback))}</b><br>${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : '<span class="tag">No number</span>'}`
        + (u.email ? `<br><small>${esc(u.email)}</small>` : "") + (u.college ? `<br><small>${esc(u.college)}</small>` : "")
        + (role ? `<br>${waButton(u.phone, role, product)}` : "");
    };
    const sellerSt = { pending: "Pending", accepted: "Accepted", rejected: "Rejected", cancelled: "Cancelled" };
    const adminSt = { pending: "Pending", approved: "Verified", rejected: "Rejected" };
    const reqs = [...D.requests].sort((a, b) => b.createdAt - a.createdAt);
    h = `<table><tr><th>Product</th><th>Buyer</th><th>Seller</th><th>Seller says</th><th>Admin</th><th>Date</th><th></th></tr>${reqs.map((r) => {
      const p = D.products.find((x) => x.id === r.productId) || {};
      const a = r.adminStatus || "pending";
      return `<tr><td><b>${esc(r.productTitle)}</b>${p.price ? `<br>₹${p.price}` : ""}${p.area || p.location ? `<br><small>${esc(p.area || p.location)}</small>` : ""}${r.message ? `<br><small>“${esc(r.message)}”</small>` : ""}</td>
      <td>${who(r.buyerId, r.buyerName, "buyer", r.productTitle || p.title)}</td><td>${who(r.sellerId, undefined, "seller", r.productTitle || p.title)}</td>
      <td><span class="tag">${sellerSt[r.status] || r.status}</span></td><td><span class="tag">${adminSt[a] || a}</span></td>
      <td>${new Date(r.createdAt).toLocaleString()}</td>
      <td><button data-areq="${r.id}" data-ast="approved" ${a === "approved" ? "disabled" : ""}>Verify</button><button class="red" data-areq="${r.id}" data-ast="rejected" ${a === "rejected" ? "disabled" : ""}>Reject</button><button class="gray" data-delr="${r.id}">Delete</button></td></tr>`;
    }).join("") || '<tr><td colspan="7">No requests yet.</td></tr>'}</table>`;
  } else if (tab === "users") {
    h = `<table><tr><th>Name</th><th>Phone</th><th>Email</th><th>College</th><th>Joined</th></tr>${D.users.map((u) =>
      `<tr><td>${esc(u.name)}</td><td>${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : "—"}</td><td>${esc(u.email || "")}</td><td>${esc(u.college || "")}</td><td>${new Date(u.createdAt).toLocaleDateString()}</td></tr>`).join("")}</table>`;
  } else {
    h = `<form class="inline" id="cat-f"><input name="name" placeholder="New category name" required><button>Add</button><button type="button" class="gray" id="seed">Add default categories</button></form>
      <table><tr><th>ID</th><th>Name</th><th></th></tr>${D.categories.map((c) =>
      `<tr><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td><button class="red" data-delc="${c.id}">Delete</button></td></tr>`).join("")}</table>`;
  }
  $("#content").innerHTML = h;
}

/* ---------- edit product (admin) ---------- */
const CONDITIONS = ["New", "Like New", "Used"];
let editId = null, editBase = 0;
const rupee = (n) => "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN");
function openEdit(id) {
  const p = D.products.find((x) => x.id === id); if (!p) return;
  const f = $("#ed-f"); editId = id; editBase = Number(p.price) || 0;
  f.elements.title.value = p.title || ""; f.price.value = p.price ?? ""; f.originalPrice.value = p.originalPrice ?? "";
  f.location.value = p.area || p.location || ""; f.description.value = p.description || "";
  f.status.value = p.status === "sold" ? "sold" : "active"; f.verified.checked = !!p.verified;
  const cats = D.categories.some((c) => c.id === p.category) ? D.categories : [...D.categories, { id: p.category, name: p.category }];
  f.category.innerHTML = cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(""); f.category.value = p.category;
  const conds = CONDITIONS.includes(p.condition) || !p.condition ? CONDITIONS : [...CONDITIONS, p.condition];
  f.condition.innerHTML = conds.map((c) => `<option>${esc(c)}</option>`).join(""); f.condition.value = p.condition || "Used";
  f.cval.value = ""; $("#ed-base").textContent = rupee(editBase); $("#ed-prev").textContent = "";
  $("#ed").showModal();
}
function applyCommission() {
  const f = $("#ed-f"), v = Number(f.cval.value);
  if (!(v >= 0) || f.cval.value === "") return alert("Enter the commission first.");
  const add = f.ctype.value === "pct" ? editBase * v / 100 : v;
  const price = Math.round(editBase + add);
  f.price.value = price;
  $("#ed-prev").textContent = `Buyer pays ${rupee(price)} · seller gets ${rupee(editBase)} · your commission ${rupee(price - editBase)}`;
}
async function saveEdit(f) {
  const p = D.products.find((x) => x.id === editId); if (!p) throw new Error("Product not found.");
  const title = f.elements.title.value.trim(), price = Number(f.price.value);
  if (!title) throw new Error("Title is required.");
  if (f.price.value === "" || !(price >= 0) || price > 10000000) throw new Error("Enter a valid price.");
  const mrp = f.originalPrice.value === "" ? price : Number(f.originalPrice.value);
  if (!(mrp >= 0)) throw new Error("Enter a valid original price.");
  const area = f.location.value.trim().slice(0, 100);
  const upd = {
    title, price, originalPrice: mrp, category: f.category.value, condition: f.condition.value,
    description: f.description.value.trim(), location: area, area, status: f.status.value,
    verified: f.verified.checked, updatedAt: Date.now()
  };
  if (area !== (p.area || p.location || "")) { upd.lat = null; upd.lng = null; }   // old coordinates no longer match the new area
  await update(ref(db, `products/${editId}`), upd);
  $("#ed").close();
}

document.addEventListener("click", run(async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.t) { tab = t.dataset.t; document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b === t)); draw(); }
  else if (t.dataset.ver) await verifyProduct(t.dataset.ver, t.dataset.val === "true");
  else if (t.dataset.editp) openEdit(t.dataset.editp);
  else if (t.id === "ed-cancel") $("#ed").close();
  else if (t.id === "ed-apply") applyCommission();
  else if (t.dataset.delp) { if (confirm("Delete this product?")) await update(ref(db), { [`products/${t.dataset.delp}`]: null, [`productImages/${t.dataset.delp}`]: null }); }
  else if (t.dataset.areq) {
    const r = D.requests.find((x) => x.id === t.dataset.areq);
    if (r) await setAdminStatus(r.id, t.dataset.ast, r.buyerId, r.sellerId, r.productTitle);
  }
  else if (t.dataset.delr) { if (confirm("Delete this request?")) await remove(ref(db, `requests/${t.dataset.delr}`)); }
  else if (t.dataset.delc) { if (confirm("Delete this category?")) await remove(ref(db, `categories/${t.dataset.delc}`)); }
  else if (t.id === "seed") alert(`${await seedCategories()} categories added.`);
  else if (t.id === "out") await logout();
}));
document.addEventListener("submit", run(async (e) => {
  e.preventDefault();
  if (e.target.id === "login-f") { const d = Object.fromEntries(new FormData(e.target)); await login(d.email, d.password); }
  if (e.target.id === "ed-f") await saveEdit(e.target);
  if (e.target.id === "cat-f") {
    const name = e.target.name.value.trim();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if ((await get(ref(db, `categories/${id}`))).exists()) throw new Error("Category already exists.");
    await set(ref(db, `categories/${id}`), { name, order: D.categories.length });
  }
}));

onUser(async (u) => {
  const ok = u && (await isAdmin());
  $("#login").classList.toggle("hidden", !!u);
  $("#out").classList.toggle("hidden", !u);
  $("#denied").classList.toggle("hidden", !u || ok);
  $("#panel").classList.toggle("hidden", !ok);
  if (ok) start();
});