import { LitElement, html } from 'lit';
import {
  watchBoard, watchUsers, watchFacilitators, watchBots, isBotId,
  getBoard, getTeam, getPartida,
} from '../lib/db.js';
import {
  watchGame, applyAction, STEP, STEP_ROLE, STEP_LABEL,
  roundInfo, addRonda, setGameColumnWip, setGameRole, currentDev, botAction,
  pauseGame, resumeGame, startGame,
} from '../lib/game.js';
import * as R from '../lib/rules.js';
import { toast, promptDialog, confirmDialog } from '../lib/ui.js';
import './dice-roller.js';
import './round-timer.js';

const ROLES = ['PM', 'DEV', 'QA'];

const COL_ACCENTS = ['#8a94a6', '#6c8cff', '#4dd0e1', '#b07cff', '#ffb74d', '#4db6ac', '#66bb6a'];

export class GameBoard extends LitElement {
  static properties = {
    boardId: { type: String, attribute: 'board-id' },
    me: { attribute: false },
    board: { state: true },
    game: { state: true },
    users: { state: true },
    facilitators: { state: true },
    bots: { state: true },
    autoBots: { state: true },
    botDelayMs: { state: true },
    selectedCardId: { state: true },
    devAction: { state: true },
    pairPartner: { state: true },
  };

  constructor() {
    super();
    this.board = null;
    this.game = null;
    this.users = [];
    this.facilitators = [];
    this.bots = [];
    this.autoBots = true;
    this.botDelayMs = Number(localStorage.getItem('kbg.botDelayMs')) || 1500;
    this.selectedCardId = null;
    this.devAction = 'advance';
    this.pairPartner = null;
  }
  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._wb = watchBoard(this.boardId, (b) => { this.board = b; });
    this._wg = watchGame(this.boardId, (g) => { this.game = g; });
    this._wu = watchUsers((l) => { this.users = l; });
    this._wf = watchFacilitators((l) => { this.facilitators = l; });
    this._wbots = watchBots((l) => { this.bots = l; });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._wb?.(); this._wg?.(); this._wu?.(); this._wf?.(); this._wbots?.();
    if (this._botTimer) { clearTimeout(this._botTimer); this._botTimer = null; }
  }

  nameOf(uid) {
    if (isBotId(uid)) { const b = this.bots.find((x) => x.id === uid); return `🤖 ${b?.name || 'Bot'}`; }
    const u = this.users.find((x) => x.id === uid);
    return u?.name || u?.email || (uid ? `…${String(uid).slice(-4)}` : '—');
  }

  // ---- Bots dirigidos por cliente ----
  updated() { this.maybeDriveBots(); }
  currentBotActor() {
    const g = this.game; if (!g) return null;
    const ra = g.roleAssignments || {};
    const withRole = (role) => Object.keys(ra).filter((u) => ra[u] === role);
    if (g.step === STEP.PM_ADD || g.step === STEP.PM_PULL || g.step === STEP.PM_VALIDATE) {
      const pms = withRole('PM'); return (pms.length && pms.every(isBotId)) ? pms[0] : null;
    }
    if (g.step === STEP.QA) {
      const qas = withRole('QA'); return (qas.length && qas.every(isBotId)) ? qas[0] : null;
    }
    if (g.step === STEP.DEVS) {
      const cur = this.currentDevUid; return isBotId(cur) ? cur : null;
    }
    return null;
  }
  maybeDriveBots() {
    if (!this.autoBots || !this.isMod || this._botTimer) return;
    const g = this.game;
    if (!g || g.status !== 'playing') return;
    if (!this.currentBotActor()) return;
    this._botTimer = setTimeout(() => {
      this._botTimer = null;
      if (!this.autoBots || !this.isMod) return;
      const g2 = this.game;
      if (!g2 || g2.status !== 'playing' || !this.currentBotActor()) return;
      const action = botAction(g2);
      if (action) this.act(action.type, action);
    }, this.botDelayMs);
  }
  setBotDelay(ms) {
    this.botDelayMs = ms;
    localStorage.setItem('kbg.botDelayMs', String(ms));
  }
  get currentDevUid() { return currentDev(this.game); }
  /** ¿Me toca accionar AHORA? (en Devs, solo el Dev de turno; admin siempre). */
  get actorIsMe() {
    const g = this.game;
    if (!g || g.status !== 'playing') return false;
    if (this.isMod) return true;
    if (g.step === STEP.DEVS) return this.myGameRole === 'DEV' && this.me?.uid === this.currentDevUid;
    return this.myGameRole === this.activeRole;
  }

  get myGameRole() { return this.game?.roleAssignments?.[this.me?.uid] ?? this.board?.roleAssignments?.[this.me?.uid] ?? null; }
  get roleAssignments() { return this.game?.roleAssignments || this.board?.roleAssignments || {}; }
  get isAdmin() { return this.me?.isAdmin; }
  /** Moderador de la partida: admin de la app o co-facilitador de sesión. */
  get isMod() { return this.me?.isAdmin || (this.me?.uid && this.facilitators?.includes(this.me.uid)); }
  get activeRole() { return this.game ? STEP_ROLE[this.game.step] : null; }
  get canAct() { return this.isMod || (this.myGameRole && this.myGameRole === this.activeRole); }
  /** Enlace a Administración conservando la partida del tablero. */
  adminHref() { return this.board?.partidaId ? `/admin?partida=${this.board.partidaId}` : '/admin'; }

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
      ${this.game.status === 'finished' ? this.renderFinished()
        : this.game.status === 'paused' ? this.renderPaused()
        : this.renderControls()}
      ${this.game.status === 'playing' && this.actorIsMe ? this.renderPreview() : ''}
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
        ${this.isMod
          ? html`<p>Inicia la ronda desde <a href=${this.adminHref()}>Administración → Facilitador</a>.</p>`
          : html`<p>Pide al facilitador que inicie la ronda.</p>`}
        <a href=${this.isMod ? this.adminHref() : '/dashboard'}>← Volver</a>
      </div>
      ${this.styles()}
    `;
  }
  onTimeUp() {
    if (this._toldTimeup) return;
    this._toldTimeup = true;
    toast('⏱ ¡Tiempo de la ronda agotado! Podéis terminar la ronda cuando queráis.', 'warning', 7000);
  }
  async pause() { await pauseGame(this.boardId); }
  async resume() { await resumeGame(this.boardId); }
  renderPaused() {
    return html`<div class="controls card center stack">
      <h2 style="margin:0">⏸ Partida en pausa</h2>
      <p class="muted">Buen momento para revisar el tablero. El facilitador la reanudará para continuar.</p>
      ${this.isMod ? html`<div class="row" style="justify-content:center"><button class="btn-primary btn-lg" @click=${() => this.resume()}>▶ Reanudar</button></div>` : ''}
    </div>`;
  }

  renderTopBar() {
    const g = this.game;
    const role = this.activeRole;
    const youAct = this.actorIsMe;
    const ri = roundInfo(g);
    return html`
      <div class="topbar card">
        <div>
          <a href="/dashboard" class="muted">← Tableros</a>
          <h1 style="margin:4px 0">${this.board.name}</h1>
          <span class="tag ${g.wipEnabled ? 'role-QA' : ''}">Partida ${g.wipEnabled ? 'con WIP' : 'sin WIP'}</span>
          ${this.renderRolePicker()}
        </div>
        <div class="status">
          <div class="turn">Ronda <strong>${ri.ronda}</strong>/${ri.rondas} · Ciclo <strong>${ri.cicloEnRonda}</strong>/${ri.ciclos}</div>
          <div class="done">✅ Done: <strong>${R.doneTotal(g)}</strong> <span class="muted">(${ri.turn}/${ri.total} ciclos)</span></div>
          ${g.startedAt ? html`<kbg-round-timer .startedAt=${g.startedAt} .endedAt=${g.endedAt || null} .timeLimit=${g.timeLimit || null} @timeup=${() => this.onTimeUp()}></kbg-round-timer>` : ''}
        </div>
        <div class="stepinfo ${youAct ? 'you' : ''}">
          <div class="muted">${STEP_LABEL[g.step]}</div>
          <div class="who">
            ${g.status === 'finished' ? 'Partida terminada'
              : g.status === 'paused' ? '⏸ Pausada'
              : youAct ? html`<span class="badge-you">Te toca a ti (${role})</span>`
              : html`Esperando a <span class="tag role-${role}">${role}</span>`}
          </div>
          ${this.isMod ? html`<label class="rolepick" style="margin-top:6px" title="Si está activado y le toca a un bot, juega solo desde aquí"><input type="checkbox" ?checked=${this.autoBots} @change=${(e) => { this.autoBots = e.target.checked; }}> 🤖 Auto-bots</label>` : ''}
          ${this.isMod && this.autoBots ? html`
            <div class="row botspeed" style="margin-top:4px; gap:4px; justify-content:flex-end" title="Velocidad de juego de los bots">
              <span class="muted" style="font-size:.74rem">Velocidad:</span>
              ${[{ ms: 3000, t: 'Lento' }, { ms: 1500, t: 'Medio' }, { ms: 700, t: 'Rápido' }].map((o) => html`
                <button class="btn-sm ${this.botDelayMs === o.ms ? 'btn-primary' : ''}" @click=${() => this.setBotDelay(o.ms)}>${o.t}</button>`)}
            </div>` : ''}
          <div class="row" style="margin-top:6px; gap:6px">
            ${this.isMod && g.status === 'playing' ? html`<button class="btn-sm" @click=${() => this.pause()}>⏸ Pausar</button>` : ''}
            ${this.isMod && g.status === 'paused' ? html`<button class="btn-primary btn-sm" @click=${() => this.resume()}>▶ Reanudar</button>` : ''}
            ${this.isMod && g.status === 'playing' ? html`<button class="btn-sm" @click=${() => this.addRound()}>➕ Añadir ronda</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /** Selector de rol del propio jugador (y, si es admin, de cualquiera vía panel aparte). */
  renderRolePicker() {
    if (this.game?.status !== 'playing') {
      return this.myGameRole ? html`<span class="tag role-${this.myGameRole}">Tu rol: ${this.myGameRole}</span>` : (this.isMod ? html`<span class="tag admin">facilitador</span>` : '');
    }
    const mine = this.myGameRole;
    return html`
      <label class="rolepick">Tu rol:
        <select @change=${(e) => this.changeMyRole(e.target.value)}>
          <option value="" ?selected=${!mine}>— sin rol —</option>
          ${ROLES.map((r) => html`<option value=${r} ?selected=${mine === r}>${r}</option>`)}
        </select>
      </label>
      ${this.isMod ? html`<button class="btn-sm" @click=${() => this.openAdminRoles()}>👥 Roles</button>` : ''}
    `;
  }
  async changeMyRole(role) {
    await setGameRole(this.boardId, this.me.uid, role || null);
    toast(role ? `Ahora eres ${role}` : 'Sin rol', 'success');
  }
  async addRound() {
    if (await confirmDialog('¿Añadir una ronda a esta partida? Se alargará la partida.', { title: 'Añadir ronda' })) {
      await addRonda(this.boardId);
      toast('Ronda añadida', 'success');
    }
  }
  async editWip(col) {
    const cur = R.wipLimitFor(this.game, col.id);
    const val = await promptDialog(`Nuevo límite WIP de "${col.name}" (0 = sin límite)`, { title: 'Cambiar WIP', value: cur === Infinity ? '0' : String(cur) });
    if (val === null) return;
    await setGameColumnWip(this.boardId, col.id, val);
    toast('WIP actualizado', 'success');
  }
  openAdminRoles() {
    // Panel simple: cambiar el rol de cualquier persona asignada.
    const wrap = document.createElement('div');
    const ra = this.roleAssignments;
    const ids = Object.keys(ra);
    wrap.innerHTML = ids.length ? '' : '<p class="muted">No hay personas con rol en esta partida.</p>';
    ids.forEach((uid) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;padding:4px 0';
      row.innerHTML = `<span>${uid}</span>`;
      const sel = document.createElement('select');
      sel.innerHTML = `<option value="">—</option>` + ROLES.map((r) => `<option value="${r}" ${ra[uid] === r ? 'selected' : ''}>${r}</option>`).join('');
      sel.onchange = () => setGameRole(this.boardId, uid, sel.value || null);
      row.appendChild(sel);
      wrap.appendChild(row);
    });
    confirmDialog(wrap, { title: 'Cambiar roles (en vivo)', confirmLabel: 'Cerrar' });
  }

  renderPreview() {
    const g = this.game;
    const a = this.anchors();
    const wip = g.wipEnabled;
    const name = (id) => this.cols().find((c) => c.id === id)?.name || '';
    const roomTxt = (colId) => {
      const limit = R.wipLimitFor(g, colId);
      if (limit === Infinity) return null;
      return `${R.countInColumn(g.cards, colId)}/${limit}`;
    };
    let msg = null; let blocked = false;
    if (g.step === STEP.PM_ADD) {
      msg = 'El PM meterá 3 historias nuevas en Backlog.';
    } else if (g.step === STEP.PM_PULL) {
      const room = roomTxt(a.id.analysis);
      if (wip && !R.hasRoom(g, a.id.analysis)) { blocked = true; msg = `Análisis está lleno (${room}): no entrarán historias aunque el dado sea alto.`; }
      else msg = `El PM moverá de Backlog → Análisis según el dado${wip && room ? ` (Análisis ${room})` : ''}.`;
    } else if (g.step === STEP.DEVS) {
      const sel = this.selectedCardId ? g.cards[this.selectedCardId] : null;
      if (!sel) { msg = 'Selecciona una historia y una opción para ver qué ocurrirá.'; }
      else if (this.devAction === 'review') {
        if (sel.col !== a.id.review) { blocked = true; msg = `#${sel.number} no está en Revisión PR; no se puede revisar.`; }
        else if (wip && !R.hasRoom(g, a.id.qa)) { blocked = true; msg = `#${sel.number}: QA llena (${roomTxt(a.id.qa)}); no podrá pasar a QA.`; }
        else msg = `#${sel.number}: Revisión PR → QA (si el dado es 3+).`;
      } else {
        const toId = R.nextColumnId(g, sel.col);
        if (!R.advanceSources(g).includes(sel.col)) { blocked = true; msg = `#${sel.number} no puede avanzar desde ${name(sel.col)}.`; }
        else if (wip && !R.hasRoom(g, toId)) { blocked = true; msg = `#${sel.number}: ${name(toId)} llena (${roomTxt(toId)}); no avanzará aunque el dado lo permita.`; }
        else msg = `#${sel.number}: ${name(sel.col)} → ${name(toId)} (si ${this.devAction === 'pair' ? 'la suma es 5+' : 'el dado es 3+'}).`;
      }
    } else if (g.step === STEP.QA) {
      const sel = this.selectedCardId ? g.cards[this.selectedCardId] : null;
      if (!sel || sel.col !== a.id.qa) { msg = 'Selecciona una historia de la columna QA.'; }
      else {
        const full = wip && !R.hasRoom(g, a.id.validation);
        blocked = full;
        msg = `#${sel.number}: con 3+ → Validación PM${full ? ` (LLENA ${roomTxt(a.id.validation)}: se quedará en QA)` : ''}; con 1-2 es bug → vuelve a Desarrollo.`;
      }
    } else if (g.step === STEP.PM_VALIDATE) {
      msg = 'El PM moverá de Validación PM → Done según el dado.';
    }
    if (!msg) return '';
    return html`<div class="preview ${blocked ? 'blocked' : ''}">${blocked ? '🚫' : '👉'} ${msg}</div>`;
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
            const wipEditable = this.isMod && g.wipEnabled && g.status === 'playing'
              && c.id !== a.id.backlog && c.id !== a.id.done;
            return html`
              <div class="column" style="--accent:${accent}">
                <div class="col-head">
                  <span class="col-name" title=${c.name}>${c.name}</span>
                  <span class="wip ${over ? 'over' : full ? 'full' : ''} ${wipEditable ? 'editable' : ''}"
                        title=${wipEditable ? 'Pulsa para cambiar el WIP' : ''}
                        @click=${wipEditable ? () => this.editWip(c) : null}>
                    ${cards.length}${hasLimit ? ` / ${limit}` : ''}${wipEditable ? ' ✎' : ''}
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
    const g = this.game;
    if (g.step === STEP.DEVS) return this.ctrlDevs(); // gestiona su propio roster/turnos
    if (!this.canAct) {
      return html`<div class="controls card muted">Esperando a que <strong>${this.activeRole}</strong> complete el ${STEP_LABEL[g.step]}.</div>`;
    }
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

  renderDevRoster() {
    const g = this.game;
    const order = g.devOrder || [];
    const acted = g.devActed || {};
    const cur = this.currentDevUid;
    return html`<div class="dev-roster">
      ${order.map((uid) => {
        const done = !!acted[uid];
        const isCur = uid === cur;
        const isMe = uid === this.me?.uid;
        return html`<span class="dev-chip ${done ? 'done' : ''} ${isCur ? 'cur' : ''}">
          ${done ? '✓' : isCur ? '➡️' : '⏳'} ${this.nameOf(uid)}${isMe ? ' (tú)' : ''}
        </span>`;
      })}
    </div>`;
  }

  ctrlDevs() {
    const g = this.game;
    const a = this.anchors();
    const order = g.devOrder || [];
    const acted = g.devActed || {};
    const cur = this.currentDevUid;
    const canFinish = this.isMod || this.myGameRole === 'PM';

    if (!this.actorIsMe) {
      return html`<div class="controls card stack">
        <p>Paso de los Devs · le toca a <strong>${cur ? this.nameOf(cur) : '—'}</strong>.</p>
        ${this.renderDevRoster()}
        ${canFinish ? html`<button @click=${() => this.act('dev-finish')}>✔ Forzar cierre → QA</button>` : ''}
      </div>`;
    }

    const sel = this.selectedCardId ? g.cards[this.selectedCardId] : null;
    const inAdvance = sel && R.advanceSources(g).includes(sel.col);
    const inReview = sel && sel.col === a.id.review;
    const action = this.devAction;
    const needTwo = action === 'pair';
    const pendingPartners = order.filter((u) => !acted[u] && u !== cur);
    const validForAction = ((action === 'advance' || action === 'pair') && inAdvance) || (action === 'review' && inReview);
    const pairOk = action !== 'pair' || (this.pairPartner && pendingPartners.includes(this.pairPartner));
    return html`<div class="controls card stack">
      <p><strong>Te toca${cur && cur !== this.me?.uid ? ` (accionas por ${this.nameOf(cur)})` : ''}.</strong> Elige una opción y tira:</p>
      ${this.renderDevRoster()}
      <div class="row">
        ${this.devOpt('advance', 'Avanzar (1 dado, 3+)')}
        ${this.devOpt('review', 'Revisar PR (1 dado, 3+)')}
        ${this.devOpt('pair', 'Pair (2 dados, 5+)')}
      </div>
      ${action === 'pair' ? html`
        <div class="row" style="gap:8px">
          <label style="margin:0">Compañero:</label>
          <select @change=${(e) => { this.pairPartner = e.target.value || null; }}>
            <option value="" ?selected=${!this.pairPartner}>— elige Dev —</option>
            ${pendingPartners.map((u) => html`<option value=${u} ?selected=${this.pairPartner === u}>${this.nameOf(u)}</option>`)}
          </select>
          ${pendingPartners.length === 0 ? html`<span class="muted">No hay otro Dev pendiente para pair.</span>` : ''}
        </div>` : ''}
      <p class="muted" style="margin:0">
        ${sel ? html`Seleccionada: <strong>#${sel.number}</strong>` : 'Selecciona una historia.'}
        ${sel && !validForAction ? html`<span style="color:var(--c-warning)"> · esa historia no vale para esta acción.</span>` : ''}
      </p>
      <div class="row" style="gap:16px">
        <kbg-dice count=${needTwo ? 2 : 1} label="Tirar" .disabled=${!validForAction || !pairOk}
          @roll=${(e) => this.devRoll(e.detail.values)}></kbg-dice>
        ${canFinish ? html`<button @click=${() => this.act('dev-finish')}>✔ Forzar cierre → QA</button>` : ''}
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
    else if (this.devAction === 'pair') this.act('dev-pair', { cardId, dice: values, partner: this.pairPartner });
    this.selectedCardId = null;
    this.pairPartner = null;
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
    const isNoWip = this.board?.mode === 'nowip';
    return html`<div class="controls card center stack">
      <h2 style="margin:0">🏁 Ronda ${this.game.round} terminada</h2>
      <p>Total de historias en <strong>Done</strong>: <strong style="font-size:1.4rem">${R.doneTotal(this.game)}</strong></p>
      <div class="row" style="justify-content:center; flex-wrap:wrap">
        <a class="btn btn-primary" href="/results?id=${this.boardId}">📊 Ver resultados y gráficas</a>
        ${this.isMod && isNoWip ? html`<button class="btn" @click=${() => this.startWipAndOpen()}>▶ Iniciar ronda CON WIP y abrir</button>` : ''}
        ${this.isMod ? html`<a class="btn btn-ghost" href=${this.adminHref()}>🎛 Facilitador</a>` : ''}
      </div>
    </div>`;
  }
  /** Arranca el tablero CON WIP del mismo equipo (misma config de partida) y navega a él. */
  async startWipAndOpen() {
    try {
      const team = await getTeam(this.board.teamId);
      const wipId = team?.boardWip;
      if (!wipId) return toast('No se encontró el tablero con WIP del equipo', 'error');
      const wipBoard = await getBoard(wipId);
      if (!wipBoard) return toast('No se encontró el tablero con WIP', 'error');
      const session = (this.board.partidaId ? (await getPartida(this.board.partidaId))?.session : null) || {};
      await startGame(wipBoard, {
        wipEnabled: true,
        rondas: session.rondas ?? 3,
        ciclos: session.ciclos ?? 5,
        timeLimitMinutes: session.timeLimitMinutes ?? null,
        pauseBetweenRounds: session.pauseBetweenRounds ?? false,
      });
      location.href = `/board?id=${wipId}`;
    } catch (e) { console.error(e); toast('No se pudo iniciar la ronda con WIP', 'error'); }
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
      kbg-game .wip.editable { cursor: pointer; outline: 1px dashed var(--c-text-dim); }
      kbg-game .wip.editable:hover { outline-color: var(--c-primary); }
      kbg-game .rolepick { display: inline-flex; align-items: center; gap: 4px; font-size: .8rem; color: var(--c-text-soft); }
      kbg-game .rolepick select { width: auto; padding: 2px 6px; }
      kbg-game .preview { margin-top: 10px; padding: 10px 14px; border-radius: 8px; background: #14304a; border-left: 4px solid var(--c-primary); font-size: .95rem; }
      kbg-game .preview.blocked { background: #3a1414; border-left-color: var(--c-danger); }
      kbg-game .dev-roster { display: flex; flex-wrap: wrap; gap: 6px; }
      kbg-game .dev-chip { font-size: .85rem; padding: 3px 10px; border-radius: 999px; background: var(--c-surface-2); border: 1px solid var(--c-border); color: var(--c-text-soft); }
      kbg-game .dev-chip.done { opacity: .6; text-decoration: line-through; }
      kbg-game .dev-chip.cur { background: #173c3f; color: #7fe3ec; border-color: #4dd0e1; font-weight: 700; }
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
