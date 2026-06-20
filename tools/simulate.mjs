// Simulador headless del Kanban Game: ejecuta el motor PURO (engine.js) con bots,
// comparando sin WIP vs con WIP sobre el MISMO mazo, a varias longitudes y con
// muchas repeticiones para cancelar el ruido de los dados.
//
//   node tools/simulate.mjs [reps] [devs] [qa] [pm]
//
// No toca Firebase. Sirve para validar la calibración antes de jugar en real.
import * as R from '../src/lib/rules.js';
import * as E from '../src/lib/engine.js';

const REPS = Number(process.argv[2]) || 400;
const N_DEV = Number(process.argv[3]) || 3;
const N_QA = Number(process.argv[4]) || 1;
const N_PM = Number(process.argv[5]) || 1;
const LENGTHS = [10, 20, 40];

function roleAssignments() {
  const ra = {};
  for (let i = 1; i <= N_DEV; i++) ra[`bot_d${i}`] = 'DEV';
  for (let i = 1; i <= N_QA; i++) ra[`bot_q${i}`] = 'QA';
  for (let i = 1; i <= N_PM; i++) ra[`bot_p${i}`] = 'PM';
  return ra;
}

function makeBoard(wipEnabled, ra) {
  const columns = R.defaultColumns().map((c, i) => ({ id: `c${i}`, name: c.name, order: i, wipLimit: c.wipLimit }));
  return { id: 'sim', teamId: null, columns, roleAssignments: ra };
}

/** Mazo compartido: business/dev por número de historia (réplica justa entre rondas). */
function makeDeck(size = 400) {
  const deck = {};
  for (let n = 1; n <= size; n++) deck[n] = { business: R.randomBusiness(), dev: R.randomFib() };
  return deck;
}

// Bot alternativo "start-eager" (mentalidad push): prioriza EMPEZAR trabajo nuevo
// (avanzar desde las columnas más tempranas) antes que revisar/terminar. Modela
// a un equipo sin disciplina de WIP. Es lo que enseña el juego: con límite WIP no
// puedes empezar de más; sin límite, inundas el sistema.
function botActionEager(state, startBias = 1) {
  if (!state || state.status !== 'playing') return null;
  const cols = R.orderedColumns(state.columns);
  const a = R.anchors(cols);
  const step = state.step;
  if (step !== E.STEP.DEVS) return E.botAction(state); // resto de pasos igual
  // Mezcla realista: con prob (1-startBias) se comporta disciplinado (terminar primero).
  if (Math.random() >= startBias) return E.botAction(state);
  const acted = state.devActed || {};
  const isBot = (u) => typeof u === 'string' && u.startsWith('bot_');
  const pending = (state.devOrder || []).filter((u) => !acted[u]);
  if (pending.some((u) => !isBot(u))) return null;
  const cur = pending.find((u) => isBot(u));
  if (!cur) return null;
  const claims = state.claims || {};
  const free = (c) => !claims[c.id] || claims[c.id] === cur;
  const blocked = R.urgentActive(state);
  const colIdx = (cid) => cols.findIndex((c) => c.id === cid);
  const botPartner = (state.devOrder || []).find((u) => !acted[u] && u !== cur && isBot(u));
  // EMPEZAR primero: avanzar desde columnas tempranas (rank = -colIdx, antes = mayor).
  const advMoves = R.advanceSources(state)
    .flatMap((colId) => R.cardsInColumn(state.cards, colId))
    .filter(free).filter((c) => !blocked || c.urgent)
    .filter((c) => c.urgent || R.hasRoom(state, R.nextColumnId(state, c.col)))
    .map((c) => ({ c, type: 'advance', rank: -colIdx(c.col) }));
  const reviewMoves = R.cardsInColumn(state.cards, a.id.review)
    .filter(free).filter((c) => !blocked || c.urgent).filter((c) => c.urgent || R.hasRoom(state, a.id.qa))
    .map((c) => ({ c, type: 'review', rank: -1000 })); // revisar lo último
  const moves = [...advMoves, ...reviewMoves].sort((m1, m2) =>
    (Number(!!m2.c.urgent) - Number(!!m1.c.urgent)) || (m2.rank - m1.rank));
  for (const m of moves) {
    if (m.type === 'review') return { type: 'dev-review', cardId: m.c.id, dice: E.rollDie(), dev: cur, expect: { step } };
    if (R.needsPair(m.c)) {
      if (botPartner) return { type: 'dev-pair', cardId: m.c.id, dice: [E.rollDie(), E.rollDie()], partner: botPartner, dev: cur, expect: { step } };
      continue;
    }
    return { type: 'dev-advance', cardId: m.c.id, dice: E.rollDie(), dev: cur, expect: { step } };
  }
  return { type: 'dev-pass', dev: cur, expect: { step } };
}

function runGame({ wipEnabled, ciclos, ra, deck, eager = false }) {
  const board = makeBoard(wipEnabled, ra);
  const cols = E.resolveColumns(board, wipEnabled).cols;
  const state = E.buildGameState(board, { wipEnabled, rondas: 1, ciclos }, deck, cols);
  const bias = Number(process.env.BIAS ?? 1);
  const bot = eager ? (s) => botActionEager(s, bias) : E.botAction;
  let guard = 0;
  const MAX = ciclos * 200 + 1000;
  while (state.status === 'playing') {
    const action = bot(state);
    if (!action) break; // no debería ocurrir con equipo 100% bots
    E.applyActionState(state, action);
    if (++guard > MAX) { console.error('guard tripped'); break; }
  }
  return R.gameMetrics(state);
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + (b ?? 0), 0) / arr.length : null; }
function meanDefined(arr) { const v = arr.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function f(x, d = 1) { return x == null ? '  —' : x.toFixed(d); }
function pct(x) { return x == null ? '  —' : `${(x * 100).toFixed(0)}%`; }

const ra = roleAssignments();
console.log(`\nKanban Game · simulación headless`);
console.log(`Equipo: ${N_DEV} DEV · ${N_QA} QA · ${N_PM} PM   |   ${REPS} repeticiones por longitud   |   mismo mazo por pareja\n`);

const head = ['Long.', 'Pol.', 'Done', '💼Neg', '🔧Dev', 'Ciclo', 'WIPmed', 'WIPpico', 'Throughput', 'Retrabajo', 'EficDev'];
console.log(head.map((h, i) => h.padEnd(i === 0 ? 6 : 10)).join(''));

for (const ciclos of LENGTHS) {
  const acc = { noWip: [], wip: [] };
  for (let r = 0; r < REPS; r++) {
    const deck = makeDeck();
    const eager = process.env.EAGER === '1';
    acc.noWip.push(runGame({ wipEnabled: false, ciclos, ra, deck, eager }));
    acc.wip.push(runGame({ wipEnabled: true, ciclos, ra, deck, eager }));
  }
  for (const [key, label] of [['noWip', 'sinWIP'], ['wip', 'conWIP']]) {
    const m = acc[key];
    const row = [
      String(ciclos).padEnd(6),
      label.padEnd(10),
      f(mean(m.map((x) => x.doneTotal))).padEnd(10),
      f(mean(m.map((x) => x.doneBusiness))).padEnd(10),
      f(mean(m.map((x) => x.doneDev))).padEnd(10),
      f(meanDefined(m.map((x) => x.avgCycleTime))).padEnd(10),
      f(mean(m.map((x) => x.avgActiveWip))).padEnd(10),
      f(mean(m.map((x) => x.peakActiveWip))).padEnd(10),
      f(meanDefined(m.map((x) => x.throughputPerTurn)), 2).padEnd(10),
      pct(meanDefined(m.map((x) => x.reworkRate))).padEnd(10),
      pct(meanDefined(m.map((x) => x.devEfficiency))).padEnd(10),
    ];
    console.log(row.join(''));
  }
  console.log('');
}
