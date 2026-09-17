import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function firebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}

let app: FirebaseApp | undefined;

if (typeof window !== "undefined" && firebaseConfigured()) {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;

export async function signInWithEmail(email: string, password: string) {
  if (!auth) throw new Error("Firebase is not configured yet.");
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerWithEmail(email: string, password: string) {
  if (!auth) throw new Error("Firebase is not configured yet.");
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function signInWithGoogle() {
  if (!auth) throw new Error("Firebase is not configured yet.");
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutFirebase() {
  if (!auth) return;
  await signOut(auth);
}

export async function updateFirebaseProfile(displayName: string, photoURL?: string) {
  if (!auth?.currentUser) throw new Error("Please sign in first.");
  await updateProfile(auth.currentUser, { displayName: displayName.trim() || undefined, photoURL: photoURL?.trim() || null });
}

export async function resetPassword(email?: string) {
  if (!auth) throw new Error("Firebase is not configured yet.");
  const target = String(email || auth.currentUser?.email || "").trim();
  if (!target) throw new Error("No email address is available for password reset.");
  await sendPasswordResetEmail(auth, target);
}

export function subscribeAuth(callback: (user: User | null) => void) {
  if (!auth) { callback(null); return () => {}; }
  return onAuthStateChanged(auth, callback);
}
