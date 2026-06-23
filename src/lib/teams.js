// Reparto de personas en equipos por ROL (lógica PURA, sin DOM ni Firebase → testeable).

export const ROLES = ['PM', 'DEV', 'QA'];

/**
 * Reparte `pool` entre los equipos por su ROL existente, SIN reconvertir:
 *  - 1 PM y 1 QA por equipo como máximo (contando los roles ya presentes),
 *  - los DEV se reparten todos, al equipo con menos gente,
 *  - quien no cuadra (PM/QA de más, o personas sin rol) queda en `leftOut`.
 *
 * @param {Array<{id:string, pref:string, name?:string, invited?:boolean}>} pool
 * @param {Array<{PM:number, DEV:number, QA:number}>} existings  roles ya presentes por equipo
 * @returns {{ plans: Array<{PM:Array,DEV:Array,QA:Array}>, leftOut: Array }}
 */
export function planByRole(pool, existings) {
  const n = existings.length;
  const plans = existings.map(() => ({ PM: [], DEV: [], QA: [] }));
  const has = (ti, role) => (existings[ti][role] || 0) + plans[ti][role].length;
  const leftOut = [];
  const seatUnique = (list, role) => {
    for (const p of list) {
      let placed = false;
      for (let ti = 0; ti < n; ti++) {
        if (has(ti, role) < 1) { plans[ti][role].push(p); placed = true; break; }
      }
      if (!placed) leftOut.push({ ...p, role }); // ese rol ya está cubierto en todos los equipos
    }
  };
  seatUnique(pool.filter((p) => p.pref === 'PM'), 'PM');
  seatUnique(pool.filter((p) => p.pref === 'QA'), 'QA');
  for (const p of pool.filter((x) => x.pref === 'DEV')) {
    let best = 0;
    let min = Infinity;
    for (let ti = 0; ti < n; ti++) {
      const c = has(ti, 'PM') + has(ti, 'DEV') + has(ti, 'QA');
      if (c < min) { min = c; best = ti; }
    }
    plans[best].DEV.push(p);
  }
  pool.filter((p) => !ROLES.includes(p.pref)).forEach((p) => leftOut.push({ ...p, role: '' }));
  return { plans, leftOut };
}

/**
 * Conteo de roles ya presentes en un equipo: miembros reales + bots (team.members)
 * más los pre-registrados asignados (invited con teamId).
 * @returns {{PM:number, DEV:number, QA:number}}
 */
export function teamRoleCounts(team, invited = []) {
  const c = { PM: 0, DEV: 0, QA: 0 };
  for (const r of Object.values(team.members || {})) if (c[r] != null) c[r] += 1;
  for (const iv of invited) if (iv.teamId === team.id && c[iv.role] != null) c[iv.role] += 1;
  return c;
}
