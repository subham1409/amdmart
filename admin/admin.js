// admin.js — admin UI. This is only a convenience layer: every action is enforced by
// database.rules.json (admins/<uid> must exist), so editing this file grants nothing.
import { db } from "../firebase.js";
import { onUser, login, logout, isAdmin, seedCategories, verifyProduct } from "../amdmart-db.js";
import { ref, onValue, remove, set, get, update } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const D = { products: [], requests: [], users: [], categories: [] };
let tab = "products", started = false;

const list = (snap) => { const a = []; snap.forEach((c) => { a.push({ id: c.key, ...c.val() }); }); return a; };
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message); } };

function start() {
  if (started) return; started = true;
  onValue(ref(db, "products"), (s) => { D.products = list(s); draw(); });
  onValue(ref(db, "requests"), (s) => { D.requests = list(s); draw(); });
  onValue(ref(db, "categories"), (s) => { D.categories = list(s).sort((a, b) => a.order - b.order); draw(); });
  onValue(ref(db, "users"), async (s) => {
    const users = list(s);
    await Promise.all(users.map(async (u) => {
      try { u.email = (await get(ref(db, `userPrivate/${u.id}/email`))).val(); } catch (_) {}
    }));
    D.users = users; draw();
  });
}

function draw() {
  $("#stats").innerHTML = ["products", "requests", "users", "categories"]
    .map((k) => `<div><b>${D[k].length}</b>${k}</div>`).join("");
  const name = (id) => D.users.find((u) => u.id === id)?.name || id.slice(0, 6);
  let h = "";
  if (tab === "products") {
    h = `<table><tr><th>Title</th><th>Price</th><th>Seller</th><th>Status</th><th>Verified</th><th></th></tr>${D.products.map((p) =>
      `<tr><td>${esc(p.title)}</td><td>₹${p.price}</td><td>${esc(name(p.sellerId))}</td><td><span class="tag">${p.status}</span></td>
      <td>${p.verified ? "✔" : "—"}</td><td><button data-ver="${p.id}" data-val="${!p.verified}">${p.verified ? "Unverify" : "Verify"}</button><button class="red" data-delp="${p.id}">Delete</button></td></tr>`).join("")}</table>`;
  } else if (tab === "requests") {
    h = `<table><tr><th>Product</th><th>Buyer</th><th>Seller</th><th>Status</th><th>Date</th><th></th></tr>${D.requests.map((r) =>
      `<tr><td>${esc(r.productTitle)}</td><td>${esc(r.buyerName)}</td><td>${esc(name(r.sellerId))}</td><td><span class="tag">${r.status}</span></td>
      <td>${new Date(r.createdAt).toLocaleDateString()}</td><td><button class="red" data-delr="${r.id}">Delete</button></td></tr>`).join("")}</table>`;
  } else if (tab === "users") {
    h = `<table><tr><th>Name</th><th>Email</th><th>College</th><th>Joined</th></tr>${D.users.map((u) =>
      `<tr><td>${esc(u.name)}</td><td>${esc(u.email || "")}</td><td>${esc(u.college || "")}</td><td>${new Date(u.createdAt).toLocaleDateString()}</td></tr>`).join("")}</table>`;
  } else {
    h = `<form class="inline" id="cat-f"><input name="name" placeholder="New category name" required><button>Add</button><button type="button" class="gray" id="seed">Add default categories</button></form>
      <table><tr><th>ID</th><th>Name</th><th></th></tr>${D.categories.map((c) =>
      `<tr><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td><button class="red" data-delc="${c.id}">Delete</button></td></tr>`).join("")}</table>`;
  }
  $("#content").innerHTML = h;
}

document.addEventListener("click", run(async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.t) { tab = t.dataset.t; document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b === t)); draw(); }
  else if (t.dataset.ver) await verifyProduct(t.dataset.ver, t.dataset.val === "true");
  else if (t.dataset.delp) { if (confirm("Delete this product?")) await update(ref(db), { [`products/${t.dataset.delp}`]: null, [`productImages/${t.dataset.delp}`]: null }); }
  else if (t.dataset.delr) { if (confirm("Delete this request?")) await remove(ref(db, `requests/${t.dataset.delr}`)); }
  else if (t.dataset.delc) { if (confirm("Delete this category?")) await remove(ref(db, `categories/${t.dataset.delc}`)); }
  else if (t.id === "seed") alert(`${await seedCategories()} categories added.`);
  else if (t.id === "out") await logout();
}));
document.addEventListener("submit", run(async (e) => {
  e.preventDefault();
  if (e.target.id === "login-f") { const d = Object.fromEntries(new FormData(e.target)); await login(d.email, d.password); }
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