import { describe, it, expect } from 'vitest';
import * as R from '../src/lib/rules.js';

// Construye un estado base con columnas con id estable a partir de defaultColumns.
function buildState({ round = 1, wipEnabled = false } = {}) {
  const columns = R.defaultColumns().map((c, i) => ({
    id: `c${i}`,
    name: c.name,
    order: i,
    wipLimit: c.wipLimit,
  }));
  return {
    round,
    wipEnabled,
    turn: 1,
    step: 1,
    status: 'playing',
    columns,
    cards: {},
    doneCount: 0,
    nextNumber: 1,
  };
}

// ids canónicos para el tablero de 7 columnas
const ID = {
  backlog: 'c0', analisis: 'c1', desarrollo: 'c2', revision: 'c3',
  qa: 'c4', validacion: 'c5', done: 'c6',
};

function putCard(state, id, number, col, bug = false) {
  state.cards[id] = { id, number, col, bug };
}

describe('anclas y columnas', () => {
  it('mapea las 7 columnas canónicas', () => {
    const s = buildState();
    const a = R.anchors(R.orderedColumns(s.columns));
    expect(a.id.backlog).toBe(ID.backlog);
    expect(a.id.analysis).toBe(ID.analisis);
    expect(a.id.review).toBe(ID.revision);
    expect(a.id.qa).toBe(ID.qa);
    expect(a.id.validation).toBe(ID.validacion);
    expect(a.id.done).toBe(ID.done);
    expect(a.id.devReturn).toBe(ID.desarrollo);
  });
});

describe('dado', () => {
  it('1 y 2 no avanzan; 3+ avanza', () => {
    expect(R.diceAdvances(1)).toBe(false);
    expect(R.diceAdvances(2)).toBe(false);
    expect(R.diceAdvances(3)).toBe(true);
    expect(R.diceAdvances(6)).toBe(true);
  });
  it('pair: suma 5+', () => {
    expect(R.pairAdvances(2, 2)).toBe(false);
    expect(R.pairAdvances(2, 3)).toBe(true);
  });
});

describe('paso 1: meter historias', () => {
  it('mete 3 historias numeradas en backlog', () => {
    let s = buildState();
    s = R.addBacklogStories(s, 3);
    expect(R.countInColumn(s.cards, ID.backlog)).toBe(3);
    expect(s.nextNumber).toBe(4);
    const nums = R.cardsInColumn(s.cards, ID.backlog).map((c) => c.number);
    expect(nums).toEqual([1, 2, 3]);
  });
});

describe('paso 2: PM backlog -> análisis', () => {
  it('mueve hasta el valor del dado sin WIP (ronda 1)', () => {
    let s = buildState();
    s = R.addBacklogStories(s, 5);
    const { state, moved } = R.pmPullToAnalysis(s, 4);
    expect(moved).toBe(4);
    expect(R.countInColumn(state.cards, ID.analisis)).toBe(4);
    expect(R.countInColumn(state.cards, ID.backlog)).toBe(1);
  });

  it('respeta el WIP de análisis en ronda 2', () => {
    let s = buildState({ round: 2, wipEnabled: true });
    s = R.addBacklogStories(s, 5);
    const { state, moved } = R.pmPullToAnalysis(s, 4); // WIP análisis = 2
    expect(moved).toBe(2);
    expect(R.countInColumn(state.cards, ID.analisis)).toBe(2);
  });
});

describe('paso 3: Dev avanzar / revisar', () => {
  it('avanza análisis -> desarrollo', () => {
    let s = buildState();
    putCard(s, 'a', 1, ID.analisis);
    const { state, ok } = R.devAdvance(s, 'a');
    expect(ok).toBe(true);
    expect(state.cards.a.col).toBe(ID.desarrollo);
  });

  it('bloquea avance si el destino está lleno (ronda 2)', () => {
    let s = buildState({ round: 2, wipEnabled: true });
    putCard(s, 'x1', 1, ID.desarrollo);
    putCard(s, 'x2', 2, ID.desarrollo);
    putCard(s, 'x3', 3, ID.desarrollo); // desarrollo lleno (WIP 3)
    putCard(s, 'a', 4, ID.analisis);
    const { ok, reason } = R.devAdvance(s, 'a');
    expect(ok).toBe(false);
    expect(reason).toBe('wip-full');
  });

  it('revisar PR mueve revisión -> QA', () => {
    let s = buildState();
    putCard(s, 'a', 1, ID.revision);
    const { state, ok } = R.devReview(s, 'a');
    expect(ok).toBe(true);
    expect(state.cards.a.col).toBe(ID.qa);
  });
});

describe('paso 4: QA', () => {
  it('3+ pasa de QA a validación', () => {
    let s = buildState();
    putCard(s, 'a', 1, ID.qa);
    const { state, result } = R.qaTest(s, 'a', 5);
    expect(result).toBe('passed');
    expect(state.cards.a.col).toBe(ID.validacion);
  });

  it('1-2 genera bug y vuelve a desarrollo', () => {
    let s = buildState();
    putCard(s, 'a', 1, ID.qa);
    const { state, result } = R.qaTest(s, 'a', 1);
    expect(result).toBe('bug');
    expect(state.cards.a.col).toBe(ID.desarrollo);
    expect(state.cards.a.bug).toBe(true);
  });

  it('bug puede superar el WIP de desarrollo (excepción)', () => {
    let s = buildState({ round: 2, wipEnabled: true });
    putCard(s, 'x1', 1, ID.desarrollo);
    putCard(s, 'x2', 2, ID.desarrollo);
    putCard(s, 'x3', 3, ID.desarrollo); // desarrollo en su límite (3)
    putCard(s, 'a', 4, ID.qa);
    const { state, result } = R.qaTest(s, 'a', 2);
    expect(result).toBe('bug');
    expect(R.countInColumn(state.cards, ID.desarrollo)).toBe(4); // supera el WIP
  });

  it('si validación está llena, la historia se queda en QA (ronda 2)', () => {
    let s = buildState({ round: 2, wipEnabled: true });
    putCard(s, 'v1', 1, ID.validacion);
    putCard(s, 'v2', 2, ID.validacion); // validación llena (WIP 2)
    putCard(s, 'a', 3, ID.qa);
    const { state, result } = R.qaTest(s, 'a', 6);
    expect(result).toBe('blocked');
    expect(state.cards.a.col).toBe(ID.qa);
  });
});

describe('paso 5: PM valida -> Done', () => {
  it('valida hasta el valor del dado e incrementa Done', () => {
    let s = buildState();
    putCard(s, 'v1', 1, ID.validacion);
    putCard(s, 'v2', 2, ID.validacion);
    putCard(s, 'v3', 3, ID.validacion);
    const { state, moved } = R.pmValidate(s, 2);
    expect(moved).toBe(2);
    expect(R.countInColumn(state.cards, ID.done)).toBe(2);
    expect(R.doneTotal(state)).toBe(2);
  });
});

describe('WIP desacoplado del número de ronda', () => {
  it('aplica WIP en cualquier ronda si wipEnabled=true', () => {
    const s = buildState({ round: 3, wipEnabled: true });
    expect(R.wipLimitFor(s, ID.analisis)).toBe(2);
  });
  it('no aplica WIP aunque sea ronda 2 si wipEnabled=false', () => {
    const s = buildState({ round: 2, wipEnabled: false });
    expect(R.wipLimitFor(s, ID.analisis)).toBe(Infinity);
  });
});

describe('métricas', () => {
  it('snapshot cuenta por columna y total done', () => {
    let s = buildState();
    putCard(s, 'a', 1, ID.analisis);
    putCard(s, 'd', 2, ID.done);
    const snap = R.turnSnapshot(s);
    expect(snap.perColumn[ID.analisis]).toBe(1);
    expect(snap.done).toBe(1);
  });

  it('detecta cuello de botella excluyendo backlog y done', () => {
    const s = buildState();
    const snaps = [
      { turn: 1, perColumn: { [ID.backlog]: 10, [ID.desarrollo]: 4, [ID.qa]: 1, [ID.done]: 9 } },
      { turn: 2, perColumn: { [ID.backlog]: 12, [ID.desarrollo]: 6, [ID.qa]: 2, [ID.done]: 9 } },
    ];
    const b = R.bottleneck(snaps, s.columns);
    expect(b.colId).toBe(ID.desarrollo);
  });
});

describe('puntuación de historias', () => {
  it('priorityOf = redondeo(dev/negocio*100)', () => {
    expect(R.priorityOf({ dev: 5, business: 2 })).toBe(250);
    expect(R.priorityOf({ dev: 3, business: 3 })).toBe(100);
    expect(R.priorityOf({ dev: 8, business: 3 })).toBe(267);
    expect(R.priorityOf({ dev: null, business: 3 })).toBe(0);
  });
  it('needsPair solo si Fibonacci > 8', () => {
    expect(R.needsPair({ dev: 13 })).toBe(true);
    expect(R.needsPair({ dev: 8 })).toBe(false);
    expect(R.needsPair({ dev: 5 })).toBe(false);
    expect(R.needsPair({ dev: null })).toBe(false);
  });
  it('el backlog asigna puntos de negocio 1..5 y dev nulo', () => {
    let s = buildState();
    s = R.addBacklogStories(s, 3);
    for (const c of R.cardsInColumn(s.cards, ID.backlog)) {
      expect(c.business).toBeGreaterThanOrEqual(1);
      expect(c.business).toBeLessThanOrEqual(5);
      expect(c.dev).toBeNull();
    }
  });
  it('al entrar en Refinement asigna estimación Fibonacci', () => {
    let s = buildState();
    s = R.addBacklogStories(s, 3);
    const { state } = R.pmPullToAnalysis(s, 2);
    for (const c of R.cardsInColumn(state.cards, ID.analisis)) {
      expect(R.FIB_DECK).toContain(c.dev);
    }
  });
});

describe('totales entregados en Done', () => {
  it('suma negocio y dev de las historias en Done', () => {
    const s = buildState();
    putCard(s, 'a', 1, ID.done); s.cards.a.business = 3; s.cards.a.dev = 5;
    putCard(s, 'b', 2, ID.done); s.cards.b.business = 2; s.cards.b.dev = 8;
    putCard(s, 'c', 3, ID.desarrollo); s.cards.c.business = 4; s.cards.c.dev = 2;
    expect(R.doneTotal(s)).toBe(2);
    expect(R.doneBusiness(s)).toBe(5);
    expect(R.doneDev(s)).toBe(13);
  });
});
