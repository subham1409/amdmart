// server.js — static hosting + secure backend API using the Firebase Admin SDK.
// Database is Firebase Realtime Database only. The service-account key never reaches the browser.
const express = require("express");
const path = require("path");
const { admin, enabled } = require("./scripts/firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;
const root = __dirname;
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "strict-origin-when-cross-origin" });
  next();
});

/* ---------- API ---------- */
const api = express.Router();
api.get("/health", (req, res) => res.json({ ok: true, adminSdk: enabled }));

// Verifies the Firebase ID token and checks admin status in the database (never trusts the client).
async function requireUser(req, res, next) {
  if (!enabled) return res.status(503).json({ error: "Admin SDK not configured" });
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    req.user = await admin.auth().verifyIdToken(token);
    req.isAdmin = (await admin.database().ref(`admins/${req.user.uid}`).once("value")).exists();
    next();
  } catch (_) { res.status(401).json({ error: "Unauthorized" }); }
}
const requireAdmin = (req, res, next) => (req.isAdmin ? next() : res.status(403).json({ error: "Admins only" }));

api.get("/stats", requireUser, requireAdmin, async (req, res) => {
  const db = admin.database(), out = {};
  for (const k of ["users", "products", "requests", "categories"]) out[k] = (await db.ref(k).once("value")).numChildren();
  res.json(out);
});

// Owner or admin: delete product + its images + everyone's favourite entries for it.
api.delete("/products/:id", requireUser, async (req, res) => {
  try {
    const db = admin.database(), id = req.params.id;
    const snap = await db.ref(`products/${id}`).once("value");
    if (!snap.exists()) return res.status(404).json({ error: "Not found" });
    const p = snap.val();
    if (p.sellerId !== req.user.uid && !req.isAdmin) return res.status(403).json({ error: "Not your product" });
    const updates = { [`products/${id}`]: null };
    (await db.ref("favourites").once("value")).forEach((u) => { if (u.hasChild(id)) updates[`favourites/${u.key}/${id}`] = null; });
    await db.ref().update(updates);
    try { await admin.storage().bucket().deleteFiles({ prefix: `products/${p.sellerId}/${id}/` }); } catch (_) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.use("/api", api);

/* ---------- static (whitelist only) ---------- */
["index.html", "style.css", "script.js", "firebase.js", "amdmart-db.js"].forEach((f) =>
  app.get(f === "index.html" ? ["/", "/index.html"] : "/" + f, (req, res) => res.sendFile(path.join(root, f))));
app.use("/images", express.static(path.join(root, "images")));
app.use("/admin", express.static(path.join(root, "admin")));
app.use((req, res) => res.status(404).send("Not found"));

app.listen(PORT, () => console.log(`AMD Mart at http://localhost:${PORT}  (Admin SDK ${enabled ? "ON" : "OFF – add serviceAccountKey.json"})`));
