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
    team: { state: true },
    game: { state: true },
    resultsNoWip: { state: true },
    resultsWip: { state: true },
  };
  constructor() {
    super();
    this.board = null; this.team = null; this.game = null;
    this.resultsNoWip = {}; this.resultsWip = {};
  }
  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._wb = watchBoard(this.boardId, (b) => {
      this.board = b;
      if (b?.teamId && b.teamId !== this._teamId) {
        this._teamId = b.teamId;
        this._wt?.();
        this._wt = onValue(ref(db, `teams/${b.teamId}`), (s) => {
          this.team = s.exists() ? { id: b.teamId, ...s.val() } : null;
          this._subResults(this.team);
        });
      }
    });
    this._wg = watchGame(this.boardId, (g) => { this.game = g; });
  }
  _subResults(t) {
    this._wrn?.(); this._wrw?.();
    if (t?.boardNoWip) this._wrn = onValue(ref(db, `results/${t.boardNoWip}`), (s) => { this.resultsNoWip = s.exists() ? s.val() : {}; });
    if (t?.boardWip) this._wrw = onValue(ref(db, `results/${t.boardWip}`), (s) => { this.resultsWip = s.exists() ? s.val() : {}; });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._wb?.(); this._wg?.(); this._wt?.(); this._wrn?.(); this._wrw?.();
  }

  colName(columns, colId) {
    const c = R.orderedColumns(columns).find((x) => x.id === colId);
    return c?.name || colId;
  }
  bottleneckOf(snapshots, columns) {
    const arr = Object.values(snapshots || {});
    const b = R.bottleneck(arr, columns);
    return b ? { name: this.colName(columns, b.colId), avg: b.avg } : null;
  }
  /** Última ronda archivada de un conjunto de resultados de un tablero. */
  latestRound(res) {
    const rounds = Object.values(res || {}).filter((r) => r && r.snapshots);
    return rounds.sort((a, b) => (b.round || 0) - (a.round || 0))[0] || null;
  }

  render() {
    if (!this.board) return html`<div class="page-loading"><span class="spinner"></span> Cargando…</div>`;
    const cmp = [this.latestRound(this.resultsNoWip), this.latestRound(this.resultsWip)].filter(Boolean);
    return html`
      <div class="flex-between">
        <div>
          <a href="/dashboard" class="muted">← Tableros</a>
          <h1 style="margin:4px 0">📊 Resultados · ${this.team?.name || this.board.name}</h1>
        </div>
        <a class="btn btn-primary" href="/board?id=${this.boardId}">▶ Ir al tablero</a>
      </div>

      ${this.renderCurrent()}
      ${cmp.length ? this.renderComparison(cmp) : ''}
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
          <h2 style="margin:0">Partida ${g.wipEnabled ? 'con WIP' : 'sin WIP'} ${g.status === 'finished' ? '(terminada)' : `(ciclo ${g.turn}/${g.totalCycles || '?'})`}</h2>
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

  fmtDur(s) { return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—'; }

  renderComparison(rounds) {
    const data = rounds.map((r) => ({ ...r, bn: this.bottleneckOf(r.snapshots, r.columns) }));
    const maxDone = Math.max(...data.map((r) => r.doneTotal || 0));
    return html`
      <div class="card stack" style="margin-top:14px">
        <h2 style="margin:0">Comparativa del equipo: sin WIP vs con WIP</h2>
        <div style="overflow-x:auto">
          <table class="cmp">
            <thead><tr><th></th>
              ${data.map((r) => html`<th>${r.wipEnabled ? 'Con WIP' : 'Sin WIP'}<br><span class="muted">ronda ${r.round}</span></th>`)}
            </tr></thead>
            <tbody>
              <tr><td>Total en Done</td>${data.map((r) => html`<td class=${r.doneTotal === maxDone ? 'pos' : ''}><strong>${r.doneTotal}</strong></td>`)}</tr>
              <tr><td>Cuello de botella</td>${data.map((r) => html`<td>${r.bn?.name || '—'}</td>`)}</tr>
              <tr><td>Duración</td>${data.map((r) => html`<td>${this.fmtDur(r.durationSec)}</td>`)}</tr>
            </tbody>
          </table>
        </div>
        ${this.renderDiffNote(data)}
        <div class="grid grid-2">
          ${data.map((r) => html`<div><h3>Flujo Ronda ${r.round} · ${r.wipEnabled ? 'con WIP' : 'sin WIP'}</h3><kbg-cfd .snapshots=${r.snapshots} .columns=${r.columns}></kbg-cfd></div>`)}
        </div>
      </div>
    `;
  }

  renderDiffNote(data) {
    const noWip = data.find((r) => !r.wipEnabled);
    const wip = data.find((r) => r.wipEnabled);
    if (noWip && wip) {
      const diff = wip.doneTotal - noWip.doneTotal;
      return html`<p class="${diff >= 0 ? 'pos' : 'neg'}" style="margin:0">
        Con WIP (R${wip.round}) vs sin WIP (R${noWip.round}): <strong>${diff >= 0 ? '+' : ''}${diff}</strong> historias.
        ${diff > 0 ? ' Limitar el WIP mejoró el resultado.' : diff < 0 ? ' El WIP redujo el total entregado, pero observa el flujo.' : ' Mismo total; compara el flujo.'}
      </p>`;
    }
    return html`<p class="muted" style="margin:0">Juega una ronda con WIP y otra sin WIP para ver la diferencia.</p>`;
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
