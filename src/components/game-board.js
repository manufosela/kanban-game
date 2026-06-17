import { LitElement, html } from 'lit';
import { watchBoard } from '../lib/db.js';
import {
  watchGame, applyAction, STEP, STEP_ROLE, STEP_LABEL,
} from '../lib/game.js';
import * as R from '../lib/rules.js';
import { toast } from '../lib/ui.js';
import './dice-roller.js';
import './round-timer.js';

const COL_ACCENTS = ['#8a94a6', '#6c8cff', '#4dd0e1', '#b07cff', '#ffb74d', '#4db6ac', '#66bb6a'];

export class GameBoard extends LitElement {
  static properties = {
    boardId: { type: String, attribute: 'board-id' },
    me: { attribute: false },
    board: { state: true },
    game: { state: true },
    selectedCardId: { state: true },
    devAction: { state: true },
  };

  constructor() {
    super();
    this.board = null;
    this.game = null;
    this.selectedCardId = null;
    this.devAction = 'advance';
  }
  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._wb = watchBoard(this.boardId, (b) => { this.board = b; });
    this._wg = watchGame(this.boardId, (g) => { this.game = g; });
  }
  disconnectedCallback() { super.disconnectedCallback(); this._wb?.(); this._wg?.(); }

  get myGameRole() { return this.board?.roleAssignments?.[this.me?.uid] || null; }
  get isAdmin() { return this.me?.isAdmin; }
  get activeRole() { return this.game ? STEP_ROLE[this.game.step] : null; }
  get canAct() { return this.isAdmin || (this.myGameRole && this.myGameRole === this.activeRole); }

  cols() { return R.orderedColumns(this.game.columns); }
  anchors() { return R.anchors(this.cols()); }

  async act(type, extra = {}) {
    try {
      const msg = await applyAction(this.boardId, { type, by: this.me?.uid, ...extra });
      if (msg) toast(msg, 'warning');
    } catch (e) { console.error(e); toast('No se pudo aplicar la acción', 'error'); }
  }

  render() {
    if (!this.board) return html`<div class="page-loading"><span class="spinner"></span> Cargando tablero…</div>`;
    if (!this.game) return this.renderNoGame();
    return html`
      ${this.renderTopBar()}
      ${this.renderColumns()}
      ${this.game.status === 'finished' ? this.renderFinished() : this.renderControls()}
      ${this.renderLog()}
      ${this.styles()}
    `;
  }

  renderNoGame() {
    const modeTxt = this.board.mode === 'wip' ? 'con WIP' : (this.board.mode === 'nowip' ? 'sin WIP' : '');
    return html`
      <div class="card center stack">
        <h1>${this.board.name}</h1>
        ${modeTxt ? html`<div><span class="tag ${this.board.mode === 'wip' ? 'role-QA' : ''}">${modeTxt}</span></div>` : ''}
        <p class="muted">La ronda todavía no ha comenzado.</p>
        ${this.isAdmin
          ? html`<p>Inicia la ronda desde <a href="/admin">Administración → Facilitador</a>.</p>`
          : html`<p>Pide al facilitador que inicie la ronda.</p>`}
        <a href="/dashboard">← Volver</a>
      </div>
      ${this.styles()}
    `;
  }
  onTimeUp() {
    if (this._toldTimeup) return;
    this._toldTimeup = true;
    toast('⏱ ¡Tiempo de la ronda agotado! Podéis terminar la ronda cuando queráis.', 'warning', 7000);
  }

  renderTopBar() {
    const g = this.game;
    const role = this.activeRole;
    const youAct = this.canAct && g.status === 'playing';
    return html`
      <div class="topbar card">
        <div>
          <a href="/dashboard" class="muted">← Tableros</a>
          <h1 style="margin:4px 0">${this.board.name}</h1>
          <span class="tag ${g.wipEnabled ? 'role-QA' : ''}">Ronda ${g.round} · ${g.wipEnabled ? 'con WIP' : 'sin WIP'}</span>
          ${this.myGameRole ? html`<span class="tag role-${this.myGameRole}">Tu rol: ${this.myGameRole}</span>` : (this.isAdmin ? html`<span class="tag admin">facilitador</span>` : '')}
        </div>
        <div class="status">
          <div class="turn">Turno <strong>${g.turn}</strong> / ${R.MAX_TURNS}</div>
          <div class="done">✅ Done: <strong>${R.doneTotal(g)}</strong></div>
          ${g.startedAt ? html`<kbg-round-timer .startedAt=${g.startedAt} .endedAt=${g.endedAt || null} .timeLimit=${g.timeLimit || null} @timeup=${() => this.onTimeUp()}></kbg-round-timer>` : ''}
        </div>
        <div class="stepinfo ${youAct ? 'you' : ''}">
          <div class="muted">${STEP_LABEL[g.step]}</div>
          <div class="who">
            ${g.status === 'finished' ? 'Ronda terminada'
              : youAct ? html`<span class="badge-you">Te toca a ti (${role})</span>`
              : html`Esperando a <span class="tag role-${role}">${role}</span>`}
          </div>
        </div>
      </div>
    `;
  }

  renderColumns() {
    const g = this.game;
    const cols = this.cols();
    const a = this.anchors();
    const selStep = g.step;
    return html`
      <div class="board-scroll">
        <div class="board" style="grid-template-columns: repeat(${cols.length}, minmax(150px, 1fr))">
          ${cols.map((c, i) => {
            const cards = R.cardsInColumn(g.cards, c.id);
            const limit = R.wipLimitFor(g, c.id);
            const hasLimit = limit !== Infinity;
            const over = hasLimit && cards.length > limit;
            const full = hasLimit && cards.length >= limit;
            const accent = COL_ACCENTS[i % COL_ACCENTS.length];
            return html`
              <div class="column" style="--accent:${accent}">
                <div class="col-head">
                  <span class="col-name" title=${c.name}>${c.name}</span>
                  <span class="wip ${over ? 'over' : full ? 'full' : ''}">
                    ${cards.length}${hasLimit ? ` / ${limit}` : ''}
                  </span>
                </div>
                <div class="col-body">
                  ${cards.map((card) => this.renderCard(card, c, a, selStep))}
                </div>
              </div>`;
          })}
        </div>
      </div>
    `;
  }

  renderCard(card, col, a, step) {
    const selectable = this.canAct && (
      (step === STEP.DEVS && (R.advanceSources(this.game).includes(card.col) || card.col === a.id.review)) ||
      (step === STEP.QA && card.col === a.id.qa)
    );
    const selected = this.selectedCardId === card.id;
    return html`
      <div class="postit ${card.bug ? 'bug' : ''} ${selected ? 'sel' : ''} ${selectable ? 'pick' : ''}"
           @click=${() => { if (selectable) this.selectedCardId = selected ? null : card.id; }}>
        <span class="num">#${card.number}</span>
        ${card.bug ? html`<span class="bugmark" title="Tiene un bug">🐞</span>` : ''}
      </div>
    `;
  }

  renderControls() {
    if (!this.canAct) {
      return html`<div class="controls card muted">Esperando a que <strong>${this.activeRole}</strong> complete el ${STEP_LABEL[this.game.step]}.</div>`;
    }
    const g = this.game;
    switch (g.step) {
      case STEP.PM_ADD: return this.ctrlPmAdd();
      case STEP.PM_PULL: return this.ctrlPmPull();
      case STEP.DEVS: return this.ctrlDevs();
      case STEP.QA: return this.ctrlQa();
      case STEP.PM_VALIDATE: return this.ctrlPmValidate();
      default: return '';
    }
  }

  ctrlPmAdd() {
    return html`<div class="controls card">
      <p>El PM mete <strong>3 historias</strong> nuevas en Backlog.</p>
      <button class="btn-primary btn-lg" @click=${() => this.act('pm-add')}>➕ Meter 3 historias</button>
    </div>`;
  }

  ctrlPmPull() {
    return html`<div class="controls card">
      <p>El PM tira 1 dado y mueve ese número de historias de <strong>Backlog → Análisis</strong>${this.game.round === 2 ? ' (respetando el WIP de Análisis)' : ''}.</p>
      <kbg-dice count="1" label="Tirar y mover" @roll=${(e) => this.act('pm-pull', { dice: e.detail.values[0] })}></kbg-dice>
    </div>`;
  }

  ctrlDevs() {
    const sel = this.selectedCardId ? this.game.cards[this.selectedCardId] : null;
    const a = this.anchors();
    const inAdvance = sel && R.advanceSources(this.game).includes(sel.col);
    const inReview = sel && sel.col === a.id.review;
    const action = this.devAction;
    const needTwo = action === 'pair';
    const validForAction =
      (action === 'advance' && inAdvance) ||
      (action === 'pair' && inAdvance) ||
      (action === 'review' && inReview);
    return html`<div class="controls card stack">
      <p>Cada Dev elige una opción y tira. Selecciona una historia y la acción:</p>
      <div class="row">
        ${this.devOpt('advance', 'Avanzar (1 dado, 3+)')}
        ${this.devOpt('review', 'Revisar PR (1 dado, 3+)')}
        ${this.devOpt('pair', 'Pair (2 dados, suma 5+)')}
      </div>
      <p class="muted" style="margin:0">
        ${sel ? html`Seleccionada: <strong>#${sel.number}</strong>` : 'Ninguna historia seleccionada.'}
        ${action === 'advance' ? ' · Avanza Análisis→Desarrollo o Desarrollo→Revisión PR.' : ''}
        ${action === 'review' ? ' · Mueve Revisión PR→QA.' : ''}
        ${action === 'pair' ? ' · Dos devs avanzan una historia.' : ''}
        ${sel && !validForAction ? html`<span style="color:var(--c-warning)"> · esa historia no es válida para esta acción.</span>` : ''}
      </p>
      <div class="row" style="gap:16px">
        <kbg-dice count=${needTwo ? 2 : 1} label="Tirar" .disabled=${!validForAction}
          @roll=${(e) => this.devRoll(e.detail.values)}></kbg-dice>
        <button @click=${() => this.act('dev-finish')}>✔ Terminar paso Devs → QA</button>
      </div>
    </div>`;
  }
  devOpt(id, label) {
    return html`<button class=${this.devAction === id ? 'btn-primary' : ''} @click=${() => { this.devAction = id; }}>${label}</button>`;
  }
  devRoll(values) {
    const cardId = this.selectedCardId;
    if (!cardId) return;
    if (this.devAction === 'advance') this.act('dev-advance', { cardId, dice: values[0] });
    else if (this.devAction === 'review') this.act('dev-review', { cardId, dice: values[0] });
    else if (this.devAction === 'pair') this.act('dev-pair', { cardId, dice: values });
    this.selectedCardId = null;
  }

  ctrlQa() {
    const a = this.anchors();
    const sel = this.selectedCardId ? this.game.cards[this.selectedCardId] : null;
    const inQa = sel && sel.col === a.id.qa;
    const rollsLeft = R.QA_MAX_ROLLS - (this.game.qaRolls || 0);
    return html`<div class="controls card stack">
      <p>QA prueba historias de la columna <strong>QA</strong> (máx. ${R.QA_MAX_ROLLS} tiradas). 3+ pasa a Validación PM; 1-2 es un bug y vuelve a Desarrollo.</p>
      <p class="muted" style="margin:0">Tiradas restantes: <strong>${rollsLeft}</strong>. ${sel ? html`Seleccionada: <strong>#${sel.number}</strong>` : 'Selecciona una historia de QA.'}</p>
      <div class="row" style="gap:16px">
        <kbg-dice count="1" label="Probar" .disabled=${!inQa || rollsLeft <= 0}
          @roll=${(e) => { this.act('qa-test', { cardId: this.selectedCardId, dice: e.detail.values[0] }); this.selectedCardId = null; }}></kbg-dice>
        <button @click=${() => this.act('qa-finish')}>✔ Terminar QA → Validación</button>
      </div>
    </div>`;
  }

  ctrlPmValidate() {
    return html`<div class="controls card">
      <p>El PM tira 1 dado y valida ese número de historias de <strong>Validación PM → Done</strong>. Esto cierra el turno.</p>
      <kbg-dice count="1" label="Tirar y validar" @roll=${(e) => this.act('pm-validate', { dice: e.detail.values[0] })}></kbg-dice>
    </div>`;
  }

  renderFinished() {
    return html`<div class="controls card center stack">
      <h2 style="margin:0">🏁 Ronda ${this.game.round} terminada</h2>
      <p>Total de historias en <strong>Done</strong>: <strong style="font-size:1.4rem">${R.doneTotal(this.game)}</strong></p>
      <div class="row" style="justify-content:center">
        <a class="btn btn-primary" href="/results?id=${this.boardId}">📊 Ver resultados y gráficas</a>
        ${this.isAdmin ? html`<a class="btn" href="/admin">🎛 Facilitador (siguiente ronda)</a>` : ''}
      </div>
    </div>`;
  }

  renderLog() {
    const log = (this.game.log || []).slice(-12).reverse();
    return html`<div class="logfeed card">
      <h3 style="margin:0 0 8px">Registro</h3>
      ${log.length === 0 ? html`<p class="muted">Sin eventos aún.</p>` : html`<ul>${log.map((l) => html`<li><span class="muted">T${l.turn ?? '·'}</span> ${l.text}</li>`)}</ul>`}
    </div>`;
  }

  styles() {
    return html`<style>
      kbg-game { display: block; max-width: 1200px; margin: 0 auto; padding: 16px; }
      kbg-game .topbar { display: grid; grid-template-columns: 1.4fr 1fr 1.4fr; gap: 16px; align-items: center; margin-bottom: 14px; }
      kbg-game .status { text-align: center; }
      kbg-game .status .turn { font-size: 1.1rem; }
      kbg-game .status .done { color: var(--c-success); }
      kbg-game .stepinfo { text-align: right; }
      kbg-game .stepinfo.you { outline: 2px solid var(--c-primary); border-radius: 8px; padding: 6px 10px; }
      kbg-game .badge-you { background: var(--c-primary); color: #fff; padding: 2px 10px; border-radius: 999px; font-weight: 700; }
      kbg-game .board-scroll { overflow-x: auto; padding-bottom: 8px; }
      kbg-game .board { display: grid; gap: 10px; min-width: min-content; }
      kbg-game .column { background: var(--c-bg-soft); border: 1px solid var(--c-border); border-top: 3px solid var(--accent); border-radius: 10px; min-height: 320px; display: flex; flex-direction: column; }
      kbg-game .col-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; gap: 6px; border-bottom: 1px solid var(--c-border); }
      kbg-game .col-name { font-weight: 700; font-size: .82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      kbg-game .wip { font-size: .75rem; color: var(--c-text-dim); background: var(--c-surface-2); border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
      kbg-game .wip.full { color: #1a1200; background: var(--c-warning); }
      kbg-game .wip.over { color: #fff; background: var(--c-danger); }
      kbg-game .col-body { padding: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; }
      kbg-game .postit { width: 56px; height: 56px; background: var(--c-postit); color: var(--c-postit-text); border-radius: 6px; box-shadow: var(--shadow-1); display: flex; align-items: center; justify-content: center; position: relative; font-weight: 800; transform: rotate(-1.5deg); }
      kbg-game .postit:nth-child(even) { transform: rotate(1.5deg); }
      kbg-game .postit.bug { background: var(--c-postit-bug); color: var(--c-postit-bug-text); }
      kbg-game .postit.pick { cursor: pointer; outline: 2px dashed transparent; }
      kbg-game .postit.pick:hover { outline-color: var(--c-primary); }
      kbg-game .postit.sel { outline: 3px solid var(--c-primary); transform: rotate(0) scale(1.06); }
      kbg-game .postit .num { font-size: .95rem; }
      kbg-game .postit .bugmark { position: absolute; top: -8px; right: -6px; font-size: .9rem; }
      kbg-game .controls { margin-top: 14px; }
      kbg-game .logfeed { margin-top: 14px; }
      kbg-game .logfeed ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: .9rem; }
      kbg-game .logfeed li { border-bottom: 1px dashed var(--c-border); padding: 3px 0; }
      @media (max-width: 760px) { kbg-game .topbar { grid-template-columns: 1fr; text-align: left; } kbg-game .status, kbg-game .stepinfo { text-align: left; } }
    </style>`;
  }
}

customElements.define('kbg-game', GameBoard);
