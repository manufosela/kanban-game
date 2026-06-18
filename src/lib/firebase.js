// Inicialización única del SDK de Firebase (cliente).
// La config es pública por diseño; la seguridad la imponen las reglas de RTDB.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FB_API_KEY,
  authDomain: import.meta.env.PUBLIC_FB_AUTH_DOMAIN,
  databaseURL: import.meta.env.PUBLIC_FB_DATABASE_URL,
  projectId: import.meta.env.PUBLIC_FB_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FB_APP_ID,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
