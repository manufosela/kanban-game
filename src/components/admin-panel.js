import { LitElement, html } from 'lit';
import {
  watchUsers, watchTeams, watchBoards, watchInvited, watchBots,
  setUserRole, createTeam, renameTeam, deleteTeam,
  renameBoard, setBoardColumns, assignToTeam, unassignFromTeam,
  addInvited, deleteInvited, setInvitedAssignment, normalizeEmail,
  setUserDefaultRole, setInvitedRole,
  isBotId, addBotToTeam, removeBotFromTeam, setBotRole, getBoard,
  watchPartidas, createPartida, renamePartida, deletePartida,
  watchPartidaSession, updatePartidaSession,
  watchPartidaFacilitators, setPartidaFacilitator, findUserPartida,
  migrateLegacyToPartida1,
} from '../lib/db.js';
import { startPartidaForBoards, startGame } from '../lib/game.js';
import { defaultColumns } from '../lib/rules.js';
import { toast, confirmDialog, promptDialog, modal } from '../lib/ui.js';

const ROLES = ['PM', 'DEV', 'QA'];

export class AdminPanel extends LitElement {
  static properties = {
    tab: { state: true },
    users: { state: true },
    teams: { state: true },
    boards: { state: true },
    session: { state: true },
    invited: { state: true },
    facilitators: { state: true },
    bots: { state: true },
    partidas: { state: true },
    currentPartidaId: { state: true },
    expanded: { state: true },
    selectedBoard: { state: true },
    me: { attribute: false },
    initialPartidaId: { attribute: false },
  };

  constructor() {
    super();
    this.tab = 'people';
    this.users = [];
    this.teams = [];
    this.boards = [];
    this.invited = [];
    this.facilitators = [];
    this.bots = [];
    this.partidas = [];
    this.currentPartidaId = null;
    this.expanded = {};
    this.session = { mode: 'nowip', timeLimitMinutes: null };
    this.selectedBoard = null;
  }
  toggleTeam(id) { this.expanded = { ...this.expanded, [id]: !this.expanded[id] }; }

  // Light DOM para heredar los estilos globales.
  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._u = watchUsers((l) => { this.users = l; });
    this._t = watchTeams((l) => { this.teams = l; });
    this._i = watchInvited((l) => { this.invited = l; });
    this._bots = watchBots((l) => { this.bots = l; });
    this._p = watchPartidas((l) => { this.partidas = l; this.maybeRestorePartida(); });
    this._b = watchBoards((l) => {
      this.boards = l;
      if (this.selectedBoard) this.selectedBoard = l.find((b) => b.id === this.selectedBoard.id) || null;
    });
    // Un co-facilitador entra directo a su partida (no ve el listado global).
    if (this.me?.facilitatorOnly) {
      findUserPartida(this.me.uid).then((pid) => { if (pid) this.enterPartida(pid); });
    }
  }

  /** Restaura la partida recordada (URL ?partida o localStorage) si sigue existiendo. */
  maybeRestorePartida() {
    if (this.currentPartidaId || this.me?.facilitatorOnly || this._restored) return;
    const want = this.initialPartidaId || localStorage.getItem('kbg.partida');
    if (want && this.partidas.some((p) => p.id === want)) {
      this._restored = true;
      this.enterPartida(want);
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._u?.(); this._t?.(); this._b?.(); this._i?.(); this._bots?.(); this._p?.();
    this._ps?.(); this._pf?.();
  }

  /** Entra a una partida: scoping de toda la gestión + watchers de sesión/facilitadores de esa partida. */
  enterPartida(pid) {
    this.currentPartidaId = pid;
    this.tab = this.me?.facilitatorOnly ? 'facilitator' : 'people';
    this.selectedBoard = null;
    try { localStorage.setItem('kbg.partida', pid); } catch { /* ignore */ }
    this._ps?.(); this._pf?.();
    this._ps = watchPartidaSession(pid, (s) => { this.session = s; });
    this._pf = watchPartidaFacilitators(pid, (l) => { this.facilitators = l; });
  }
  leavePartida() {
    this._ps?.(); this._pf?.();
    this._ps = null; this._pf = null;
    this.currentPartidaId = null;
    this.selectedBoard = null;
    try { localStorage.removeItem('kbg.partida'); } catch { /* ignore */ }
  }
  currentPartida() { return this.partidas.find((p) => p.id === this.currentPartidaId) || null; }

  // ---- Listas filtradas a la partida activa (las colecciones son planas con partidaId) ----
  get pTeams() { return this.teams.filter((t) => t.partidaId === this.currentPartidaId); }
  get pBoards() { return this.boards.filter((b) => b.partidaId === this.currentPartidaId); }
  get pInvited() { return this.invited.filter((iv) => iv.partidaId === this.currentPartidaId); }
  /** uids reales que son miembros de algún equipo de la partida activa. */
  partidaUserIds() {
    const s = new Set();
    this.pTeams.forEach((t) => Object.keys(t.members || {}).forEach((u) => { if (!isBotId(u)) s.add(u); }));
    return s;
  }
  /** uids reales asignados a algún equipo de CUALQUIER partida (para detectar globales libres). */
  assignedAnywhere() {
    const s = new Set();
    this.teams.forEach((t) => Object.keys(t.members || {}).forEach((u) => { if (!isBotId(u)) s.add(u); }));
    return s;
  }

  teamName(id) { return this.teams.find((t) => t.id === id)?.name || '—'; }

  render() {
    const facOnly = this.me?.facilitatorOnly;
    // Sin partida seleccionada: el admin ve el listado de partidas; el co-facilitador espera a su routing.
    if (!this.currentPartidaId) {
      if (facOnly) return html`<div class="card"><p class="muted">No tienes ninguna partida asignada como co-facilitador. Pide a un administrador que te asigne a una.</p></div>`;
      return this.renderPartidas();
    }
    const p = this.currentPartida();
    const tab = facOnly ? 'facilitator' : this.tab;
    return html`
      <div class="flex-between" style="flex-wrap:wrap; gap:8px">
        <h1 style="margin:0">${facOnly ? '🎛 Facilitador' : '🗂 '}${p ? p.name : 'Partida'}
          ${p?.isDemo ? html`<span class="tag" style="background:#1f3a2a;color:#9ff0c0">demo</span>` : ''}</h1>
        ${facOnly ? '' : html`<button @click=${() => this.leavePartida()}>← Todas las partidas</button>`}
      </div>
      ${facOnly ? '' : html`
        <div class="row tabs" style="margin:12px 0; gap:6px">
          ${this._tab('people', '👤 Personas')}
          ${this._tab('teams', '👥 Equipos y tableros')}
          ${this._tab('facilitator', '🎛 Facilitador')}
        </div>`}
      ${tab === 'people' ? this.renderPeople() : ''}
      ${tab === 'teams' ? this.renderTeams() : ''}
      ${tab === 'facilitator' ? this.renderFacilitator() : ''}
    `;
  }

  // ---------------- Partidas (entidad raíz) ----------------
  renderPartidas() {
    // Datos antiguos sin partida (de antes del modelo de partidas).
    const legacy = this.teams.some((t) => !t.partidaId) || this.boards.some((b) => !b.partidaId);
    return html`
      <div class="flex-between"><h1 style="margin:0">🗂 Partidas</h1></div>
      ${legacy ? html`
        <div class="card stack" style="margin-top:12px; border:1px solid var(--c-warning)">
          <h3 style="margin:0">⚠ Datos sin partida</h3>
          <p class="muted" style="margin:0">Hay equipos o tableros creados antes del modelo de partidas. Migra todo a una <strong>Partida 1</strong> (conserva su sesión y co-facilitadores). Es seguro e idempotente.</p>
          <div><button class="btn-primary" @click=${() => this.runMigration()}>📦 Migrar datos a «Partida 1»</button></div>
        </div>` : ''}
      <div class="card stack" style="margin-top:12px">
        <div class="row">
          <input id="newPartida" type="text" placeholder="Nombre de la partida (p.ej. Taller Kanban — Marzo)" style="max-width:360px"
                 @keydown=${(e) => { if (e.key === 'Enter') this.addPartida(); }}>
          <button class="btn-primary" @click=${() => this.addPartida()}>+ Crear partida</button>
          <span class="muted">·</span>
          <button class="btn" @click=${() => this.createDemoPartida()}>🎮 Generar partida demo completa</button>
        </div>
        <p class="muted" style="margin:0">Cada partida agrupa sus propias personas, equipos, tableros y configuración. Solo el login es global; el resto se gestiona dentro de cada partida.</p>
      </div>
      ${this.partidas.length === 0 ? html`<p class="empty-state">No hay partidas todavía. Crea la primera.</p>` : html`
        <div class="card" style="margin-top:12px">
          <table class="t">
            <thead><tr><th>Partida</th><th>Equipos</th><th>Tableros</th><th>Personas</th><th></th></tr></thead>
            <tbody>
              ${this.partidas.map((p) => {
                const tms = this.teams.filter((t) => t.partidaId === p.id);
                const bds = this.boards.filter((b) => b.partidaId === p.id);
                const realIds = new Set();
                let bots = 0;
                tms.forEach((t) => Object.keys(t.members || {}).forEach((u) => { if (isBotId(u)) bots += 1; else realIds.add(u); }));
                const pend = this.invited.filter((iv) => iv.partidaId === p.id).length;
                const total = realIds.size + bots;
                return html`<tr>
                  <td><strong>${p.name}</strong> ${p.isDemo ? html`<span class="tag" style="background:#1f3a2a;color:#9ff0c0">demo</span>` : ''}</td>
                  <td>${tms.length}</td>
                  <td>${bds.length}</td>
                  <td>${total}${bots ? html` <span class="muted">(${bots} bots)</span>` : ''}${pend ? html` <span class="muted">(+${pend} pend.)</span>` : ''}</td>
                  <td class="row" style="gap:6px">
                    <button class="btn-sm btn-primary" @click=${() => this.enterPartida(p.id)}>Entrar</button>
                    <button class="btn-sm" @click=${() => this.renamePartidaPrompt(p)}>Renombrar</button>
                    <button class="btn-sm btn-danger" @click=${() => this.removePartida(p)}>Eliminar</button>
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>`}
      ${this.tableStyles()}
    `;
  }
  async runMigration() {
    const ok = await confirmDialog('¿Migrar todos los equipos, tableros, invitados y bots sin partida a una nueva «Partida 1»? Se conservan tal cual; solo se agrupan.', { title: 'Migrar datos antiguos' });
    if (!ok) return;
    const pid = await migrateLegacyToPartida1(this.me?.uid);
    toast(pid ? 'Datos migrados a «Partida 1»' : 'No había nada que migrar', pid ? 'success' : 'info');
  }
  async addPartida() {
    const input = this.querySelector('#newPartida');
    const name = (input.value || '').trim();
    if (!name) return toast('Escribe un nombre para la partida', 'warning');
    const pid = await createPartida(name, this.me?.uid, false);
    input.value = '';
    toast('Partida creada', 'success');
    this.enterPartida(pid);
  }
  async renamePartidaPrompt(p) {
    const name = await promptDialog('Nuevo nombre de la partida', { title: 'Renombrar partida', value: p.name });
    if (name) { await renamePartida(p.id, name); toast('Partida renombrada', 'success'); }
  }
  async removePartida(p) {
    const ok = await confirmDialog(`¿Eliminar la partida "${p.name}" con TODOS sus equipos, tableros, partidas jugadas, resultados, bots e invitados? Esta acción no se puede deshacer.`, { title: 'Eliminar partida', danger: true });
    if (!ok) return;
    await deletePartida(p.id);
    if (this.currentPartidaId === p.id) this.leavePartida();
    toast('Partida eliminada', 'success');
  }
  /** Crea una partida demo completa: equipo de bots, inicia su tablero y lo abre. */
  async createDemoPartida() {
    const ok = await confirmDialog('¿Generar una partida demo completa (equipo de bots: 1 PM, 3 DEV, 1 QA), iniciarla y abrir el tablero para verla jugar sola?', { title: 'Partida demo completa' });
    if (!ok) return;
    const n = this.partidas.filter((p) => p.isDemo).length + 1;
    const pid = await createPartida(`Demo ${n}`, this.me?.uid, true);
    const team = await createTeam('Equipo demo', this.me?.uid, pid);
    await addBotToTeam(team, 'PM', 'Bot PM');
    await addBotToTeam(team, 'DEV', 'Bot Dev 1');
    await addBotToTeam(team, 'DEV', 'Bot Dev 2');
    await addBotToTeam(team, 'DEV', 'Bot Dev 3');
    await addBotToTeam(team, 'QA', 'Bot QA');
    const board = await getBoard(team.boardNoWip);
    await startGame(board, { wipEnabled: false, rondas: 3, ciclos: 5, timeLimitMinutes: null });
    toast('Partida demo creada, ¡a jugar!', 'success');
    location.href = `/board?id=${team.boardNoWip}`;
  }

  _tab(id, label) {
    return html`<button class=${this.tab === id ? 'btn-primary' : ''} @click=${() => { this.tab = id; }}>${label}</button>`;
  }

  // ---------------- Personas ----------------
  teamNameOf(uid) {
    const t = this.pTeams.find((x) => x.members && x.members[uid]);
    return t ? `${t.name} · ${t.members[uid]}` : null;
  }
  roleSelect(current, onChange) {
    return html`<select @change=${(e) => onChange(e.target.value || null)}>
      <option value="" ?selected=${!current}>—</option>
      ${ROLES.map((r) => html`<option value=${r} ?selected=${current === r}>${r}</option>`)}
    </select>`;
  }
  renderPeople() {
    // Reales de ESTA partida (miembros de sus equipos) + invitados pre-registrados en ella.
    const memberIds = this.partidaUserIds();
    const partidaUsers = this.users.filter((u) => memberIds.has(u.id));
    const pInvited = this.pInvited;
    // Usuarios con cuenta que no están en ningún equipo: disponibles para añadir a esta partida.
    const assigned = this.assignedAnywhere();
    const freeUsers = this.users.filter((u) => !assigned.has(u.id));
    // Emails (normalizados) de usuarios reales: para detectar pre-registros redundantes.
    const realNorms = new Set(this.users.map((u) => normalizeEmail(u.email)));
    return html`
      <div class="card stack">
        <h3 style="margin:0">Pre-registrar personas por email</h3>
        <p class="muted" style="margin:0">Pega los correos separados por comas o saltos de línea. Acepta el formato de convocatoria <code>Nombre Apellido &lt;correo&gt;</code> (rellena nombre y email) o solo el correo. Quedan asociadas a <strong>esta partida</strong>; cuando entren con ese correo se asociarán solas a su equipo y rol.</p>
        <textarea id="invEmails" rows="3" placeholder="Ana Pérez &lt;ana@correo.com&gt;, Luis Gil &lt;luis@correo.com&gt;…" style="width:100%"></textarea>
        <div><button class="btn-primary" @click=${() => this.addInvitedEmails()}>+ Añadir personas</button></div>
      </div>
      <div class="card" style="margin-top:12px">
        <table class="t">
          <thead><tr><th></th><th>Nombre</th><th>Email</th><th>Rol real</th><th>Estado</th><th>Equipo</th><th></th></tr></thead>
          <tbody>
            ${partidaUsers.map((u) => html`
              <tr>
                <td>${u.photoURL ? html`<img class="avatar" src=${u.photoURL} referrerpolicy="no-referrer" alt="">` : '👤'}</td>
                <td>${u.name || '—'}</td>
                <td class="muted">${u.email || ''}</td>
                <td>${this.roleSelect(u.defaultRole, (v) => setUserDefaultRole(u.id, v))}</td>
                <td>${u.role === 'admin' ? html`<span class="tag admin">admin</span>` : html`<span class="tag">jugador</span>`}</td>
                <td>${this.teamNameOf(u.id) ? html`<span class="tag">${this.teamNameOf(u.id)}</span>` : html`<span class="muted">sin equipo</span>`}</td>
                <td><button class="btn-sm" @click=${() => this.toggleAdmin(u)}>${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button></td>
              </tr>`)}
            ${pInvited.map((iv) => {
              const dup = realNorms.has(normalizeEmail(iv.email));
              return html`
              <tr>
                <td>✉️</td>
                <td>${iv.name || '—'}</td>
                <td class="muted">${iv.email}</td>
                <td>${this.roleSelect(iv.role, (v) => setInvitedRole(iv.id, v))}</td>
                <td>${dup
                  ? html`<span class="tag" style="background:#5a1d1d;color:#ffd7d7" title="Esta persona ya tiene cuenta con un correo equivalente; este pre-registro sobra">ya tiene cuenta</span>`
                  : html`<span class="tag" style="background:#3a3416;color:#ffe08a">pendiente</span>`}</td>
                <td>${iv.teamId ? html`<span class="tag">${this.pTeams.find((t) => t.id === iv.teamId)?.name || iv.teamId}</span>` : html`<span class="muted">sin equipo</span>`}</td>
                <td><button class="btn-sm btn-danger" @click=${() => this.removeInvited(iv)}>Eliminar</button></td>
              </tr>`;
            })}
          </tbody>
        </table>
        ${partidaUsers.length === 0 && pInvited.length === 0 ? html`<p class="empty-state">Aún no hay personas en esta partida. Pre-regístralas por email arriba.</p>` : ''}
      </div>
      ${freeUsers.length ? html`
        <div class="card stack" style="margin-top:12px">
          <h3 style="margin:0">Con cuenta, sin asignar</h3>
          <p class="muted" style="margin:0">Personas que ya han iniciado sesión pero no están en ningún equipo. No necesitan pre-registro: añádelas directamente a un equipo de esta partida.</p>
          <table class="t">
            <thead><tr><th>Nombre</th><th>Email</th><th></th></tr></thead>
            <tbody>
              ${freeUsers.map((u) => html`
                <tr>
                  <td>${u.name || '—'} ${u.role === 'admin' ? html`<span class="tag admin">admin</span>` : ''}</td>
                  <td class="muted">${u.email || ''}</td>
                  <td><button class="btn-sm btn-primary" @click=${() => this.openAssignToTeam(u)}>➕ Añadir a equipo</button></td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : ''}
      ${this.tableStyles()}
    `;
  }
  /** Modal para asignar un usuario real (con cuenta) a un equipo de la partida con un rol. */
  openAssignToTeam(u) {
    const teams = this.pTeams;
    if (teams.length === 0) return toast('Crea un equipo primero en «Equipos y tableros»', 'warning');
    const wrap = document.createElement('div');
    wrap.innerHTML = `<p class="muted">Añadir a <strong>${u.name || u.email}</strong> a un equipo de esta partida:</p>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:8px';
    const teamSel = document.createElement('select');
    teamSel.innerHTML = teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    const roleSel = document.createElement('select');
    roleSel.innerHTML = ROLES.map((r) => `<option value="${r}" ${r === 'DEV' ? 'selected' : ''}>${r}</option>`).join('');
    row.append(teamSel, roleSel);
    wrap.appendChild(row);
    modal(wrap, {
      title: 'Añadir a un equipo',
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Añadir', variant: 'primary', onClick: async (c) => {
          const t = this.teams.find((x) => x.id === teamSel.value);
          if (t) await assignToTeam(t, u.id, roleSel.value);
          c();
          if (t) toast(`${u.name || u.email} → ${t.name} (${roleSel.value})`, 'success');
        } },
      ],
    });
  }
  /** Parsea "Nombre Apellido <correo>, correo2, ..." -> [{email, name}] (nombre = correo si no hay). */
  parseInvited(raw) {
    const emailRe = /([^\s<>;,]+@[^\s<>;,]+\.[^\s<>;,]+)/;
    const out = [];
    const seen = new Set();
    for (const chunk of String(raw || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
      const m = chunk.match(emailRe);
      if (!m) continue;
      const email = m[1].toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      let name = chunk.replace(m[1], '').replace(/[<>"']/g, '').trim();
      if (!name) name = email;
      out.push({ email, name });
    }
    return out;
  }
  async addInvitedEmails() {
    const raw = this.querySelector('#invEmails').value || '';
    const parsed = this.parseInvited(raw);
    if (parsed.length === 0) return toast('No se reconoció ningún correo válido', 'warning');
    // El pre-registro se indexa por email. Distinguimos: usuario real ya existente,
    // ya pre-registrado en esta partida, ya en otra partida, o nuevo.
    const userByEmail = new Map(this.users.map((u) => [normalizeEmail(u.email), u]));
    const invByEmail = new Map(this.invited.map((i) => [normalizeEmail(i.email), i]));
    let added = 0;
    const haveAccount = []; const inThis = []; const inOther = [];
    for (const { email, name } of parsed) {
      const norm = normalizeEmail(email);
      const u = userByEmail.get(norm);
      const iv = invByEmail.get(norm);
      if (u) { haveAccount.push(u.name || email); continue; }
      if (iv) { (iv.partidaId === this.currentPartidaId ? inThis : inOther).push(name); continue; }
      await addInvited(email, name, this.currentPartidaId); added += 1;
    }
    this.querySelector('#invEmails').value = '';
    const parts = [];
    if (added) parts.push(`${added} pre-registrada(s)`);
    if (haveAccount.length) parts.push(`${haveAccount.length} ya tienen cuenta (${haveAccount.join(', ')}): añádelas a un equipo en «Con cuenta, sin asignar»`);
    if (inThis.length) parts.push(`${inThis.length} ya estaban en esta partida`);
    if (inOther.length) parts.push(`${inOther.length} ya pre-registrada(s) en otra partida`);
    toast(parts.join(' · ') || 'Sin cambios', added ? 'success' : 'info', 8000);
  }
  async removeInvited(iv) {
    if (await confirmDialog(`¿Eliminar el pre-registro de ${iv.email}?`, { title: 'Eliminar pendiente', danger: true })) {
      await deleteInvited(iv.id); toast('Pre-registro eliminado', 'success');
    }
  }
  async toggleAdmin(u) {
    if (u.id === this.me?.uid && u.role === 'admin') {
      const ok = await confirmDialog('¿Quitarte a ti mismo el rol admin? Perderás el acceso a esta página.', { title: 'Cuidado', danger: true });
      if (!ok) return;
    }
    await setUserRole(u.id, u.role === 'admin' ? 'player' : 'admin');
    toast('Rol actualizado', 'success');
  }

  // ---------------- Equipos y tableros ----------------
  renderTeams() {
    if (this.selectedBoard) return this.renderBoardConfig(this.selectedBoard);
    return html`
      <div class="card stack">
        <div class="row">
          <input id="newTeam" type="text" placeholder="Nombre del equipo" style="max-width:280px"
                 @keydown=${(e) => { if (e.key === 'Enter') this.addTeam(); }}>
          <button class="btn-primary" @click=${() => this.addTeam()}>+ Crear equipo</button>
          <span class="muted">·</span>
          <button class="btn" @click=${() => this.demoWithBots()}>🎮 Crear demo con bots</button>
        </div>
        <div class="row" style="gap:8px; align-items:flex-end">
          <span class="muted">o automático:</span>
          <div><label>Nº equipos</label><input id="nTeams" type="number" min="1" .value=${this.suggestTeamCount()} style="width:90px"></div>
          <button class="btn-primary" @click=${() => this.generateTeams()}>🎲 Generar equipos al azar</button>
          <span class="muted">reparte por rol real a quien no esté en un equipo (1 PM · 3 DEV · 2 QA por equipo)</span>
        </div>
        <p class="muted" style="margin:0">Cada equipo se crea con sus dos tableros: uno <strong>sin WIP</strong> y uno <strong>con WIP</strong>. Asigna a las personas una vez por equipo; juegan en ambos.</p>
      </div>
      ${this.pTeams.length === 0 ? html`<p class="empty-state">No hay equipos todavía en esta partida.</p>` : this.pTeams.map((t) => this.renderTeamCard(t))}
      ${this.tableStyles()}
    `;
  }

  /** Lista combinada de miembros del equipo: reales (con uid) + pendientes (invitados). */
  teamMemberList(t) {
    const list = [];
    const members = t.members || {};
    for (const [uid, role] of Object.entries(members)) {
      if (isBotId(uid)) {
        const b = this.bots.find((x) => x.id === uid);
        list.push({ id: uid, name: b?.name || 'Bot', role, bot: true });
      } else {
        const u = this.users.find((x) => x.id === uid);
        list.push({ id: uid, name: u?.name || u?.email || uid, role, invited: false });
      }
    }
    for (const iv of this.invited) {
      if (iv.teamId === t.id) list.push({ id: iv.id, name: iv.name || iv.email, email: iv.email, role: iv.role || 'DEV', invited: true });
    }
    return list;
  }

  renderTeamCard(t) {
    const list = this.teamMemberList(t);
    const counts = ROLES.reduce((a, r) => { a[r] = list.filter((p) => p.role === r).length; return a; }, {});
    const boardNoWip = this.boards.find((b) => b.id === t.boardNoWip);
    const boardWip = this.boards.find((b) => b.id === t.boardWip);
    const open = !!this.expanded[t.id];
    return html`
      <div class="card stack" style="margin-top:12px">
        <div class="flex-between team-head" style="cursor:pointer" @click=${() => this.toggleTeam(t.id)}>
          <h2 style="margin:0">${open ? '▾' : '▸'} 👥 ${t.name}
            <span class="muted" style="font-weight:400; font-size:.82rem">· ${list.length}p · PM ${counts.PM} / DEV ${counts.DEV} / QA ${counts.QA}</span>
          </h2>
          <span class="row" @click=${(e) => e.stopPropagation()}>
            <button class="btn-sm" @click=${() => this.renameTeam(t)}>Renombrar</button>
            <button class="btn-sm btn-danger" @click=${() => this.removeTeam(t)}>Eliminar equipo</button>
          </span>
        </div>
        ${!open ? '' : html`
          <div class="row">
            <span class="tag role-PM">PM: ${counts.PM} <span class="muted">(1)</span></span>
            <span class="tag role-DEV">DEV: ${counts.DEV} <span class="muted">(2-3)</span></span>
            <span class="tag role-QA">QA: ${counts.QA} <span class="muted">(1-2)</span></span>
            <span class="muted">${list.length} personas</span>
          </div>

          <div class="flex-between" style="flex-wrap:wrap; gap:6px">
            <h3 style="margin:6px 0 0">Personas del equipo</h3>
            <span class="row" style="gap:6px">
              <select id="bot-role-${t.id}" title="Rol del bot" style="width:auto; padding:2px 6px">
                ${ROLES.map((r) => html`<option value=${r} ?selected=${r === 'DEV'}>${r}</option>`)}
              </select>
              <button class="btn-sm" @click=${() => this.addBot(t)}>🤖 Añadir bot</button>
              <button class="btn-sm btn-primary" @click=${() => this.openAddPeople(t)}>➕ Añadir personas</button>
            </span>
          </div>
          ${list.length === 0 ? html`<p class="muted" style="margin:0">Sin personas. Pulsa «Añadir personas».</p>` : html`
            <table class="t">
              <thead><tr><th>Persona</th><th>Rol</th><th></th></tr></thead>
              <tbody>
                ${list.map((p) => html`
                  <tr>
                    <td>${p.bot ? '🤖 ' : ''}${p.name} ${p.bot ? html`<span class="tag" style="background:#1f3a2a;color:#9ff0c0">bot</span>` : ''} ${p.invited ? html`<span class="tag" style="background:#3a3416;color:#ffe08a">pendiente</span>` : ''}</td>
                    <td>
                      <select @change=${(e) => this.setMemberRole(t, p, e.target.value)}>
                        ${ROLES.map((r) => html`<option value=${r} ?selected=${p.role === r}>${r}</option>`)}
                      </select>
                    </td>
                    <td><button class="btn-sm btn-danger" @click=${() => this.removeMember(t, p)}>Quitar</button></td>
                  </tr>`)}
              </tbody>
            </table>`}

          <h3 style="margin:6px 0 0">Tableros del equipo</h3>
          ${this.renderTeamBoardRow(boardNoWip, 'sin WIP')}
          ${this.renderTeamBoardRow(boardWip, 'con WIP')}
        `}
      </div>
    `;
  }
  async setMemberRole(t, p, role) {
    if (p.bot) await setBotRole(t, p.id, role);
    else if (p.invited) await setInvitedAssignment(p.id, t.id, role);
    else await assignToTeam(t, p.id, role);
    toast(`${p.name} → ${role}`, 'success');
  }
  async removeMember(t, p) {
    if (p.bot) await removeBotFromTeam(t, p.id);
    else if (p.invited) await setInvitedAssignment(p.id, null, null);
    else await unassignFromTeam(t, p.id);
    toast(`${p.name} fuera del equipo`, 'info');
  }
  async addBot(t) {
    const role = this.querySelector(`#bot-role-${t.id}`)?.value || 'DEV';
    const n = this.teamMemberList(t).filter((p) => p.bot && p.role === role).length + 1;
    await addBotToTeam(t, role, `Bot ${role} ${n}`);
    toast(`Bot ${role} añadido`, 'success');
  }
  openAddPeople(t) {
    // Candidatos: invitados de ESTA partida sin equipo + usuarios reales libres (sin equipo en ninguna partida).
    // Se excluyen los pendientes que ya tienen cuenta real (mismo email normalizado): evita duplicados.
    const assigned = this.assignedAnywhere();
    const realNorms = new Set(this.users.map((u) => normalizeEmail(u.email)));
    const roleOrder = { PM: 0, DEV: 1, QA: 2, '': 3 };
    const cands = [
      ...this.users.filter((u) => !assigned.has(u.id)).map((u) => ({ id: u.id, label: u.name || u.email, sub: (u.name && u.email) ? u.email : '', invited: false, role: u.defaultRole || '' })),
      ...this.pInvited.filter((iv) => !iv.teamId && !realNorms.has(normalizeEmail(iv.email))).map((iv) => ({ id: iv.id, label: iv.name || iv.email, sub: iv.email, invited: true, role: iv.role || '' })),
    ].sort((a, b) => (roleOrder[a.role] - roleOrder[b.role]) || a.label.localeCompare(b.label));
    const wrap = document.createElement('div');
    if (cands.length === 0) {
      wrap.innerHTML = '<p class="muted">No hay más personas disponibles. Pre-registra correos en la pestaña «Personas».</p>';
    }
    const roleChip = (role) => role
      ? `<span class="tag role-${role}" style="font-size:.72rem">${role}</span>`
      : '<span style="opacity:.5;font-size:.72rem">sin rol</span>';
    for (const c of cands) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:5px 0;cursor:pointer';
      row.innerHTML = `<input type="checkbox" data-id="${c.id}" data-inv="${c.invited ? 1 : 0}" data-role="${c.role}"> ${roleChip(c.role)} <span>${c.label}${c.sub ? ` <span style="opacity:.6">${c.sub}</span>` : ''}${c.invited ? ' <span style="background:#3a3416;color:#ffe08a;border-radius:999px;padding:1px 8px;font-size:.7rem">pendiente</span>' : ''}</span>`;
      wrap.appendChild(row);
    }
    modal(wrap, {
      title: `Añadir personas a ${t.name}`,
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Añadir seleccionadas', variant: 'primary', onClick: async (c) => {
          const checks = [...wrap.querySelectorAll('input[type=checkbox]:checked')];
          for (const ch of checks) {
            const role = ch.dataset.role || 'DEV';
            if (ch.dataset.inv === '1') await setInvitedAssignment(ch.dataset.id, t.id, role);
            else await assignToTeam(t, ch.dataset.id, role);
          }
          c();
          toast(`${checks.length} persona(s) añadida(s)`, 'success');
        } },
      ],
    });
  }

  renderTeamBoardRow(b, label) {
    if (!b) return html`<p class="muted">Falta el tablero «${label}» (equipo creado con una versión anterior; recréalo).</p>`;
    return html`
      <div class="flex-between" style="border-bottom:1px solid var(--c-border); padding:6px 0">
        <span>🧩 <strong>${b.name}</strong> <span class="tag ${b.mode === 'wip' ? 'role-QA' : ''}">${label}</span>
          <span class="muted">· ${b.status || 'setup'}${b.round ? ` · ronda ${b.round}` : ''}</span></span>
        <span class="row">
          <button class="btn-sm" @click=${() => this.renameBoardPrompt(b)}>Renombrar</button>
          <button class="btn-sm" @click=${() => { this.selectedBoard = b; }}>⚙ Columnas${b.mode === 'wip' ? ' y WIP' : ''}</button>
          <a class="btn btn-sm" href="/board?id=${b.id}">▶ Abrir</a>
          <a class="btn btn-sm" href="/results?id=${b.id}">📊</a>
        </span>
      </div>
    `;
  }

  async addTeam() {
    const input = this.querySelector('#newTeam');
    const name = input.value.trim();
    if (!name) return toast('Escribe un nombre', 'warning');
    await createTeam(name, this.me?.uid, this.currentPartidaId);
    input.value = '';
    toast('Equipo y sus 2 tableros creados', 'success');
  }
  /** Crea una demo: equipo de bots con todos los roles, inicia su partida y abre el tablero. */
  async demoWithBots() {
    const ok = await confirmDialog('¿Crear una demo con bots (1 PM, 3 DEV, 1 QA), iniciarla y abrir el tablero para verla jugar sola?', { title: 'Crear demo con bots' });
    if (!ok) return;
    const team = await createTeam(`Demo ${this.pTeams.length + 1}`, this.me?.uid, this.currentPartidaId);
    await addBotToTeam(team, 'PM', 'Bot PM');
    await addBotToTeam(team, 'DEV', 'Bot Dev 1');
    await addBotToTeam(team, 'DEV', 'Bot Dev 2');
    await addBotToTeam(team, 'DEV', 'Bot Dev 3');
    await addBotToTeam(team, 'QA', 'Bot QA');
    const board = await getBoard(team.boardNoWip);
    await startGame(board, {
      wipEnabled: false,
      rondas: this.session?.rondas ?? 3,
      ciclos: this.session?.ciclos ?? 5,
      timeLimitMinutes: this.session?.timeLimitMinutes ?? null,
    });
    toast('Demo creada, ¡a jugar!', 'success');
    location.href = `/board?id=${team.boardNoWip}`;
  }
  /** Personas con rol real disponibles para esta partida (invitados de la partida + reales libres). */
  unassignedPeople() {
    const assigned = this.assignedAnywhere();
    const people = [];
    this.users.forEach((u) => { if (u.defaultRole && !assigned.has(u.id)) people.push({ id: u.id, role: u.defaultRole, invited: false, name: u.name || u.email }); });
    this.pInvited.forEach((iv) => { if (iv.role && !iv.teamId) people.push({ id: iv.id, role: iv.role, invited: true, name: iv.name || iv.email }); });
    return people;
  }
  suggestTeamCount() {
    return Math.max(1, this.unassignedPeople().filter((p) => p.role === 'PM').length);
  }
  /** Cuenta de personas de un equipo: reales (logadas) + pendientes (pre-registradas). */
  teamCounts(teamId) {
    const t = this.teams.find((x) => x.id === teamId);
    const real = t?.members ? Object.keys(t.members).length : 0;
    const pend = this.invited.filter((iv) => iv.teamId === teamId).length;
    return { real, pend, total: real + pend };
  }
  async generateTeams() {
    const nTeams = Math.max(1, Number(this.querySelector('#nTeams')?.value) || 1);
    const people = this.unassignedPeople();
    if (people.length === 0) return toast('No hay personas con rol real sin asignar. Ponles el rol en la pestaña Personas.', 'warning', 6000);
    const byRole = { PM: [], DEV: [], QA: [] };
    people.forEach((p) => { if (byRole[p.role]) byRole[p.role].push(p); });
    const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
    shuffle(byRole.PM); shuffle(byRole.DEV); shuffle(byRole.QA);
    const slots = Array.from({ length: nTeams }, () => ({ PM: [], DEV: [], QA: [] }));
    const leftovers = [];
    const place = (list, role, cap) => {
      let ti = 0;
      for (const p of list) {
        let placed = false;
        for (let k = 0; k < nTeams; k++) { const idx = (ti + k) % nTeams; if (slots[idx][role].length < cap) { slots[idx][role].push(p); ti = idx + 1; placed = true; break; } }
        if (!placed) leftovers.push(p);
      }
    };
    place(byRole.PM, 'PM', 1); place(byRole.DEV, 'DEV', 3); place(byRole.QA, 'QA', 2);
    const assignedCount = people.length - leftovers.length;
    const ok = await confirmDialog(`Se crearán ${nTeams} equipo(s) y se repartirán ${assignedCount} persona(s).${leftovers.length ? ` ${leftovers.length} quedarán sin asignar (las pones a mano).` : ''} ¿Continuar?`, { title: 'Generar equipos' });
    if (!ok) return;
    const base = this.pTeams.length;
    for (let i = 0; i < nTeams; i++) {
      const team = await createTeam(`Equipo ${base + i + 1}`, this.me?.uid, this.currentPartidaId);
      for (const role of ROLES) {
        for (const p of slots[i][role]) {
          if (p.invited) await setInvitedAssignment(p.id, team.id, role);
          else await assignToTeam(team, p.id, role);
        }
      }
    }
    toast(`${nTeams} equipo(s) generados${leftovers.length ? `, ${leftovers.length} sin asignar` : ''}`, 'success');
  }
  async renameTeam(t) {
    const name = await promptDialog('Nuevo nombre del equipo', { title: 'Renombrar equipo', value: t.name });
    if (!name) return;
    await renameTeam(t.id, name);
    // Renombrar también sus tableros (el renombrado del equipo cascada a los tableros).
    if (t.boardNoWip) await renameBoard(t.boardNoWip, `${name} · sin WIP`);
    if (t.boardWip) await renameBoard(t.boardWip, `${name} · con WIP`);
    toast('Equipo y tableros renombrados', 'success');
  }
  async removeTeam(t) {
    if (await confirmDialog(`¿Eliminar el equipo "${t.name}" y sus 2 tableros (con partidas y resultados)?`, { title: 'Eliminar equipo', danger: true })) {
      await deleteTeam(t); toast('Equipo eliminado', 'success');
    }
  }
  async renameBoardPrompt(b) {
    const name = await promptDialog('Nuevo nombre del tablero', { title: 'Renombrar tablero', value: b.name });
    if (name) { await renameBoard(b.id, name); toast('Tablero renombrado', 'success'); }
  }

  // ---------------- Configuración de columnas de un tablero ----------------
  renderBoardConfig(b) {
    const isWip = b.mode === 'wip';
    const cols = Object.entries(b.columns || {})
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, c) => (a.order ?? 0) - (c.order ?? 0));
    return html`
      <div class="card stack">
        <div class="flex-between">
          <h2 style="margin:0">⚙ ${b.name} <span class="tag ${isWip ? 'role-QA' : ''}">${isWip ? 'con WIP' : 'sin WIP'}</span></h2>
          <button @click=${() => { this.selectedBoard = null; }}>← Volver</button>
        </div>
        <h3 style="margin:8px 0 0">Columnas${isWip ? ' y límites WIP' : ''}</h3>
        ${isWip
          ? html`<p class="muted" style="margin:0">Vacío = sin límite. Backlog y Done no se limitan nunca.</p>`
          : html`<p class="muted" style="margin:0">Este tablero es <strong>sin WIP</strong>: las columnas no tienen límite.</p>`}
        <div id="colEditor" class="stack">
          ${cols.map((c, i) => html`
            <div class="row col-row" data-id=${c.id}>
              <span class="muted" style="width:24px">${i + 1}</span>
              <input class="c-name" type="text" .value=${c.name} style="max-width:240px">
              ${isWip ? html`<label style="margin:0">WIP</label><input class="c-wip" type="number" min="0" .value=${c.wipLimit ?? ''} placeholder="∞" style="width:80px">` : ''}
              <button class="btn-sm" @click=${() => this.moveCol(cols, i, -1)} ?disabled=${i === 0}>↑</button>
              <button class="btn-sm" @click=${() => this.moveCol(cols, i, 1)} ?disabled=${i === cols.length - 1}>↓</button>
              <button class="btn-sm btn-danger" @click=${() => this.deleteCol(cols, i)} ?disabled=${cols.length <= 5}>✕</button>
            </div>`)}
        </div>
        <div class="row">
          <button class="btn-sm" @click=${() => this.addCol(cols)}>+ Añadir columna</button>
          <button class="btn-primary" @click=${() => this.saveCols(b)}>💾 Guardar columnas</button>
          <button class="btn-sm" @click=${() => this.resetCols(b)}>Restaurar 7 por defecto</button>
        </div>
        <p class="muted" style="margin:0">El inicio de rondas se hace desde la pestaña <strong>Facilitador</strong>.</p>
      </div>
      ${this.tableStyles()}
    `;
  }

  // edición de columnas (en memoria hasta "Guardar")
  readColsFromDom() {
    return Array.from(this.querySelectorAll('.col-row')).map((row) => {
      const wipEl = row.querySelector('.c-wip');
      const wip = wipEl ? wipEl.value.trim() : '';
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
      const cols = b.mode === 'wip' ? defaultColumns() : defaultColumns().map((c) => ({ ...c, wipLimit: null }));
      await setBoardColumns(b.id, cols);
      toast('Columnas restauradas', 'success');
    }
  }

  // ---------------- Facilitador (control central) ----------------
  renderFacilitator() {
    const mode = this.session?.mode || 'nowip';
    const modeBoards = this.pBoards.filter((b) => b.mode === mode);
    const anyPlaying = modeBoards.some((b) => b.status === 'playing');
    const rondas = this.session?.rondas ?? 3;
    const ciclos = this.session?.ciclos ?? 5;
    const teamless = modeBoards.filter((b) => !this.teams.find((t) => t.id === b.teamId));
    const emptyTeams = modeBoards.filter((b) => this.teamCounts(b.teamId).total === 0);
    const anyPending = modeBoards.some((b) => this.teamCounts(b.teamId).pend > 0);
    const blocked = teamless.length > 0 || emptyTeams.length > 0;
    return html`
      <div class="card stack">
        <h2 style="margin:0">🎛 Facilitador</h2>
        <div class="row" style="gap:8px">
          <label style="margin:0">Modo activo:</label>
          <button class=${mode === 'nowip' ? 'btn-primary' : ''} @click=${() => this.setMode('nowip')}>Sin WIP</button>
          <button class=${mode === 'wip' ? 'btn-primary' : ''} @click=${() => this.setMode('wip')}>Con WIP</button>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; align-items:flex-end">
          <div><label>Rondas</label><input id="sessRondas" type="number" min="1" .value=${rondas} style="width:80px"></div>
          <div><label>Ciclos por ronda</label><input id="sessCiclos" type="number" min="1" .value=${ciclos} style="width:120px"></div>
          <div><label>Tiempo máx. partida (min)</label><input id="sessTime" type="number" min="0" .value=${this.session?.timeLimitMinutes ?? ''} placeholder="sin límite" style="width:150px"></div>
          <label style="margin:0"><input id="sessPause" type="checkbox" ?checked=${this.session?.pauseBetweenRounds}> Parar entre rondas</label>
          <button class="btn-sm" @click=${() => this.saveSessionConfig()}>💾 Guardar</button>
          <span class="muted">Total: ${rondas * ciclos} ciclos. Igual en ambos modos.</span>
        </div>

        <h3 style="margin:6px 0 0">Tableros del modo ${mode === 'wip' ? 'CON WIP' : 'SIN WIP'} (${modeBoards.length})</h3>
        ${modeBoards.length === 0 ? html`<p class="muted">No hay tableros. Crea equipos en la pestaña «Equipos y tableros».</p>` : html`
          <table class="t">
            <thead><tr><th>Equipo</th><th>Personas</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${modeBoards.map((b) => {
                const team = this.teams.find((t) => t.id === b.teamId);
                const c = this.teamCounts(b.teamId);
                return html`<tr>
                  <td>${team?.name || '—'}
                    ${c.total === 0 ? html`<span class="tag bad">sin personas</span>` : ''}
                    ${c.total > 0 && c.real === 0 ? html`<span class="tag" style="background:#3a3416;color:#ffe08a">todos pendientes</span>` : ''}
                  </td>
                  <td>${c.total}${c.pend ? html` <span class="muted">(${c.pend} pend.)</span>` : ''}</td>
                  <td>${b.status || 'setup'}</td>
                  <td><a class="btn btn-sm" href="/board?id=${b.id}">▶ Abrir</a> <a class="btn btn-sm" href="/results?id=${b.id}">📊</a></td>
                </tr>`;
              })}
            </tbody>
          </table>`}

        ${blocked ? html`<p class="bad" style="margin:0">⚠ No se puede iniciar: hay equipos sin nadie asignado o tableros sin equipo. Corrígelo en «Equipos y tableros».</p>` : ''}
        ${!blocked && anyPending ? html`<p class="muted" style="margin:0">ℹ️ Hay personas <strong>pendientes</strong> (pre-registradas) que aún no han iniciado sesión: no podrán jugar su rol hasta que entren con su correo.</p>` : ''}
        <div class="row" style="gap:10px; align-items:center">
          <button class="btn-primary btn-lg" ?disabled=${modeBoards.length === 0 || anyPlaying || blocked} @click=${() => this.startPartida()}>
            ▶ Iniciar partida ${mode === 'wip' ? 'con WIP' : 'sin WIP'} (${rondas}×${ciclos}) en todos
          </button>
          ${anyPlaying ? html`<span class="muted">Hay partidas en curso; espera a que terminen.</span>` : ''}
        </div>
        <p class="muted" style="margin:0">Juega primero <strong>Sin WIP</strong> y luego <strong>Con WIP</strong> con la misma configuración. Durante la partida, el moderador puede añadir rondas o cambiar el WIP desde cada tablero.</p>
      </div>
      ${this.me?.isAdmin ? this.renderCoFacilitators() : ''}
      ${this.tableStyles()}
    `;
  }
  renderCoFacilitators() {
    const facSet = new Set(this.facilitators);
    // Co-facilitadores actuales: reales con el flag (los admin facilitan siempre, no se listan).
    const current = this.users.filter((u) => facSet.has(u.id) && u.role !== 'admin');
    return html`
      <div class="card stack" style="margin-top:12px">
        <div class="flex-between" style="flex-wrap:wrap; gap:6px">
          <h3 style="margin:0">Co-facilitadores de esta partida</h3>
          <button class="btn-sm btn-primary" @click=${() => this.openAddFacilitator()}>➕ Añadir co-facilitador</button>
        </div>
        <p class="muted" style="margin:0">Pueden moderar los tableros de esta partida (forzar pasos, WIP, rondas, roles) y ven solo esta partida, no las demás. Quítalos al terminar la sesión.</p>
        <p class="muted" style="margin:0">ℹ️ Por seguridad, un co-facilitador debe <strong>haber entrado con Google al menos una vez</strong> (no hace falta que tenga equipo). En cuanto entre, aparecerá aquí para marcarlo.</p>
        ${current.length === 0 ? html`<p class="muted" style="margin:0">Aún no hay co-facilitadores. Pulsa «Añadir co-facilitador».</p>` : html`
        <table class="t">
          <thead><tr><th>Persona</th><th></th></tr></thead>
          <tbody>
            ${current.map((u) => html`
              <tr>
                <td>${u.name || u.email} ${this.teamNameOf(u.id) ? html`<span class="tag">${this.teamNameOf(u.id)}</span>` : html`<span class="muted" style="font-size:.78rem">no juega</span>`}</td>
                <td><button class="btn-sm btn-danger" @click=${() => this.toggleFacilitator(u, false)}>Quitar</button></td>
              </tr>`)}
          </tbody>
        </table>`}
      </div>`;
  }
  /** Modal para nombrar co-facilitadores: personas que ya han iniciado sesión (libres o de la partida). */
  openAddFacilitator() {
    const facSet = new Set(this.facilitators);
    const assigned = this.assignedAnywhere();
    const memberIds = this.partidaUserIds();
    const cands = this.users
      .filter((u) => u.role !== 'admin' && !facSet.has(u.id) && (memberIds.has(u.id) || !assigned.has(u.id)))
      .map((u) => ({
        id: u.id,
        label: u.name || u.email,
        sub: (u.name && u.email) ? u.email : '',
        free: !memberIds.has(u.id),
      }))
      .sort((a, b) => (Number(b.free) - Number(a.free)) || a.label.localeCompare(b.label));
    const wrap = document.createElement('div');
    if (cands.length === 0) {
      wrap.innerHTML = '<p class="muted">No hay personas disponibles. El co-facilitador debe entrar con Google una vez (un clic, sin necesidad de equipo) y entonces aparecerá aquí. Los pre-registrados por email que aún no han entrado no pueden serlo todavía.</p>';
    }
    for (const c of cands) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:5px 0;cursor:pointer';
      const chip = c.free
        ? '<span style="background:#26324a;color:#bcd3ff;border-radius:999px;padding:1px 8px;font-size:.7rem">sin rol asignado</span>'
        : '<span style="background:#1f3a2a;color:#9ff0c0;border-radius:999px;padding:1px 8px;font-size:.7rem">juega aquí</span>';
      row.innerHTML = `<input type="checkbox" data-id="${c.id}"> ${chip} <span>${c.label}${c.sub ? ` <span style="opacity:.6">${c.sub}</span>` : ''}</span>`;
      wrap.appendChild(row);
    }
    modal(wrap, {
      title: 'Añadir co-facilitadores',
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Añadir seleccionadas', variant: 'primary', onClick: async (c) => {
          const checks = [...wrap.querySelectorAll('input[type=checkbox]:checked')];
          for (const ch of checks) await setPartidaFacilitator(this.currentPartidaId, ch.dataset.id, true);
          c();
          if (checks.length) toast(`${checks.length} co-facilitador(es) añadido(s)`, 'success');
        } },
      ],
    });
  }
  async toggleFacilitator(u, on) {
    await setPartidaFacilitator(this.currentPartidaId, u.id, on);
    toast(on ? `${u.name || u.email} es co-facilitador` : `${u.name || u.email} ya no es co-facilitador`, 'success');
  }
  async setMode(mode) { await updatePartidaSession(this.currentPartidaId, { mode }); }
  async saveSessionConfig() {
    const rondas = Math.max(1, Number(this.querySelector('#sessRondas').value) || 1);
    const ciclos = Math.max(1, Number(this.querySelector('#sessCiclos').value) || 1);
    const tv = this.querySelector('#sessTime').value.trim();
    const timeLimitMinutes = tv === '' ? null : Math.max(0, Number(tv)) || null;
    const pauseBetweenRounds = this.querySelector('#sessPause')?.checked || false;
    await updatePartidaSession(this.currentPartidaId, { rondas, ciclos, timeLimitMinutes, pauseBetweenRounds });
    toast(`Configuración: ${rondas} rondas × ${ciclos} ciclos`, 'success');
  }
  async startPartida() {
    const mode = this.session?.mode || 'nowip';
    const modeBoards = this.pBoards.filter((b) => b.mode === mode);
    if (modeBoards.length === 0) return toast('No hay tableros de este modo', 'warning');
    const problems = [];
    for (const b of modeBoards) {
      const team = this.teams.find((t) => t.id === b.teamId);
      if (!team) problems.push(`"${b.name}" sin equipo`);
      else if (this.teamCounts(b.teamId).total === 0) problems.push(`Equipo "${team.name}" sin nadie asignado`);
    }
    if (problems.length) return toast('No se puede iniciar: ' + problems.join('; '), 'error', 6000);
    if (modeBoards.some((b) => b.status === 'playing')) return toast('Hay partidas en curso.', 'warning');
    const rondas = this.session?.rondas ?? 3;
    const ciclos = this.session?.ciclos ?? 5;
    const ok = await confirmDialog(`¿Iniciar la partida ${mode === 'wip' ? 'con WIP' : 'sin WIP'} (${rondas}×${ciclos} = ${rondas * ciclos} ciclos) en ${modeBoards.length} tablero(s)?`, { title: 'Iniciar partida' });
    if (!ok) return;
    await startPartidaForBoards(modeBoards, mode, { rondas, ciclos, timeLimitMinutes: this.session?.timeLimitMinutes ?? null, pauseBetweenRounds: this.session?.pauseBetweenRounds || false });
    // Con un único tablero (típico en demos) abre directamente; con varios, deja la tabla con «Abrir».
    if (modeBoards.length === 1) { location.href = `/board?id=${modeBoards[0].id}`; return; }
    toast(`Partida iniciada en ${modeBoards.length} tablero(s). Pulsa «Abrir» en cada uno para verlos.`, 'success', 5000);
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
      .tag.bad { background: #5a1d1d; color: #ffd7d7; }
      p.bad { color: var(--c-warning); }
    </style>`;
  }
}

customElements.define('kbg-admin', AdminPanel);
