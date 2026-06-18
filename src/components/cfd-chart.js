import { LitElement, html } from 'lit';
import * as R from '../lib/rules.js';

const PALETTE = ['#8a94a6', '#6c8cff', '#4dd0e1', '#b07cff', '#ffb74d', '#4db6ac', '#66bb6a', '#ef5d5d', '#f4a83a'];

/**
 * Diagrama de flujo acumulado (CFD): área apilada de historias por columna a lo
 * largo de los turnos. Las bandas que se ensanchan revelan acumulación (cuello de botella).
 * Propiedades: .snapshots (objeto {turn: {perColumn}}), .columns (array).
 */
export class CfdChart extends LitElement {
  static properties = { snapshots: { attribute: false }, columns: { attribute: false } };
  createRenderRoot() { return this; }

  render() {
    const snaps = this.snapshots || {};
    const turns = Object.keys(snaps).map(Number).sort((a, b) => a - b);
    const cols = R.orderedColumns(this.columns || []);
    if (turns.length === 0 || cols.length === 0) {
      return html`<p class="muted">No hay datos de turnos todavía.</p>`;
    }

    const W = 640, H = 300, M = { t: 16, r: 130, b: 30, l: 34 };
    const innerW = W - M.l - M.r, innerH = H - M.t - M.b;

    // Suma total por turno para escalar Y.
    const totalAt = (t) => cols.reduce((sum, c) => sum + (snaps[t]?.perColumn?.[c.id] || 0), 0);
    const maxStack = Math.max(1, ...turns.map(totalAt));

    const x = (t, i) => M.l + (turns.length === 1 ? innerW / 2 : (i / (turns.length - 1)) * innerW);
    const y = (v) => M.t + innerH - (v / maxStack) * innerH;

    // Cumulativos por columna y turno.
    const cum = turns.map((t) => {
      let acc = 0;
      return cols.map((c) => { const lo = acc; acc += (snaps[t]?.perColumn?.[c.id] || 0); return { lo, hi: acc }; });
    });

    const areas = cols.map((c, k) => {
      const top = turns.map((t, i) => `${x(t, i).toFixed(1)},${y(cum[i][k].hi).toFixed(1)}`);
      const bottom = turns.map((t, i) => `${x(t, i).toFixed(1)},${y(cum[i][k].lo).toFixed(1)}`).reverse();
      return { name: c.name, color: PALETTE[k % PALETTE.length], points: [...top, ...bottom].join(' ') };
    });

    const yTicks = 4;
    return html`
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Diagrama de flujo acumulado">
          ${Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = (maxStack / yTicks) * i;
            return html`<g>
              <line x1=${M.l} y1=${y(v)} x2=${W - M.r} y2=${y(v)} stroke="#31435c" stroke-width="1" opacity="0.5"></line>
              <text x=${M.l - 6} y=${y(v) + 4} text-anchor="end" fill="#6f819a" font-size="10">${Math.round(v)}</text>
            </g>`;
          })}
          ${areas.map((a) => html`<polygon points=${a.points} fill=${a.color} opacity="0.85"></polygon>`)}
          ${turns.map((t, i) => html`<text x=${x(t, i)} y=${H - 10} text-anchor="middle" fill="#6f819a" font-size="10">T${t}</text>`)}
          ${cols.map((c, k) => html`
            <g transform="translate(${W - M.r + 12}, ${M.t + 8 + k * 18})">
              <rect width="12" height="12" rx="2" fill=${PALETTE[k % PALETTE.length]}></rect>
              <text x="18" y="10" fill="#a9b8cc" font-size="11">${c.name}</text>
            </g>`)}
        </svg>
      </div>
    `;
  }
}

customElements.define('kbg-cfd', CfdChart);
