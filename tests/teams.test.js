import { describe, it, expect } from 'vitest';
import { planByRole, teamRoleCounts } from '../src/lib/teams.js';

const p = (id, pref) => ({ id, pref, name: id });
const zero = (n) => Array.from({ length: n }, () => ({ PM: 0, DEV: 0, QA: 0 }));

describe('planByRole — reparto por rol sin reconvertir', () => {
  it('1 PM y 1 QA por equipo; DEV repartidos; nadie fuera si cuadra', () => {
    const pool = [p('pm1', 'PM'), p('pm2', 'PM'), p('qa1', 'QA'), p('qa2', 'QA'), p('d1', 'DEV'), p('d2', 'DEV'), p('d3', 'DEV')];
    const { plans, leftOut } = planByRole(pool, zero(2));
    expect(plans[0].PM).toHaveLength(1);
    expect(plans[1].PM).toHaveLength(1);
    expect(plans[0].QA).toHaveLength(1);
    expect(plans[1].QA).toHaveLength(1);
    expect(plans[0].DEV.length + plans[1].DEV.length).toBe(3);
    expect(leftOut).toHaveLength(0);
  });

  it('PMs de más quedan FUERA (no se reconvierten)', () => {
    const pool = [p('pm1', 'PM'), p('pm2', 'PM'), p('pm3', 'PM')];
    const { plans, leftOut } = planByRole(pool, zero(2));
    expect(plans[0].PM).toHaveLength(1);
    expect(plans[1].PM).toHaveLength(1);
    expect(plans[0].DEV).toHaveLength(0); // NO se reconvierte a DEV
    expect(leftOut).toHaveLength(1);
    expect(leftOut[0].id).toBe('pm3');
    expect(leftOut[0].role).toBe('PM');
  });

  it('personas sin rol quedan fuera con role vacío', () => {
    const pool = [p('x', ''), p('y', null)];
    const { leftOut } = planByRole(pool, zero(1));
    expect(leftOut).toHaveLength(2);
    expect(leftOut.every((l) => l.role === '')).toBe(true);
  });

  it('respeta los roles ya presentes (no añade 2º PM a un equipo que ya lo tiene)', () => {
    const existings = [{ PM: 1, DEV: 0, QA: 0 }, { PM: 0, DEV: 0, QA: 0 }];
    const { plans, leftOut } = planByRole([p('pm1', 'PM')], existings);
    expect(plans[0].PM).toHaveLength(0); // el equipo 0 ya tenía PM
    expect(plans[1].PM).toHaveLength(1); // va al equipo 1
    expect(leftOut).toHaveLength(0);
  });

  it('DEV va al equipo con menos gente', () => {
    const existings = [{ PM: 1, DEV: 2, QA: 1 }, { PM: 0, DEV: 0, QA: 0 }];
    const { plans } = planByRole([p('d', 'DEV')], existings);
    expect(plans[1].DEV).toHaveLength(1); // el equipo 1 estaba más vacío
    expect(plans[0].DEV).toHaveLength(0);
  });
});

describe('teamRoleCounts', () => {
  it('cuenta miembros (reales+bots) e invitados asignados', () => {
    const team = { id: 't1', members: { u1: 'PM', bot_1: 'DEV', u2: 'DEV' } };
    const invited = [{ id: 'inv_a', teamId: 't1', role: 'QA' }, { id: 'inv_b', teamId: 't2', role: 'PM' }];
    expect(teamRoleCounts(team, invited)).toEqual({ PM: 1, DEV: 2, QA: 1 });
  });
  it('equipo vacío → todo a cero', () => {
    expect(teamRoleCounts({ id: 't', members: {} }, [])).toEqual({ PM: 0, DEV: 0, QA: 0 });
  });
});
