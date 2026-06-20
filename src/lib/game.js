// Capa de persistencia de la partida: envuelve el motor PURO (engine.js) con la
// lectura/escritura del estado en /games/{boardId} mediante transacciones RTDB.
// Toda la lógica de turnos, acciones y bots vive en engine.js (sin Firebase).
import { ref, onValue, runTransaction, get, set, update } from 'firebase/database';
import { db } from './firebase.js';
import * as R from './rules.js';
import * as E from './engine.js';
import { backlogById } from './backlogs.js';

// Re-export del motor para no romper imports existentes (game-board, dashboard…).
export {
  STEP, STEP_LABEL, STEP_ROLE, rollDie, roundInfo, currentDev, botAction,
} from './engine.js';

export function watchGame(boardId, cb) {
  return onValue(ref(db, `games/${boardId}`), (s) => cb(s.exists() ? s.val() : null));
}

/**
 * Inicializa (o reinicia) una partida. Una partida dura M rondas × N ciclos.
 * opts = { wipEnabled, rondas, ciclos, timeLimitMinutes }
 */
export async function startGame(board, opts = {}) {
  const { wipEnabled = false } = opts;
  // Con WIP: ajusta los límites a la capacidad del equipo (nº por rol) y los persiste.
  const { cols, boardWipUpdates } = E.resolveColumns(board, wipEnabled);
  if (wipEnabled && Object.keys(boardWipUpdates).length) {
    const updates = {};
    for (const [colId, val] of Object.entries(boardWipUpdates)) {
      updates[`boards/${board.id}/columns/${colId}/wipLimit`] = val;
    }
    await update(ref(db), updates);
  }
  // Backlog curado del equipo (mismos títulos/estimaciones en ambas rondas).
  let storyList = null;
  if (board.teamId) {
    const bs = await get(ref(db, `teams/${board.teamId}/backlogId`));
    const bk = bs.exists() ? backlogById(bs.val()) : null;
    if (bk) storyList = bk.stories;
  }
  // Con WIP: reproduce el mazo (negocio/dev) guardado de la ronda sin WIP, para una comparativa justa.
  let deck = null;
  if (wipEnabled && board.teamId) {
    const ds = await get(ref(db, `teams/${board.teamId}/storyDeck`));
    deck = ds.exists() ? ds.val() : null;
  }
  const state = E.buildGameState(board, { ...opts, storyList }, deck, cols);
  await runTransaction(ref(db, `games/${board.id}`), () => state);
  await runTransaction(ref(db, `boards/${board.id}/round`), () => 1);
  await runTransaction(ref(db, `boards/${board.id}/status`), () => 'playing');
}

/**
 * Inicio centralizado (facilitador): arranca la partida del modo en varios tableros a la vez.
 * `mode` define wipEnabled. `opts` = { rondas, ciclos, timeLimitMinutes }.
 */
export async function startPartidaForBoards(boards, mode, opts = {}) {
  const wipEnabled = mode === 'wip';
  await Promise.all((boards || []).map((b) => startGame(b, { ...opts, wipEnabled })));
  return (boards || []).length;
}

/** Pausa una partida en curso (bloquea acciones y bots). */
export async function pauseGame(boardId) {
  await runTransaction(ref(db, `games/${boardId}/status`), (s) => (s === 'playing' ? 'paused' : s));
}
/** Reanuda una partida pausada. */
export async function resumeGame(boardId) {
  await runTransaction(ref(db, `games/${boardId}/status`), (s) => (s === 'paused' ? 'playing' : s));
}

/** Añade una ronda (N ciclos más) a una partida en curso. */
export async function addRonda(boardId) {
  await runTransaction(ref(db, `games/${boardId}`), (s) => {
    if (!s || s.status !== 'playing') return s;
    s.rondas = (s.rondas || 1) + 1;
    s.totalCycles = (s.totalCycles || 0) + (s.ciclos || 1);
    const log = Array.isArray(s.log) ? s.log : [];
    s.log = [...log, { t: Date.now(), turn: s.turn, text: `El moderador añade una ronda: ahora ${s.rondas} ronda(s).` }].slice(-60);
    return s;
  });
}

/** Cambia el límite WIP de una columna en una partida en curso (y lo persiste en el tablero). */
export async function setGameColumnWip(boardId, colId, wipLimit) {
  const val = (wipLimit === '' || wipLimit == null) ? null : Math.max(0, Number(wipLimit)) || null;
  await runTransaction(ref(db, `games/${boardId}`), (s) => {
    if (!s) return s;
    const cols = Array.isArray(s.columns) ? s.columns : Object.values(s.columns || {});
    const col = cols.find((c) => c.id === colId);
    if (col) col.wipLimit = val;
    s.columns = cols;
    return s;
  });
  await update(ref(db, `boards/${boardId}/columns/${colId}`), { wipLimit: val });
}

/** Cambia el rol de una persona en una partida en curso. */
export async function setGameRole(boardId, uid, role) {
  await set(ref(db, `games/${boardId}/roleAssignments/${uid}`), role || null);
}

/**
 * Aplica una acción del juego dentro de una transacción, delegando en el motor.
 * `action` = { type, cardId?, dice?, by? }
 */
export async function applyAction(boardId, action) {
  const gref = ref(db, `games/${boardId}`);
  let resultMsg = null;
  const res = await runTransaction(gref, (state) => {
    if (!state || state.status !== 'playing') return state;
    const { state: s, msg } = E.applyActionState(state, action);
    resultMsg = msg;
    return s;
  });
  // Si la ronda acaba de terminar, archiva resultados y marca el tablero como terminado.
  const finalState = res?.snapshot?.exists() ? res.snapshot.val() : null;
  if (finalState && finalState.status === 'finished') {
    await archiveResults(boardId, finalState);
    await runTransaction(ref(db, `boards/${boardId}/status`), () => 'finished');
    // Si terminó la ronda SIN WIP, guarda el mazo (negocio/dev por historia) para replicarlo con WIP.
    if (!finalState.wipEnabled && finalState.teamId) {
      const deck = {};
      for (const c of Object.values(finalState.cards || {})) {
        if (c && c.number != null && !c.urgent) deck[c.number] = { business: c.business ?? null, dev: c.dev ?? null };
      }
      await set(ref(db, `teams/${finalState.teamId}/storyDeck`), deck);
    }
  }
  return resultMsg;
}

/** Guarda los resultados de una ronda en /results/{boardId}/round{N}. */
export async function archiveResults(boardId, state) {
  const durationSec = state.startedAt && state.endedAt
    ? Math.round((state.endedAt - state.startedAt) / 1000)
    : null;
  await set(ref(db, `results/${boardId}/round${state.round}`), {
    round: state.round,
    wipEnabled: !!state.wipEnabled,
    columns: state.columns,
    snapshots: state.snapshots || {},
    doneTotal: R.doneTotal(state),
    doneBusiness: R.doneBusiness(state),
    doneDev: R.doneDev(state),
    metrics: R.gameMetrics(state),
    flow: state.flow || E.emptyFlow(),
    durationSec,
    finishedAt: Date.now(),
  });
}

/** Lee las dos rondas guardadas para comparativa (snapshots por ronda). */
export async function getGame(boardId) {
  const s = await get(ref(db, `games/${boardId}`));
  return s.exists() ? s.val() : null;
}
