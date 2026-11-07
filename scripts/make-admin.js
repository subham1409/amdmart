// npm run make-admin -- someone@email.com   (user must have signed up on the site first)
const { admin, enabled, keyPath } = require("./firebase-admin");
if (!enabled) { console.error(`Service account key not found at ${keyPath}. See README.`); process.exit(1); }
const email = process.argv[2];
if (!email) { console.error("Usage: npm run make-admin -- user@email.com"); process.exit(1); }
(async () => {
  const user = await admin.auth().getUserByEmail(email);
  await admin.database().ref(`admins/${user.uid}`).set(true);
  console.log(`${email} (${user.uid}) is now an admin.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
