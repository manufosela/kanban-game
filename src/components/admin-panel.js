import { LitElement, html } from 'lit';
import {
  watchUsers, watchTeams, watchBoards, watchInvited, watchBots,
  setUserRole, setUserStatus, createTeam, renameTeam, deleteTeam,
  renameBoard, setBoardColumns, setColumnWip, assignToTeam, unassignFromTeam,
  addInvited, deleteInvited, setInvitedAssignment, setInvitedFacilitator, normalizeEmail,
  setUserDefaultRole, setInvitedRole,
  isBotId, addBotToTeam, removeBotFromTeam, setBotRole, getBoard, removeUser,
  watchPartidas, createPartida, renamePartida, deletePartida,
  watchPartidaSession, updatePartidaSession,
  watchPartidaFacilitators, setPartidaFacilitator, findUserPartida,
  migrateLegacyToPartida1, setTeamBacklog,
} from '../lib/db.js';
import { startPartidaForBoards, startGame } from '../lib/game.js';
import { defaultColumns, suggestedWipByAnchor, anchors, orderedColumns } from '../lib/rules.js';
import { BACKLOGS, backlogOptions } from '../lib/backlogs.js';
import { planByRole, teamRoleCounts } from '../lib/teams.js';
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
    let savedTab = null;
    try { savedTab = localStorage.getItem('kbg.adminTab'); } catch { /* ignore */ }
    const validTab = ['people', 'teams', 'facilitator'].includes(savedTab) ? savedTab : 'people';
    this.tab = this.me?.facilitatorOnly ? 'facilitator' : validTab;
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
  // Pre-registrados de ESTA partida. Los "libres" (sin partida, p.ej. de una borrada) no se
  // muestran aquí para no ensuciar; vuelven a asociarse si re-registras su email.
  get pInvited() { return this.invited.filter((iv) => iv.partidaId === this.currentPartidaId); }
  /** uids reales que son miembros de algún equipo de la partida activa. */
  partidaUserIds() {
    const s = new Set();
    this.pTeams.forEach((t) => Object.keys(t.members || {}).forEach((u) => { if (!isBotId(u)) s.add(u); }));
    return s;
  }
  /** Personas (no bots) que YA están en algún equipo de CUALQUIER partida. Se usa como filtro
   *  de "libres": quien ya está colocado en otra partida no aparece como disponible aquí, así
   *  una partida recién creada sale vacía. Para meter a alguien que ya está en otra, primero
   *  hay que liberarlo (quitarlo de su equipo) o usar su login. */
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
      if (facOnly) return html`${this.renderPendingApprovals()}<div class="card"><p class="muted">No tienes ninguna partida asignada como co-facilitador. Pide a un administrador que te asigne a una.</p></div>`;
      return html`${this.renderPendingApprovals()}${this.renderPartidas()}`;
    }
    const p = this.currentPartida();
    const tab = facOnly ? 'facilitator' : this.tab;
    return html`
      <div class="flex-between" style="flex-wrap:wrap; gap:8px">
        <h1 style="margin:0">${facOnly ? '🎛 Facilitador' : '🗂 '}${p ? p.name : 'Partida'}
          ${p?.isDemo ? html`<span class="tag" style="background:#1f3a2a;color:#9ff0c0">demo</span>` : ''}</h1>
        ${facOnly ? '' : html`<button @click=${() => this.leavePartida()}>← Todas las partidas</button>`}
      </div>
      ${this.renderPendingApprovals()}
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

  /** Aviso de usuarios en standby (dominio no autorizado) pendientes de aprobación. */
  renderPendingApprovals() {
    const pending = (this.users || []).filter((u) => u.status === 'pending');
    if (pending.length === 0) return '';
    return html`
      <div class="card stack" style="margin:12px 0; border:1px solid var(--c-warning)">
        <h3 style="margin:0">⏳ Accesos pendientes (${pending.length})</h3>
        <p class="muted" style="margin:0">Cuentas fuera del dominio autorizado, en espera. Acéptalas para que puedan entrar.</p>
        <table class="t">
          <tbody>
            ${pending.map((u) => html`<tr>
              <td>${u.name || '—'}</td>
              <td class="muted">${u.email || ''}</td>
              <td style="text-align:right; white-space:nowrap">
                <button class="btn-sm btn-primary" @click=${() => this.approveUser(u)}>✓ Aceptar</button>
                <button class="btn-sm" @click=${() => this.rejectUser(u)}>✕ Rechazar</button>
              </td>
            </tr>`)}
          </tbody>
        </table>
      </div>`;
  }
  async approveUser(u) {
    await setUserStatus(u.id, 'active');
    toast(`${u.name || u.email} aceptado`, 'success');
  }
  async rejectUser(u) {
    const ok = await confirmDialog(`¿Rechazar y eliminar a ${u.name || u.email}?`, { title: 'Rechazar acceso' });
    if (!ok) return;
    await removeUser(u.id);
    toast('Acceso rechazado', 'success');
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
          <button class="btn" @click=${() => this.createDemoPartida()}>🤖 Partida con bots (sin iniciar)</button>
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
    const ok = await confirmDialog('¿Crear una partida con un equipo de bots (1 PM, 3 DEV, 1 QA)? NO se inicia: entras en ella y la arrancas tú desde la pestaña Facilitador cuando quieras.', { title: 'Partida con bots' });
    if (!ok) return;
    const n = this.partidas.filter((p) => p.isDemo).length + 1;
    const pid = await createPartida(`Demo ${n}`, this.me?.uid, true);
    const team = await createTeam('Equipo bots', this.me?.uid, pid);
    await addBotToTeam(team, 'PM', 'Bot PM');
    await addBotToTeam(team, 'DEV', 'Bot Dev 1');
    await addBotToTeam(team, 'DEV', 'Bot Dev 2');
    await addBotToTeam(team, 'DEV', 'Bot Dev 3');
    await addBotToTeam(team, 'QA', 'Bot QA');
    await setTeamBacklog(team.id, BACKLOGS[0].id); // proyecto con títulos reales
    toast('Partida con bots creada. Inícialo desde la pestaña Facilitador cuando quieras.', 'success', 6000);
    this.enterPartida(pid);
  }

  _tab(id, label) {
    return html`<button class=${this.tab === id ? 'btn-primary' : ''} @click=${() => this.selectTab(id)}>${label}</button>`;
  }
  selectTab(id) {
    this.tab = id;
    try { localStorage.setItem('kbg.adminTab', id); } catch { /* ignore */ }
  }

  // ---------------- Personas ----------------
  teamNameOf(uid) {
    const t = this.pTeams.find((x) => x.members && x.members[uid]);
    return t ? `${t.name} · ${t.members[uid]}` : null;
  }
  /** Construye la lista unificada de personas de la partida (miembros + pendientes + libres con cuenta). */
  peopleRows() {
    const memberIds = this.partidaUserIds();
    const assigned = this.assignedAnywhere();
    const realNorms = new Set(this.users.map((u) => normalizeEmail(u.email)));
    const teamOf = (uid) => this.pTeams.find((t) => t.members && t.members[uid] != null);
    const rows = [];
    this.users.filter((u) => memberIds.has(u.id)).forEach((u) => {
      const t = teamOf(u.id);
      rows.push({ kind: 'member', id: u.id, name: u.name || u.email, email: u.email, photoURL: u.photoURL, role: (t && t.members[u.id]) || '', team: t, isAdmin: u.role === 'admin' });
    });
    this.pInvited.forEach((iv) => {
      // Oculta pre-registros que ya tienen cuenta real equivalente (el real ya aparece).
      if (realNorms.has(normalizeEmail(iv.email))) return;
      rows.push({ kind: 'invited', id: iv.id, name: iv.name || iv.email, email: iv.email, role: iv.role || '', teamId: iv.teamId });
    });
    this.users.filter((u) => !assigned.has(u.id)).forEach((u) => {
      rows.push({ kind: 'free', id: u.id, name: u.name || u.email, email: u.email, photoURL: u.photoURL, role: u.defaultRole || '', isAdmin: u.role === 'admin' });
    });
    return rows;
  }
  renderPeople() {
    const rows = this.peopleRows();
    return html`
      <div class="card stack">
        <h3 style="margin:0">Pre-registrar personas por email</h3>
        <p class="muted" style="margin:0">Pega los correos separados por comas o saltos de línea. Acepta el formato de convocatoria <code>Nombre Apellido &lt;correo&gt;</code> (rellena nombre y email) o solo el correo. Quedan asociadas a <strong>esta partida</strong>; cuando entren con ese correo se asociarán solas a su equipo y rol.</p>
        <textarea id="invEmails" rows="3" placeholder="Ana Pérez &lt;ana@correo.com&gt;, Luis Gil &lt;luis@correo.com&gt;…" style="width:100%"></textarea>
        <div><button class="btn-primary" @click=${() => this.addInvitedEmails()}>+ Añadir personas</button></div>
      </div>
      <div class="card" style="margin-top:12px">
        <p class="muted" style="margin:0 0 8px">Personas de esta partida. Asigna <strong>rol</strong> y <strong>equipo</strong> a cada una. <em>Pendiente</em> = aún no ha entrado; <em>con cuenta</em> = ya ha entrado; <em>ya tiene cuenta</em> = pre-registro que sobra (elimínalo).</p>
        <table class="t">
          <thead><tr><th></th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Equipo</th><th></th></tr></thead>
          <tbody>
            ${rows.length === 0 ? html`<tr><td colspan="7"><span class="muted">Aún no hay personas. Pre-regístralas por email arriba o pídeles que entren con Google.</span></td></tr>` : ''}
            ${rows.map((r) => this.renderPersonRow(r))}
          </tbody>
        </table>
      </div>
      ${this.tableStyles()}
    `;
  }
  renderPersonRow(r) {
    const icon = r.kind === 'invited' ? '✉️' : (r.photoURL ? html`<img class="avatar" src=${r.photoURL} referrerpolicy="no-referrer" alt="">` : '👤');
    const estado = r.kind === 'member'
      ? (r.isAdmin ? html`<span class="tag admin">admin</span>` : html`<span class="tag" style="background:#1f3a2a;color:#9ff0c0">en equipo</span>`)
      : r.kind === 'free'
        ? (r.isAdmin ? html`<span class="tag admin">admin</span>` : html`<span class="tag">con cuenta</span>`)
        : html`<span class="tag" style="background:#3a3416;color:#ffe08a">pendiente</span>`;
    let teamCell;
    if (r.kind === 'member') {
      teamCell = html`<span class="tag">${r.team?.name || '—'}</span> <button class="btn-sm btn-danger" @click=${() => this.removeFromTeam(r)}>Quitar</button>`;
    } else if (r.kind === 'invited' && r.teamId) {
      teamCell = html`<span class="tag">${this.pTeams.find((t) => t.id === r.teamId)?.name || r.teamId}</span> <button class="btn-sm" @click=${() => setInvitedAssignment(r.id, null, r.role || null)}>Quitar</button>`;
    } else {
      teamCell = html`<button class="btn-sm btn-primary" @click=${() => this.openAssignToTeam(r)}>➕ Añadir a equipo</button>`;
    }
    const action = r.kind === 'invited'
      ? html`<button class="btn-sm btn-danger" @click=${() => this.removeInvited({ id: r.id, email: r.email })}>Eliminar</button>`
      : html`
        <button class="btn-sm" @click=${() => this.toggleAdmin({ id: r.id, role: r.isAdmin ? 'admin' : 'player', name: r.name, email: r.email })}>${r.isAdmin ? 'Quitar admin' : 'Hacer admin'}</button>
        ${r.id === this.me?.uid ? '' : html`<button class="btn-sm btn-danger" @click=${() => this.expelUser(r)}>Expulsar</button>`}`;
    return html`
      <tr>
        <td>${icon}</td>
        <td>${r.name || '—'}</td>
        <td class="muted">${r.email || ''}</td>
        <td>${this.personRoleSelect(r)}</td>
        <td>${estado}</td>
        <td>${teamCell}</td>
        <td>${action}</td>
      </tr>`;
  }
  personRoleSelect(r) {
    return html`<select @change=${(e) => this.setRowRole(r, e.target.value || null)}>
      <option value="" ?selected=${!r.role}>—</option>
      ${ROLES.map((role) => html`<option value=${role} ?selected=${r.role === role}>${role}</option>`)}
    </select>`;
  }
  async setRowRole(r, role) {
    if (r.kind === 'member') {
      if (!role || !r.team) return; // un miembro siempre conserva un rol
      await assignToTeam(r.team, r.id, role);
    } else if (r.kind === 'invited') {
      if (r.teamId) await setInvitedAssignment(r.id, r.teamId, role);
      else await setInvitedRole(r.id, role);
    } else {
      await setUserDefaultRole(r.id, role);
    }
  }
  async removeFromTeam(r) {
    await unassignFromTeam(r.team, r.id);
    toast(`${r.name} fuera del equipo`, 'info');
  }
  async expelUser(r) {
    const ok = await confirmDialog(`¿Expulsar a ${r.name || r.email}? Se cerrará su sesión y saldrá del juego. Si vuelve a entrar, reaparecerá.`, { title: 'Expulsar', danger: true });
    if (!ok) return;
    await removeUser(r.id);
    toast(`${r.name || r.email} expulsado`, 'success');
  }
  /** Limpia (una vez) los pre-registros que ya tienen cuenta real equivalente. */
  updated() {
    if (!this.currentPartidaId) return;
    const realNorms = new Set(this.users.map((u) => normalizeEmail(u.email)));
    this._cleanedInv = this._cleanedInv || new Set();
    for (const iv of this.pInvited) {
      if (realNorms.has(normalizeEmail(iv.email)) && !this._cleanedInv.has(iv.id)) {
        this._cleanedInv.add(iv.id);
        deleteInvited(iv.id);
      }
    }
  }
  /** Modal para asignar una persona (usuario real o pendiente) a un equipo con un rol. */
  openAssignToTeam(person) {
    const teams = this.pTeams;
    if (teams.length === 0) return toast('Crea un equipo primero en «Equipos y tableros»', 'warning');
    const wrap = document.createElement('div');
    wrap.innerHTML = `<p class="muted">Añadir a <strong>${person.name || person.email}</strong> a un equipo de esta partida:</p>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:8px';
    const teamSel = document.createElement('select');
    teamSel.innerHTML = teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    const roleSel = document.createElement('select');
    roleSel.innerHTML = ROLES.map((r) => `<option value="${r}" ${(person.role || 'DEV') === r ? 'selected' : ''}>${r}</option>`).join('');
    row.append(teamSel, roleSel);
    wrap.appendChild(row);
    modal(wrap, {
      title: 'Añadir a un equipo',
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Añadir', variant: 'primary', onClick: async (c) => {
          const tid = teamSel.value; const role = roleSel.value;
          if (person.kind === 'invited') await setInvitedAssignment(person.id, tid, role);
          else { const t = this.teams.find((x) => x.id === tid); if (t) await assignToTeam(t, person.id, role); }
          c();
          toast(`${person.name || person.email} → ${this.teams.find((x) => x.id === tid)?.name} (${role})`, 'success');
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
      if (iv) {
        if (iv.partidaId === this.currentPartidaId) inThis.push(name);
        else if (iv.partidaId == null) { await addInvited(email, name, this.currentPartidaId); added += 1; } // reutiliza persona libre
        else inOther.push(name);
        continue;
      }
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
          <button class="btn" @click=${() => this.demoWithBots()}>🤖 Crear equipo de bots</button>
        </div>
        <div class="row" style="gap:8px; align-items:flex-end; flex-wrap:wrap">
          <span class="muted">o automático:</span>
          <div><label>Nº equipos</label><input id="nTeams" type="number" min="1" .value=${this.suggestTeamCount()} style="width:90px"></div>
          <button class="btn" @click=${() => this.createEmptyTeams()}>➕ Crear N equipos vacíos</button>
          <button class="btn-primary" @click=${() => this.generateTeams()}>🎲 Crear N + repartir por rol</button>
          <button class="btn-primary" ?disabled=${this.pTeams.length === 0} @click=${() => this.fillExistingTeams()}>👥 Repartir en equipos existentes</button>
        </div>
        <p class="muted" style="margin:0">«Repartir» coloca a cada persona en <strong>su rol</strong> (1 PM · 1 QA · resto DEV por equipo), <strong>sin reconvertir</strong>: quien no cuadre (p.ej. PMs de más) queda <strong>fuera</strong> y te lo resumo. Mete <strong>bots</strong> donde falte rol y <strong>ajusta el WIP</strong>.</p>
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
    else if (p.invited) await setInvitedAssignment(p.id, null, p.role || null); // saca del equipo pero recuerda su rol
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
    const ok = await confirmDialog('¿Crear un equipo de bots (1 PM, 3 DEV, 1 QA) en esta partida? NO se inicia: lo arrancas tú desde la pestaña Facilitador cuando quieras.', { title: 'Crear equipo de bots' });
    if (!ok) return;
    const team = await createTeam(`Bots ${this.pTeams.length + 1}`, this.me?.uid, this.currentPartidaId);
    await addBotToTeam(team, 'PM', 'Bot PM');
    await addBotToTeam(team, 'DEV', 'Bot Dev 1');
    await addBotToTeam(team, 'DEV', 'Bot Dev 2');
    await addBotToTeam(team, 'DEV', 'Bot Dev 3');
    await addBotToTeam(team, 'QA', 'Bot QA');
    await setTeamBacklog(team.id, BACKLOGS[0].id);
    toast('Equipo de bots creado. Inícialo desde la pestaña Facilitador cuando quieras (con Auto-bots ON juegan solos).', 'success', 6000);
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
  /** Personas sin asignar (reales + pre-registradas), con su rol preferido si lo tienen. */
  unassignedPool() {
    const assigned = this.assignedAnywhere();
    const realNorms = new Set(this.users.map((u) => normalizeEmail(u.email)));
    return [
      ...this.users.filter((u) => u.role !== 'admin' && !assigned.has(u.id)).map((u) => ({ id: u.id, invited: false, pref: u.defaultRole || '', name: u.name || u.email })),
      ...this.pInvited.filter((iv) => !iv.teamId && !realNorms.has(normalizeEmail(iv.email))).map((iv) => ({ id: iv.id, invited: true, pref: iv.role || '', name: iv.name || iv.email })),
    ];
  }
  /** Resumen del reparto: composición por equipo, bots y quién quedó fuera. */
  showTeamSummary(summary, leftOut, totalPeople) {
    const botsByRole = { PM: 0, DEV: 0, QA: 0 };
    summary.forEach((s) => s.botRoles.forEach((r) => { botsByRole[r] += 1; }));
    const totalBots = botsByRole.PM + botsByRole.DEV + botsByRole.QA;
    const placed = totalPeople - leftOut.length;
    const lines = summary.map((s) => {
      const h = { PM: s.plan.PM.length + (s.existing.PM || 0), DEV: s.plan.DEV.length + (s.existing.DEV || 0), QA: s.plan.QA.length + (s.existing.QA || 0) };
      const bots = s.botRoles.length ? ` · <span style="color:#9ff0c0">bots: ${s.botRoles.join(', ')}</span>` : '';
      return `<li style="margin:2px 0"><strong>${s.name}</strong> — PM:${h.PM} · DEV:${h.DEV} · QA:${h.QA}${bots}</li>`;
    }).join('');
    const outLines = leftOut.map((p) => `<li style="margin:2px 0">${p.name || p.id}${p.role ? ` <span class="tag role-${p.role}">${p.role}</span>` : ' <span style="opacity:.6">(sin rol)</span>'}</li>`).join('');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <ul style="margin:0 0 10px;padding-left:18px">${lines}</ul>
      <p style="margin:0">👥 <strong>${placed}</strong> de ${totalPeople} persona(s) asignadas.</p>
      ${totalBots
        ? `<p style="margin:6px 0 0">🤖 <strong>${totalBots}</strong> bot(s) en huecos: ${['PM', 'DEV', 'QA'].filter((r) => botsByRole[r]).map((r) => `${botsByRole[r]} ${r}`).join(', ')}.</p>`
        : '<p style="margin:6px 0 0;color:#9ff0c0">✅ Sin bots: roles cubiertos por personas.</p>'}
      ${leftOut.length
        ? `<p style="margin:10px 0 4px;color:#ffb4b4"><strong>⚠️ ${leftOut.length} sin asignar</strong> (no cuadran sin reconvertir su rol):</p>
           <ul style="margin:0;padding-left:18px">${outLines}</ul>
           <p style="margin:6px 0 0" class="muted">Decides tú: déjalos fuera, cámbiales el rol (consensuado), o crea otro equipo y mételos con bots.</p>`
        : '<p style="margin:6px 0 0;color:#9ff0c0">Nadie quedó fuera.</p>'}
    `;
    modal(wrap, { title: 'Resumen del reparto', actions: [{ label: 'Entendido', variant: 'primary', onClick: (c) => c() }] });
  }
  /** Asigna el plan al equipo, rellena con bots los roles a 0 (incl. los ya presentes) y ajusta el WIP. */
  async populateTeam(team, plan, existing = { PM: 0, DEV: 0, QA: 0 }) {
    for (const role of ROLES) {
      for (const m of plan[role]) {
        if (m.invited) await setInvitedAssignment(m.id, team.id, role);
        else await assignToTeam(team, m.id, role);
      }
    }
    const botRoles = [];
    for (const role of ROLES) {
      if ((existing[role] || 0) + plan[role].length === 0) { await addBotToTeam(team, role, `Bot ${role}`); botRoles.push(role); }
    }
    const board = await getBoard(team.boardWip);
    if (board) {
      const wip = suggestedWipByAnchor(board.columns, board.roleAssignments || {});
      const analysisId = anchors(orderedColumns(board.columns)).id.analysis;
      await Promise.all(Object.entries(wip).map(([colId, val]) => setColumnWip(team.boardWip, colId, val)));
      await setColumnWip(team.boardWip, analysisId, null); // Refinement: buffer sin WIP
    }
    return botRoles;
  }
  shuffleInPlace(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  /** Crea N equipos VACÍOS (sin personas) para rellenarlos después. */
  async createEmptyTeams() {
    const nTeams = Math.max(1, Number(this.querySelector('#nTeams')?.value) || 1);
    const ok = await confirmDialog(`¿Crear ${nTeams} equipo(s) vacío(s) (con sus dos tableros)? Luego les asignas personas.`, { title: 'Crear equipos' });
    if (!ok) return;
    const base = this.pTeams.length;
    for (let i = 0; i < nTeams; i++) await createTeam(`Equipo ${base + i + 1}`, this.me?.uid, this.currentPartidaId);
    toast(`${nTeams} equipo(s) creado(s).`, 'success');
  }

  /** Crea N equipos y reparte a las personas POR SU ROL (sin reconvertir); informa del resultado. */
  async generateTeams() {
    const nTeams = Math.max(1, Number(this.querySelector('#nTeams')?.value) || 1);
    const pool = this.shuffleInPlace(this.unassignedPool());
    if (pool.length === 0) return toast('No hay personas sin asignar. Usa "Crear equipos" si solo quieres la estructura.', 'warning', 6000);
    const existings = Array.from({ length: nTeams }, () => ({ PM: 0, DEV: 0, QA: 0 }));
    const { plans, leftOut } = planByRole(pool, existings);
    const ok = await confirmDialog(
      `Se crearán ${nTeams} equipo(s) y se repartirán las personas por su ROL (sin reconvertir). Bots en los roles que falten; quien no cuadre quedará fuera (te lo resumo al final). ¿Continuar?`,
      { title: 'Generar equipos por rol' });
    if (!ok) return;
    const base = this.pTeams.length;
    const summary = [];
    for (let i = 0; i < nTeams; i++) {
      const team = await createTeam(`Equipo ${base + i + 1}`, this.me?.uid, this.currentPartidaId);
      const botRoles = await this.populateTeam(team, plans[i], existings[i]);
      summary.push({ name: team.name, plan: plans[i], existing: existings[i], botRoles });
    }
    this.showTeamSummary(summary, leftOut, pool.length);
  }

  /** Reparte a las personas sin asignar en los equipos YA EXISTENTES, por su ROL; informa del resultado. */
  async fillExistingTeams() {
    const teams = this.pTeams;
    if (teams.length === 0) return toast('No hay equipos creados. Crea equipos primero.', 'warning', 5000);
    const pool = this.shuffleInPlace(this.unassignedPool());
    if (pool.length === 0) return toast('No hay personas sin asignar.', 'warning', 5000);
    const existings = teams.map((t) => teamRoleCounts(t, this.invited));
    const { plans, leftOut } = planByRole(pool, existings);
    const ok = await confirmDialog(
      `Se repartirán las personas por su ROL en ${teams.length} equipo(s) existente(s) (sin reconvertir, respetando los que ya tienen). Bots en huecos; quien no cuadre queda fuera (te lo resumo). ¿Continuar?`,
      { title: 'Repartir por rol en equipos existentes' });
    if (!ok) return;
    const summary = [];
    for (let i = 0; i < teams.length; i++) {
      const botRoles = await this.populateTeam(teams[i], plans[i], existings[i]);
      summary.push({ name: teams[i].name, plan: plans[i], existing: existings[i], botRoles });
    }
    this.showTeamSummary(summary, leftOut, pool.length);
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
    const rondas = this.session?.rondas ?? 2;
    const ciclos = this.session?.ciclos ?? 7;
    const backlogMode = this.session?.backlogMode || 'per-team';
    const backlogId = this.session?.backlogId || BACKLOGS[0].id;
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
          <div><label>Backlog</label>
            <select id="sessBacklogMode" @change=${(e) => this.onBacklogModeChange(e.target.value)}>
              <option value="per-team" ?selected=${backlogMode === 'per-team'}>Uno por equipo</option>
              <option value="competition" ?selected=${backlogMode === 'competition'}>Mismo (competición)</option>
            </select>
          </div>
          ${backlogMode === 'competition' ? html`<div><label>Proyecto</label>
            <select id="sessBacklogId">
              ${backlogOptions().map((o) => html`<option value=${o.id} ?selected=${o.id === backlogId}>${o.emoji} ${o.name}</option>`)}
            </select></div>` : ''}
          <button class="btn-sm" @click=${() => this.saveSessionConfig()}>💾 Guardar</button>
          <span class="muted">Total: ${rondas * ciclos} ciclos (~${Math.round(rondas * ciclos * 1.3)} min/tablero). Igual en ambos modos. Más ciclos = efecto WIP más nítido pero sesión más larga.</span>
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
                  <td>
                    ${b.status !== 'playing' && b.status !== 'finished' && c.total > 0
                      ? html`<button class="btn btn-sm btn-primary" @click=${() => this.startOneBoard(b)}>▶ Iniciar este</button> ` : ''}
                    <a class="btn btn-sm" href="/board?id=${b.id}">▶ Abrir</a> <a class="btn btn-sm" href="/results?id=${b.id}">📊</a></td>
                </tr>`;
              })}
            </tbody>
          </table>`}

        ${blocked ? html`<p class="bad" style="margin:0">⚠ No se puede iniciar: hay equipos sin nadie asignado o tableros sin equipo. Corrígelo en «Equipos y tableros».</p>` : ''}
        ${!blocked && anyPending ? html`<p class="muted" style="margin:0">ℹ️ Hay personas <strong>pendientes</strong> (pre-registradas) que aún no han iniciado sesión: no podrán jugar su rol hasta que entren con su correo.</p>` : ''}
        <div class="row" style="gap:10px; align-items:center; flex-wrap:wrap">
          <button class="btn-primary btn-lg" ?disabled=${modeBoards.length === 0 || anyPlaying || blocked} @click=${() => this.startPartida()}>
            ▶ Iniciar partida ${mode === 'wip' ? 'con WIP' : 'sin WIP'} (${rondas}×${ciclos}) en todos
          </button>
          ${modeBoards.filter((b) => b.status === 'playing').map((b) => html`
            <a class="btn btn-lg" href="/board?id=${b.id}">▶ Ir al tablero${modeBoards.length > 1 ? ` · ${this.teams.find((t) => t.id === b.teamId)?.name || ''}` : ''}</a>`)}
        </div>
        <p class="muted" style="margin:0">Flujo: <strong>1)</strong> Modo «Sin WIP» → Iniciar. <strong>2)</strong> Cuando termine, cambia el Modo a «Con WIP» y vuelve a Iniciar. Con «▶ Ir al tablero» vuelves al que esté en juego.</p>
      </div>
      ${this.me?.isAdmin ? this.renderCoFacilitators() : ''}
      ${this.tableStyles()}
    `;
  }
  renderCoFacilitators() {
    const facSet = new Set(this.facilitators);
    // Co-facilitadores actuales: reales con el flag (los admin facilitan siempre, no se listan).
    const current = this.users.filter((u) => facSet.has(u.id) && u.role !== 'admin');
    const realNorms = new Set(this.users.map((u) => normalizeEmail(u.email)));
    // Pre-designados que aún no han entrado (se promueven al hacer login).
    const pendingFac = this.pInvited.filter((iv) => iv.facilitator === true && !realNorms.has(normalizeEmail(iv.email)));
    return html`
      <div class="card stack" style="margin-top:12px">
        <div class="flex-between" style="flex-wrap:wrap; gap:6px">
          <h3 style="margin:0">Co-facilitadores de esta partida</h3>
          <button class="btn-sm btn-primary" @click=${() => this.openAddFacilitator()}>➕ Añadir co-facilitador</button>
        </div>
        <p class="muted" style="margin:0">Pueden moderar los tableros de esta partida (forzar pasos, WIP, rondas, roles) y ven solo esta partida, no las demás. Quítalos al terminar la sesión.</p>
        <p class="muted" style="margin:0">ℹ️ Puedes elegir a personas que <strong>ya han entrado</strong> o <strong>pre-registradas</strong> (estas se promueven solas en cuanto entran con su correo).</p>
        ${current.length === 0 && pendingFac.length === 0 ? html`<p class="muted" style="margin:0">Aún no hay co-facilitadores. Pulsa «Añadir co-facilitador».</p>` : html`
        <table class="t">
          <thead><tr><th>Persona</th><th></th></tr></thead>
          <tbody>
            ${current.map((u) => html`
              <tr>
                <td>${u.name || u.email} ${this.teamNameOf(u.id) ? html`<span class="tag">${this.teamNameOf(u.id)}</span>` : html`<span class="muted" style="font-size:.78rem">no juega</span>`}</td>
                <td><button class="btn-sm btn-danger" @click=${() => this.toggleFacilitator(u, false)}>Quitar</button></td>
              </tr>`)}
            ${pendingFac.map((iv) => html`
              <tr>
                <td>${iv.name || iv.email} <span class="tag" style="background:#3a3416;color:#ffe08a">pendiente · entrará como co-facilitador</span></td>
                <td><button class="btn-sm btn-danger" @click=${() => this.unflagInvitedFacilitator(iv)}>Quitar</button></td>
              </tr>`)}
          </tbody>
        </table>`}
      </div>`;
  }
  /** Modal para nombrar co-facilitadores: personas que ya han iniciado sesión (libres o de la partida). */
  openAddFacilitator() {
    const facSet = new Set(this.facilitators);
    const realNorms = new Set(this.users.map((u) => normalizeEmail(u.email)));
    // Se muestran TODAS las personas (puedan o no jugar): un co-facilitador puede tener rol.
    const userCands = this.users
      .filter((u) => u.role !== 'admin' && !facSet.has(u.id))
      .map((u) => ({ type: 'user', id: u.id, label: u.name || u.email, sub: (u.name && u.email) ? u.email : '', note: this.teamNameOf(u.id) || 'con cuenta' }));
    const invCands = this.pInvited
      .filter((iv) => !iv.facilitator && !realNorms.has(normalizeEmail(iv.email)))
      .map((iv) => ({ type: 'invited', id: iv.id, label: iv.name || iv.email, sub: iv.email, invited: true, note: 'pre-registrado' }));
    const cands = [...userCands, ...invCands]
      .sort((a, b) => (Number(!!b.invited) - Number(!!a.invited)) || a.label.localeCompare(b.label));
    const wrap = document.createElement('div');
    if (cands.length === 0) {
      wrap.innerHTML = '<p class="muted">No hay personas sin rol disponibles. Un co-facilitador no puede tener rol de juego: quítaselo en «Equipos» o pre-registra/usa a alguien sin equipo.</p>';
    }
    for (const c of cands) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:5px 0;cursor:pointer';
      const chip = `<span style="background:${c.invited ? '#3a3416;color:#ffe08a' : '#26324a;color:#bcd3ff'};border-radius:999px;padding:1px 8px;font-size:.7rem">${c.note || ''}</span>`;
      row.innerHTML = `<input type="checkbox" data-id="${c.id}" data-type="${c.type}"> ${chip} <span>${c.label}${c.sub ? ` <span style="opacity:.6">${c.sub}</span>` : ''}</span>`;
      wrap.appendChild(row);
    }
    modal(wrap, {
      title: 'Añadir co-facilitadores',
      actions: [
        { label: 'Cancelar', onClick: (c) => c() },
        { label: 'Añadir seleccionadas', variant: 'primary', onClick: async (c) => {
          const checks = [...wrap.querySelectorAll('input[type=checkbox]:checked')];
          for (const ch of checks) {
            if (ch.dataset.type === 'invited') await setInvitedFacilitator(ch.dataset.id, true);
            else await setPartidaFacilitator(this.currentPartidaId, ch.dataset.id, true);
          }
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
  async unflagInvitedFacilitator(iv) {
    await setInvitedFacilitator(iv.id, false);
    toast(`${iv.name || iv.email} ya no entrará como co-facilitador`, 'success');
  }
  async setMode(mode) { await updatePartidaSession(this.currentPartidaId, { mode }); }
  async onBacklogModeChange(backlogMode) { await updatePartidaSession(this.currentPartidaId, { backlogMode }); }
  /** Asigna a cada equipo de la partida su proyecto: rotando (por equipo) o el mismo (competición). */
  async assignBacklogs(mode = this.session?.backlogMode || 'per-team', compId = this.session?.backlogId || BACKLOGS[0].id) {
    const ids = backlogOptions().map((o) => o.id);
    const teamIds = [...new Set(this.pBoards.map((b) => b.teamId).filter(Boolean))].sort();
    await Promise.all(teamIds.map((tid, i) => setTeamBacklog(tid, mode === 'competition' ? compId : ids[i % ids.length])));
    return teamIds.length;
  }
  async saveSessionConfig() {
    const rondas = Math.max(1, Number(this.querySelector('#sessRondas').value) || 1);
    const ciclos = Math.max(1, Number(this.querySelector('#sessCiclos').value) || 1);
    const tv = this.querySelector('#sessTime').value.trim();
    const timeLimitMinutes = tv === '' ? null : Math.max(0, Number(tv)) || null;
    const pauseBetweenRounds = this.querySelector('#sessPause')?.checked || false;
    const backlogMode = this.querySelector('#sessBacklogMode')?.value || 'per-team';
    const backlogId = this.querySelector('#sessBacklogId')?.value || this.session?.backlogId || BACKLOGS[0].id;
    await updatePartidaSession(this.currentPartidaId, { rondas, ciclos, timeLimitMinutes, pauseBetweenRounds, backlogMode, backlogId });
    const n = await this.assignBacklogs(backlogMode, backlogId);
    toast(`Configuración guardada · backlog asignado a ${n} equipo(s)`, 'success');
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
    const rondas = this.session?.rondas ?? 2;
    const ciclos = this.session?.ciclos ?? 7;
    const ok = await confirmDialog(`¿Iniciar la partida ${mode === 'wip' ? 'con WIP' : 'sin WIP'} (${rondas}×${ciclos} = ${rondas * ciclos} ciclos) en ${modeBoards.length} tablero(s)?`, { title: 'Iniciar partida' });
    if (!ok) return;
    await this.assignBacklogs(); // garantiza que cada equipo tiene proyecto antes de empezar
    await startPartidaForBoards(modeBoards, mode, { rondas, ciclos, timeLimitMinutes: this.session?.timeLimitMinutes ?? null, pauseBetweenRounds: this.session?.pauseBetweenRounds || false });
    // Con un único tablero (típico en demos) abre directamente; con varios, deja la tabla con «Abrir».
    if (modeBoards.length === 1) { location.href = `/board?id=${modeBoards[0].id}`; return; }
    toast(`Partida iniciada en ${modeBoards.length} tablero(s). Pulsa «Abrir» en cada uno para verlos.`, 'success', 5000);
  }

  /** Arranca UN solo tablero (equipo que llega tarde / recreado) con la config de la sesión y su
   *  modo. Juega a su ritmo aunque el resto ya esté en curso. */
  async startOneBoard(b) {
    if (!b.teamId) return toast('Ese tablero no tiene equipo.', 'error');
    if (this.teamCounts(b.teamId).total === 0) return toast('El equipo no tiene a nadie asignado.', 'error');
    if (b.status === 'playing') return toast('Ese tablero ya está en juego.', 'warning');
    const wipEnabled = b.mode === 'wip';
    const rondas = this.session?.rondas ?? 2;
    const ciclos = this.session?.ciclos ?? 7;
    const name = this.teams.find((t) => t.id === b.teamId)?.name || b.name;
    const ok = await confirmDialog(
      `¿Iniciar SOLO el tablero «${name}» (${wipEnabled ? 'con WIP' : 'sin WIP'}, ${rondas}×${ciclos})? Empezará aunque el resto ya esté en curso; jugará a su ritmo.`,
      { title: 'Iniciar este tablero' });
    if (!ok) return;
    await this.assignBacklogs(); // asegura que el equipo tiene proyecto
    await startGame(b, { wipEnabled, rondas, ciclos, timeLimitMinutes: this.session?.timeLimitMinutes ?? null, pauseBetweenRounds: this.session?.pauseBetweenRounds || false });
    toast('Tablero iniciado.', 'success');
    location.href = `/board?id=${b.id}`;
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
