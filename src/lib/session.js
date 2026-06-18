// Gestión de sesión: login con Google, alta de usuario en RTDB, rol y guards.
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { ref, get, set, update, serverTimestamp } from 'firebase/database';
import { auth, db, ADMIN_EMAILS } from './firebase.js';
import { claimInvitedOnLogin } from './db.js';

const provider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}

/**
 * Garantiza que existe /users/{uid}. Si es la primera vez:
 *  - rol 'admin' si el email está en ADMIN_EMAILS o si la base de usuarios está vacía.
 *  - rol 'player' en caso contrario.
 * Devuelve el perfil actualizado.
 */
export async function ensureUserRecord(user) {
  const userRef = ref(db, `users/${user.uid}`);
  const snap = await get(userRef);

  if (snap.exists()) {
    // Mantener datos básicos al día sin tocar el rol.
    const profile = snap.val();
    const patch = {};
    if (profile.name !== (user.displayName || profile.name)) patch.name = user.displayName || profile.name || user.email;
    if (profile.photoURL !== (user.photoURL || null)) patch.photoURL = user.photoURL || null;
    if (Object.keys(patch).length) await update(userRef, patch);
    return { uid: user.uid, ...profile, ...patch };
  }

  // Primer registro: determinar si es admin.
  const allUsersSnap = await get(ref(db, 'users'));
  const isFirstUser = !allUsersSnap.exists();
  const emailIsAdmin = ADMIN_EMAILS.includes(String(user.email || '').toLowerCase());
  const role = isFirstUser || emailIsAdmin ? 'admin' : 'player';

  const profile = {
    name: user.displayName || user.email,
    email: user.email,
    photoURL: user.photoURL || null,
    role,
    createdAt: serverTimestamp(),
  };
  await set(userRef, profile);
  return { uid: user.uid, ...profile };
}

/**
 * Observa el estado de autenticación. Llama a `callback({ user, profile })`
 * (profile es null si no hay sesión). Devuelve la función para desuscribirse.
 */
export function watchSession(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return callback({ user: null, profile: null });
    try {
      const profile = await ensureUserRecord(user);
      try { await claimInvitedOnLogin(user); } catch (e) { console.warn('No se pudo reclamar el pre-registro:', e); }
      callback({ user, profile });
    } catch (err) {
      console.error('Error asegurando el registro de usuario:', err);
      callback({ user, profile: null, error: err });
    }
  });
}

/**
 * Guard para páginas. Resuelve con { user, profile } cuando hay acceso.
 * Redirige si no se cumplen las condiciones.
 *  - sin sesión  -> '/'
 *  - requireAdmin y no es admin -> '/dashboard'
 */
export function requireAuth({ requireAdmin = false } = {}) {
  return new Promise((resolve) => {
    const unsub = watchSession(({ user, profile }) => {
      if (!user) {
        window.location.replace('/');
        return;
      }
      if (requireAdmin && profile?.role !== 'admin') {
        window.location.replace('/dashboard');
        return;
      }
      unsub();
      resolve({ user, profile });
    });
  });
}
