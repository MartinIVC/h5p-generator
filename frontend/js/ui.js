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
  let activeOnClose = null;
  let activeDialog = null;
  let messageRegion = null;
  const dismissMessages = new WeakMap();

  function placeMessageRegion() {
    if (!messageRegion) return;
    const host = activeDialog || document.body;
    if (messageRegion.parentNode === host) return;
    host.appendChild(messageRegion);
  }

  const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, ch => HTML_ENTITIES[ch]);
  }

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
    const onClose = activeOnClose;
    activeModal = null;
    activeDialog = null;
    placeMessageRegion();
    modalCloseHandler = null;
    activeOnClose = null;

    if (typeof onClose === 'function') {
      try {
        onClose();
      } catch {
        // Evita que un error de limpieza impida restaurar el foco.
      }
    }

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
    activeOnClose = typeof options.onClose === 'function' ? options.onClose : null;
    if (!wasActive) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = modal.querySelector('.modal-dialog-content, .preview-dialog') || modal;
    activeDialog = dialog;
    placeMessageRegion();
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

      openModal(modal, {
        focus: '#ui-confirm-cancel',
        onEscape: () => finish(false),
        onClose: () => finish(false)
      });
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

  window.uiEscapeHtml = escapeHtml;

  window.uiDialog = {
    open: openModal,
    close: closeModal,
    focusableElements: getFocusableElements,
    isOpen: () => Boolean(activeDialog),
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

  window.uiMessage = function (message, type = 'info') {
    if (typeof message !== 'string') return;
    const text = message.trim();
    if (!text) return;
    const kind = ['error', 'success', 'warning'].includes(type) ? type : 'info';
    if (!messageRegion) {
      messageRegion = document.createElement('div');
      messageRegion.className = 'ui-message-region';
      placeMessageRegion();
    }

    // Un mismo resultado no debe acumular avisos ni anunciarse varias veces.
    if (Array.from(messageRegion.children).some(item =>
      (item.dataset?.message || item.textContent) === text && item.dataset?.type === kind
    )) return;
    if (messageRegion.children.length >= 3) {
      const oldest = Array.from(messageRegion.children).find(item => !item.contains(document.activeElement));
      if (oldest) dismissMessages.get(oldest)(true);
    }

    const toast = document.createElement('div');
    toast.className = `ui-message ui-message-${kind}`;
    toast.dataset.type = kind;
    toast.dataset.message = text;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');

    const body = document.createElement('span');
    body.className = 'ui-message-text';
    body.textContent = text;
    toast.appendChild(body);

    let dismissTimer;
    let removeTimer;
    let remaining = kind === 'error' ? 10000 : 6500;
    let startedAt;
    let hovered = false;
    let focused = false;
    let dismissed = false;

    const dismiss = (immediate = false) => {
      window.clearTimeout(dismissTimer);
      if (immediate) {
        window.clearTimeout(removeTimer);
        toast.remove();
        return;
      }
      if (dismissed) return;
      dismissed = true;
      if (toast.contains(document.activeElement)) {
        const target = getFocusableElements(activeDialog || document.body)
          .find(element => !messageRegion.contains(element));
        target?.focus();
      }
      toast.classList.add('is-leaving');
      removeTimer = window.setTimeout(() => dismiss(true), 180);
    };
    dismissMessages.set(toast, dismiss);

    const updateTimer = () => {
      if (dismissed) return;
      if (focused || hovered) {
        if (dismissTimer === undefined) return;
        window.clearTimeout(dismissTimer);
        dismissTimer = undefined;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      } else if (dismissTimer === undefined) {
        startedAt = Date.now();
        dismissTimer = window.setTimeout(dismiss, remaining);
      }
    };
    toast.addEventListener('pointerenter', () => { hovered = true; updateTimer(); });
    toast.addEventListener('pointerleave', () => { hovered = false; updateTimer(); });
    toast.addEventListener('focusin', () => { focused = true; updateTimer(); });
    toast.addEventListener('focusout', () => { focused = false; updateTimer(); });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ui-message-close';
    closeBtn.setAttribute('aria-label', 'Cerrar aviso');
    const closeGlyph = document.createElement('span');
    closeGlyph.setAttribute('aria-hidden', 'true');
    closeGlyph.textContent = '×';
    closeBtn.appendChild(closeGlyph);
    closeBtn.addEventListener('click', () => dismiss());
    toast.appendChild(closeBtn);

    messageRegion.appendChild(toast);

    updateTimer();
  };
})();
