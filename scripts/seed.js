// npm run seed — adds the default categories that are missing. Never overwrites or deletes data.
const { admin, enabled, keyPath } = require("./firebase-admin");
if (!enabled) { console.error(`Service account key not found at ${keyPath}. See README.`); process.exit(1); }
const DEFAULTS = [["iot", "IoT & Components"], ["books", "Books & Notes"], ["shoes-clothes", "Shoes & Clothes"],
  ["electronics", "Electronics"], ["hostel", "Hostel Essentials"], ["services", "Services"],
  ["traditional", "Traditional Wear"], ["projects", "Projects"], ["others", "Others"], ["hot-deals", "Hot Deals"]];
(async () => {
  const db = admin.database();
  const existing = (await db.ref("categories").once("value")).val() || {};
  const updates = {};
  DEFAULTS.forEach(([id, name], i) => { if (!existing[id]) updates[`categories/${id}`] = { name, order: i }; });
  if (Object.keys(updates).length) await db.ref().update(updates);
  console.log(`Added ${Object.keys(updates).length} categories, kept ${DEFAULTS.length - Object.keys(updates).length} existing.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
