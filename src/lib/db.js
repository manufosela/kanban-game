// Acceso a datos de administración: usuarios, equipos, tableros y asignaciones.
import {
  ref, update, remove, get, onValue, serverTimestamp,
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
/** Rol de juego por defecto (real) de una persona. */
export async function setUserDefaultRole(uid, role) {
  await update(ref(db, `users/${uid}`), { defaultRole: role || null });
}
export async function setInvitedRole(key, role) {
  await update(ref(db, `invitedUsers/${key}`), { role: role || null });
}

// ---- Helpers de tablero ----
function makeColumns(arr) {
  return arr.reduce((acc, c, i) => {
    const colId = c.id || newId('col');
    acc[colId] = { name: c.name, order: i, wipLimit: c.wipLimit ?? null };
    return acc;
  }, {});
}
function boardData(name, teamId, mode, columns, createdBy) {
  return {
    name, teamId, mode, // mode: 'nowip' | 'wip' (fijo)
    createdBy: createdBy || null,
    createdAt: serverTimestamp(),
    round: 0,
    status: 'setup',
    columns,
    roleAssignments: {},
  };
}

// ---- Equipos (cada equipo = pareja de tableros: sin WIP + con WIP) ----
export async function createTeam(name, createdBy) {
  const teamId = newId('team');
  const boardNoWip = newId('board');
  const boardWip = newId('board');
  const colsNoWip = makeColumns(defaultColumns().map((c) => ({ ...c, wipLimit: null })));
  const colsWip = makeColumns(defaultColumns());
  const updates = {};
  updates[`boards/${boardNoWip}`] = boardData(`${name} · sin WIP`, teamId, 'nowip', colsNoWip, createdBy);
  updates[`boards/${boardWip}`] = boardData(`${name} · con WIP`, teamId, 'wip', colsWip, createdBy);
  updates[`teams/${teamId}`] = {
    name, createdBy: createdBy || null, createdAt: serverTimestamp(),
    members: {}, boardNoWip, boardWip,
  };
  await update(ref(db), updates);
  return { id: teamId, name, members: {}, boardNoWip, boardWip };
}
export async function renameTeam(teamId, name) {
  await update(ref(db, `teams/${teamId}`), { name });
}
export async function deleteTeam(team) {
  const updates = {};
  updates[`teams/${team.id}`] = null;
  for (const bid of [team.boardNoWip, team.boardWip].filter(Boolean)) {
    updates[`boards/${bid}`] = null;
    updates[`games/${bid}`] = null;
    updates[`results/${bid}`] = null;
  }
  await update(ref(db), updates);
}

// ---- Tableros ----
export async function updateBoard(boardId, patch) {
  await update(ref(db, `boards/${boardId}`), patch);
}
export async function renameBoard(boardId, name) {
  await update(ref(db, `boards/${boardId}`), { name });
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

// ---- Asignaciones (persona -> equipo + rol; se espeja a los 2 tableros) ----
export async function assignToTeam(team, uid, role) {
  const updates = {};
  updates[`teams/${team.id}/members/${uid}`] = role; // 'PM'|'DEV'|'QA'
  updates[`users/${uid}/teamId`] = team.id;
  updates[`users/${uid}/gameRole`] = role;
  for (const bid of [team.boardNoWip, team.boardWip].filter(Boolean)) {
    updates[`boards/${bid}/roleAssignments/${uid}`] = role;
  }
  await update(ref(db), updates);
}
export async function unassignFromTeam(team, uid) {
  const updates = {};
  updates[`teams/${team.id}/members/${uid}`] = null;
  for (const bid of [team.boardNoWip, team.boardWip].filter(Boolean)) {
    updates[`boards/${bid}/roleAssignments/${uid}`] = null;
  }
  await update(ref(db), updates);
}

// ---- Sesión del facilitador (modo activo + tiempo) ----
export function watchSession(cb) {
  return onValue(ref(db, 'session'), (s) => cb(s.exists() ? s.val() : { mode: 'nowip', timeLimitMinutes: null }));
}
export async function setSession(patch) {
  await update(ref(db, 'session'), patch);
}

// ---- Pre-registro de personas por email (invitados) ----
export function invKey(email) {
  return 'inv_' + String(email || '').trim().toLowerCase().replace(/[.#$/[\]@]/g, '_');
}
export function watchInvited(cb) {
  return onValue(ref(db, 'invitedUsers'), (s) => cb(toList(s.val())));
}
export async function addInvited(email, name) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const key = invKey(e);
  await update(ref(db, `invitedUsers/${key}`), { email: e, name: name || e, teamId: null, role: null });
  return key;
}
export async function deleteInvited(key) { await remove(ref(db, `invitedUsers/${key}`)); }
export async function setInvitedAssignment(key, teamId, role) {
  await update(ref(db, `invitedUsers/${key}`), { teamId: teamId || null, role: role || null });
}

/**
 * Al iniciar sesión: si hay un pre-registro con el email del usuario, lo asocia
 * a su equipo y rol (en ambos tableros) y elimina el registro pendiente.
 */
export async function claimInvitedOnLogin(user) {
  if (!user?.email) return false;
  const key = invKey(user.email);
  const snap = await get(ref(db, `invitedUsers/${key}`));
  if (!snap.exists()) return false;
  const inv = snap.val();
  if (inv.teamId) {
    const ts = await get(ref(db, `teams/${inv.teamId}`));
    if (ts.exists()) {
      await assignToTeam({ id: inv.teamId, ...ts.val() }, user.uid, inv.role || 'DEV');
    }
  }
  await remove(ref(db, `invitedUsers/${key}`));
  return true;
}

export async function getBoard(boardId) {
  const s = await get(ref(db, `boards/${boardId}`));
  return s.exists() ? { id: boardId, ...s.val() } : null;
}
