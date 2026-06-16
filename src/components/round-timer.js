import { LitElement, html, css } from 'lit';

/**
 * Cronómetro de ronda. <kbg-round-timer .startedAt .endedAt .timeLimit>
 *  - startedAt: ms de inicio de la ronda.
 *  - endedAt: ms de fin (null si en curso) -> congela el tiempo.
 *  - timeLimit: segundos de límite opcional (null = sin límite).
 * Emite 'timeup' una sola vez al alcanzar el límite.
 */
export class RoundTimer extends LitElement {
  static properties = {
    startedAt: { type: Number },
    endedAt: { type: Number },
    timeLimit: { type: Number },
    _now: { state: true },
  };

  static styles = css`
    :host { display: inline-flex; }
    .timer {
      display: inline-flex; align-items: center; gap: 6px;
      font-variant-numeric: tabular-nums; font-weight: 700;
      background: #25344a; color: #e8eef6; border: 1px solid #31435c;
      border-radius: 999px; padding: 4px 12px; font-size: .95rem;
    }
    .timer.over { background: #5a1d1d; border-color: #ef5d5d; color: #ffd7d7; animation: pulse 1s infinite; }
    .limit { opacity: .6; font-weight: 500; font-size: .8rem; }
    @keyframes pulse { 50% { opacity: .55; } }
  `;

  constructor() {
    super();
    this.startedAt = 0;
    this.endedAt = null;
    this.timeLimit = null;
    this._now = Date.now();
    this._firedTimeup = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._iv = setInterval(() => {
      if (this.endedAt) return;
      this._now = Date.now();
    }, 1000);
  }
  disconnectedCallback() { super.disconnectedCallback(); clearInterval(this._iv); }

  fmt(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  render() {
    if (!this.startedAt) return html``;
    const ref = this.endedAt || this._now;
    const elapsed = (ref - this.startedAt) / 1000;
    const over = this.timeLimit && elapsed >= this.timeLimit;

    if (over && !this._firedTimeup) {
      this._firedTimeup = true;
      this.dispatchEvent(new CustomEvent('timeup', { bubbles: true, composed: true }));
    }
    if (this.timeLimit && elapsed < this.timeLimit) this._firedTimeup = false;

    return html`
      <span class="timer ${over ? 'over' : ''}" title="Tiempo de la ronda">
        ⏱ ${this.fmt(elapsed)}
        ${this.timeLimit ? html`<span class="limit">/ ${this.fmt(this.timeLimit)}${over ? ' ¡agotado!' : ''}</span>` : ''}
      </span>
    `;
  }
}

customElements.define('kbg-round-timer', RoundTimer);
