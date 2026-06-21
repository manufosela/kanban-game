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
            ${(() => { const m = R.gameMetrics(g); return html`
            <span class="tag">✅ Done: <strong>${m.doneTotal}</strong></span>
            <span class="tag">💼 Negocio: <strong>${m.doneBusiness}</strong></span>
            <span class="tag">🔧 Dev: <strong>${m.doneDev}</strong></span>
            <span class="tag">📈 Ritmo de entrega: <strong>${this.fmtNum(m.throughputPerTurn, 2)}</strong> historias/turno</span>
            ${m.avgCycleTime != null ? html`<span class="tag">⏱️ Ciclo: <strong>${this.fmtNum(m.avgCycleTime, 1)}</strong> turnos</span>` : ''}
            <span class="tag">📦 WIP medio: <strong>${this.fmtNum(m.avgActiveWip, 1)}</strong></span>
            ${m.reworkRate != null ? html`<span class="tag">♻️ Retrabajo: <strong>${this.fmtPct(m.reworkRate)}</strong></span>` : ''}
            ${m.devIdle != null ? html`<span class="tag">⏸️ Dev parado: <strong>${m.devIdle}</strong></span>` : ''}
            ${bn ? html`<span class="tag role-QA">🍶 Cuello: ${bn.name}</span>` : ''}`; })()}
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
  fmtCycle(t) { return t == null ? '—' : `${t.toFixed(1)} turnos`; }
  cycleTag(snaps, columns) {
    const t = R.avgCycleTime(snaps, columns);
    return t == null ? '' : html`<span class="tag">⏱️ Tiempo de ciclo: <strong>${t.toFixed(1)}</strong> turnos</span>`;
  }
  /** Métricas de una ronda archivada (usa las guardadas; si no, las recalcula). */
  roundMetrics(r) {
    if (r.metrics) return r.metrics;
    return {
      avgCycleTime: R.avgCycleTime(r.snapshots, r.columns),
      avgActiveWip: R.avgActiveWip(r.snapshots, r.columns),
      peakActiveWip: R.peakActiveWip(r.snapshots, r.columns),
      throughputPerTurn: R.throughputPerTurn(r.snapshots),
      reworkRate: null, devEfficiency: null,
    };
  }
  fmtNum(x, d = 1) { return x == null ? '—' : x.toFixed(d); }
  fmtPct(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }
  /** Fila comparativa: resalta el mejor valor (menor o mayor según `better`). */
  metricRow(label, hint, vals, better, fmt) {
    const nums = better ? vals.filter((v) => typeof v === 'number') : [];
    const best = nums.length ? (better === 'low' ? Math.min(...nums) : Math.max(...nums)) : null;
    return html`<tr>
      <td>${label} ${hint ? html`<span class="muted">(${hint})</span>` : ''}</td>
      ${vals.map((v) => html`<td class=${v != null && v === best && nums.length > 1 ? 'pos' : ''}>${fmt(v)}</td>`)}
    </tr>`;
  }

  renderComparison(rounds) {
    const data = rounds.map((r) => ({
      ...r,
      bn: this.bottleneckOf(r.snapshots, r.columns),
      m: this.roundMetrics(r),
    }));
    data.forEach((r) => { r.cycle = r.m.avgCycleTime; });
    const col = (sel) => data.map(sel);
    return html`
      <div class="card stack" style="margin-top:14px">
        <h2 style="margin:0">Comparativa del equipo: sin WIP vs con WIP</h2>
        <div style="overflow-x:auto">
          <table class="cmp">
            <thead><tr><th></th>
              ${data.map((r) => html`<th>${r.wipEnabled ? 'Con WIP' : 'Sin WIP'}<br><span class="muted">ronda ${r.round}</span></th>`)}
            </tr></thead>
            <tbody>
              <tr class="group"><td colspan=${data.length + 1}>Entrega</td></tr>
              ${this.metricRow('✅ Historias en Done', 'más = mejor', col((r) => r.doneTotal ?? null), 'high', (v) => html`<strong>${this.fmtNum(v, 0)}</strong>`)}
              ${this.metricRow('💼 Valor de negocio', 'más = mejor', col((r) => r.doneBusiness ?? null), 'high', (v) => this.fmtNum(v, 0))}
              ${this.metricRow('🔧 Esfuerzo dev entregado', 'más = mejor', col((r) => r.doneDev ?? null), 'high', (v) => this.fmtNum(v, 0))}
              ${this.metricRow('📈 Ritmo de entrega', 'historias/turno · más = mejor', col((r) => r.m.throughputPerTurn), 'high', (v) => this.fmtNum(v, 2))}
              <tr class="group"><td colspan=${data.length + 1}>Flujo</td></tr>
              ${this.metricRow('⏱️ Tiempo de ciclo', 'turnos · menos = mejor', col((r) => r.m.avgCycleTime), 'low', (v) => this.fmtCycle(v))}
              ${this.metricRow('📦 WIP medio', 'menos = mejor', col((r) => r.m.avgActiveWip), 'low', (v) => this.fmtNum(v, 1))}
              ${this.metricRow('🔺 Pico de WIP', 'menos = mejor', col((r) => r.m.peakActiveWip), 'low', (v) => this.fmtNum(v, 0))}
              ${this.metricRow('🍶 Cuello de botella', '', col((r) => r.bn?.name ?? null), null, (v) => v || '—')}
              <tr class="group"><td colspan=${data.length + 1}>Calidad y eficiencia</td></tr>
              ${this.metricRow('♻️ Retrabajo (bugs QA)', 'menos = mejor', col((r) => r.m.reworkRate), 'low', (v) => this.fmtPct(v))}
              ${this.metricRow('⚙️ Eficiencia Dev', 'acciones útiles · más = mejor', col((r) => r.m.devEfficiency), 'high', (v) => this.fmtPct(v))}
              ${this.metricRow('⏸️ Dev parado', 'acciones sin trabajo útil', col((r) => r.m.devIdle ?? null), null, (v) => this.fmtNum(v, 0))}
              ${this.metricRow('⏲️ Duración real', '', col((r) => r.durationSec ?? null), null, (v) => this.fmtDur(v))}
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
      const cw = wip.cycle, cn = noWip.cycle;
      const cycleNote = (cw != null && cn != null)
        ? html`<br>⏱️ <strong>Tiempo de ciclo:</strong> con WIP ${cw.toFixed(1)} vs sin WIP ${cn.toFixed(1)} turnos.
            ${cw < cn
              ? html`<span class="pos">El WIP entrega cada historia antes (Ley de Little: menos trabajo a medias = menos tiempo de ciclo).</span>`
              : html`<span class="muted">Aquí no se ve la mejora; suele necesitar más turnos o equipos mayores.</span>`}`
        : '';
      return html`<p style="margin:0">
        <span class="${diff >= 0 ? 'pos' : 'neg'}">Historias en Done — con WIP (R${wip.round}) vs sin WIP (R${noWip.round}): <strong>${diff >= 0 ? '+' : ''}${diff}</strong>.</span>
        ${diff < 0 ? html`<span class="muted"> El throughput total no es donde gana el WIP — mira el tiempo de ciclo.</span>` : ''}
        ${cycleNote}
      </p>`;
    }
    return html`<p class="muted" style="margin:0">Juega una ronda con WIP y otra sin WIP para ver la diferencia.</p>`;
  }

  chartStyles() {
    return html`<style>
      kbg-cfd, kbg-throughput { display: block; width: 100%; }
      kbg-cfd svg, kbg-throughput svg { display: block; width: 100%; height: auto; }
      kbg-results .chart-wrap { background: var(--c-bg-soft); border: 1px solid var(--c-border); border-radius: 8px; padding: 8px; }
      kbg-results table.cmp { width: 100%; border-collapse: collapse; }
      kbg-results table.cmp th, kbg-results table.cmp td { padding: 8px 10px; border-bottom: 1px solid var(--c-border); text-align: left; }
      kbg-results table.cmp th { color: var(--c-text-soft); font-size: .85rem; }
      kbg-results .pos { color: var(--c-success); font-weight: 600; }
      kbg-results .neg { color: var(--c-warning); }
      kbg-results table.cmp tr.group td { background: var(--c-bg-soft); color: var(--c-text-soft); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; padding-top: 10px; }
      kbg-results h3 { font-size: .95rem; color: var(--c-text-soft); margin: 8px 0; }
    </style>`;
  }
}

customElements.define('kbg-results', ResultsView);
