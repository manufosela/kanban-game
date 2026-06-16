// =============================================================================
// Kanban Game — reglas del juego (lógica PURA, sin Firebase, 100% testeable).
//
// Flujo canónico de 7 columnas:
//   Backlog → Análisis → Desarrollo → Revisión PR → QA → Validación PM → Done
//
// El motor es genérico por POSICIÓN para soportar columnas configurables
// (mínimo 5). Los "anclajes" semánticos se calculan desde el orden:
//   backlog    = primera
//   analysis   = segunda
//   done       = última
//   validation = penúltima
//   qa         = antepenúltima
//   review     = la anterior a qa
//   devReturn  = la anterior a review (destino del bug)
// Para el tablero por defecto de 7 columnas el mapeo coincide exactamente con
// el canónico (Desarrollo es devReturn, Revisión PR es review, etc.).
//
// NOTA sobre el paso 4 (QA): el documento de reglas menciona "Revisión PR"
// como origen, pero la opción B del Dev ya mueve Revisión PR → QA y la columna
// QA tiene límite WIP propio. La única lectura coherente (sin columnas muertas)
// es que QA prueba lo que hay en la columna QA y lo pasa a Validación PM, con el
// bug devolviendo a Desarrollo. Se implementa esa interpretación.
// =============================================================================

export const STORIES_PER_TURN = 3;
export const MAX_TURNS = 10;
export const QA_MAX_ROLLS = 2;
export const DICE_ADVANCE_MIN = 3;
export const PAIR_SUM_MIN = 5;

/** Columnas por defecto (con límites WIP usados en la Ronda 2). */
export function defaultColumns() {
  return [
    { name: 'Backlog', wipLimit: null },
    { name: 'Análisis', wipLimit: 2 },
    { name: 'Desarrollo', wipLimit: 3 },
    { name: 'Revisión PR', wipLimit: 2 },
    { name: 'QA', wipLimit: 2 },
    { name: 'Validación PM', wipLimit: 2 },
    { name: 'Done', wipLimit: null },
  ];
}

/**
 * Ordena las columnas por `order`. Acepta un array o un mapa {id: col}
 * (tal y como puede venir de Realtime Database) y garantiza que cada
 * columna conserva su `id`.
 */
export function orderedColumns(columns) {
  if (!columns) return [];
  const arr = Array.isArray(columns)
    ? columns.filter(Boolean)
    : Object.entries(columns).map(([id, col]) => ({ id, ...col }));
  return arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Calcula los índices/ids ancla a partir de las columnas ordenadas. */
export function anchors(orderedCols) {
  const n = orderedCols.length;
  const idx = {
    backlog: 0,
    analysis: 1,
    review: n - 4,
    qa: n - 3,
    validation: n - 2,
    done: n - 1,
    devReturn: n - 5,
  };
  const byId = {};
  for (const key of Object.keys(idx)) {
    const i = idx[key];
    byId[key] = i >= 0 && i < n ? orderedCols[i].id : null;
  }
  return { idx, id: byId, count: n };
}

export function diceAdvances(value) {
  return value >= DICE_ADVANCE_MIN;
}

export function pairAdvances(a, b) {
  return a + b >= PAIR_SUM_MIN;
}

/** Historias en una columna, ordenadas por número. */
export function cardsInColumn(cards, colId) {
  return Object.values(cards || {})
    .filter((c) => c.col === colId)
    .sort((a, b) => a.number - b.number);
}

export function countInColumn(cards, colId) {
  return cardsInColumn(cards, colId).length;
}

/**
 * Límite WIP efectivo de una columna para el estado actual.
 *  - wipEnabled=false: sin límite (independientemente del número de ronda).
 *  - Backlog y Done: nunca tienen límite.
 *  - wipLimit null/0: sin límite.
 */
export function wipLimitFor(state, colId) {
  const cols = orderedColumns(state.columns);
  const a = anchors(cols);
  if (!state.wipEnabled) return Infinity;
  if (colId === a.id.backlog || colId === a.id.done) return Infinity;
  const col = cols.find((c) => c.id === colId);
  if (!col || col.wipLimit == null || col.wipLimit <= 0) return Infinity;
  return col.wipLimit;
}

/** ¿Hay hueco en la columna destino? */
export function hasRoom(state, colId) {
  return countInColumn(state.cards, colId) < wipLimitFor(state, colId);
}

// ---------------------------------------------------------------------------
// Transformaciones de estado (devuelven SIEMPRE un estado nuevo).
// ---------------------------------------------------------------------------

function clone(state) {
  return {
    ...state,
    columns: state.columns.map((c) => ({ ...c })),
    cards: Object.fromEntries(Object.entries(state.cards || {}).map(([k, v]) => [k, { ...v }])),
  };
}

function moveCard(state, cardId, toColId) {
  const s = clone(state);
  if (s.cards[cardId]) s.cards[cardId].col = toColId;
  return s;
}

/** Paso 1 — el PM mete `n` historias nuevas en Backlog. */
export function addBacklogStories(state, n = STORIES_PER_TURN) {
  const s = clone(state);
  const cols = orderedColumns(s.columns);
  const backlogId = anchors(cols).id.backlog;
  let next = s.nextNumber || 1;
  for (let i = 0; i < n; i++) {
    const id = `s${next}`;
    s.cards[id] = { id, number: next, col: backlogId, bug: false };
    next++;
  }
  s.nextNumber = next;
  return s;
}

/**
 * Paso 2 — el PM tira 1 dado y mueve hasta `dice` historias de Backlog a Análisis.
 * En Ronda 2 respeta el WIP de Análisis (mueve hasta llenar o agotar el dado).
 * Devuelve { state, moved }.
 */
export function pmPullToAnalysis(state, dice) {
  const cols = orderedColumns(state.columns);
  const a = anchors(cols);
  let s = state;
  let moved = 0;
  const backlog = cardsInColumn(s.cards, a.id.backlog);
  for (const card of backlog) {
    if (moved >= dice) break;
    if (!hasRoom(s, a.id.analysis)) break;
    s = moveCard(s, card.id, a.id.analysis);
    moved++;
  }
  return { state: s, moved };
}

/** Columnas válidas como origen de "avanzar" (Dev opción A/C): de Análisis a Revisión-1. */
export function advanceSources(state) {
  const cols = orderedColumns(state.columns);
  const a = anchors(cols);
  const ids = [];
  for (let i = a.idx.analysis; i < a.idx.review; i++) ids.push(cols[i].id);
  return ids; // p.ej. [Análisis, Desarrollo] en el tablero de 7
}

/** Id de la columna siguiente a `colId` (o null si es la última). */
export function nextColumnId(state, colId) {
  const cols = orderedColumns(state.columns);
  const i = cols.findIndex((c) => c.id === colId);
  return i >= 0 && i < cols.length - 1 ? cols[i + 1].id : null;
}

/**
 * Dev opción A/C — avanza UNA historia una columna (Análisis→Desarrollo o
 * Desarrollo→Revisión PR). Comprueba WIP del destino (Ronda 2).
 * Devuelve { state, ok, reason }.
 */
export function devAdvance(state, cardId) {
  const card = state.cards?.[cardId];
  if (!card) return { state, ok: false, reason: 'no-card' };
  if (!advanceSources(state).includes(card.col)) return { state, ok: false, reason: 'bad-source' };
  const toId = nextColumnId(state, card.col);
  if (!toId) return { state, ok: false, reason: 'no-target' };
  if (!hasRoom(state, toId)) return { state, ok: false, reason: 'wip-full' };
  const s = moveCard(state, cardId, toId);
  return { state: s, ok: true };
}

/**
 * Dev opción B — revisa un PR: mueve UNA historia de Revisión PR a QA.
 * Comprueba WIP de QA (Ronda 2). Devuelve { state, ok, reason }.
 */
export function devReview(state, cardId) {
  const cols = orderedColumns(state.columns);
  const a = anchors(cols);
  const card = state.cards?.[cardId];
  if (!card) return { state, ok: false, reason: 'no-card' };
  if (card.col !== a.id.review) return { state, ok: false, reason: 'bad-source' };
  if (!hasRoom(state, a.id.qa)) return { state, ok: false, reason: 'wip-full' };
  const s = moveCard(state, cardId, a.id.qa);
  return { state: s, ok: true };
}

/**
 * Paso 4 — QA prueba UNA historia de la columna QA:
 *  - dado 3+: pasa a Validación PM (si hay hueco; si no, se queda en QA).
 *  - dado 1-2: BUG, vuelve a Desarrollo (devReturn). El bug puede superar el WIP.
 * Devuelve { state, result: 'passed'|'blocked'|'bug', toCol }.
 */
export function qaTest(state, cardId, dice) {
  const cols = orderedColumns(state.columns);
  const a = anchors(cols);
  const card = state.cards?.[cardId];
  if (!card || card.col !== a.id.qa) return { state, result: 'invalid' };

  if (diceAdvances(dice)) {
    if (!hasRoom(state, a.id.validation)) return { state, result: 'blocked', toCol: a.id.qa };
    let s = moveCard(state, cardId, a.id.validation);
    s.cards[cardId].bug = false;
    return { state: s, result: 'passed', toCol: a.id.validation };
  }
  // Bug: vuelve a Desarrollo aunque supere el WIP (excepción de la Ronda 2).
  let s = moveCard(state, cardId, a.id.devReturn);
  s.cards[cardId].bug = true;
  return { state: s, result: 'bug', toCol: a.id.devReturn };
}

/**
 * Paso 5 — el PM tira 1 dado y valida hasta `dice` historias de Validación PM a Done.
 * Devuelve { state, moved }.
 */
export function pmValidate(state, dice) {
  const cols = orderedColumns(state.columns);
  const a = anchors(cols);
  let s = state;
  let moved = 0;
  const waiting = cardsInColumn(s.cards, a.id.validation);
  for (const card of waiting) {
    if (moved >= dice) break;
    s = moveCard(s, card.id, a.id.done);
    moved++;
  }
  if (moved > 0) {
    s = clone(s);
    s.doneCount = (s.doneCount || 0) + moved;
  }
  return { state: s, moved };
}

/** Total acumulado de historias en Done. */
export function doneTotal(state) {
  const cols = orderedColumns(state.columns);
  const a = anchors(cols);
  return countInColumn(state.cards, a.id.done);
}

/** Snapshot de métricas del turno: conteo por columna + total Done. */
export function turnSnapshot(state) {
  const cols = orderedColumns(state.columns);
  const perColumn = {};
  for (const c of cols) perColumn[c.id] = countInColumn(state.cards, c.id);
  return {
    turn: state.turn,
    round: state.round,
    perColumn,
    done: doneTotal(state),
  };
}

/**
 * Columna con mayor acumulación media (cuello de botella), excluyendo
 * Backlog y Done. `snapshots` es un array de turnSnapshot.
 * Devuelve { colId, avg } o null.
 */
export function bottleneck(snapshots, columns) {
  if (!snapshots || snapshots.length === 0) return null;
  const cols = orderedColumns(columns);
  const a = anchors(cols);
  const exclude = new Set([a.id.backlog, a.id.done]);
  const totals = {};
  for (const snap of snapshots) {
    for (const [colId, count] of Object.entries(snap.perColumn || {})) {
      if (exclude.has(colId)) continue;
      totals[colId] = (totals[colId] || 0) + count;
    }
  }
  let best = null;
  for (const [colId, total] of Object.entries(totals)) {
    const avg = total / snapshots.length;
    if (!best || avg > best.avg) best = { colId, avg };
  }
  return best;
}
