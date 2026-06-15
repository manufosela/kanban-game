import { LitElement, html } from 'lit';

/**
 * Throughput por turno (barras) + Done acumulado (línea).
 * Propiedad .snapshots = { turn: { done } }.
 */
export class ThroughputChart extends LitElement {
  static properties = { snapshots: { attribute: false } };
  createRenderRoot() { return this; }

  render() {
    const snaps = this.snapshots || {};
    const turns = Object.keys(snaps).map(Number).sort((a, b) => a - b);
    if (turns.length === 0) return html`<p class="muted">No hay datos de turnos todavía.</p>`;

    const doneAt = (t) => snaps[t]?.done || 0;
    const through = turns.map((t, i) => Math.max(0, doneAt(t) - (i > 0 ? doneAt(turns[i - 1]) : 0)));
    const maxDone = Math.max(1, ...turns.map(doneAt));
    const maxThrough = Math.max(1, ...through);

    const W = 640, H = 280, M = { t: 16, r: 20, b: 30, l: 34 };
    const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
    const band = innerW / turns.length;
    const x = (i) => M.l + band * i + band / 2;
    const yBar = (v) => (v / maxThrough) * innerH;
    const yLine = (v) => M.t + innerH - (v / maxDone) * innerH;

    const linePts = turns.map((t, i) => `${x(i).toFixed(1)},${yLine(doneAt(t)).toFixed(1)}`).join(' ');

    return html`
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Throughput y Done acumulado">
          ${[0, 0.5, 1].map((f) => {
            const yy = M.t + innerH - f * innerH;
            return html`<line x1=${M.l} y1=${yy} x2=${W - M.r} y2=${yy} stroke="#31435c" opacity="0.5"></line>`;
          })}
          ${turns.map((t, i) => html`
            <rect x=${M.l + band * i + band * 0.2} y=${M.t + innerH - yBar(through[i])}
                  width=${band * 0.6} height=${yBar(through[i])} rx="3" fill="#3d8bff" opacity="0.85">
              <title>Turno ${t}: ${through[i]} completadas</title>
            </rect>
            <text x=${x(i)} y=${H - 10} text-anchor="middle" fill="#6f819a" font-size="10">T${t}</text>
          `)}
          <polyline points=${linePts} fill="none" stroke="#66bb6a" stroke-width="2.5"></polyline>
          ${turns.map((t, i) => html`<circle cx=${x(i)} cy=${yLine(doneAt(t))} r="3" fill="#66bb6a"></circle>`)}
        </svg>
        <div class="row" style="gap:16px; font-size:.85rem; margin-top:4px">
          <span><span style="display:inline-block;width:12px;height:12px;background:#3d8bff;border-radius:2px"></span> Throughput por turno</span>
          <span><span style="display:inline-block;width:12px;height:3px;background:#66bb6a;vertical-align:middle"></span> Done acumulado</span>
        </div>
      </div>
    `;
  }
}

customElements.define('kbg-throughput', ThroughputChart);
