import { LitElement, html } from 'lit';
import {
  watchUsers, watchTeams, watchBoards,
  setUserRole, createTeam, renameTeam, deleteTeam,
  createBoard, updateBoard, deleteBoard, setBoardColumns, assignPlayer, unassignPlayer,
} from '../lib/db.js';
import { startGame } from '../lib/game.js';
import { defaultColumns } from '../lib/rules.js';
import { toast, confirmDialog, promptDialog } from '../lib/ui.js';

const ROLES = ['PM', 'DEV', 'QA'];

export class AdminPanel extends LitElement {
  static properties = {
    tab: { state: true },
    users: { state: true },
    teams: { state: true },
    boards: { state: true },
    selectedBoard: { state: true },
    me: { attribute: false },
  };

  constructor() {
    super();
    this.tab = 'people';
    this.users = [];
    this.teams = [];
    this.boards = [];
    this.selectedBoard = null;
  }

  // Light DOM para heredar los estilos globales.
  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._u = watchUsers((l) => { this.users = l; });
    this._t = watchTeams((l) => { this.teams = l; });
    this._b = watchBoards((l) => {
      this.boards = l;
      if (this.selectedBoard) this.selectedBoard = l.find((b) => b.id === this.selectedBoard.id) || null;
      const pre = new URLSearchParams(location.search).get('board');
      if (pre && !this.selectedBoard) { this.selectedBoard = l.find((b) => b.id === pre) || null; if (this.selectedBoard) this.tab = 'boards'; }
    });
  }
  disconnectedCallback() { super.disconnectedCallback(); this._u?.(); this._t?.(); this._b?.(); }

  teamName(id) { return this.teams.find((t) => t.id === id)?.name || '—'; }

  render() {
    return html`
      <div class="flex-between">
        <h1>Administración</h1>
      </div>
      <div class="row tabs" style="margin:12px 0; gap:6px">
        ${this._tab('people', '👤 Personas')}
        ${this._tab('teams', '👥 Equipos')}
        ${this._tab('boards', '🧩 Tableros')}
        ${this._tab('assign', '🎯 Asignaciones')}
      </div>
      ${this.tab === 'people' ? this.renderPeople() : ''}
      ${this.tab === 'teams' ? this.renderTeams() : ''}
      ${this.tab === 'boards' ? this.renderBoards() : ''}
      ${this.tab === 'assign' ? this.renderAssign() : ''}
    `;
  }

  _tab(id, label) {
    return html`<button class=${this.tab === id ? 'btn-primary' : ''} @click=${() => { this.tab = id; }}>${label}</button>`;
  }

  // ---------------- Personas ----------------
  renderPeople() {
    return html`
      <div class="card">
        <table class="t">
          <thead><tr><th></th><th>Nombre</th><th>Email</th><th>Rol app</th><th>Tablero · rol juego</th><th></th></tr></thead>
          <tbody>
            ${this.users.map((u) => html`
              <tr>
                <td>${u.photoURL ? html`<img class="avatar" src=${u.photoURL} referrerpolicy="no-referrer" alt="">` : '👤'}</td>
                <td>${u.name || '—'}</td>
                <td class="muted">${u.email || ''}</td>
                <td>${u.role === 'admin' ? html`<span class="tag admin">admin</span>` : html`<span class="tag">jugador</span>`}</td>
                <td>${u.boardId ? html`<span class="tag">${this.boards.find((b) => b.id === u.boardId)?.name || u.boardId}</span> ${u.gameRole ? html`<span class="tag role-${u.gameRole}">${u.gameRole}</span>` : ''}` : html`<span class="muted">sin asignar</span>`}</td>
                <td>
                  <button class="btn-sm" @click=${() => this.toggleAdmin(u)}>
                    ${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}
                  </button>
                </td>
              </tr>`)}
          </tbody>
        </table>
        ${this.users.length === 0 ? html`<p class="empty-state">Aún no hay personas registradas. Comparte el enlace y pídeles que entren con Google.</p>` : ''}
      </div>
      ${this.tableStyles()}
    `;
  }
  async toggleAdmin(u) {
    if (u.id === this.me?.uid && u.role === 'admin') {
      const ok = await confirmDialog('¿Quitarte a ti mismo el rol admin? Perderás el acceso a esta página.', { title: 'Cuidado', danger: true });
      if (!ok) return;
    }
    await setUserRole(u.id, u.role === 'admin' ? 'player' : 'admin');
    toast('Rol actualizado', 'success');
  }

  // ---------------- Equipos ----------------
  renderTeams() {
    return html`
      <div class="card stack">
        <div class="row">
          <input id="newTeam" type="text" placeholder="Nombre del equipo" style="max-width:280px"
                 @keydown=${(e) => { if (e.key === 'Enter') this.addTeam(); }}>
          <button class="btn-primary" @click=${() => this.addTeam()}>+ Crear equipo</button>
        </div>
        ${this.teams.length === 0 ? html`<p class="empty-state">No hay equipos todavía.</p>` : html`
          <ul class="list">
            ${this.teams.map((t) => html`
              <li class="flex-between">
                <span>👥 <strong>${t.name}</strong> <span class="muted">· ${t.members ? Object.keys(t.members).length : 0} miembros</span></span>
                <span class="row">
                  <button class="btn-sm" @click=${() => this.renameTeam(t)}>Renombrar</button>
                  <button class="btn-sm btn-danger" @click=${() => this.removeTeam(t)}>Eliminar</button>
                </span>
              </li>`)}
          </ul>`}
      </div>
      ${this.tableStyles()}
    `;
  }
  async addTeam() {
    const input = this.querySelector('#newTeam');
    const name = input.value.trim();
    if (!name) return toast('Escribe un nombre', 'warning');
    await createTeam(name, this.me?.uid);
    input.value = '';
    toast('Equipo creado', 'success');
  }
  async renameTeam(t) {
    const name = await promptDialog('Nuevo nombre del equipo', { title: 'Renombrar equipo', value: t.name });
    if (name) { await renameTeam(t.id, name); toast('Equipo renombrado', 'success'); }
  }
  async removeTeam(t) {
    if (await confirmDialog(`¿Eliminar el equipo "${t.name}"?`, { title: 'Eliminar equipo', danger: true })) {
      await deleteTeam(t.id); toast('Equipo eliminado', 'success');
    }
  }

  // ---------------- Tableros ----------------
  renderBoards() {
    if (this.selectedBoard) return this.renderBoardConfig(this.selectedBoard);
    return html`
      <div class="card stack">
        <div class="row">
          <input id="newBoard" type="text" placeholder="Nombre del tablero" style="max-width:260px">
          <select id="newBoardTeam" style="max-width:220px">
            <option value="">— Sin equipo —</option>
            ${this.teams.map((t) => html`<option value=${t.id}>${t.name}</option>`)}
          </select>
          <button class="btn-primary" @click=${() => this.addBoard()}>+ Crear tablero</button>
        </div>
        <p class="muted">Cada tablero se crea con las 7 columnas por defecto del juego. Puedes editarlas y configurar el WIP entrando en el tablero.</p>
        ${this.boards.length === 0 ? html`<p class="empty-state">No hay tableros.</p>` : html`
          <ul class="list">
            ${this.boards.map((b) => html`
              <li class="flex-between">
                <span>🧩 <strong>${b.name}</strong>
                  <span class="muted">· ${this.teamName(b.teamId)} · ${b.columns ? Object.keys(b.columns).length : 0} col · ${b.status || 'setup'}</span>
                </span>
                <span class="row">
                  <button class="btn-sm" @click=${() => { this.selectedBoard = b; }}>⚙ Configurar</button>
                  <a class="btn btn-sm" href="/board?id=${b.id}">▶ Jugar</a>
                  <button class="btn-sm btn-danger" @click=${() => this.removeBoard(b)}>Eliminar</button>
                </span>
              </li>`)}
          </ul>`}
      </div>
      ${this.tableStyles()}
    `;
  }

  renderBoardConfig(b) {
    const cols = Object.entries(b.columns || {})
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, c) => (a.order ?? 0) - (c.order ?? 0));
    return html`
      <div class="card stack">
        <div class="flex-between">
          <h2 style="margin:0">⚙ ${b.name}</h2>
          <button @click=${() => { this.selectedBoard = null; }}>← Volver</button>
        </div>

        <div class="row" style="gap:8px">
          <label style="margin:0">Ronda activa:</label>
          <select @change=${(e) => this.setRound(b, Number(e.target.value))}>
            <option value="1" ?selected=${b.round === 1}>Ronda 1 · sin WIP</option>
            <option value="2" ?selected=${b.round === 2}>Ronda 2 · con WIP</option>
          </select>
          <span class="muted">El WIP solo se aplica en la Ronda 2.</span>
        </div>

        <h3 style="margin:8px 0 0">Columnas y límites WIP</h3>
        <p class="muted" style="margin:0">Vacío = sin límite. Backlog y Done no se limitan nunca.</p>
        <div id="colEditor" class="stack">
          ${cols.map((c, i) => html`
            <div class="row col-row" data-id=${c.id}>
              <span class="muted" style="width:24px">${i + 1}</span>
              <input class="c-name" type="text" .value=${c.name} style="max-width:240px">
              <label style="margin:0">WIP</label>
              <input class="c-wip" type="number" min="0" .value=${c.wipLimit ?? ''} placeholder="∞" style="width:80px">
              <button class="btn-sm" @click=${() => this.moveCol(cols, i, -1)} ?disabled=${i === 0}>↑</button>
              <button class="btn-sm" @click=${() => this.moveCol(cols, i, 1)} ?disabled=${i === cols.length - 1}>↓</button>
              <button class="btn-sm btn-danger" @click=${() => this.deleteCol(cols, i)} ?disabled=${cols.length <= 5}>✕</button>
            </div>`)}
        </div>
        <div class="row">
          <button class="btn-sm" @click=${() => this.addCol(cols)}>+ Añadir columna</button>
          <button class="btn-primary" @click=${() => this.saveCols(b)}>💾 Guardar columnas y WIP</button>
          <button class="btn-sm" @click=${() => this.resetCols(b)}>Restaurar 7 por defecto</button>
        </div>

        <hr style="border-color:var(--c-border);width:100%">
        <h3 style="margin:0">Partida</h3>
        <div class="row">
          <button class="btn-primary" @click=${() => this.start(b, 1)}>▶ Iniciar Ronda 1 (sin WIP)</button>
          <button class="btn-primary" @click=${() => this.start(b, 2)}>▶ Iniciar Ronda 2 (con WIP)</button>
          <a class="btn" href="/results?id=${b.id}">📊 Ver resultados</a>
        </div>
        <p class="muted" style="margin:0">Iniciar una ronda reinicia el tablero de juego para esa ronda (los resultados guardados de la ronda anterior se conservan en métricas).</p>
      </div>
      ${this.tableStyles()}
    `;
  }

  async addBoard() {
    const name = this.querySelector('#newBoard').value.trim();
    const teamId = this.querySelector('#newBoardTeam').value || null;
    if (!name) return toast('Escribe un nombre de tablero', 'warning');
    const id = await createBoard({ name, teamId, createdBy: this.me?.uid });
    this.querySelector('#newBoard').value = '';
    toast('Tablero creado', 'success');
    const b = await new Promise((r) => { const u = watchBoards((l) => { u(); r(l.find((x) => x.id === id)); }); });
    if (b) this.selectedBoard = b;
  }
  async removeBoard(b) {
    if (await confirmDialog(`¿Eliminar el tablero "${b.name}" y su partida?`, { title: 'Eliminar tablero', danger: true })) {
      await deleteBoard(b.id); toast('Tablero eliminado', 'success');
    }
  }
  async setRound(b, round) {
    await updateBoard(b.id, { round, wipEnabled: round === 2 });
    toast(`Ronda ${round} activada`, 'success');
  }

  // edición de columnas (en memoria hasta "Guardar")
  readColsFromDom() {
    return Array.from(this.querySelectorAll('.col-row')).map((row) => {
      const wip = row.querySelector('.c-wip').value.trim();
      return {
        id: row.dataset.id,
        name: row.querySelector('.c-name').value.trim() || 'Columna',
        wipLimit: wip === '' ? null : Math.max(0, Number(wip)) || null,
      };
    });
  }
  moveCol(cols, i, dir) {
    const current = this.readColsFromDom();
    const j = i + dir;
    if (j < 0 || j >= current.length) return;
    [current[i], current[j]] = [current[j], current[i]];
    this._pendingCols = current;
    this.selectedBoard = { ...this.selectedBoard, columns: this.colsToMap(current) };
  }
  deleteCol(cols, i) {
    const current = this.readColsFromDom();
    if (current.length <= 5) return toast('Mínimo 5 columnas para el juego', 'warning');
    current.splice(i, 1);
    this.selectedBoard = { ...this.selectedBoard, columns: this.colsToMap(current) };
  }
  addCol(cols) {
    const current = this.readColsFromDom();
    // Inserta antes de Done (última).
    current.splice(Math.max(1, current.length - 1), 0, { id: '', name: 'Nueva columna', wipLimit: null });
    this.selectedBoard = { ...this.selectedBoard, columns: this.colsToMap(current) };
  }
  colsToMap(arr) {
    return arr.reduce((acc, c, i) => { acc[c.id || `tmp_${i}_${Date.now()}`] = { name: c.name, order: i, wipLimit: c.wipLimit ?? null }; return acc; }, {});
  }
  async saveCols(b) {
    const current = this.readColsFromDom();
    if (current.length < 5) return toast('Mínimo 5 columnas', 'warning');
    await setBoardColumns(b.id, current);
    toast('Columnas guardadas', 'success');
  }
  async resetCols(b) {
    if (await confirmDialog('¿Restaurar las 7 columnas por defecto? Se perderá la configuración actual de columnas.', { title: 'Restaurar columnas', danger: true })) {
      await setBoardColumns(b.id, defaultColumns());
      toast('Columnas restauradas', 'success');
    }
  }
  async start(b, round) {
    const ok = await confirmDialog(`¿Iniciar la Ronda ${round}? Se reiniciará el tablero de juego.`, { title: `Iniciar Ronda ${round}` });
    if (!ok) return;
    await startGame(b, round);
    toast(`Ronda ${round} iniciada`, 'success');
    location.href = `/board?id=${b.id}`;
  }

  // ---------------- Asignaciones ----------------
  renderAssign() {
    const board = this.selectedBoard || this.boards[0];
    if (!board) return html`<div class="card empty-state">Crea primero un tablero en la pestaña Tableros.</div>`;
    const assignments = board.roleAssignments || {};
    const counts = ROLES.reduce((a, r) => { a[r] = Object.values(assignments).filter((x) => x === r).length; return a; }, {});
    return html`
      <div class="card stack">
        <div class="row">
          <label style="margin:0">Tablero:</label>
          <select @change=${(e) => { this.selectedBoard = this.boards.find((b) => b.id === e.target.value); }}>
            ${this.boards.map((b) => html`<option value=${b.id} ?selected=${b.id === board.id}>${b.name}</option>`)}
          </select>
          <span class="muted">Equipo: ${this.teamName(board.teamId)}</span>
        </div>
        <div class="row">
          <span class="tag role-PM">PM: ${counts.PM} <span class="muted">(reco. 1)</span></span>
          <span class="tag role-DEV">DEV: ${counts.DEV} <span class="muted">(reco. 2-3)</span></span>
          <span class="tag role-QA">QA: ${counts.QA} <span class="muted">(reco. 1-2)</span></span>
        </div>
        <table class="t">
          <thead><tr><th>Persona</th><th>Rol en este tablero</th></tr></thead>
          <tbody>
            ${this.users.map((u) => html`
              <tr>
                <td>${u.name || u.email}</td>
                <td>
                  <select @change=${(e) => this.assign(board, u, e.target.value)}>
                    <option value="" ?selected=${!assignments[u.id]}>— Sin asignar —</option>
                    ${ROLES.map((r) => html`<option value=${r} ?selected=${assignments[u.id] === r}>${r}</option>`)}
                  </select>
                </td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      ${this.tableStyles()}
    `;
  }
  async assign(board, u, role) {
    if (!role) { await unassignPlayer({ boardId: board.id, uid: u.id }); toast(`${u.name || u.email} sin asignar`, 'info'); return; }
    await assignPlayer({ boardId: board.id, uid: u.id, role, teamId: board.teamId });
    toast(`${u.name || u.email} → ${role}`, 'success');
  }

  tableStyles() {
    return html`<style>
      .tabs button { min-width: 0; }
      table.t { width: 100%; border-collapse: collapse; }
      table.t th, table.t td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--c-border); vertical-align: middle; }
      table.t th { color: var(--c-text-soft); font-size: .82rem; font-weight: 600; }
      .avatar { width: 28px; height: 28px; border-radius: 50%; vertical-align: middle; }
      ul.list { list-style: none; padding: 0; margin: 0; }
      ul.list li { padding: 10px 4px; border-bottom: 1px solid var(--c-border); }
      .col-row { padding: 4px 0; }
    </style>`;
  }
}

customElements.define('kbg-admin', AdminPanel);
