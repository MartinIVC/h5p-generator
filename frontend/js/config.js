/**
 * frontend/js/config.js
 * Módulo de Opciones y Configuración (Tema visual y Gestión de Google Gemini API Key).
 * Gestiona la selección de temas (Claro / Oscuro / Sistema), las credenciales de IA
 * y el modal accesible de configuración general y Just-in-Time.
 */

(function () {
  'use strict';

  // =========================================================================
  // CONSTANTES Y ESTADO
  // =========================================================================

  const THEMES = {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system'
  };

  const THEME_STORAGE_KEY = 'h5p_theme_preference';

  const state = {
    currentTheme: localStorage.getItem(THEME_STORAGE_KEY) || THEMES.SYSTEM,
    hasKey: false,
    maskedKey: '',
    isEditingKey: false,
    onSuccessCallback: null,
    listeners: []
  };

  // =========================================================================
  // GESTIÓN DE TEMAS (CLARO / OSCURO / SISTEMA)
  // =========================================================================

  /**
   * Resuelve si el sistema operativo tiene activado el modo oscuro
   * @returns {boolean}
   */
  function isSystemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Aplica la clase correspondiente ('dark' o 'light') en el elemento <html>
   * @param {string} theme ('light' | 'dark' | 'system')
   */
  function applyTheme(theme) {
    const root = document.documentElement;
    let effectiveDark = false;

    if (theme === THEMES.DARK) {
      effectiveDark = true;
    } else if (theme === THEMES.LIGHT) {
      effectiveDark = false;
    } else {
      // Modo Sistema
      effectiveDark = isSystemDark();
    }

    if (effectiveDark) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    state.currentTheme = theme;
  }

  /**
   * Guarda y aplica la preferencia de tema seleccionada
   * @param {string} theme ('light' | 'dark' | 'system')
   */
  function setTheme(theme) {
    if (!Object.values(THEMES).includes(theme)) return;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme(theme);
    updateThemeUI();
  }

  /**
   * Actualiza los estados visuales (radio y tarjeta activa) dentro del modal
   */
  function updateThemeUI() {
    const modal = document.getElementById('modal-settings');
    if (!modal || modal.classList.contains('hidden')) return;

    const cards = modal.querySelectorAll('.theme-option-card');
    cards.forEach(card => {
      const value = card.getAttribute('data-theme');
      const isSelected = value === state.currentTheme;
      card.classList.toggle('active', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');

      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = isSelected;
    });
  }

  // =========================================================================
  // GESTIÓN DE API KEY DE GEMINI
  // =========================================================================

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

  // =========================================================================
  // RENDERIZADO DEL MODAL
  // =========================================================================

  /**
   * Genera el HTML de la sección de apariencia (selector de tema)
   */
  function getThemeSectionHTML() {
    return `
      <section class="settings-section">
        <div class="settings-section-header">
          <h4 class="settings-section-title">Apariencia</h4>
          <p class="settings-section-desc">
            Elige el tema visual para la interfaz del generador.
          </p>
        </div>

        <div class="theme-selector-grid" role="radiogroup" aria-label="Selección de tema visual">
          <!-- Opción Claro -->
          <label
            class="theme-option-card ${state.currentTheme === THEMES.LIGHT ? 'active' : ''}"
            data-theme="${THEMES.LIGHT}"
            role="radio"
            aria-checked="${state.currentTheme === THEMES.LIGHT ? 'true' : 'false'}"
            tabindex="0"
          >
            <input
              type="radio"
              name="theme-choice"
              value="${THEMES.LIGHT}"
              class="hidden-radio"
              ${state.currentTheme === THEMES.LIGHT ? 'checked' : ''}
            />
            <div class="theme-icon-circle theme-icon-light">
              <svg class="icon-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            </div>
            <div class="theme-card-info">
              <strong class="theme-card-title">Tema Claro</strong>
              <span class="theme-card-desc">Diseño estándar luminoso</span>
            </div>
          </label>

          <!-- Opción Oscuro -->
          <label
            class="theme-option-card ${state.currentTheme === THEMES.DARK ? 'active' : ''}"
            data-theme="${THEMES.DARK}"
            role="radio"
            aria-checked="${state.currentTheme === THEMES.DARK ? 'true' : 'false'}"
            tabindex="0"
          >
            <input
              type="radio"
              name="theme-choice"
              value="${THEMES.DARK}"
              class="hidden-radio"
              ${state.currentTheme === THEMES.DARK ? 'checked' : ''}
            />
            <div class="theme-icon-circle theme-icon-dark">
              <svg class="icon-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            </div>
            <div class="theme-card-info">
              <strong class="theme-card-title">Tema Oscuro</strong>
              <span class="theme-card-desc">Reduce el cansancio visual</span>
            </div>
          </label>

          <!-- Opción Sistema -->
          <label
            class="theme-option-card ${state.currentTheme === THEMES.SYSTEM ? 'active' : ''}"
            data-theme="${THEMES.SYSTEM}"
            role="radio"
            aria-checked="${state.currentTheme === THEMES.SYSTEM ? 'true' : 'false'}"
            tabindex="0"
          >
            <input
              type="radio"
              name="theme-choice"
              value="${THEMES.SYSTEM}"
              class="hidden-radio"
              ${state.currentTheme === THEMES.SYSTEM ? 'checked' : ''}
            />
            <div class="theme-icon-circle theme-icon-system">
              <svg class="icon-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
            </div>
            <div class="theme-card-info">
              <strong class="theme-card-title">Sistema</strong>
              <span class="theme-card-desc">Sincroniza con tu equipo</span>
            </div>
          </label>
        </div>
      </section>
    `;
  }

  /**
   * Genera el HTML de la sección de Google Gemini API Key
   */
  function getApiKeySectionHTML(isJustInTime) {
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
              API Key de Google Gemini <span class="required-indicator">*</span>
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
              <button
                type="button"
                class="btn-icon btn-toggle-pwd"
                id="btn-toggle-key-visibility"
                title="Mostrar/Ocultar clave"
                aria-label="Mostrar u ocultar clave"
              >
                <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
            <p class="api-key-help-text">
              ¿No tienes una clave? Puedes obtenerla de forma gratuita en
              <a href="#" class="link-external" id="link-get-gemini-key" target="_blank" rel="noopener noreferrer">
                Google AI Studio &nearr;
              </a>
            </p>
          </div>
          <div class="api-key-actions-row">
            ${state.hasKey ? `
              <button type="button" class="btn-secondary" id="btn-cancel-edit-key">
                Cancelar
              </button>
            ` : ''}
            <button type="submit" class="btn-primary" id="btn-save-api-key">
              ${state.hasKey ? 'Actualizar Clave' : 'Guardar Clave'}
            </button>
          </div>
        </form>
      `;
    }

    return `
      <section class="settings-section">
        <div class="settings-section-header">
          <h4 class="settings-section-title">Generación con Google Gemini</h4>
          <p class="settings-section-desc">
            ${isJustInTime
              ? 'Se requiere una clave API para generar actividades H5P interactivas con IA a partir de tus documentos docentes.'
              : 'La clave API se utiliza localmente en tu equipo para analizar tus apuntes docentes y generar preguntas y actividades interactivas H5P con IA.'}
          </p>
        </div>
        ${keyContentHTML}
      </section>
    `;
  }

  /**
   * Renderiza el contenido del modal de opciones / clave API
   * @param {boolean} isJustInTime Indica si se abrió de forma contextual desde una acción
   */
  function renderSettingsModal(isJustInTime = false) {
    const modal = document.getElementById('modal-settings');
    if (!modal) return;

    const headerTitle = isJustInTime
      ? 'Clave de Inteligencia Artificial Requerida'
      : 'Opciones y Configuración';

    let bodyContent = '';
    if (isJustInTime) {
      bodyContent = getApiKeySectionHTML(true);
    } else {
      bodyContent = `
        ${getThemeSectionHTML()}
        <hr class="settings-divider" />
        ${getApiKeySectionHTML(false)}
      `;
    }

    modal.innerHTML = `
      <div class="modal-dialog-content settings-dialog-box" role="dialog" aria-modal="true" aria-labelledby="modal-settings-title">
        <header class="modal-dialog-header">
          <div class="modal-dialog-title-wrap">
            <svg class="icon-svg modal-header-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <h3 class="modal-dialog-title" id="modal-settings-title">${headerTitle}</h3>
          </div>
          <button type="button" class="btn-icon btn-close-dialog" id="btn-close-settings-modal" aria-label="Cerrar ventana">
            <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>

        <div class="settings-dialog-body">
          ${bodyContent}
        </div>

        <footer class="modal-dialog-footer">
          <button type="button" class="${isJustInTime ? 'btn-secondary' : 'btn-primary'}" id="btn-close-settings-modal-footer">
            ${isJustInTime ? 'Cerrar' : 'Listo'}
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

    const btnFooterClose = document.getElementById('btn-close-settings-modal-footer');
    if (btnFooterClose) btnFooterClose.addEventListener('click', closeModal);

    // Eventos de selección de tema (si está presente)
    const themeCards = modal.querySelectorAll('.theme-option-card');
    themeCards.forEach(card => {
      const selectCard = () => {
        const themeValue = card.getAttribute('data-theme');
        setTheme(themeValue);
      };

      card.addEventListener('click', selectCard);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectCard();
        }
      });
    });

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

    // Toggle visibilidad de clave
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

    // Link externo a Google AI Studio
    const linkStudio = document.getElementById('link-get-gemini-key');
    if (linkStudio) {
      linkStudio.addEventListener('click', (e) => {
        e.preventDefault();
        const url = 'https://aistudio.google.com/app/apikey';
        if (window.academicAPI && typeof window.academicAPI.openExternalUrl === 'function') {
          window.academicAPI.openExternalUrl(url);
        } else {
          window.open(url, '_blank');
        }
      });
    }

    // Formulario de guardado de clave
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

  // Aplicar tema inmediatamente (evita parpadeo de pantalla en blanco)
  applyTheme(state.currentTheme);

  // Escuchar cambios de preferencia del sistema si está en modo SYSTEM
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (state.currentTheme === THEMES.SYSTEM) {
        applyTheme(THEMES.SYSTEM);
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleSystemChange);
    }
  }

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

    // Soporte para cerrar modal con Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('modal-settings');
        if (modal && !modal.classList.contains('hidden')) {
          modal.classList.add('hidden');
          state.isEditingKey = false;
          state.onSuccessCallback = null;
        }
      }
    });
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
    },
    getTheme: () => state.currentTheme,
    setTheme,
    THEMES
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
