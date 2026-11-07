// Server-side Firebase Admin init. The service-account key stays on the server/your PC only.
require("dotenv").config();
const admin = require("firebase-admin");
const fs = require("fs");

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT || "./serviceAccountKey.json";
let enabled = false;
if (fs.existsSync(keyPath)) {
  admin.initializeApp({
    credential: admin.credential.cert(require(require("path").resolve(keyPath))),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://amdmart-cb4d9-default-rtdb.firebaseio.com",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "amdmart-cb4d9.firebasestorage.app"
  });
  enabled = true;
}
module.exports = { admin, enabled, keyPath };
