// Sistema de feedback de la app: toasts, modales y confirmaciones.
// Nunca usar alert/confirm/prompt nativos.

let toastHost;
function ensureToastHost() {
  if (toastHost) return toastHost;
  toastHost = document.createElement('div');
  toastHost.id = 'kbg-toasts';
  Object.assign(toastHost.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: '9999',
    display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '360px',
  });
  document.body.appendChild(toastHost);
  return toastHost;
}

const TOAST_COLORS = {
  info: '#3d8bff', success: '#2ecc71', warning: '#f4a83a', error: '#ef5d5d',
};

export function toast(message, type = 'info', timeout = 3500) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.textContent = message;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    background: '#1d2a3a', color: '#e8eef6',
    borderLeft: `4px solid ${TOAST_COLORS[type] || TOAST_COLORS.info}`,
    padding: '10px 14px', borderRadius: '8px',
    boxShadow: '0 6px 20px rgba(0,0,0,.4)', font: '14px system-ui, sans-serif',
    opacity: '0', transform: 'translateY(8px)', transition: 'opacity .2s, transform .2s',
  });
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

/**
 * Modal genérico. `render(close)` recibe una función para cerrar.
 * Devuelve { close }. Si pasas un string, lo muestra como mensaje.
 */
export function modal(content, { title = '', actions } = {}) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(4,9,16,.66)', zIndex: '9998',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
  });
  const box = document.createElement('div');
  Object.assign(box.style, {
    background: '#1d2a3a', color: '#e8eef6', border: '1px solid #31435c',
    borderRadius: '12px', padding: '20px', width: 'min(480px, 96vw)',
    boxShadow: '0 16px 50px rgba(0,0,0,.5)', maxHeight: '90vh', overflow: 'auto',
  });

  if (title) {
    const h = document.createElement('h3');
    h.textContent = title;
    h.style.margin = '0 0 12px';
    box.appendChild(h);
  }

  const body = document.createElement('div');
  if (typeof content === 'string') body.textContent = content;
  else if (content instanceof Node) body.appendChild(content);
  box.appendChild(body);

  const close = () => overlay.remove();

  if (actions) {
    const bar = document.createElement('div');
    Object.assign(bar.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' });
    for (const act of actions) {
      const b = document.createElement('button');
      b.textContent = act.label;
      if (act.variant === 'primary') b.className = 'btn-primary';
      if (act.variant === 'danger') b.className = 'btn-danger';
      b.onclick = () => act.onClick?.(close);
      bar.appendChild(b);
    }
    box.appendChild(bar);
  }

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  return { close };
}

/** Confirmación con promesa (resuelve true/false). */
export function confirmDialog(message, { title = 'Confirmar', confirmLabel = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    modal(message, {
      title,
      actions: [
        { label: 'Cancelar', onClick: (close) => { close(); resolve(false); } },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: (close) => { close(); resolve(true); } },
      ],
    });
  });
}

/** Pide un texto con promesa (resuelve string o null). */
export function promptDialog(message, { title = '', value = '', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    const p = document.createElement('p'); p.textContent = message; p.style.marginBottom = '10px';
    const input = document.createElement('input');
    input.type = 'text'; input.value = value; input.placeholder = placeholder;
    wrap.appendChild(p); wrap.appendChild(input);
    const m = modal(wrap, {
      title,
      actions: [
        { label: 'Cancelar', onClick: (close) => { close(); resolve(null); } },
        { label: 'Aceptar', variant: 'primary', onClick: (close) => { close(); resolve(input.value.trim() || null); } },
      ],
    });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { m.close(); resolve(input.value.trim() || null); } });
  });
}
