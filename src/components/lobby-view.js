import { LitElement, html } from 'lit';
import { watchTeams, watchPartidas, assignToTeam } from '../lib/db.js';
import { toast } from '../lib/ui.js';

// Cupos por equipo: 1 PM, 1 QA, Desarrollo libre hasta DEV_CAP.
const DEV_CAP = 4;
const ROLE_CAP = { PM: 1, QA: 1, DEV: DEV_CAP };
const ROLE_DESC = { PM: 'Gestiona el flujo y prioriza', DEV: 'Saca el trabajo adelante', QA: 'Prueba y da por buena la historia' };

/**
 * Lobby de auto-asignación: el jugador (con cuenta) elige equipo y rol con hueco.
 * El rol queda fijo (solo el admin lo cambia luego). Sin equipos creados → espera.
 */
export class LobbyView extends LitElement {
  static properties = {
    me: { attribute: false },           // { uid }
    teams: { state: true },
    partidas: { state: true },
    selectedPartida: { state: true },
    joining: { state: true },
  };

  constructor() {
    super();
    this.teams = [];
    this.partidas = [];
    this.selectedPartida = null;
    this.joining = false;
  }
  createRenderRoot() { return this; } // light DOM, hereda estilos globales

  connectedCallback() {
    super.connectedCallback();
    this._wt = watchTeams((l) => { this.teams = l; });
    this._wp = watchPartidas((l) => { this.partidas = l; });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._wt?.(); this._wp?.();
  }

  /** Partidas que tienen al menos un equipo (donde tiene sentido unirse). */
  joinablePartidas() {
    return this.partidas.filter((p) => this.teams.some((t) => t.partidaId === p.id));
  }
  teamsOf(pid) { return this.teams.filter((t) => t.partidaId === pid); }
  countRoles(team) {
    const c = { PM: 0, DEV: 0, QA: 0 };
    Object.values(team.members || {}).forEach((r) => { if (c[r] != null) c[r] += 1; });
    return c;
  }

  async join(team, role) {
    if (this.joining) return;
    this.joining = true;
    try {
      await assignToTeam(team, this.me.uid, role);
      toast(`Te has unido a «${team.name}» como ${role}`, 'success', 4000);
    } catch (e) {
      console.error(e);
      toast('No se pudo unir (quizá el hueco se acaba de ocupar). Reintenta.', 'error');
    }
    this.joining = false;
  }

  render() {
    const joinable = this.joinablePartidas();
    if (!joinable.length) {
      return html`<div class="card"><p class="muted" style="margin:0">⏳ Esperando a que el facilitador cree los equipos… Esta pantalla se actualizará sola.</p></div>`;
    }
    const p = joinable.length === 1 ? joinable[0] : joinable.find((x) => x.id === this.selectedPartida);
    if (!p) {
      return html`<div class="card stack">
        <h2 style="margin:0">¿A qué partida te unes?</h2>
        <div class="row" style="flex-wrap:wrap; gap:8px">
          ${joinable.map((x) => html`<button class="btn btn-lg" @click=${() => { this.selectedPartida = x.id; }}>${x.name}</button>`)}
        </div>
      </div>`;
    }
    const teams = this.teamsOf(p.id);
    return html`
      <div class="stack">
        <div class="flex-between" style="flex-wrap:wrap; gap:8px">
          <h2 style="margin:0">Únete a un equipo</h2>
          ${joinable.length > 1 ? html`<button class="btn btn-sm" @click=${() => { this.selectedPartida = null; }}>← Otra partida</button>` : ''}
        </div>
        <p class="muted" style="margin:0">Partida: <strong>${p.name}</strong>. Elige equipo y rol. <strong>Tu rol queda fijo</strong> — si te equivocas, avisa al facilitador y te lo cambia.</p>
        <div class="grid grid-2">
          ${teams.map((t) => this.renderTeam(t))}
        </div>
      </div>
      ${this.styles()}`;
  }

  renderTeam(t) {
    const c = this.countRoles(t);
    return html`<div class="card stack lobby-team">
      <h3 style="margin:0">${t.name}</h3>
      <div class="stack" style="gap:6px">
        ${['PM', 'DEV', 'QA'].map((role) => this.roleRow(t, role, c[role]))}
      </div>
    </div>`;
  }

  roleRow(t, role, count) {
    const cap = ROLE_CAP[role];
    const free = count < cap;
    return html`<div class="lobby-role">
      <div>
        <strong class="role-${role}">${role}</strong>
        <span class="muted">${count}/${cap}</span>
        <div class="muted lobby-desc">${ROLE_DESC[role]}</div>
      </div>
      ${free
        ? html`<button class="btn btn-sm btn-primary" ?disabled=${this.joining} @click=${() => this.join(t, role)}>Unirme</button>`
        : html`<span class="tag">lleno</span>`}
    </div>`;
  }

  styles() {
    return html`<style>
      kbg-lobby .lobby-team { min-height: 0; }
      kbg-lobby .lobby-role { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 8px; }
      kbg-lobby .lobby-desc { font-size: .8rem; }
      kbg-lobby .role-PM { color: #ffd166; }
      kbg-lobby .role-DEV { color: #6cc4ff; }
      kbg-lobby .role-QA { color: #9ff0c0; }
    </style>`;
  }
}

customElements.define('kbg-lobby', LobbyView);
