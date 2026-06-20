import { LitElement, html, css } from 'lit';
import { rollDie } from '../lib/game.js';

/**
 * Dado digital de 6 caras. <kbg-dice count="1|2" label="Tirar">
 * Emite el evento 'roll' con detail { values: number[] } al terminar la animación.
 * Usa shadow DOM propio (estilos encapsulados de las caras del dado).
 */
export class DiceRoller extends LitElement {
  static properties = {
    count: { type: Number },
    disabled: { type: Boolean },
    label: { type: String },
    force: { type: Array }, // si se indica, el dado ATERRIZA en estos valores (secuencia guardada)
    _values: { state: true },
    _rolling: { state: true },
  };

  static styles = css`
    :host { display: inline-flex; align-items: center; gap: 12px; }
    .dice { display: flex; gap: 10px; }
    .die {
      width: 54px; height: 54px; background: #fffdf5; border-radius: 12px;
      box-shadow: 0 3px 0 #c9c2a8, 0 6px 14px rgba(0,0,0,.35);
      display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr);
      padding: 8px; box-sizing: border-box;
    }
    .die.rolling { animation: shake .12s linear infinite; }
    @keyframes shake { 0%{transform:translateY(0) rotate(-4deg)} 50%{transform:translateY(-4px) rotate(4deg)} 100%{transform:translateY(0) rotate(-4deg)} }
    .pip { width: 10px; height: 10px; border-radius: 50%; background: #21304a; align-self: center; justify-self: center; }
    .pip.off { background: transparent; }
    button {
      font: inherit; cursor: pointer; border: 1px solid #2f7af0; background: #3d8bff; color: #fff;
      padding: 10px 18px; border-radius: 8px; font-weight: 600;
    }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .total { font-weight: 700; color: #ffd166; min-width: 1.5em; }
  `;

  constructor() {
    super();
    this.count = 1;
    this.disabled = false;
    this.label = 'Tirar';
    this._values = Array(1).fill(1);
    this._rolling = false;
  }

  // Mapa de pips encendidos (índices 0..8) por valor.
  static PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };

  renderDie(value, rolling) {
    const on = new Set(DiceRoller.PIPS[value] || []);
    return html`<div class="die ${rolling ? 'rolling' : ''}">
      ${Array.from({ length: 9 }, (_, i) => html`<span class="pip ${on.has(i) ? '' : 'off'}"></span>`)}
    </div>`;
  }

  async roll() {
    if (this._rolling || this.disabled) return;
    this._rolling = true;
    const n = this.count || 1;
    // Animación: ciclar valores aleatorios.
    const start = Date.now();
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        this._values = Array.from({ length: n }, () => rollDie());
        if (Date.now() - start > 600) { clearInterval(iv); resolve(); }
      }, 80);
    });
    // Aterriza en los valores forzados (secuencia guardada) si los hay; si no, aleatorio.
    const forced = Array.isArray(this.force) && this.force.length === n ? this.force.map(Number) : null;
    this._values = forced || Array.from({ length: n }, () => rollDie());
    this._rolling = false;
    this.dispatchEvent(new CustomEvent('roll', { detail: { values: [...this._values] }, bubbles: true, composed: true }));
  }

  render() {
    const n = this.count || 1;
    const vals = this._values.length === n ? this._values : Array(n).fill(1);
    return html`
      <div class="dice">${vals.map((v) => this.renderDie(v, this._rolling))}</div>
      ${n > 1 ? html`<span class="total">${vals.reduce((a, b) => a + b, 0)}</span>` : ''}
      <button ?disabled=${this.disabled || this._rolling} @click=${() => this.roll()}>🎲 ${this.label}</button>
    `;
  }
}

customElements.define('kbg-dice', DiceRoller);
