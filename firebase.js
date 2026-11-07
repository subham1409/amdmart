// firebase.js — the ONLY place Firebase is configured.
// The web config below is public by design (security comes from the Rules files).
// Never put a service-account private key in frontend code.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBSw9p-3xBLKHQUywSjF2Xg8NUsREI9qzE",
  authDomain: "amdmart-cb4d9.firebaseapp.com",
  // Confirmed Realtime Database URL (from your Firebase console)
  databaseURL: "https://amdmart-cb4d9-default-rtdb.firebaseio.com",
  projectId: "amdmart-cb4d9",
  storageBucket: "amdmart-cb4d9.firebasestorage.app",
  messagingSenderId: "815864203042",
  appId: "1:815864203042:web:dac0ac0ad0e47b92c0877b",
  measurementId: "G-363961WHM1"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);