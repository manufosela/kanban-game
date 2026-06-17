// Motor de partida: persiste el estado en /games/{boardId} y aplica las
// acciones de cada paso del turno con transacciones, usando la lógica pura de rules.js.
import { ref, onValue, runTransaction, get, set, update } from 'firebase/database';
import { db } from './firebase.js';
import * as R from './rules.js';

export const STEP = {
  PM_ADD: 1,        // PM mete 3 historias en Backlog
  PM_PULL: 2,       // PM tira: Backlog -> Análisis
  DEVS: 3,          // Devs actúan (avanzar / revisar / pair)
  QA: 4,            // QA prueba (QA -> Validación / bug -> Desarrollo)
  PM_VALIDATE: 5,   // PM tira: Validación -> Done
};

export const STEP_LABEL = {
  1: 'Paso 1 · El PM mete 3 historias en Backlog',
  2: 'Paso 2 · El PM tira el dado: Backlog → Análisis',
  3: 'Paso 3 · Los Devs actúan',
  4: 'Paso 4 · QA prueba las historias',
  5: 'Paso 5 · El PM valida: Validación PM → Done',
};

/** Rol que controla cada paso. */
export const STEP_ROLE = { 1: 'PM', 2: 'PM', 3: 'DEV', 4: 'QA', 5: 'PM' };

export function rollDie() {
  // Dado de 6 caras (cliente). Para una dinámica de taller es suficiente.
  return Math.floor(Math.random() * 6) + 1;
}

export function watchGame(boardId, cb) {
  return onValue(ref(db, `games/${boardId}`), (s) => cb(s.exists() ? s.val() : null));
}

/**
 * Inicializa (o reinicia) una partida. Una partida dura M rondas × N ciclos.
 * opts = { wipEnabled, rondas, ciclos, timeLimitMinutes }
 */
export async function startGame(board, { wipEnabled = false, rondas = 2, ciclos = 5, timeLimitMinutes = null } = {}) {
  const cols = R.orderedColumns(board.columns).map((c, i) => ({
    id: c.id, name: c.name, order: i, wipLimit: c.wipLimit ?? null,
  }));
  const M = Math.max(1, Number(rondas) || 1);
  const N = Math.max(1, Number(ciclos) || 1);
  const limitMin = Number(timeLimitMinutes) > 0 ? Number(timeLimitMinutes) : null;
  const state = {
    round: 1,
    wipEnabled: !!wipEnabled,
    rondas: M,
    ciclos: N,
    totalCycles: M * N,
    turn: 1, // ciclo actual (1..totalCycles)
    step: STEP.PM_ADD,
    status: 'playing',
    columns: cols,
    roleAssignments: board.roleAssignments || {}, // copia editable en vivo
    cards: {},
    doneCount: 0,
    nextNumber: 1,
    dice: null,
    snapshots: {},
    startedAt: Date.now(),
    endedAt: null,
    timeLimit: limitMin ? limitMin * 60 : null, // segundos
    log: [{ t: 0, text: `Comienza la partida ${wipEnabled ? '(con WIP)' : '(sin WIP)'}: ${M} ronda(s) × ${N} ciclo(s).` }],
  };
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

/** Ronda actual (1..M) y ciclo dentro de la ronda (1..N) a partir del turno (ciclo global). */
export function roundInfo(state) {
  const N = state?.ciclos || R.MAX_TURNS;
  const turn = state?.turn || 1;
  const M = state?.rondas || 1;
  return {
    ronda: Math.min(M, Math.floor((turn - 1) / N) + 1),
    cicloEnRonda: ((turn - 1) % N) + 1,
    ciclos: N,
    rondas: M,
    turn,
    total: state?.totalCycles || N,
  };
}

function pushLog(state, text) {
  const log = Array.isArray(state.log) ? state.log : [];
  state.log = [...log, { t: Date.now(), turn: state.turn, step: state.step, text }].slice(-60);
}

function setDice(state, kind, values, by) {
  state.dice = { kind, values: Array.isArray(values) ? values : [values], by: by || null, at: Date.now() };
}

/**
 * Aplica una acción del juego dentro de una transacción.
 * `action` = { type, cardId?, dice?, by? }
 * Lanza si la acción no corresponde al paso actual.
 */
export async function applyAction(boardId, action) {
  const gref = ref(db, `games/${boardId}`);
  let resultMsg = null;
  const res = await runTransaction(gref, (state) => {
    if (!state || state.status !== 'playing') return state;
    const s = normalize(state);
    const handler = HANDLERS[action.type];
    if (!handler) return state;
    const out = handler(s, action);
    resultMsg = out?.msg || null;
    return s;
  });
  // Si la ronda acaba de terminar, archiva sus resultados para la comparativa.
  const finalState = res?.snapshot?.exists() ? res.snapshot.val() : null;
  if (finalState && finalState.status === 'finished') {
    await archiveResults(boardId, finalState);
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
    durationSec,
    finishedAt: Date.now(),
  });
}

/** Asegura que cards/columns existen y son del tipo correcto tras leer de RTDB. */
function normalize(state) {
  if (!state.cards) state.cards = {};
  if (!state.snapshots) state.snapshots = {};
  return state;
}

function endTurn(s) {
  // Snapshot del ciclo que termina (incluye a qué ronda pertenece).
  const N = s.ciclos || R.MAX_TURNS;
  const snap = R.turnSnapshot(s);
  snap.ronda = Math.floor((s.turn - 1) / N) + 1;
  s.snapshots = { ...(s.snapshots || {}), [s.turn]: snap };
  const total = s.totalCycles || R.MAX_TURNS;
  if (s.turn >= total) {
    s.status = 'finished';
    s.endedAt = Date.now();
    pushLog(s, `Fin de la partida ${s.wipEnabled ? '(con WIP)' : '(sin WIP)'}. Total en Done: ${R.doneTotal(s)}.`);
  } else {
    s.turn += 1;
    s.step = STEP.PM_ADD;
    s.dice = null;
    pushLog(s, `Comienza el ciclo ${s.turn}.`);
  }
}

// --- Paso 3 (Devs) por turnos: una acción por Dev ---
function devUids(s) {
  return Object.entries(s.roleAssignments || {})
    .filter(([, r]) => r === 'DEV')
    .map(([uid]) => uid)
    .sort();
}
function startDevsStep(s) {
  const devs = devUids(s);
  s.devOrder = devs;
  s.devActed = {};
  if (devs.length === 0) { s.step = STEP.QA; s.qaRolls = 0; pushLog(s, 'No hay Devs asignados; pasa a QA.'); }
  else s.step = STEP.DEVS;
}
/** Dev al que le toca actuar (el primero del orden que no ha actuado), o null. */
export function currentDev(s) {
  const order = s?.devOrder || [];
  const acted = s?.devActed || {};
  return order.find((u) => !acted[u]) || null;
}
function markDevActed(s, uids) {
  s.devActed = { ...(s.devActed || {}) };
  for (const u of uids) if (u) s.devActed[u] = true;
  const all = (s.devOrder || []).every((u) => s.devActed[u]);
  if (all) { s.step = STEP.QA; s.qaRolls = 0; pushLog(s, 'Todos los Devs han actuado. Turno de QA.'); }
}

const HANDLERS = {
  // Paso 1
  'pm-add': (s) => {
    if (s.step !== STEP.PM_ADD) return { msg: 'No es el paso de meter historias.' };
    const added = R.addBacklogStories(s, R.STORIES_PER_TURN);
    s.cards = added.cards;
    s.nextNumber = added.nextNumber;
    s.step = STEP.PM_PULL;
    pushLog(s, `El PM mete ${R.STORIES_PER_TURN} historias nuevas en Backlog.`);
    return {};
  },

  // Paso 2
  'pm-pull': (s, a) => {
    if (s.step !== STEP.PM_PULL) return { msg: 'No es el paso del PM (Backlog→Análisis).' };
    const dice = a.dice;
    const { state, moved } = R.pmPullToAnalysis(s, dice);
    s.cards = state.cards;
    setDice(s, 'pm-pull', dice, a.by);
    pushLog(s, `El PM saca ${dice} y mueve ${moved} historia(s) a Análisis.`);
    startDevsStep(s);
    return {};
  },

  // Paso 3 — Dev avanzar (el Dev de turno)
  'dev-advance': (s, a) => {
    if (s.step !== STEP.DEVS) return { msg: 'No es el paso de los Devs.' };
    const cur = currentDev(s);
    if (!cur) return { msg: 'Todos los Devs han actuado.' };
    const dice = a.dice;
    setDice(s, 'dev-advance', dice, cur);
    if (!R.diceAdvances(dice)) pushLog(s, `Dev saca ${dice}: la historia no avanza.`);
    else {
      const out = R.devAdvance(s, a.cardId);
      if (out.ok) { s.cards = out.state.cards; pushLog(s, `Dev saca ${dice}: la historia #${num(s, a.cardId)} avanza.`); }
      else pushLog(s, `Dev saca ${dice} pero no puede avanzar (${reason(out.reason)}).`);
    }
    markDevActed(s, [cur]);
    return {};
  },

  // Paso 3 — Dev revisar PR (el Dev de turno)
  'dev-review': (s, a) => {
    if (s.step !== STEP.DEVS) return { msg: 'No es el paso de los Devs.' };
    const cur = currentDev(s);
    if (!cur) return { msg: 'Todos los Devs han actuado.' };
    const dice = a.dice;
    setDice(s, 'dev-review', dice, cur);
    if (!R.diceAdvances(dice)) pushLog(s, `Revisión de PR: saca ${dice}, no se completa.`);
    else {
      const out = R.devReview(s, a.cardId);
      if (out.ok) { s.cards = out.state.cards; pushLog(s, `Revisión de PR (${dice}): la historia #${num(s, a.cardId)} pasa a QA.`); }
      else pushLog(s, `Revisión de PR (${dice}) pero no puede mover (${reason(out.reason)}).`);
    }
    markDevActed(s, [cur]);
    return {};
  },

  // Paso 3 — Pair programming: el Dev de turno + un compañero pendiente (consume a ambos)
  'dev-pair': (s, a) => {
    if (s.step !== STEP.DEVS) return { msg: 'No es el paso de los Devs.' };
    const cur = currentDev(s);
    if (!cur) return { msg: 'Todos los Devs han actuado.' };
    const partner = a.partner;
    const order = s.devOrder || [];
    const acted = s.devActed || {};
    if (!partner || !order.includes(partner) || acted[partner] || partner === cur) {
      return { msg: 'Elige un compañero Dev pendiente para el pair.' };
    }
    const [d1, d2] = a.dice;
    setDice(s, 'dev-pair', [d1, d2], cur);
    if (!R.pairAdvances(d1, d2)) pushLog(s, `Pair: ${d1}+${d2}=${d1 + d2}, no avanza.`);
    else {
      const out = R.devAdvance(s, a.cardId);
      if (out.ok) { s.cards = out.state.cards; pushLog(s, `Pair (${d1}+${d2}=${d1 + d2}): la historia #${num(s, a.cardId)} avanza.`); }
      else pushLog(s, `Pair (${d1}+${d2}) pero no puede avanzar (${reason(out.reason)}).`);
    }
    markDevActed(s, [cur, partner]);
    return {};
  },

  // Paso 3 -> 4 (cierre forzado por PM/admin)
  'dev-finish': (s) => {
    if (s.step !== STEP.DEVS) return {};
    s.step = STEP.QA;
    s.qaRolls = 0;
    pushLog(s, 'Se cierra el paso de Devs. Turno de QA.');
    return {};
  },

  // Paso 4 — QA prueba una historia
  'qa-test': (s, a) => {
    if (s.step !== STEP.QA) return { msg: 'No es el paso de QA.' };
    if ((s.qaRolls || 0) >= R.QA_MAX_ROLLS) return { msg: 'QA ya agotó sus tiradas este turno.' };
    const dice = a.dice;
    setDice(s, 'qa-test', dice, a.by);
    s.qaRolls = (s.qaRolls || 0) + 1;
    const out = R.qaTest(s, a.cardId, dice);
    s.cards = out.state.cards;
    if (out.result === 'passed') pushLog(s, `QA saca ${dice}: la historia #${num(s, a.cardId)} pasa a Validación PM.`);
    else if (out.result === 'bug') pushLog(s, `QA saca ${dice}: ¡bug! La historia #${num(s, a.cardId)} vuelve a Desarrollo.`);
    else if (out.result === 'blocked') pushLog(s, `QA saca ${dice} pero Validación PM está llena: la historia se queda en QA.`);
    return {};
  },

  // Paso 4 -> 5
  'qa-finish': (s) => {
    if (s.step !== STEP.QA) return {};
    s.step = STEP.PM_VALIDATE;
    pushLog(s, 'QA termina. El PM va a validar.');
    return {};
  },

  // Paso 5 — PM valida -> Done y fin de turno
  'pm-validate': (s, a) => {
    if (s.step !== STEP.PM_VALIDATE) return { msg: 'No es el paso de validación.' };
    const dice = a.dice;
    const { state, moved } = R.pmValidate(s, dice);
    s.cards = state.cards;
    s.doneCount = state.doneCount;
    setDice(s, 'pm-validate', dice, a.by);
    pushLog(s, `El PM saca ${dice} y valida ${moved} historia(s) a Done.`);
    endTurn(s);
    return {};
  },
};

function num(s, cardId) {
  return s.cards?.[cardId]?.number ?? '?';
}
function reason(code) {
  return { 'wip-full': 'columna destino llena (WIP)', 'no-card': 'sin historia', 'bad-source': 'origen no válido', 'no-target': 'sin destino' }[code] || code;
}

/** Lee las dos rondas guardadas para comparativa (snapshots por ronda). */
export async function getGame(boardId) {
  const s = await get(ref(db, `games/${boardId}`));
  return s.exists() ? s.val() : null;
}
