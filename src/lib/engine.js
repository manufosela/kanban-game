// Motor de partida PURO (sin Firebase): construye el estado, aplica las acciones
// de cada paso y calcula la jugada de los bots. game.js envuelve esto con la
// persistencia en RTDB; el simulador (tools/simulate.mjs) lo usa tal cual.
//
// Al ser puro (solo depende de rules.js) es 100% testeable y reproducible.
import * as R from './rules.js';

export const STEP = {
  PM_ADD: 1,        // PM mete 3 historias en Backlog
  PM_PULL: 2,       // PM tira: Backlog -> Refinement
  DEVS: 3,          // Devs actúan (avanzar / revisar / pair)
  QA: 4,            // QA prueba (QA -> Validación / bug -> Desarrollo)
  PM_VALIDATE: 5,   // PM tira: Validación -> Done
};

export const STEP_LABEL = {
  1: 'Paso 1 · El PM mete 3 historias en Backlog',
  2: 'Paso 2 · El PM tira el dado: Backlog → Refinement',
  3: 'Paso 3 · Los Devs actúan',
  4: 'Paso 4 · QA prueba las historias',
  5: 'Paso 5 · El PM valida: Validación PM → Done',
};

/** Rol que controla cada paso. */
export const STEP_ROLE = { 1: 'PM', 2: 'PM', 3: 'DEV', 4: 'QA', 5: 'PM' };

export function rollDie() {
  // Dado de 6 caras. Para una dinámica de taller es suficiente.
  return Math.floor(Math.random() * 6) + 1;
}

// Tendencia del bot Dev a EMPEZAR trabajo nuevo en vez de terminar lo empezado
// (mentalidad "push", como un equipo sin disciplina de WIP). Modela el
// comportamiento humano natural: si nada lo impide, la gente abre tareas nuevas.
// En la ronda con WIP los límites impiden empezar de más → fuerzan terminar.
// 0 = siempre disciplinado (terminar primero); 1 = siempre empezar.
// Calibrado por simulación (tools/simulate.mjs): 0.4 da el contraste realista
// donde el WIP gana en throughput, valor y, sobre todo, tiempo de ciclo.
export const BOT_START_BIAS = 0.4;

/**
 * Resuelve las columnas iniciales y, con WIP, sus límites por capacidad de equipo.
 * Devuelve { cols, boardWipUpdates } (lo segundo para que game.js lo persista).
 * Refinement (buffer de entrada) queda SIEMPRE sin WIP.
 */
export function resolveColumns(board, wipEnabled) {
  const cols = R.orderedColumns(board.columns).map((c, i) => ({
    id: c.id, name: c.name, order: i, wipLimit: c.wipLimit ?? null,
  }));
  const boardWipUpdates = {};
  if (wipEnabled) {
    const wip = R.suggestedWipByAnchor(cols, board.roleAssignments || {});
    const analysisId = R.anchors(cols).id.analysis;
    cols.forEach((c) => {
      const val = c.id === analysisId ? null : wip[c.id];
      if (c.id === analysisId || val != null) {
        c.wipLimit = val ?? null;
        boardWipUpdates[c.id] = c.wipLimit;
      }
    });
  }
  return { cols, boardWipUpdates };
}

/** Contadores de flujo (retrabajo, bloqueos, idle, acciones) para métricas. */
export function emptyFlow() {
  return { devMoves: 0, devBlocked: 0, devIdle: 0, bugs: 0, qaBlocked: 0, qaPass: 0, pairMoves: 0, validated: 0, added: 0, urgent: 0 };
}

/**
 * Construye el estado inicial de una partida en memoria (sin persistir).
 * opts = { wipEnabled, rondas, ciclos, timeLimitMinutes, pauseBetweenRounds }.
 */
export function buildGameState(board, opts = {}, deck = null, cols = null) {
  const { wipEnabled = false, rondas = 2, ciclos = 5, timeLimitMinutes = null, pauseBetweenRounds = false } = opts;
  const columns = cols || resolveColumns(board, wipEnabled).cols;
  const M = Math.max(1, Number(rondas) || 1);
  const N = Math.max(1, Number(ciclos) || 1);
  const limitMin = Number(timeLimitMinutes) > 0 ? Number(timeLimitMinutes) : null;
  return {
    round: 1,
    teamId: board.teamId || null,
    deck: deck || null,
    wipEnabled: !!wipEnabled,
    rondas: M,
    ciclos: N,
    totalCycles: M * N,
    pauseBetweenRounds: !!pauseBetweenRounds,
    turn: 1,
    step: STEP.PM_ADD,
    status: 'playing',
    columns,
    roleAssignments: board.roleAssignments || {},
    cards: {},
    doneCount: 0,
    nextNumber: 1,
    dice: null,
    snapshots: {},
    flow: emptyFlow(),
    startedAt: Date.now(),
    endedAt: null,
    timeLimit: limitMin ? limitMin * 60 : null,
    log: [{ t: 0, text: `Comienza la partida ${wipEnabled ? '(con WIP)' : '(sin WIP)'}: ${M} ronda(s) × ${N} ciclo(s).` }],
  };
}

/** Ronda actual (1..M) y ciclo dentro de la ronda (1..N) a partir del turno global. */
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

export function pushLog(state, text, by) {
  const log = Array.isArray(state.log) ? state.log : [];
  state.log = [...log, { t: Date.now(), turn: state.turn, step: state.step, text, by: by || null }].slice(-60);
}

function setDice(state, kind, values, by) {
  state.dice = { kind, values: Array.isArray(values) ? values : [values], by: by || null, at: Date.now() };
}

/** Asegura que cards/columns/flow existen tras leer de RTDB. */
export function normalize(state) {
  if (!state.cards) state.cards = {};
  if (!state.snapshots) state.snapshots = {};
  if (!state.flow) state.flow = emptyFlow();
  return state;
}

function flow(s) {
  if (!s.flow) s.flow = emptyFlow();
  return s.flow;
}

export function endTurn(s) {
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
    const finishedCiclo = s.turn;
    s.turn += 1;
    s.step = STEP.PM_ADD;
    s.dice = null;
    pushLog(s, `Comienza el ciclo ${s.turn}.`);
    if (s.pauseBetweenRounds && finishedCiclo % N === 0) {
      s.status = 'paused';
      pushLog(s, `Fin de la ronda ${finishedCiclo / N}. Partida en pausa; el facilitador reanuda.`);
    }
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
  if (devs.length === 0) { pushLog(s, 'No hay Devs asignados.'); enterQaStep(s); }
  else s.step = STEP.DEVS;
}
function enterQaStep(s) {
  const a = R.anchors(R.orderedColumns(s.columns));
  if (R.cardsInColumn(s.cards, a.id.qa).length === 0) {
    pushLog(s, 'No hay historias en QA.');
    enterValidateStep(s);
  } else {
    s.step = STEP.QA;
    s.qaRolls = 0;
    pushLog(s, 'Turno de QA.');
  }
}
function enterValidateStep(s) {
  const a = R.anchors(R.orderedColumns(s.columns));
  if (R.cardsInColumn(s.cards, a.id.validation).length === 0) {
    pushLog(s, 'No hay nada que validar; fin del turno.');
    endTurn(s);
  } else {
    s.step = STEP.PM_VALIDATE;
  }
}
export function currentDev(s) {
  const order = s?.devOrder || [];
  const acted = s?.devActed || {};
  return order.find((u) => !acted[u]) || null;
}
function devIsPending(s, u) {
  return !!u && (s.devOrder || []).includes(u) && !(s.devActed || {})[u];
}
function actingDev(s, a) {
  if (devIsPending(s, a.dev)) return a.dev;
  if (devIsPending(s, a.by)) return a.by;
  return currentDev(s);
}
function urgentBlocks(s, cardId) {
  return !!cardId && R.urgentActive(s) && !s.cards?.[cardId]?.urgent;
}
function clearDevClaims(s, uids) {
  if (!s.claims) return;
  const set = new Set(uids.filter(Boolean));
  for (const [cid, u] of Object.entries(s.claims)) if (set.has(u)) delete s.claims[cid];
}
function markDevActed(s, uids) {
  s.devActed = { ...(s.devActed || {}) };
  for (const u of uids) if (u) s.devActed[u] = true;
  clearDevClaims(s, uids);
  const all = (s.devOrder || []).every((u) => s.devActed[u]);
  if (all) { pushLog(s, 'Todos los Devs han actuado.'); enterQaStep(s); }
}

export const HANDLERS = {
  'pm-add': (s) => {
    if (s.step !== STEP.PM_ADD) return { msg: 'No es el paso de meter historias.' };
    const added = R.addBacklogStories(s, R.STORIES_PER_TURN);
    s.cards = added.cards;
    s.nextNumber = added.nextNumber;
    s.step = STEP.PM_PULL;
    flow(s).added += R.STORIES_PER_TURN;
    pushLog(s, `El PM mete ${R.STORIES_PER_TURN} historias nuevas en Backlog.`);
    return {};
  },
  'pm-skip-add': (s) => {
    if (s.step !== STEP.PM_ADD) return {};
    s.step = STEP.PM_PULL;
    pushLog(s, 'El PM no mete historias nuevas este turno.');
    return {};
  },
  'pm-pull': (s, a) => {
    if (s.step !== STEP.PM_PULL) return { msg: 'No es el paso del PM (Backlog→Refinement).' };
    const dice = a.dice;
    const { state, moved } = R.pmPullToAnalysis(s, dice);
    s.cards = state.cards;
    setDice(s, 'pm-pull', dice, a.by);
    pushLog(s, `El PM saca ${dice} y mueve ${moved} historia(s) a Refinement.`);
    startDevsStep(s);
    return {};
  },
  'dev-claim': (s, a) => {
    if (s.step !== STEP.DEVS) return {};
    const dev = actingDev(s, a);
    if (!devIsPending(s, dev)) return {};
    if (urgentBlocks(s, a.cardId)) return { msg: 'Hay una historia Urgent en curso: cógela a ella.' };
    s.claims = s.claims || {};
    const owner = s.claims[a.cardId];
    if (owner && owner !== dev) return { msg: 'Esa historia ya la ha cogido otro Dev.' };
    clearDevClaims(s, [dev]);
    s.claims[a.cardId] = dev;
    return {};
  },
  'dev-unclaim': (s, a) => {
    if (!s.claims) return {};
    const dev = actingDev(s, a);
    if (s.claims[a.cardId] && s.claims[a.cardId] === dev) delete s.claims[a.cardId];
    return {};
  },
  'dev-advance': (s, a) => {
    if (s.step !== STEP.DEVS) return { msg: 'No es el paso de los Devs.' };
    const dev = actingDev(s, a);
    if (!devIsPending(s, dev)) return { msg: 'Ya has actuado este turno (o no eres Dev).' };
    if (urgentBlocks(s, a.cardId)) return { msg: 'Hay una historia Urgent en curso: trabájala antes.' };
    if ((s.claims?.[a.cardId]) && s.claims[a.cardId] !== dev) return { msg: 'Esa historia la tiene otro Dev.' };
    if (R.needsPair(s.cards?.[a.cardId])) return { msg: 'Esa historia (Fibonacci > 8) debe hacerse en pair.' };
    const dice = a.dice;
    setDice(s, 'dev-advance', dice, dev);
    if (!R.diceAdvances(dice)) pushLog(s, `saca ${dice}: la historia no avanza.`, dev);
    else {
      const out = R.devAdvance(s, a.cardId);
      if (out.ok) { s.cards = out.state.cards; flow(s).devMoves += 1; pushLog(s, `saca ${dice}: la historia #${num(s, a.cardId)} avanza.`, dev); }
      else { if (out.reason === 'wip-full') flow(s).devBlocked += 1; pushLog(s, `saca ${dice} pero no puede avanzar (${reason(out.reason)}).`, dev); }
    }
    markDevActed(s, [dev]);
    return {};
  },
  'dev-review': (s, a) => {
    if (s.step !== STEP.DEVS) return { msg: 'No es el paso de los Devs.' };
    const dev = actingDev(s, a);
    if (!devIsPending(s, dev)) return { msg: 'Ya has actuado este turno (o no eres Dev).' };
    if (urgentBlocks(s, a.cardId)) return { msg: 'Hay una historia Urgent en curso: trabájala antes.' };
    if ((s.claims?.[a.cardId]) && s.claims[a.cardId] !== dev) return { msg: 'Esa historia la tiene otro Dev.' };
    const dice = a.dice;
    setDice(s, 'dev-review', dice, dev);
    if (!R.diceAdvances(dice)) pushLog(s, `revisa un PR y saca ${dice}: no se completa.`, dev);
    else {
      const out = R.devReview(s, a.cardId);
      if (out.ok) { s.cards = out.state.cards; flow(s).devMoves += 1; pushLog(s, `revisa un PR (${dice}): la historia #${num(s, a.cardId)} pasa a QA.`, dev); }
      else { if (out.reason === 'wip-full') flow(s).devBlocked += 1; pushLog(s, `revisa un PR (${dice}) pero no puede mover (${reason(out.reason)}).`, dev); }
    }
    markDevActed(s, [dev]);
    return {};
  },
  'dev-pair': (s, a) => {
    if (s.step !== STEP.DEVS) return { msg: 'No es el paso de los Devs.' };
    const dev = actingDev(s, a);
    if (!devIsPending(s, dev)) return { msg: 'Ya has actuado este turno (o no eres Dev).' };
    if (urgentBlocks(s, a.cardId)) return { msg: 'Hay una historia Urgent en curso: trabájala antes.' };
    if ((s.claims?.[a.cardId]) && s.claims[a.cardId] !== dev) return { msg: 'Esa historia la tiene otro Dev.' };
    const partner = a.partner;
    if (!devIsPending(s, partner) || partner === dev) return { msg: 'Hace falta otro Dev disponible para el pair.' };
    const [d1, d2] = a.dice;
    setDice(s, 'dev-pair', [d1, d2], dev);
    if (!R.pairAdvances(d1, d2)) pushLog(s, `en pair saca ${d1}+${d2}=${d1 + d2}: no avanza.`, dev);
    else {
      const out = R.devAdvance(s, a.cardId);
      if (out.ok) { s.cards = out.state.cards; flow(s).pairMoves += 1; flow(s).devMoves += 1; pushLog(s, `en pair (${d1}+${d2}=${d1 + d2}): la historia #${num(s, a.cardId)} avanza.`, dev); }
      else { if (out.reason === 'wip-full') flow(s).devBlocked += 1; pushLog(s, `en pair (${d1}+${d2}) pero no puede avanzar (${reason(out.reason)}).`, dev); }
    }
    markDevActed(s, [dev, partner]);
    return {};
  },
  'dev-finish': (s) => {
    if (s.step !== STEP.DEVS) return {};
    pushLog(s, 'Se cierra el paso de Devs.');
    enterQaStep(s);
    return {};
  },
  'dev-pass': (s, a) => {
    if (s.step !== STEP.DEVS) return {};
    const dev = actingDev(s, a);
    if (!devIsPending(s, dev)) return {};
    flow(s).devIdle += 1;
    pushLog(s, 'pasa (nada que hacer este turno).', dev);
    markDevActed(s, [dev]);
    return {};
  },
  'inject-urgent': (s) => {
    if (!s.wipEnabled) return { msg: 'Urgent solo está disponible en la ronda con WIP.' };
    const a = R.anchors(R.orderedColumns(s.columns));
    const n = s.nextNumber || 1;
    const id = `s${n}`;
    const fib = [2, 3, 5, 8][Math.floor(Math.random() * 4)];
    s.cards = { ...(s.cards || {}), [id]: { id, number: n, col: a.id.devReturn, bug: false, business: 5, dev: fib, urgent: true } };
    s.nextNumber = n + 1;
    flow(s).urgent += 1;
    pushLog(s, `🔥 Entra una historia URGENT (#${n}) directa a Desarrollo: sácala ya; ignora el WIP y para el resto.`);
    return {};
  },
  'qa-test': (s, a) => {
    if (s.step !== STEP.QA) return { msg: 'No es el paso de QA.' };
    if ((s.qaRolls || 0) >= R.QA_MAX_ROLLS) return { msg: 'QA ya agotó sus tiradas este turno.' };
    if (a.expect && a.expect.qaRolls != null && (s.qaRolls || 0) !== a.expect.qaRolls) return { msg: 'El estado de QA cambió.' };
    const dice = a.dice;
    setDice(s, 'qa-test', dice, a.by);
    s.qaRolls = (s.qaRolls || 0) + 1;
    const out = R.qaTest(s, a.cardId, dice);
    s.cards = out.state.cards;
    if (out.result === 'passed') { flow(s).qaPass += 1; pushLog(s, `QA saca ${dice}: la historia #${num(s, a.cardId)} pasa a Validación PM.`); }
    else if (out.result === 'bug') { flow(s).bugs += 1; pushLog(s, `QA saca ${dice}: ¡bug! La historia #${num(s, a.cardId)} vuelve a Desarrollo.`); }
    else if (out.result === 'blocked') { flow(s).qaBlocked += 1; pushLog(s, `QA saca ${dice} pero Validación PM está llena: la historia se queda en QA.`); }
    return {};
  },
  'qa-finish': (s) => {
    if (s.step !== STEP.QA) return {};
    pushLog(s, 'QA termina.');
    enterValidateStep(s);
    return {};
  },
  'pm-validate': (s, a) => {
    if (s.step !== STEP.PM_VALIDATE) return { msg: 'No es el paso de validación.' };
    const dice = a.dice;
    const { state, moved } = R.pmValidate(s, dice);
    s.cards = state.cards;
    s.doneCount = state.doneCount;
    flow(s).validated += moved;
    setDice(s, 'pm-validate', dice, a.by);
    pushLog(s, `El PM saca ${dice} y valida ${moved} historia(s) a Done.`);
    endTurn(s);
    return {};
  },
};

/** Aplica una acción al estado en memoria (sin Firebase). Devuelve { state, msg }. */
export function applyActionState(state, action) {
  const s = normalize(state);
  const handler = HANDLERS[action.type];
  if (!handler) return { state: s, msg: null };
  const out = handler(s, action);
  return { state: s, msg: out?.msg || null };
}

function num(s, cardId) {
  return s.cards?.[cardId]?.number ?? '?';
}
function reason(code) {
  return { 'wip-full': 'columna destino llena (WIP)', 'no-card': 'sin historia', 'bad-source': 'origen no válido', 'no-target': 'sin destino' }[code] || code;
}

/**
 * Calcula la jugada del bot al que le toca actuar según el paso actual.
 * Devuelve una acción { type, ...payload, expect } o null.
 */
export function botAction(state) {
  if (!state || state.status !== 'playing') return null;
  const cols = R.orderedColumns(state.columns);
  const a = R.anchors(cols);
  const step = state.step;
  if (step === STEP.PM_ADD) {
    const backlog = R.cardsInColumn(state.cards, a.id.backlog).length;
    return { type: backlog > R.STORIES_PER_TURN * 3 ? 'pm-skip-add' : 'pm-add', expect: { step } };
  }
  if (step === STEP.PM_PULL) return { type: 'pm-pull', dice: rollDie(), expect: { step } };
  if (step === STEP.PM_VALIDATE) return { type: 'pm-validate', dice: rollDie(), expect: { step } };
  if (step === STEP.QA) {
    const qaCards = R.cardsInColumn(state.cards, a.id.qa);
    if ((state.qaRolls || 0) < R.QA_MAX_ROLLS && qaCards.length) {
      return { type: 'qa-test', cardId: qaCards[0].id, dice: rollDie(), expect: { step, qaRolls: state.qaRolls || 0 } };
    }
    return { type: 'qa-finish', expect: { step } };
  }
  if (step === STEP.DEVS) {
    const acted = state.devActed || {};
    const isBot = (u) => typeof u === 'string' && u.startsWith('bot_');
    const claimed = new Set(Object.values(state.claims || {}));
    const pending = (state.devOrder || []).filter((u) => !acted[u]);
    if (pending.some((u) => !isBot(u) && !claimed.has(u))) return null;
    const cur = pending.find((u) => isBot(u));
    if (!cur) return null;
    const claims = state.claims || {};
    const free = (c) => !claims[c.id] || claims[c.id] === cur;
    const blocked = R.urgentActive(state);
    const colIdx = (cid) => cols.findIndex((c) => c.id === cid);
    const botPartner = (state.devOrder || []).find((u) => !acted[u] && u !== cur && isBot(u));
    // "Empezar" (push) con prob BOT_START_BIAS; si no, "terminar primero" (pull).
    // Sin WIP, empezar infla el trabajo a medias; con WIP, los límites lo impiden.
    const eager = Math.random() < BOT_START_BIAS;
    const reviewRank = eager ? -1000 : 1000;        // revisar = lo más aguas abajo
    const advRank = (cid) => (eager ? -colIdx(cid) : colIdx(cid)); // eager: empezar lo más temprano
    const reviewMoves = R.cardsInColumn(state.cards, a.id.review)
      .filter(free).filter((c) => !blocked || c.urgent).filter((c) => c.urgent || R.hasRoom(state, a.id.qa))
      .map((c) => ({ c, type: 'review', rank: reviewRank }));
    const advMoves = R.advanceSources(state)
      .flatMap((colId) => R.cardsInColumn(state.cards, colId))
      .filter(free).filter((c) => !blocked || c.urgent)
      .filter((c) => c.urgent || R.hasRoom(state, R.nextColumnId(state, c.col)))
      .map((c) => ({ c, type: 'advance', rank: advRank(c.col) }));
    const moves = [...reviewMoves, ...advMoves].sort((m1, m2) =>
      (Number(!!m2.c.urgent) - Number(!!m1.c.urgent))
      || (m2.rank - m1.rank)
      || (R.priorityOf(m2.c) - R.priorityOf(m1.c)));
    for (const m of moves) {
      if (m.type === 'review') return { type: 'dev-review', cardId: m.c.id, dice: rollDie(), dev: cur, expect: { step } };
      if (R.needsPair(m.c)) {
        if (botPartner) return { type: 'dev-pair', cardId: m.c.id, dice: [rollDie(), rollDie()], partner: botPartner, dev: cur, expect: { step } };
        continue;
      }
      return { type: 'dev-advance', cardId: m.c.id, dice: rollDie(), dev: cur, expect: { step } };
    }
    return { type: 'dev-pass', dev: cur, expect: { step } };
  }
  return null;
}
