import { LitElement, html } from 'lit';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase.js';
import { watchBoard } from '../lib/db.js';
import { watchGame } from '../lib/game.js';
import * as R from '../lib/rules.js';
import './cfd-chart.js';
import './throughput-chart.js';

export class ResultsView extends LitElement {
  static properties = {
    boardId: { type: String, attribute: 'board-id' },
    board: { state: true },
    game: { state: true },
    results: { state: true },
  };
  constructor() { super(); this.board = null; this.game = null; this.results = {}; }
  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._wb = watchBoard(this.boardId, (b) => { this.board = b; });
    this._wg = watchGame(this.boardId, (g) => { this.game = g; });
    this._wr = onValue(ref(db, `results/${this.boardId}`), (s) => { this.results = s.exists() ? s.val() : {}; });
  }
  disconnectedCallback() { super.disconnectedCallback(); this._wb?.(); this._wg?.(); this._wr?.(); }

  colName(columns, colId) {
    const c = R.orderedColumns(columns).find((x) => x.id === colId);
    return c?.name || colId;
  }

  bottleneckOf(snapshots, columns) {
    const arr = Object.values(snapshots || {});
    const b = R.bottleneck(arr, columns);
    return b ? { name: this.colName(columns, b.colId), avg: b.avg } : null;
  }

  render() {
    if (!this.board) return html`<div class="page-loading"><span class="spinner"></span> Cargando…</div>`;
    const r1 = this.results?.round1;
    const r2 = this.results?.round2;
    return html`
      <div class="flex-between">
        <div>
          <a href="/dashboard" class="muted">← Tableros</a>
          <h1 style="margin:4px 0">📊 Resultados · ${this.board.name}</h1>
        </div>
        <a class="btn btn-primary" href="/board?id=${this.boardId}">▶ Ir al tablero</a>
      </div>

      ${this.renderCurrent()}
      ${(r1 || r2) ? this.renderComparison(r1, r2) : ''}
      ${this.chartStyles()}
    `;
  }

  renderCurrent() {
    const g = this.game;
    if (!g) return html`<div class="card empty-state">Aún no se ha jugado ninguna ronda en este tablero.</div>`;
    const snaps = g.snapshots || {};
    const hasData = Object.keys(snaps).length > 0;
    const bn = this.bottleneckOf(snaps, g.columns);
    return html`
      <div class="card stack" style="margin-top:14px">
        <div class="flex-between">
          <h2 style="margin:0">${g.round === 2 ? 'Ronda 2 · con WIP' : 'Ronda 1 · sin WIP'} ${g.status === 'finished' ? '(terminada)' : `(turno ${g.turn}/${R.MAX_TURNS})`}</h2>
          <div class="row">
            <span class="tag">✅ Done: <strong>${R.doneTotal(g)}</strong></span>
            ${bn ? html`<span class="tag role-QA">🍶 Cuello de botella: ${bn.name}</span>` : ''}
          </div>
        </div>
        ${hasData ? html`
          <div class="grid grid-2">
            <div><h3>Throughput y Done acumulado</h3><kbg-throughput .snapshots=${snaps}></kbg-throughput></div>
            <div><h3>Diagrama de flujo (CFD)</h3><kbg-cfd .snapshots=${snaps} .columns=${g.columns}></kbg-cfd></div>
          </div>` : html`<p class="muted">Juega al menos un turno para ver gráficas.</p>`}
      </div>
    `;
  }

  renderComparison(r1, r2) {
    const bn1 = r1 ? this.bottleneckOf(r1.snapshots, r1.columns) : null;
    const bn2 = r2 ? this.bottleneckOf(r2.snapshots, r2.columns) : null;
    const diff = (r1 && r2) ? (r2.doneTotal - r1.doneTotal) : null;
    return html`
      <div class="card stack" style="margin-top:14px">
        <h2 style="margin:0">Comparativa de rondas</h2>
        <table class="cmp">
          <thead><tr><th></th><th>Ronda 1 · sin WIP</th><th>Ronda 2 · con WIP</th></tr></thead>
          <tbody>
            <tr><td>Total en Done</td><td>${r1 ? r1.doneTotal : '—'}</td><td>${r2 ? r2.doneTotal : '—'}</td></tr>
            <tr><td>Cuello de botella</td><td>${bn1?.name || '—'}</td><td>${bn2?.name || '—'}</td></tr>
          </tbody>
        </table>
        ${diff != null ? html`<p class="${diff >= 0 ? 'pos' : 'neg'}" style="margin:0">
          Diferencia (R2 − R1): <strong>${diff >= 0 ? '+' : ''}${diff}</strong> historias.
          ${diff > 0 ? ' Limitar el WIP mejoró el resultado.' : diff < 0 ? ' El WIP redujo el total entregado, pero observa el flujo.' : ' Mismo total; compara el flujo.'}
        </p>` : html`<p class="muted">Juega ambas rondas para ver la diferencia.</p>`}
        <div class="grid grid-2">
          ${r1 ? html`<div><h3>Flujo Ronda 1</h3><kbg-cfd .snapshots=${r1.snapshots} .columns=${r1.columns}></kbg-cfd></div>` : ''}
          ${r2 ? html`<div><h3>Flujo Ronda 2</h3><kbg-cfd .snapshots=${r2.snapshots} .columns=${r2.columns}></kbg-cfd></div>` : ''}
        </div>
      </div>
    `;
  }

  chartStyles() {
    return html`<style>
      kbg-results .chart-wrap { background: var(--c-bg-soft); border: 1px solid var(--c-border); border-radius: 8px; padding: 8px; }
      kbg-results table.cmp { width: 100%; border-collapse: collapse; }
      kbg-results table.cmp th, kbg-results table.cmp td { padding: 8px 10px; border-bottom: 1px solid var(--c-border); text-align: left; }
      kbg-results table.cmp th { color: var(--c-text-soft); font-size: .85rem; }
      kbg-results .pos { color: var(--c-success); }
      kbg-results .neg { color: var(--c-warning); }
      kbg-results h3 { font-size: .95rem; color: var(--c-text-soft); margin: 8px 0; }
    </style>`;
  }
}

customElements.define('kbg-results', ResultsView);
