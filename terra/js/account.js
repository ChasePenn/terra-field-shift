// Accounts and saved plans. With Firebase set up, plans sync live across devices
// (Google sign-in + Firestore). Without it, plans stay in this browser.
import { FIREBASE } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const LOCAL = 'terra-saved';
let fb = null, user = null, unsub = null;
let plans = readLocal();
const listeners = new Set();

function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; } }
function writeLocal() { try { localStorage.setItem(LOCAL, JSON.stringify(plans)); } catch { /* full or blocked */ } }
function emit() { for (const f of listeners) f({ user, plans, cloud: !!fb }); }

export const accountsReady = () => !!FIREBASE;
export function onAccount(f) { listeners.add(f); f({ user, plans, cloud: !!fb }); return () => listeners.delete(f); }
export function getPlans() { return plans; }

export async function initAccount() {
  if (!FIREBASE) return;
  try {
    const [{ initializeApp }, auth, store] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
    const app = initializeApp(FIREBASE);
    fb = { auth, store, a: auth.getAuth(app), db: store.getFirestore(app) };
    auth.onAuthStateChanged(fb.a, (u) => {
      user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;
      unsub?.(); unsub = null;
      if (user) {
        const ref = store.doc(fb.db, 'users', user.uid);
        let first = true;
        unsub = store.onSnapshot(ref, (snap) => {
          const cloud = snap.exists() ? snap.data().plans || [] : [];
          if (first) {
            first = false;
            // Bring plans saved on this device into the account once.
            const ids = new Set(cloud.map((p) => p.id));
            const extra = readLocal().filter((p) => !ids.has(p.id));
            if (extra.length) { plans = [...cloud, ...extra]; push(); return emit(); }
          }
          plans = cloud; writeLocal(); emit();
        });
      } else { plans = readLocal(); emit(); }
    });
  } catch (e) { console.warn('Accounts unavailable', e); fb = null; emit(); }
}

function push() {
  writeLocal();
  if (fb && user) fb.store.setDoc(fb.store.doc(fb.db, 'users', user.uid), { plans, updated: Date.now() }).catch((e) => console.warn(e));
}

export async function signIn() {
  if (!fb) throw new Error('no-accounts');
  const p = new fb.auth.GoogleAuthProvider();
  try { await fb.auth.signInWithPopup(fb.a, p); } catch (e) {
    if (String(e.code).includes('popup')) return fb.auth.signInWithRedirect(fb.a, p);
    throw e;
  }
}
export async function signOutNow() { if (fb) await fb.auth.signOut(fb.a); }

export function savePlan(p) { plans = [p, ...plans.filter((x) => x.id !== p.id)].slice(0, 30); push(); emit(); }
export function removePlan(id) { plans = plans.filter((x) => x.id !== id); push(); emit(); }
export function renamePlan(id, name) { const p = plans.find((x) => x.id === id); if (p) { p.name = name; push(); emit(); } }
