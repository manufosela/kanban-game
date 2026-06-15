// Acceso a datos de administración: usuarios, equipos, tableros y asignaciones.
import {
  ref, push, set, update, remove, get, onValue, serverTimestamp,
} from 'firebase/database';
import { db } from './firebase.js';
import { defaultColumns } from './rules.js';

function newId(prefix) {
  const rnd = (crypto?.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e6)}`)
    .replace(/-/g, '')
    .slice(0, 12);
  return `${prefix}_${rnd}`;
}

// ---- Suscripciones en tiempo real (devuelven función de desuscripción) ----
export function watchUsers(cb) {
  return onValue(ref(db, 'users'), (s) => cb(toList(s.val())));
}
export function watchTeams(cb) {
  return onValue(ref(db, 'teams'), (s) => cb(toList(s.val())));
}
export function watchBoards(cb) {
  return onValue(ref(db, 'boards'), (s) => cb(toList(s.val())));
}
export function watchBoard(boardId, cb) {
  return onValue(ref(db, `boards/${boardId}`), (s) => cb(s.exists() ? { id: boardId, ...s.val() } : null));
}

function toList(obj) {
  if (!obj) return [];
  return Object.entries(obj).map(([id, v]) => ({ id, ...v }));
}

// ---- Usuarios ----
export async function setUserRole(uid, role) {
  await update(ref(db, `users/${uid}`), { role });
}

// ---- Equipos ----
export async function createTeam(name, createdBy) {
  const id = newId('team');
  await set(ref(db, `teams/${id}`), { name, createdBy, createdAt: serverTimestamp() });
  return id;
}
export async function renameTeam(teamId, name) {
  await update(ref(db, `teams/${teamId}`), { name });
}
export async function deleteTeam(teamId) {
  await remove(ref(db, `teams/${teamId}`));
}

// ---- Tableros ----
/** Crea un tablero con las 7 columnas por defecto (o las indicadas). */
export async function createBoard({ name, teamId, createdBy, columns }) {
  const id = newId('board');
  const cols = (columns || defaultColumns()).reduce((acc, c, i) => {
    const colId = c.id || newId('col');
    acc[colId] = { name: c.name, order: i, wipLimit: c.wipLimit ?? null };
    return acc;
  }, {});
  await set(ref(db, `boards/${id}`), {
    name,
    teamId: teamId || null,
    createdBy,
    createdAt: serverTimestamp(),
    round: 1,
    wipEnabled: false,
    status: 'setup',
    columns: cols,
    roleAssignments: {},
  });
  return id;
}
export async function updateBoard(boardId, patch) {
  await update(ref(db, `boards/${boardId}`), patch);
}
export async function deleteBoard(boardId) {
  await remove(ref(db, `boards/${boardId}`));
  await remove(ref(db, `games/${boardId}`));
}

/** Reemplaza el conjunto de columnas del tablero (array ordenado de columnas). */
export async function setBoardColumns(boardId, columnsArray) {
  const cols = columnsArray.reduce((acc, c, i) => {
    const colId = c.id || newId('col');
    acc[colId] = { name: c.name, order: i, wipLimit: c.wipLimit ?? null };
    return acc;
  }, {});
  await update(ref(db, `boards/${boardId}`), { columns: cols });
}

/** Activa/desactiva o fija el WIP de una columna. */
export async function setColumnWip(boardId, colId, wipLimit) {
  await update(ref(db, `boards/${boardId}/columns/${colId}`), { wipLimit });
}

// ---- Asignaciones (persona -> equipo + tablero + rol de juego) ----
export async function assignPlayer({ boardId, uid, role, teamId }) {
  const updates = {};
  updates[`boards/${boardId}/roleAssignments/${uid}`] = role; // 'PM'|'DEV'|'QA'
  updates[`users/${uid}/teamId`] = teamId || null;
  updates[`users/${uid}/boardId`] = boardId;
  updates[`users/${uid}/gameRole`] = role;
  if (teamId) updates[`teams/${teamId}/members/${uid}`] = true;
  await update(ref(db), updates);
}
export async function unassignPlayer({ boardId, uid }) {
  const updates = {};
  updates[`boards/${boardId}/roleAssignments/${uid}`] = null;
  await update(ref(db), updates);
}

export async function getBoard(boardId) {
  const s = await get(ref(db, `boards/${boardId}`));
  return s.exists() ? { id: boardId, ...s.val() } : null;
}
