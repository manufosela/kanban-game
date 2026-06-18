// Acceso a datos de administración: usuarios, equipos, tableros y asignaciones.
import {
  ref, set, update, remove, get, onValue, serverTimestamp,
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
function boardData(name, teamId, mode, columns, createdBy, partidaId) {
  return {
    name, teamId, mode, // mode: 'nowip' | 'wip' (fijo)
    partidaId: partidaId || null,
    createdBy: createdBy || null,
    createdAt: serverTimestamp(),
    round: 0,
    status: 'setup',
    columns,
    roleAssignments: {},
  };
}

// ---- Equipos (cada equipo = pareja de tableros: sin WIP + con WIP) ----
export async function createTeam(name, createdBy, partidaId = null) {
  const teamId = newId('team');
  const boardNoWip = newId('board');
  const boardWip = newId('board');
  const colsNoWip = makeColumns(defaultColumns().map((c) => ({ ...c, wipLimit: null })));
  const colsWip = makeColumns(defaultColumns());
  const updates = {};
  updates[`boards/${boardNoWip}`] = boardData(`${name} · sin WIP`, teamId, 'nowip', colsNoWip, createdBy, partidaId);
  updates[`boards/${boardWip}`] = boardData(`${name} · con WIP`, teamId, 'wip', colsWip, createdBy, partidaId);
  updates[`teams/${teamId}`] = {
    name, createdBy: createdBy || null, createdAt: serverTimestamp(),
    partidaId: partidaId || null,
    members: {}, boardNoWip, boardWip,
  };
  await update(ref(db), updates);
  return { id: teamId, name, partidaId: partidaId || null, members: {}, boardNoWip, boardWip };
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

// ---- Bots (jugadores ficticios; miembros sintéticos del equipo) ----
export function isBotId(id) { return typeof id === 'string' && id.startsWith('bot_'); }
export function watchBots(cb) {
  return onValue(ref(db, 'bots'), (s) => cb(toList(s.val())));
}
export async function addBotToTeam(team, role, name) {
  const botId = newId('bot');
  const updates = {};
  updates[`bots/${botId}`] = { name: name || 'Bot', createdAt: serverTimestamp(), partidaId: team.partidaId || null };
  updates[`teams/${team.id}/members/${botId}`] = role;
  for (const bid of [team.boardNoWip, team.boardWip].filter(Boolean)) updates[`boards/${bid}/roleAssignments/${botId}`] = role;
  await update(ref(db), updates);
  return botId;
}
export async function setBotRole(team, botId, role) {
  const updates = {};
  updates[`teams/${team.id}/members/${botId}`] = role;
  for (const bid of [team.boardNoWip, team.boardWip].filter(Boolean)) updates[`boards/${bid}/roleAssignments/${botId}`] = role;
  await update(ref(db), updates);
}
export async function removeBotFromTeam(team, botId) {
  const updates = {};
  updates[`bots/${botId}`] = null;
  updates[`teams/${team.id}/members/${botId}`] = null;
  for (const bid of [team.boardNoWip, team.boardWip].filter(Boolean)) updates[`boards/${bid}/roleAssignments/${botId}`] = null;
  await update(ref(db), updates);
}

// ---- Sesión del facilitador (modo activo + tiempo) ----
export function watchSession(cb) {
  return onValue(ref(db, 'session'), (s) => cb(s.exists() ? s.val() : { mode: 'nowip', timeLimitMinutes: null }));
}
export async function setSession(patch) {
  await update(ref(db, 'session'), patch);
}

// ---- Co-facilitadores (moderadores temporales de la sesión) ----
export function watchFacilitators(cb) {
  return onValue(ref(db, 'facilitators'), (s) => {
    const v = s.val() || {};
    cb(Object.keys(v).filter((k) => v[k]));
  });
}
export async function setFacilitator(uid, on) {
  await set(ref(db, `facilitators/${uid}`), on ? true : null);
}
export async function getIsFacilitator(uid) {
  const s = await get(ref(db, `facilitators/${uid}`));
  return s.val() === true;
}

// ---- Partidas (entidad raíz: agrupa equipos, tableros, personas, bots y config) ----
// Arquitectura: colecciones planas (teams/boards/bots/invitedUsers) con campo
// `partidaId`. La sesión y los co-facilitadores son por partida
// (/partidas/{pid}/session y /partidas/{pid}/facilitators). Se mantiene un espejo
// global /facilitators/{uid}=true porque las reglas de RTDB no pueden resolver
// dinámicamente board→partida→facilitador; el scoping por partida se aplica en la
// capa de aplicación (un co-facilitador solo ve/gestiona su partida).
const DEFAULT_PARTIDA_SESSION = {
  mode: 'nowip', rondas: 3, ciclos: 5, timeLimitMinutes: null, pauseBetweenRounds: false,
};

export function watchPartidas(cb) {
  return onValue(ref(db, 'partidas'), (s) => cb(toList(s.val())));
}
export function watchPartida(pid, cb) {
  return onValue(ref(db, `partidas/${pid}`), (s) => cb(s.exists() ? { id: pid, ...s.val() } : null));
}
export async function getPartida(pid) {
  const s = await get(ref(db, `partidas/${pid}`));
  return s.exists() ? { id: pid, ...s.val() } : null;
}
export async function createPartida(name, createdBy, isDemo = false) {
  const pid = newId('partida');
  await set(ref(db, `partidas/${pid}`), {
    name: name || 'Partida',
    createdBy: createdBy || null,
    createdAt: serverTimestamp(),
    isDemo: !!isDemo,
    session: { ...DEFAULT_PARTIDA_SESSION },
    facilitators: {},
  });
  return pid;
}
export async function renamePartida(pid, name) {
  await update(ref(db, `partidas/${pid}`), { name });
}

// ---- Sesión por partida (modo activo + configuración del juego) ----
export function watchPartidaSession(pid, cb) {
  return onValue(ref(db, `partidas/${pid}/session`), (s) => cb(s.exists() ? s.val() : { ...DEFAULT_PARTIDA_SESSION }));
}
export async function updatePartidaSession(pid, patch) {
  await update(ref(db, `partidas/${pid}/session`), patch);
}

// ---- Co-facilitadores por partida (con espejo global para las reglas RTDB) ----
export function watchPartidaFacilitators(pid, cb) {
  return onValue(ref(db, `partidas/${pid}/facilitators`), (s) => {
    const v = s.val() || {};
    cb(Object.keys(v).filter((k) => v[k]));
  });
}
export async function setPartidaFacilitator(pid, uid, on) {
  const updates = {};
  updates[`partidas/${pid}/facilitators/${uid}`] = on ? true : null;
  updates[`facilitators/${uid}`] = on ? true : null; // espejo global (boolean) para las reglas
  await update(ref(db), updates);
}
/** Devuelve el pid de la partida donde `uid` es co-facilitador, o null. */
export async function findUserPartida(uid) {
  const s = await get(ref(db, 'partidas'));
  const all = s.val() || {};
  for (const [pid, p] of Object.entries(all)) {
    if (p.facilitators && p.facilitators[uid]) return pid;
  }
  return null;
}

/** Borra una partida y, en cascada, sus equipos, tableros, juegos, resultados, bots e invitados. */
export async function deletePartida(pid) {
  const [teamsSnap, boardsSnap, invitedSnap, botsSnap] = await Promise.all([
    get(ref(db, 'teams')), get(ref(db, 'boards')), get(ref(db, 'invitedUsers')), get(ref(db, 'bots')),
  ]);
  const updates = {};
  updates[`partidas/${pid}`] = null;
  const teams = teamsSnap.val() || {};
  for (const [tid, t] of Object.entries(teams)) {
    if (t.partidaId !== pid) continue;
    updates[`teams/${tid}`] = null;
    for (const mid of Object.keys(t.members || {})) {
      if (!isBotId(mid)) { updates[`users/${mid}/teamId`] = null; updates[`users/${mid}/gameRole`] = null; }
    }
  }
  const boards = boardsSnap.val() || {};
  for (const [bid, b] of Object.entries(boards)) {
    if (b.partidaId !== pid) continue;
    updates[`boards/${bid}`] = null;
    updates[`games/${bid}`] = null;
    updates[`results/${bid}`] = null;
  }
  const invited = invitedSnap.val() || {};
  for (const [k, inv] of Object.entries(invited)) {
    if (inv.partidaId === pid) updates[`invitedUsers/${k}`] = null;
  }
  const bots = botsSnap.val() || {};
  for (const [botId, bot] of Object.entries(bots)) {
    if (bot.partidaId === pid) updates[`bots/${botId}`] = null;
  }
  await update(ref(db), updates);
}

/**
 * Migración: envuelve los datos antiguos (sin partidaId) en una "Partida 1".
 * Idempotente: solo sella lo que no tenga partidaId y crea /partidas/partida1 una vez,
 * copiando la sesión y los co-facilitadores globales heredados.
 */
export async function migrateLegacyToPartida1(createdBy) {
  const [teamsSnap, boardsSnap, invitedSnap, botsSnap, sessionSnap, facSnap, partidaSnap] = await Promise.all([
    get(ref(db, 'teams')), get(ref(db, 'boards')), get(ref(db, 'invitedUsers')),
    get(ref(db, 'bots')), get(ref(db, 'session')), get(ref(db, 'facilitators')),
    get(ref(db, 'partidas/partida1')),
  ]);
  const pid = 'partida1';
  const sess = sessionSnap.val() || {};
  const facilitators = facSnap.val() || {};
  const updates = {};
  if (!partidaSnap.exists()) {
    updates['partidas/partida1'] = {
      name: 'Partida 1',
      createdBy: createdBy || null,
      createdAt: serverTimestamp(),
      isDemo: false,
      session: {
        mode: sess.mode || 'nowip',
        rondas: sess.rondas ?? 3,
        ciclos: sess.ciclos ?? 5,
        timeLimitMinutes: sess.timeLimitMinutes ?? null,
        pauseBetweenRounds: sess.pauseBetweenRounds ?? false,
      },
      facilitators,
    };
  }
  const stamp = (coll, snap) => {
    const obj = snap.val() || {};
    for (const [id, v] of Object.entries(obj)) {
      if (v && !v.partidaId) updates[`${coll}/${id}/partidaId`] = pid;
    }
  };
  stamp('teams', teamsSnap);
  stamp('boards', boardsSnap);
  stamp('invitedUsers', invitedSnap);
  stamp('bots', botsSnap);
  if (Object.keys(updates).length === 0) return null;
  await update(ref(db), updates);
  return pid;
}

// ---- Pre-registro de personas por email (invitados) ----
export function invKey(email) {
  return 'inv_' + String(email || '').trim().toLowerCase().replace(/[.#$/[\]@]/g, '_');
}
export function watchInvited(cb) {
  return onValue(ref(db, 'invitedUsers'), (s) => cb(toList(s.val())));
}
export async function addInvited(email, name, partidaId = null) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const key = invKey(e);
  await update(ref(db, `invitedUsers/${key}`), {
    email: e, name: name || e, teamId: null, role: null, partidaId: partidaId || null,
  });
  return key;
}
export async function deleteInvited(key) { await remove(ref(db, `invitedUsers/${key}`)); }
export async function setInvitedAssignment(key, teamId, role) {
  await update(ref(db, `invitedUsers/${key}`), { teamId: teamId || null, role: role || null });
}

/**
 * Al iniciar sesión: si hay un pre-registro con el email del usuario, lo asocia
 * a su equipo y rol (en ambos tableros), lo promociona a co-facilitador si estaba
 * marcado, y elimina el registro pendiente.
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
