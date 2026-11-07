// amdmart-db.js — every AMD Mart feature reads/writes Firebase through these functions.
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, reauthenticateWithCredential, EmailAuthProvider, verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  ref, get, set, update, remove, push, query, orderByChild, equalTo,
  onValue, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const toList = (snap) => {
  const out = [];
  snap.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
  return out;
};
const uid = () => {
  if (!auth.currentUser) throw new Error("Please log in first.");
  return auth.currentUser.uid;
};

/* ---------------- AUTH + USERS ---------------- */
// Indian mobile numbers: accepts "+91 98765 43210", "09876543210" etc. and returns the 10 digits, or "" if invalid.
export function normPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : "";
}
export async function register({ name, email, password, phone = "", college = "" }) {
  const cleanPhone = normPhone(phone);
  if (!cleanPhone) throw new Error("Please enter a valid 10-digit mobile number.");   // checked BEFORE creating the account
  phone = cleanPhone;
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  const id = cred.user.uid;
  await update(ref(db), {
    [`users/${id}`]: { name, college, createdAt: Date.now() },      // visible to signed-in users
    [`userPrivate/${id}`]: { email, phone }                          // visible to owner + admin only
  });
  return cred.user;
}
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const id = cred.user.uid;
  // Self-heal: create the profile if an earlier signup saved the account but not the profile.
  if (!(await get(ref(db, `users/${id}`))).exists()) {
    await update(ref(db), {
      [`users/${id}`]: { name: cred.user.displayName || "Student", college: "", createdAt: Date.now() },
      [`userPrivate/${id}`]: { email: cred.user.email, phone: "" }
    });
  }
  return cred;
}
export const logout = () => signOut(auth);
export const onUser = (cb) => onAuthStateChanged(auth, cb);

// UX only (show/hide admin menu). Real enforcement is in database.rules.json.
export async function isAdmin() {
  if (!auth.currentUser) return false;
  return (await get(ref(db, `admins/${auth.currentUser.uid}`))).exists();
}
// Preferred area, stored privately (owner + admin only) as area name + approximate coordinates. Never a street address.
export const saveLocationPref = (loc) =>
  set(ref(db, `userPrivate/${uid()}/locationPref`), { area: loc.area, lat: loc.lat, lng: loc.lng, src: loc.src || "manual" });
export async function getLocationPref() {
  const s = await get(ref(db, `userPrivate/${uid()}/locationPref`));
  return s.exists() ? s.val() : null;
}
// Own mobile number (stored privately: owner + admin only). Returns "" when none is saved yet.
export async function getMyPhone() {
  const s = await get(ref(db, `userPrivate/${uid()}/phone`));
  return s.exists() ? String(s.val() || "") : "";
}
export async function savePhone(phone) {
  const p = normPhone(phone);
  if (!p) throw new Error("Please enter a valid 10-digit mobile number.");
  await set(ref(db, `userPrivate/${uid()}/phone`), p);
  return p;
}
// Edit own profile: name + college (public profile) and mobile number (private).
export async function updateMyProfile({ name, college = "", phone }) {
  const me = uid();
  name = String(name || "").trim();
  college = String(college || "").trim();
  if (!name) throw new Error("Please enter your name.");
  if (name.length > 60) throw new Error("Name is too long (max 60 characters).");
  if (college.length > 80) throw new Error("College name is too long (max 80 characters).");
  const p = normPhone(phone);
  if (!p) throw new Error("Please enter a valid 10-digit mobile number.");
  await updateProfile(auth.currentUser, { displayName: name });
  const writes = {
    [`users/${me}/name`]: name,
    [`users/${me}/college`]: college,
    [`userPrivate/${me}/phone`]: p
  };
  // Older accounts may have no profile record yet: the rules require createdAt on it.
  if (!(await get(ref(db, `users/${me}`))).exists()) writes[`users/${me}/createdAt`] = Date.now();
  await update(ref(db), writes);
  return { name, college, phone: p };
}
// Email changes need the current password; Firebase then emails a link to the NEW address and only switches after it is opened.
export async function changeEmail(newEmail, password) {
  const u = auth.currentUser;
  if (!u) throw new Error("Please log in first.");
  newEmail = String(newEmail || "").trim().toLowerCase();
  if (newEmail === String(u.email || "").toLowerCase()) throw new Error("That is already your email.");
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
    await verifyBeforeUpdateEmail(u, newEmail);
  } catch (e) {
    const m = { "auth/wrong-password": "Current password is wrong.", "auth/invalid-credential": "Current password is wrong.",
      "auth/email-already-in-use": "That email is already used by another account.", "auth/invalid-email": "Enter a valid email address.",
      "auth/too-many-requests": "Too many attempts. Try again in a few minutes." }[e.code];
    throw new Error(m || e.message);
  }
}
// Keeps the admin-visible copy of the email in step with the login email (after a verified change).
export async function syncEmail() {
  const u = auth.currentUser; if (!u || !u.email) return;
  const r = ref(db, `userPrivate/${u.uid}/email`);
  if ((await get(r)).val() !== u.email) await set(r, u.email);
}
export async function getUser(id) {
  const s = await get(ref(db, `users/${id}`));
  return s.exists() ? { id, ...s.val() } : null;
}

/* ---------------- CATEGORIES ---------------- */
export function listenCategories(cb) {
  return onValue(ref(db, "categories"), (s) =>
    cb(toList(s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))));
}
// Admin-only (rules enforce it). Adds missing categories, never overwrites/deletes existing ones.
export async function seedCategories() {
  const defaults = [
    ["iot", "IoT & Components"], ["books", "Books & Notes"], ["shoes-clothes", "Shoes & Clothes"],
    ["electronics", "Electronics"], ["hostel", "Hostel Essentials"], ["services", "Services"],
    ["traditional", "Traditional Wear"], ["projects", "Projects"], ["others", "Others"],
    ["hot-deals", "Hot Deals"]
  ];
  const existing = (await get(ref(db, "categories"))).val() || {};
  const updates = {};
  defaults.forEach(([id, name], i) => {
    if (!existing[id]) updates[`categories/${id}`] = { name, order: i };
  });
  if (Object.keys(updates).length) await update(ref(db), updates);
  return Object.keys(updates).length;
}

/* ---------------- PRODUCTS ---------------- */
// Images are resized in the browser and stored as small JPEG data-URLs in the Realtime Database
// (no Firebase Storage / billing needed). thumb lives on the product; full images in productImages/{pid}.
async function decode(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch (_) {} }
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = url;
  });
}
function draw(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}
// Photos are shrunk in parallel (fast), then saved with just 2 database writes.
async function prepare(file, wantThumb) {
  const src = await decode(file);
  const big = draw(src, 640);
  if (src.close) src.close();
  return { full: big.toDataURL("image/jpeg", 0.6), thumb: wantThumb ? draw(big, 280).toDataURL("image/jpeg", 0.65) : "" };
}
export async function addProduct(data, files = []) {
  const me = uid();
  const pid = push(ref(db, "products")).key;
  const picks = [...files].slice(0, 3);
  const done = await Promise.all(picks.map((f, i) => prepare(f, i === 0)));
  // Approximate pickup area only (area name + the area's centre point), never a seller's exact address.
  const hasGeo = data.area && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng));
  const geo = hasGeo ? { area: String(data.area), lat: Number(data.lat), lng: Number(data.lng) } : {};
  const full = done.map((d) => d.full);
  const record = {
    title: data.title, description: data.description || "",
    price: Number(data.price), originalPrice: Number(data.originalPrice || data.price),
    category: data.category, condition: data.condition || "Used",
    location: data.area || data.location || "", ...geo, thumb: done[0]?.thumb || "", imageCount: full.length,
    sellerId: me, verified: false, status: "active", createdAt: Date.now()
  };
  // ONE database round trip: product + all photos together (rules updated to allow this; see database.rules.json).
  const writes = { [`products/${pid}`]: record };
  full.forEach((d, i) => { writes[`productImages/${pid}/${i}`] = d; });
  await update(ref(db), writes);
  return pid;
}
export async function getProductImages(pid) {
  const s = await get(ref(db, `productImages/${pid}`));
  return s.exists() ? Object.values(s.val()) : [];
}
export const updateProduct = (pid, fields) =>
  update(ref(db, `products/${pid}`), { ...fields, updatedAt: Date.now() });
export const markSold = (pid) => updateProduct(pid, { status: "sold" });
export async function deleteProduct(pid) {
  // Prefer the secure backend (also cleans favourites); fall back to direct rules-protected delete.
  try {
    const r = await fetch(`/api/products/${pid}`, { method: "DELETE", headers: { Authorization: "Bearer " + await auth.currentUser.getIdToken() } });
    if (r.ok) return;
  } catch (_) {}
  await update(ref(db), { [`productImages/${pid}`]: null, [`products/${pid}`]: null });
}
// Real-time product feed. opts: { category, sellerId }. Returns an unsubscribe function.
export function listenProducts(cb, opts = {}, onError) {
  let q = ref(db, "products");
  if (opts.sellerId) q = query(q, orderByChild("sellerId"), equalTo(opts.sellerId));
  else if (opts.category) q = query(q, orderByChild("category"), equalTo(opts.category));
  return onValue(q, (s) =>
    cb(toList(s).filter((p) => p.status === "active" || opts.sellerId)
      .sort((a, b) => b.createdAt - a.createdAt)), onError);
}
export async function getProduct(pid) {
  const s = await get(ref(db, `products/${pid}`));
  return s.exists() ? { id: pid, ...s.val() } : null;
}
// Admin-only (rules enforce it)
export const verifyProduct = (pid, v = true) => update(ref(db, `products/${pid}`), { verified: v });

/* ---------------- FAVOURITES ---------------- */
export async function toggleFavourite(pid) {
  const r = ref(db, `favourites/${uid()}/${pid}`);
  if ((await get(r)).exists()) { await remove(r); return false; }
  await set(r, Date.now()); return true;
}
export const listenFavouriteIds = (cb) =>
  onValue(ref(db, `favourites/${uid()}`), (s) => cb(Object.keys(s.val() || {})));

/* ---------------- BUYING REQUESTS ---------------- */
export async function sendRequest(product, message = "") {
  const me = uid();
  if (product.sellerId === me) throw new Error("You can't request your own product.");
  if (!(await getMyPhone())) throw new Error("Please add your mobile number first.");
  const rid = push(ref(db, "requests")).key;
  // order matters: rules check the request exists before allowing the index entries
  // status = seller's decision, adminStatus = admin's verification ("pending" | "approved" | "rejected")
  await set(ref(db, `requests/${rid}`), {
    productId: product.id, productTitle: product.title, buyerId: me,
    buyerName: auth.currentUser.displayName || "Student",
    sellerId: product.sellerId, message, status: "pending", adminStatus: "pending", createdAt: Date.now()
  });
  await set(ref(db, `userRequests/${me}/${rid}`), true);
  await set(ref(db, `userRequests/${product.sellerId}/${rid}`), true);
  await notify(product.sellerId, "request", "New buying request",
    `${auth.currentUser.displayName || "A student"} wants "${product.title}"`, { requestId: rid });
  return rid;
}
// Seller: "accepted" | "rejected". Buyer: "cancelled".
export async function setRequestStatus(rid, status, otherUid, title) {
  await set(ref(db, `requests/${rid}/status`), status);
  await notify(otherUid, "request", `Request ${status}`, title || "", { requestId: rid });
}
// Admin-only (rules enforce it): verify or reject a request, and tell both people.
export async function setAdminStatus(rid, status, buyerId, sellerId, title = "") {
  await update(ref(db, `requests/${rid}`), { adminStatus: status, adminUpdatedAt: Date.now() });
  const word = status === "approved" ? "verified by admin" : "rejected by admin";
  await Promise.all([buyerId, sellerId].filter(Boolean).map((u) =>
    notify(u, "request", `Request ${word}`, title, { requestId: rid }).catch(() => {})));
}
// Real-time list of all requests I'm part of (as buyer or seller).
export function listenMyRequests(cb) {
  const me = uid();
  const cache = {};
  const unsubs = [];
  const idsUnsub = onValue(ref(db, `userRequests/${me}`), (s) => {
    unsubs.splice(0).forEach((u) => u());
    const ids = Object.keys(s.val() || {});
    if (!ids.length) return cb([]);
    ids.forEach((id) => unsubs.push(onValue(ref(db, `requests/${id}`), (rs) => {
      if (rs.exists()) cache[id] = { id, ...rs.val() };
      cb(ids.map((i) => cache[i]).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt));
    })));
  });
  return () => { idsUnsub(); unsubs.forEach((u) => u()); };
}

/* ---------------- NOTIFICATIONS ---------------- */
export function notify(toUid, type, title, message, extra = {}) {
  return push(ref(db, `notifications/${toUid}`), {
    type, title, message, ...extra, fromUid: uid(), read: false, createdAt: Date.now()
  });
}
export const listenNotifications = (cb) =>
  onValue(ref(db, `notifications/${uid()}`), (s) =>
    cb(toList(s).sort((a, b) => b.createdAt - a.createdAt)));
export const markNotificationRead = (nid) => set(ref(db, `notifications/${uid()}/${nid}/read`), true);
export const deleteNotification = (nid) => remove(ref(db, `notifications/${uid()}/${nid}`));