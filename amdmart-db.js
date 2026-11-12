// amdmart-db.js — every AMD Mart feature reads/writes Firebase through these functions.
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile,
  EmailAuthProvider, reauthenticateWithCredential, verifyBeforeUpdateEmail
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
export async function register({ name, email, password, phone = "", college = "" }) {
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
export async function getUser(id) {
  const s = await get(ref(db, `users/${id}`));
  return s.exists() ? { id, ...s.val() } : null;
}


/* ---------------- PROFILE / PHONE / LOCATION / EMAIL ---------------- */
const cleanPhone = (p) => {
  const v = String(p || "").replace(/[\s-]/g, "");
  if (!/^\+?[0-9]{10,15}$/.test(v)) throw new Error("Enter a valid mobile number (10 digits).");
  return v;
};
export async function getMyPhone() {
  const s = await get(ref(db, `userPrivate/${uid()}/phone`));
  return s.exists() ? s.val() : "";
}
export async function savePhone(phone) {
  const v = cleanPhone(phone);
  await set(ref(db, `userPrivate/${uid()}/phone`), v);
  return v;
}
// Returns { phone, college } (script.js stores it in S.me)
export async function updateMyProfile({ name, phone, college = "" }) {
  const id = uid();
  name = String(name || "").trim();
  if (!name) throw new Error("Name is required.");
  const p = cleanPhone(phone);
  const c = String(college || "").trim();
  await update(ref(db), {
    [`users/${id}/name`]: name,
    [`users/${id}/college`]: c,
    [`userPrivate/${id}/phone`]: p
  });
  await updateProfile(auth.currentUser, { displayName: name });
  return { phone: p, college: c };
}
// Sends a verification link to the new address; the email changes only after the link is opened.
export async function changeEmail(newEmail, password) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in first.");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  await verifyBeforeUpdateEmail(user, newEmail);
}
// After the user verified a new email, copy it into userPrivate so the database matches the account.
export async function syncEmail() {
  const user = auth.currentUser;
  if (!user || !user.email) return;
  const r = ref(db, `userPrivate/${user.uid}/email`);
  if ((await get(r)).val() !== user.email) await set(r, user.email);
}
// Saved area (account-wide, private to the user): { area, lat, lng, src }
export const saveLocationPref = (loc) =>
  set(ref(db, `userPrivate/${uid()}/location`), { area: loc.area, lat: loc.lat, lng: loc.lng, src: loc.src || "manual" });
export async function getLocationPref() {
  const s = await get(ref(db, `userPrivate/${uid()}/location`));
  return s.exists() ? s.val() : null;
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
  // As sharp as the database rule allows (< 400,000 characters per photo): start big, shrink only if needed.
  let dim = 1280, q = 0.72, full = "";
  for (let k = 0; k < 10; k++) {
    full = draw(src, dim).toDataURL("image/jpeg", q);
    if (full.length < 380000) break;
    if (q > 0.5) q -= 0.08; else dim = Math.round(dim * 0.85);
  }
  const thumb = wantThumb ? draw(src, 280).toDataURL("image/jpeg", 0.65) : "";
  if (src.close) src.close();
  return { full, thumb };
}
// Every new listing is shown at the seller's price + 10% (100 → 110). Done here so the seller never sees or does anything extra.
export const MARKUP_PCT = 10;
export async function addProduct(data, files = []) {
  const me = uid();
  const price = Math.round(Number(data.price) * (100 + MARKUP_PCT) / 100);
  if (!(price >= 0) || price > 10000000) throw new Error("Enter a valid price.");
  const pid = push(ref(db, "products")).key;
  const picks = [...files].slice(0, 3);
  const done = await Promise.all(picks.map((f, i) => prepare(f, i === 0)));
  const full = done.map((d) => d.full);
  await set(ref(db, `products/${pid}`), {
    title: data.title, description: data.description || "",
    price, sellerPrice: Math.round(Number(data.price)),   // seller's own price (before the +10%), used by the admin Requests/Income tabs
    originalPrice: Number(data.originalPrice || price),
    category: data.category, condition: data.condition || "Used",
    location: data.area || data.location || "",
    area: data.area || data.location || "",
    ...(Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng)) ? { lat: Number(data.lat), lng: Number(data.lng) } : {}),
    thumb: done[0]?.thumb || "", imageCount: full.length,
    sellerId: me, verified: false, status: "active", createdAt: Date.now()
  });
  // product must exist first: the image rules check the product's owner. One write for all photos.
  if (full.length) await update(ref(db, `productImages/${pid}`), Object.fromEntries(full.map((d, i) => [i, d])));
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
  // photos first (their rule needs the product to still exist); never block the delete if that fails
  try { await remove(ref(db, `productImages/${pid}`)); } catch (_) {}
  await remove(ref(db, `products/${pid}`));
}
// Real-time product feed. opts: { category, sellerId }. Returns an unsubscribe function.
export function listenProducts(cb, opts = {}, onError) {
  let q = ref(db, "products");
  if (opts.sellerId) q = query(q, orderByChild("sellerId"), equalTo(opts.sellerId));
  else if (opts.category) q = query(q, orderByChild("category"), equalTo(opts.category));
  return onValue(q, (s) =>
    cb(toList(s).filter((p) => p.status === "active" || opts.sellerId)
      .sort((a, b) => b.createdAt - a.createdAt)), (err) => { console.error(err); if (onError) onError(err); });
}
export async function getProduct(pid) {
  const s = await get(ref(db, `products/${pid}`));
  return s.exists() ? { id: pid, ...s.val() } : null;
}
// Admin-only (rules enforce it)
export const verifyProduct = (pid, v = true) => update(ref(db, `products/${pid}`), { verified: v });

// Admin-only (rules enforce it): verify / reject a buying request and tell both people.
export async function setAdminStatus(rid, status, buyerId, sellerId, title) {
  await update(ref(db, `requests/${rid}`), { adminStatus: status, adminUpdatedAt: Date.now() });
  const word = status === "approved" ? "verified" : status === "rejected" ? "rejected" : status;
  // only the buyer is told; the seller is contacted by the admin on WhatsApp
  if (buyerId) await notify(buyerId, "request", `Request ${word} by admin`, title || "", { requestId: rid });
}

/* ---------------- FAVOURITES ---------------- */
export async function toggleFavourite(pid) {
  const r = ref(db, `favourites/${uid()}/${pid}`);
  if ((await get(r)).exists()) { await remove(r); return false; }
  await set(r, Date.now()); return true;
}
export const listenFavouriteIds = (cb) =>
  onValue(ref(db, `favourites/${uid()}`), (s) => cb(Object.keys(s.val() || {})));

/* ---------------- COUPONS ---------------- */
// coupons/<CODE> = { code, type: "pct" | "flat", value, maxUses, used, active, createdAt }
export const normCoupon = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
export function couponDiscount(c, price) {
  const p = Number(price) || 0, v = Number(c.value) || 0;
  return Math.max(0, Math.min(p, Math.round(c.type === "flat" ? v : p * v / 100)));
}
// Buyer: checks a code against a price (read only). One account (= one email) can use a coupon only once:
// couponUses/<CODE>/<uid> is written together with the use count, so it exists once the coupon was used.
// Returns { code, type, value, maxUses, used, discount, finalPrice }.
export async function checkCoupon(raw, price) {
  const code = normCoupon(raw);
  if (code.length < 3) throw new Error("Enter a valid coupon code.");
  let c = null, mine = false;
  try {
    const [s, m] = await Promise.all([get(ref(db, `coupons/${code}`)), get(ref(db, `couponUses/${code}/${uid()}`))]);
    c = s.exists() ? s.val() : null; mine = m.exists();
  } catch (e) { throw new Error(e.message === "Please log in first." ? e.message : "Couldn't check the coupon. Please try again."); }
  if (!c || c.active === false) throw new Error("This coupon code isn't valid.");
  if (mine) throw new Error("You have reached the maximum use limit of this coupon.");
  const maxUses = Number(c.maxUses) || 0, used = Number(c.used) || 0;
  if (used >= maxUses) throw new Error("This coupon has reached its usage limit.");
  const discount = couponDiscount(c, price);
  if (discount <= 0) throw new Error("This coupon doesn't apply to this product.");
  return { code, type: c.type, value: Number(c.value), maxUses, used, discount, finalPrice: Number(price) - discount };
}
// Admin-only (rules enforce it)
export async function createCoupon({ code, type, value, maxUses }) {
  code = normCoupon(code);
  if (code.length < 3 || code.length > 20) throw new Error("Coupon code must be 3 to 20 letters or numbers.");
  if (type !== "pct" && type !== "flat") throw new Error("Choose a discount type.");
  value = Number(value); maxUses = Math.floor(Number(maxUses));
  if (!(value > 0)) throw new Error("Enter a discount greater than 0.");
  if (type === "pct" && value > 100) throw new Error("A percentage discount can't be more than 100.");
  if (!(maxUses >= 1)) throw new Error("Max uses must be at least 1.");
  const r = ref(db, `coupons/${code}`);
  if ((await get(r)).exists()) throw new Error("That coupon code already exists.");
  await set(r, { code, type, value, maxUses, used: 0, active: true, createdAt: Date.now() });
}
export const setCouponActive = (code, on) => update(ref(db, `coupons/${code}`), { active: !!on });
// also clears who used it, so the same code can be created again later with a clean slate
export const deleteCoupon = (code) => update(ref(db), { [`coupons/${code}`]: null, [`couponUses/${code}`]: null });

/* ---------------- BUYING REQUESTS ---------------- */
export async function sendRequest(product, message = "", couponCode = "") {
  const me = uid();
  if (product.sellerId === me) throw new Error("You can't request your own product.");
  const rid = push(ref(db, "requests")).key;
  const name = auth.currentUser.displayName || "Student";
  const body = {
    productId: product.id, productTitle: product.title, buyerId: me, buyerName: name,
    sellerId: product.sellerId, message, status: "pending", createdAt: Date.now()
  };
  if (!couponCode) await set(ref(db, `requests/${rid}`), body);
  else {
    // The request, the coupon's use count and "this account used it" are saved in ONE atomic write:
    // either all three happen or none. If someone else took the last use a moment ago, re-check and retry.
    for (let i = 0; ; i++) {
      const c = await checkCoupon(couponCode, product.price);
      try {
        await update(ref(db), {
          [`coupons/${c.code}/used`]: c.used + 1,
          [`couponUses/${c.code}/${me}`]: Date.now(),
          [`requests/${rid}`]: { ...body, couponCode: c.code, couponType: c.type, couponValue: c.value,
            couponDiscount: c.discount, listedPrice: Number(product.price), finalPrice: c.finalPrice }
        });
        break;
      } catch (_) { if (i >= 2) throw new Error("Couldn't apply the coupon. Please try again."); }
    }
  }
  // the request must exist first (rules check it); after that the three small writes run together
  await Promise.all([
    set(ref(db, `userRequests/${me}/${rid}`), true),
    set(ref(db, `userRequests/${product.sellerId}/${rid}`), true),
    // the seller only hears that someone asked; no buyer name or details. The admin takes it from here on WhatsApp.
    notify(product.sellerId, "request", "Someone requested your product",
      `Someone made a request for your product "${String(product.title).slice(0, 100)}". Admin will contact you on WhatsApp regarding it.`, { requestId: rid })
  ]);
  return rid;
}
// Buyer only: "cancelled". (Requests go to the admin, so the seller is not asked and not notified.)
export async function setRequestStatus(rid, status) {
  await set(ref(db, `requests/${rid}/status`), status);
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