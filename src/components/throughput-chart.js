import { LitElement, html, svg } from 'lit';

/**
 * Throughput por turno (barras) + Done acumulado (línea).
 * Propiedad .snapshots = { turn: { done } }.
 */
export class ThroughputChart extends LitElement {
  static properties = { snapshots: { attribute: false } };
  createRenderRoot() { return this; }

  render() {
    // Normaliza objeto {turn: snap} o array (RTDB) a lista ordenada, ignorando huecos null.
    const raw = this.snapshots || {};
    const list = (Array.isArray(raw) ? raw : Object.values(raw))
      .filter((s) => s && typeof s.done === 'number')
      .sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
    if (list.length === 0) return html`<p class="muted">No hay datos de turnos todavía.</p>`;

    const doneAt = (i) => list[i]?.done || 0;
    const through = list.map((s, i) => Math.max(0, doneAt(i) - (i > 0 ? doneAt(i - 1) : 0)));
    const maxDone = Math.max(1, ...list.map((s) => s.done || 0));
    const maxThrough = Math.max(1, ...through);

    const W = 640, H = 280, M = { t: 16, r: 20, b: 30, l: 34 };
    const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
    const band = innerW / list.length;
    const x = (i) => M.l + band * i + band / 2;
    const yBar = (v) => (v / maxThrough) * innerH;
    const yLine = (v) => M.t + innerH - (v / maxDone) * innerH;

    const linePts = list.map((s, i) => `${x(i).toFixed(1)},${yLine(doneAt(i)).toFixed(1)}`).join(' ');

    return html`
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Throughput y Done acumulado">
          ${[0, 0.5, 1].map((f) => {
            const yy = M.t + innerH - f * innerH;
            return svg`<line x1=${M.l} y1=${yy} x2=${W - M.r} y2=${yy} stroke="#31435c" opacity="0.5"></line>`;
          })}
          ${list.map((s, i) => svg`
            <rect x=${M.l + band * i + band * 0.2} y=${M.t + innerH - yBar(through[i])}
                  width=${band * 0.6} height=${yBar(through[i])} rx="3" fill="#3d8bff" opacity="0.85">
              <title>Turno ${s.turn ?? i}: ${through[i]} completadas</title>
            </rect>
            <text x=${x(i)} y=${H - 10} text-anchor="middle" fill="#6f819a" font-size="10">T${s.turn ?? i}</text>
          `)}
          <polyline points=${linePts} fill="none" stroke="#66bb6a" stroke-width="2.5"></polyline>
          ${list.map((s, i) => svg`<circle cx=${x(i)} cy=${yLine(doneAt(i))} r="3" fill="#66bb6a"></circle>`)}
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
