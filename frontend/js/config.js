/**
 * frontend/js/config.js
 * Módulo de Opciones y Gestión de Credenciales (Google Gemini API Key).
 * Gestiona la configuración persistente, el modal de opciones y la solicitud Just-in-Time.
 */

(function () {
  'use strict';

  const state = {
    hasKey: false,
    maskedKey: '',
    isEditingKey: false,
    onSuccessCallback: null,
    listeners: []
  };

  /**
   * Helper para invocar la API segura de Electron con fallback a localStorage
   */
  const api = {
    async getApiKeyStatus() {
      if (window.academicAPI && typeof window.academicAPI.getApiKeyStatus === 'function') {
        return window.academicAPI.getApiKeyStatus();
      }
      const raw = localStorage.getItem('h5p_gemini_api_key');
      if (raw && raw.trim()) {
        const masked = raw.length > 8 ? `${raw.slice(0, 4)}••••••••••••${raw.slice(-4)}` : '••••••••';
        return { hasKey: true, maskedKey: masked };
      }
      return { hasKey: false, maskedKey: '' };
    },
    async saveApiKey(key) {
      if (window.academicAPI && typeof window.academicAPI.saveApiKey === 'function') {
        return window.academicAPI.saveApiKey(key);
      }
      localStorage.setItem('h5p_gemini_api_key', key.trim());
      const masked = key.length > 8 ? `${key.slice(0, 4)}••••••••••••${key.slice(-4)}` : '••••••••';
      return { hasKey: true, maskedKey: masked };
    },
    async removeApiKey() {
      if (window.academicAPI && typeof window.academicAPI.removeApiKey === 'function') {
        return window.academicAPI.removeApiKey();
      }
      localStorage.removeItem('h5p_gemini_api_key');
      return { hasKey: false, maskedKey: '' };
    }
  };

  /**
   * Notifica a los suscriptores cuando cambia el estado de la clave
   */
  function notifyListeners() {
    state.listeners.forEach(fn => {
      try {
        fn({ hasKey: state.hasKey, maskedKey: state.maskedKey });
      } catch (err) {
        console.error('[config.js] Error en listener:', err);
      }
    });
  }

  /**
   * Consulta el estado actual de la clave
   */
  async function refreshStatus() {
    try {
      const status = await api.getApiKeyStatus();
      state.hasKey = Boolean(status.hasKey);
      state.maskedKey = status.maskedKey || '';
      notifyListeners();
    } catch (err) {
      console.error('[config.js] Error consultando API key status:', err);
      state.hasKey = false;
      state.maskedKey = '';
    }
  }

  /**
   * Abre el modal de configuración general (Opciones)
   */
  async function openSettingsModal() {
    await refreshStatus();
    state.isEditingKey = !state.hasKey;
    renderSettingsModal(false);
  }

  /**
   * Abre el modal Just-in-Time cuando una acción requiere obligatoriamente la clave
   * @param {Function} [onSuccess] Callback que se ejecuta tras ingresar la clave exitosamente
   */
  async function requireApiKey(onSuccess = null) {
    await refreshStatus();
    if (state.hasKey) {
      if (typeof onSuccess === 'function') onSuccess();
      return;
    }
    state.onSuccessCallback = onSuccess;
    state.isEditingKey = true;
    renderSettingsModal(true);
  }

  /**
   * Renderiza el contenido del modal de opciones / clave API
   * @param {boolean} isJustInTime Indica si se abrió de forma contextual desde una acción
   */
  function renderSettingsModal(isJustInTime = false) {
    const modal = document.getElementById('modal-settings');
    if (!modal) return;

    let keyContentHTML = '';

    if (state.hasKey && !state.isEditingKey) {
      keyContentHTML = `
        <div class="api-key-configured-card">
          <div class="api-key-status-row">
            <div class="api-key-badge-success">
              <svg class="icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span>Clave configurada y activa</span>
            </div>
            <code class="api-key-masked">${state.maskedKey}</code>
          </div>
          <div class="api-key-card-actions">
            <button type="button" class="btn-secondary" id="btn-change-api-key">
              Cambiar Clave
            </button>
            <button type="button" class="btn-text-danger" id="btn-remove-api-key">
              Eliminar
            </button>
          </div>
        </div>
      `;
    } else {
      keyContentHTML = `
        <form id="form-api-key" class="api-key-form">
          <div class="form-group">
            <label for="input-gemini-key" class="form-label">
              API Key de Google Gemini <span class="required-star">*</span>
            </label>
            <div class="api-key-input-wrap">
              <input
                type="password"
                id="input-gemini-key"
                class="form-control"
                placeholder="AIzaSy..."
                autocomplete="off"
                spellcheck="false"
                required
              />
              <button type="button" class="btn-icon btn-toggle-pwd" id="btn-toggle-key-visibility" title="Mostrar/Ocultar clave" aria-label="Mostrar/Ocultar clave">
                <svg class="icon-svg icon-eye" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
            <p class="form-hint api-key-help-text">
              ¿No tienes una clave? Puedes obtenerla de forma gratuita con tu cuenta de Google en
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="link-external">
                Google AI Studio ↗
              </a>.
            </p>
          </div>

          <div class="api-key-actions-row">
            ${state.hasKey ? `
              <button type="button" class="btn-secondary" id="btn-cancel-edit-key">Cancelar</button>
            ` : ''}
            <button type="submit" class="btn-primary" id="btn-save-api-key">
              <span>${isJustInTime ? 'Guardar y Continuar' : 'Guardar Clave'}</span>
            </button>
          </div>
        </form>
      `;
    }

    modal.innerHTML = `
      <div class="modal-dialog-content settings-dialog-box">
        <header class="modal-dialog-header">
          <div class="modal-dialog-title-wrap">
            <svg class="icon-svg modal-header-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <h3 class="modal-dialog-title" id="modal-settings-title">
              ${isJustInTime ? 'Clave de Inteligencia Artificial Requerida' : 'Opciones y Configuración'}
            </h3>
          </div>
          <button type="button" class="btn-icon btn-close-dialog" id="btn-close-settings-modal" aria-label="Cerrar ventana">
            <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>

        <div class="settings-dialog-body">
          <section class="settings-section">
            <div class="settings-section-header">
              <h4 class="settings-section-title">Generación con Google Gemini</h4>
              <p class="settings-section-desc">
                La clave API se utiliza localmente en tu equipo para analizar tus apuntes docentes y generar preguntas y actividades interactivas H5P con IA.
              </p>
            </div>
            ${keyContentHTML}
          </section>
        </div>

        <footer class="modal-dialog-footer">
          <button type="button" class="btn-secondary" id="btn-footer-close-settings">
            Cerrar
          </button>
        </footer>
      </div>
    `;

    modal.classList.remove('hidden');

    const closeModal = () => {
      modal.classList.add('hidden');
      state.isEditingKey = false;
      state.onSuccessCallback = null;
    };

    const btnClose = document.getElementById('btn-close-settings-modal');
    if (btnClose) btnClose.addEventListener('click', closeModal);

    const btnFooterClose = document.getElementById('btn-footer-close-settings');
    if (btnFooterClose) btnFooterClose.addEventListener('click', closeModal);

    // Botón cambiar clave
    const btnChange = document.getElementById('btn-change-api-key');
    if (btnChange) {
      btnChange.addEventListener('click', () => {
        state.isEditingKey = true;
        renderSettingsModal(isJustInTime);
      });
    }

    // Botón cancelar edición
    const btnCancelEdit = document.getElementById('btn-cancel-edit-key');
    if (btnCancelEdit) {
      btnCancelEdit.addEventListener('click', () => {
        state.isEditingKey = false;
        renderSettingsModal(isJustInTime);
      });
    }

    // Botón eliminar clave
    const btnRemove = document.getElementById('btn-remove-api-key');
    if (btnRemove) {
      btnRemove.addEventListener('click', async () => {
        if (confirm('¿Deseas desvincular tu API Key de Gemini? Tendrás que ingresarla nuevamente para generar actividades.')) {
          await api.removeApiKey();
          await refreshStatus();
          state.isEditingKey = true;
          renderSettingsModal(isJustInTime);
        }
      });
    }

    // Toggle visibilidad de contraseña
    const btnTogglePwd = document.getElementById('btn-toggle-key-visibility');
    const inputKey = document.getElementById('input-gemini-key');
    if (btnTogglePwd && inputKey) {
      btnTogglePwd.addEventListener('click', () => {
        const isPassword = inputKey.type === 'password';
        inputKey.type = isPassword ? 'text' : 'password';
        btnTogglePwd.classList.toggle('active', isPassword);
      });
      setTimeout(() => inputKey.focus(), 100);
    }

    // Formulario de guardado
    const formKey = document.getElementById('form-api-key');
    if (formKey) {
      formKey.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rawKey = inputKey.value.trim();
        if (!rawKey) {
          alert('Por favor ingresa una clave API válida.');
          return;
        }

        try {
          const res = await api.saveApiKey(rawKey);
          state.hasKey = res.hasKey;
          state.maskedKey = res.maskedKey;
          state.isEditingKey = false;
          notifyListeners();

          const cb = state.onSuccessCallback;
          closeModal();

          if (typeof cb === 'function') {
            cb();
          }
        } catch (err) {
          alert(`Error al guardar la clave API: ${err.message}`);
        }
      });
    }
  }

  // =========================================================================
  // INICIALIZACIÓN
  // =========================================================================

  async function init() {
    await refreshStatus();

    // Conectar botón "Opciones" en el menú lateral
    const btnMenuSettings = document.getElementById('menu-opt-settings');
    if (btnMenuSettings) {
      btnMenuSettings.addEventListener('click', () => {
        const btnCloseMenu = document.getElementById('btn-close-menu');
        if (btnCloseMenu) btnCloseMenu.click();
        openSettingsModal();
      });
    }
  }

  window.configManager = {
    init,
    openSettingsModal,
    requireApiKey,
    refreshStatus,
    hasApiKey: () => state.hasKey,
    getApiKeyStatus: () => ({ hasKey: state.hasKey, maskedKey: state.maskedKey }),
    onStatusChange: (callback) => {
      if (typeof callback === 'function') {
        state.listeners.push(callback);
        // Llamada inmediata con el estado actual
        callback({ hasKey: state.hasKey, maskedKey: state.maskedKey });
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
