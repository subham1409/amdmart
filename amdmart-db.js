// amdmart-db.js — every AMD Mart feature reads/writes Firebase through these functions.
import { auth, db, storage } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  ref, get, set, update, remove, push, query, orderByChild, equalTo,
  onValue, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import {
  ref as sRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

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
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
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
// files: array of File objects (images). Stored in Firebase Storage, URLs saved in the database.
export async function addProduct(data, files = []) {
  const me = uid();
  const pid = push(ref(db, "products")).key;
  const imageUrls = [];
  for (let i = 0; i < Math.min(files.length, 5); i++) {
    const r = sRef(storage, `products/${me}/${pid}/${Date.now()}_${i}`);
    await uploadBytes(r, files[i], { contentType: files[i].type });
    imageUrls.push(await getDownloadURL(r));
  }
  const product = {
    title: data.title, description: data.description || "",
    price: Number(data.price), originalPrice: Number(data.originalPrice || data.price),
    category: data.category, condition: data.condition || "Used",
    location: data.location || "", imageUrls,
    sellerId: me, verified: false, status: "active", createdAt: Date.now()
  };
  await set(ref(db, `products/${pid}`), product);
  return pid;
}
export const updateProduct = (pid, fields) =>
  update(ref(db, `products/${pid}`), { ...fields, updatedAt: Date.now() });
export const markSold = (pid) => updateProduct(pid, { status: "sold" });
export async function deleteProduct(pid) {
  const s = await get(ref(db, `products/${pid}/imageUrls`));
  await remove(ref(db, `products/${pid}`));
  // best-effort image cleanup (storage rules only let the owner delete)
  for (const url of Object.values(s.val() || {})) {
    try { await deleteObject(sRef(storage, url)); } catch (_) {}
  }
}
// Real-time product feed. opts: { category, sellerId }. Returns an unsubscribe function.
export function listenProducts(cb, opts = {}) {
  let q = ref(db, "products");
  if (opts.sellerId) q = query(q, orderByChild("sellerId"), equalTo(opts.sellerId));
  else if (opts.category) q = query(q, orderByChild("category"), equalTo(opts.category));
  return onValue(q, (s) =>
    cb(toList(s).filter((p) => p.status === "active" || opts.sellerId)
      .sort((a, b) => b.createdAt - a.createdAt)));
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
  const rid = push(ref(db, "requests")).key;
  // order matters: rules check the request exists before allowing the index entries
  await set(ref(db, `requests/${rid}`), {
    productId: product.id, productTitle: product.title, buyerId: me,
    buyerName: auth.currentUser.displayName || "Student",
    sellerId: product.sellerId, message, status: "pending", createdAt: Date.now()
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
