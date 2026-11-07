# AMD Mart – Ahmedabad Students' Marketplace

Buy · Sell · Reuse · Connect. Frontend: plain HTML/CSS/JS. Backend: **Firebase only**
(Authentication, Realtime Database, Storage). No SQL, no other database.

## Structure
```
index.html / style.css / script.js   storefront (home, explore, requests, profile, post ad)
firebase.js                          Firebase config + init (single place)
amdmart-db.js                        all database/auth/storage functions
admin/                               admin panel (products, requests, users, categories)
database.rules.json / storage.rules  security rules
server.js + scripts/                 static server, secure Admin-SDK API, seed + make-admin scripts
```

## Run
```
npm install
cp .env.example .env
npm start        # http://localhost:3000
```
(ES modules need http://, so don't open index.html via file://.)

## Firebase setup (project amdmart-cb4d9)
1. Console → Authentication → enable **Email/Password**.
2. Create **Realtime Database** and **Storage** if not already created.
3. Check `databaseURL` in `firebase.js` matches Console → Realtime Database.
4. Compare, then publish `database.rules.json` (Realtime Database → Rules) and
   `storage.rules` (Storage → Rules), or `firebase deploy --only database,storage`.
   Rules never delete data, but they replace any existing rules.
5. Add `localhost` / your domain in Authentication → Settings → Authorized domains.

## Backend (Firebase Admin SDK) — optional but recommended
1. Firebase Console → Project settings → Service accounts → **Generate new private key**.
   Save it as `serviceAccountKey.json` in this folder (it is git-ignored; never share it or put it in frontend code).
2. `cp .env.example .env`, then:
```
npm run seed                          # creates default categories (adds missing only)
npm run make-admin -- you@email.com   # after you've signed up on the site
npm start                             # API: /api/health, /api/stats (admin), DELETE /api/products/:id
```
Without the key the site still works directly through the Firebase rules; only the `/api` routes are off.

## Make yourself admin (manual alternative)
1. Sign up on the site, copy your UID (Authentication → Users).
2. Realtime Database console → add `admins/<your-uid>` = `true` (clients can't write this node).
3. Open `/admin/admin.html`, log in, Categories tab → **Add default categories** (adds missing only).

## Security notes
- Admin power comes only from `admins/<uid>` checked in the database rules, never from frontend code.
- Owners can edit/delete only their own products; only admins can set `verified`.
- Requests are visible only to buyer, seller and admins; favourites are private.
- Never commit service-account keys. Consider API-key domain restrictions and App Check.
