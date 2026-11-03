// Small shared UI helpers for the host and editor pages.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let toastTimer = null;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/** In-page confirmation dialog. Resolves true when confirmed. */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'confirm';
    d.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>
      ${message ? `<p>${esc(message)}</p>` : ''}
      <div class="confirm-actions">
        <button value="cancel" class="btn">${esc(cancelText)}</button>
        <button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-gold'}">${esc(confirmText)}</button>
      </div>
    </form>`;
    document.body.append(d);
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'ok');
      d.remove();
    });
    d.showModal();
    d.querySelector('button[value=cancel]').focus();
  });
}

export const isDialogOpen = () => !!document.querySelector('dialog[open]');
