/**
 * Shared UI behavior for dialogs and motion preferences.
 */
(function () {
  'use strict';

  const MOTION_STORAGE_KEY = 'h5p_motion_preference';
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  let activeModal = null;
  let returnFocus = null;
  let modalCloseHandler = null;

  function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');

    if (modal !== activeModal) return;
    document.removeEventListener('keydown', modalCloseHandler);
    activeModal = null;
    modalCloseHandler = null;

    const previousFocus = returnFocus;
    returnFocus = null;
    if (previousFocus && previousFocus.isConnected && previousFocus.getClientRects().length > 0) {
      previousFocus.focus();
    }
  }

  function openModal(modal, options = {}) {
    if (!modal) return;
    if (activeModal && activeModal !== modal) closeModal(activeModal);

    const wasActive = activeModal === modal;
    if (wasActive && modalCloseHandler) document.removeEventListener('keydown', modalCloseHandler);
    activeModal = modal;
    if (!wasActive) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = modal.querySelector('.modal-dialog-content, .preview-dialog') || modal;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const label = dialog.querySelector('.modal-dialog-title, .preview-title, h1, h2, h3');
    if (label && !label.id) label.id = `${modal.id}-title`;
    if (label) dialog.setAttribute('aria-labelledby', label.id);

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.remove('hidden');

    modalCloseHandler = (event) => {
      if (!activeModal) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typeof options.onEscape === 'function') options.onEscape();
        else closeModal(modal);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', modalCloseHandler);

    const initialFocus = typeof options.focus === 'string'
      ? dialog.querySelector(options.focus)
      : options.focus;
    const focusTarget = initialFocus || getFocusableElements(dialog)[0] || dialog;
    if (!dialog.contains(focusTarget)) return;
    if (focusTarget === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    focusTarget.focus();
  }

  function confirmDialog(options = {}) {
    const modal = document.getElementById('modal-confirm-dialog');
    if (!modal) return Promise.resolve(false);

    modal.innerHTML = `
      <section class="modal-dialog-content confirm-dialog-box" aria-labelledby="ui-confirm-title">
        <header class="modal-dialog-header">
          <h2 class="modal-dialog-title" id="ui-confirm-title"></h2>
          <button type="button" class="btn-icon" id="ui-confirm-close" aria-label="Cerrar">
            <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>
          </button>
        </header>
        <div class="confirm-dialog-body"><p id="ui-confirm-message"></p></div>
        <footer class="modal-dialog-footer">
          <button type="button" class="btn-secondary" id="ui-confirm-cancel">Cancelar</button>
          <button type="button" class="btn-text-danger" id="ui-confirm-accept"></button>
        </footer>
      </section>
    `;

    modal.querySelector('#ui-confirm-title').textContent = options.title || '¿Confirmas esta acción?';
    modal.querySelector('#ui-confirm-message').textContent = options.message || '';
    modal.querySelector('#ui-confirm-accept').textContent = options.confirmLabel || 'Confirmar';

    return new Promise(resolve => {
      let settled = false;
      const finish = (accepted) => {
        if (settled) return;
        settled = true;
        closeModal(modal);
        resolve(accepted);
      };

      openModal(modal, { focus: '#ui-confirm-cancel', onEscape: () => finish(false) });
      modal.querySelector('#ui-confirm-cancel').addEventListener('click', () => finish(false));
      modal.querySelector('#ui-confirm-close').addEventListener('click', () => finish(false));
      modal.querySelector('#ui-confirm-accept').addEventListener('click', () => finish(true));
    });
  }

  function getMotionPreference() {
    return localStorage.getItem(MOTION_STORAGE_KEY) || 'system';
  }

  function applyMotionPreference() {
    const reduced = getMotionPreference() === 'reduced' ||
      (getMotionPreference() === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.classList.toggle('motion-reduced', reduced);
  }

  applyMotionPreference();
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', applyMotionPreference);
  else if (motionQuery.addListener) motionQuery.addListener(applyMotionPreference);

  window.uiDialog = {
    open: openModal,
    close: closeModal,
    focusableElements: getFocusableElements,
    confirm: confirmDialog
  };

  window.uiPreferences = {
    getMotionPreference,
    setMotionPreference(preference) {
      const value = preference === 'reduced' ? 'reduced' : 'system';
      localStorage.setItem(MOTION_STORAGE_KEY, value);
      applyMotionPreference();
    }
  };

  let messageRegion = null;
  window.uiMessage = function (message, type = 'info') {
    if (!messageRegion) {
      messageRegion = document.createElement('div');
      messageRegion.className = 'ui-message-region';
      messageRegion.setAttribute('aria-live', 'polite');
      messageRegion.setAttribute('aria-atomic', 'false');
      document.body.appendChild(messageRegion);
    }

    const toast = document.createElement('div');
    toast.className = `ui-message ui-message-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    messageRegion.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 180);
    }, 6500);
  };
})();
