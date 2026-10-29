/**
 * upload.js
 * Componente modular para el panel de subida de archivos y prompt (Paso 1).
 * Inserta la interfaz dinámicamente y gestiona la lista enumerada de archivos.
 * Valida formatos que el extractor actual procesa (PDF y TXT).
 */

(function () {
  'use strict';

  // Mantener la selección alineada con backend/chunker.js.
  const ALLOWED_EXTENSIONS = ['pdf', 'txt'];

  // String para el atributo accept del input file
  const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map(ext => `.${ext}`).join(',');

  // Estado interno del módulo
  const state = {
    files: [],
    prompt: ''
  };

  /**
   * Obtiene la extensión en minúsculas de un nombre de archivo.
   * @param {string} filename
   * @returns {string}
   */
  function getFileExtension(filename) {
    if (!filename || typeof filename !== 'string' || !filename.includes('.')) {
      return '';
    }
    return filename.split('.').pop().toLowerCase();
  }

  /**
   * Determina si el formato de archivo es aceptado.
   * @param {string} filename
   * @returns {boolean}
   */
  function isFormatAllowed(filename) {
    const ext = getFileExtension(filename);
    return ALLOWED_EXTENSIONS.includes(ext);
  }

  /**
   * Da formato legible en Bytes, KB, MB o GB al tamaño de un archivo.
   * @param {number} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Construye el markup HTML del panel de subida.
   * @returns {string}
   */
  function getTemplate() {
    return `
      <div class="upload-card-wrapper">
        <header class="upload-panel-header">
          <h2 class="upload-panel-title">Material e instrucciones</h2>
          <p class="upload-panel-subtitle">
            Añade apuntes en PDF o TXT y orienta la actividad con instrucciones breves.
          </p>
        </header>

        <div class="upload-main-grid">
          <!-- Columna izquierda: Zona de carga y Botón Upload -->
          <div class="upload-dropzone" id="upload-dropzone" aria-describedby="upload-dropzone-desc upload-formats-hint">
            <input type="file" id="upload-file-input" class="hidden" multiple accept="${ACCEPT_ATTR}" />
            
            <div class="upload-icon-circle">
              <svg class="icon-svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            </div>

            <h3 class="upload-dropzone-title">Arrastra y suelta tus archivos aquí</h3>
            <p class="upload-dropzone-desc" id="upload-dropzone-desc">Arrastra los documentos hasta aquí o selecciónalos desde tu equipo.</p>

            <button type="button" class="btn-primary" id="btn-trigger-upload">
              <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>Subir Archivos</span>
            </button>

            <span class="upload-formats-hint" id="upload-formats-hint">Formatos disponibles para generar: PDF y TXT.</span>
          </div>

          <!-- Columna derecha: Lista de archivos enumerada al lado del botón upload -->
          <div class="file-list-card">
            <div class="file-list-header">
              <div class="file-list-title-wrap">
                <h3 class="file-list-title">Archivos seleccionados</h3>
                <span class="file-badge-count" id="file-count-badge" aria-label="Cantidad de archivos">0</span>
              </div>
              <button type="button" class="btn-text-danger hidden" id="btn-clear-all" title="Eliminar todos los archivos seleccionados">
                Limpiar todo
              </button>
            </div>

            <div class="file-list-scroll">
              <div class="file-list-content" id="file-list-content">
                <!-- Se llena dinámicamente con la lista enumerada o el estado vacío -->
              </div>
            </div>
          </div>
        </div>

        <!-- Sección de Prompt e instrucciones adicionales -->
        <div class="upload-prompt-section">
          <label for="upload-prompt-input" class="upload-prompt-label">
            Instrucciones para la actividad (opcional):
          </label>
          <textarea
            id="upload-prompt-input"
            class="upload-prompt-textarea"
            rows="3"
            placeholder="Ejemplo: Evalúa los conceptos principales con preguntas de dificultad media..."></textarea>
        </div>

        <!-- Acciones del pie del panel -->
        <footer class="upload-footer-actions">
          <div class="upload-summary-info" id="upload-summary-info" role="status" aria-live="polite" aria-atomic="true">
            No se han seleccionado archivos
          </div>
          <button type="button" class="btn-primary" id="btn-next-step" disabled>
            <span>Continuar a Tipo H5P</span>
            <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </footer>
      </div>
    `;
  }

  /**
   * Genera el HTML del estado vacío cuando no hay archivos.
   * @returns {string}
   */
  function getEmptyStateTemplate() {
    return `
      <div class="file-list-empty">
        <svg class="icon-svg file-list-empty-icon" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        <p class="file-list-empty-title">No hay archivos seleccionados</p>
        <p class="file-list-empty-desc">
          Usa el botón de subida o arrastra tus documentos para enumerarlos aquí.
        </p>
      </div>
    `;
  }

  /**
   * Genera el HTML de la lista enumerada de archivos con soporte de estado de error.
   * @param {Array<File>} files
   * @returns {string}
   */
  function getFileListTemplate(files) {
    const items = files.map((file, index) => {
      const num = index + 1;
      const sizeStr = formatFileSize(file.size);
      const safeName = escapeHtml(file.name);
      const allowed = isFormatAllowed(file.name);
      const ext = getFileExtension(file.name);

      if (!allowed) {
        // Renderizado de archivo con error (marcado en rojo según paleta de colores)
        return `
          <li class="file-item file-item-error" data-index="${index}">
            <span class="file-item-number" aria-hidden="true">${num}</span>
            <svg class="icon-svg file-item-icon file-item-icon-error" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <div class="file-item-info">
              <div class="file-item-title-row">
                <span class="file-item-name" title="${safeName}">${safeName}</span>
                <span class="file-item-error-tag">Error</span>
              </div>
              <span class="file-item-error-msg">Formato ${ext ? `.${escapeHtml(ext)}` : 'desconocido'} no admitido</span>
            </div>
            <button type="button" class="btn-icon file-item-remove" data-action="remove" data-index="${index}" title="Quitar archivo no admitido" aria-label="Quitar ${safeName}">
              <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </li>
        `;
      }

      // Renderizado normal de archivo válido
      return `
        <li class="file-item" data-index="${index}">
          <span class="file-item-number" aria-hidden="true">${num}</span>
          <svg class="icon-svg file-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <div class="file-item-info">
            <span class="file-item-name" title="${safeName}">${safeName}</span>
            <span class="file-item-size">${sizeStr}</span>
          </div>
          <button type="button" class="btn-icon file-item-preview" data-action="preview" data-index="${index}" title="Previsualizar archivo" aria-label="Previsualizar ${safeName}">
            <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button type="button" class="btn-icon file-item-remove" data-action="remove" data-index="${index}" title="Quitar archivo" aria-label="Quitar ${safeName}">
            <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </li>
      `;
    }).join('');

    return `<ol class="file-items-list" aria-label="Lista de archivos subidos">${items}</ol>`;
  }

  /**
   * Sanitiza strings para inserción segura en atributos y texto.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Inicializa el panel upload cuando el DOM esté disponible.
   */
  function initUploadPanel() {
    const container = document.getElementById('panel-upload');
    if (!container) {
      console.warn('Contenedor #panel-upload no encontrado en el DOM.');
      return;
    }

    // Insertar markup en el contenedor
    container.innerHTML = getTemplate();

    // Cachear referencias del DOM
    const dropzone = container.querySelector('#upload-dropzone');
    const fileInput = container.querySelector('#upload-file-input');
    const btnTriggerUpload = container.querySelector('#btn-trigger-upload');
    const fileCountBadge = container.querySelector('#file-count-badge');
    const btnClearAll = container.querySelector('#btn-clear-all');
    const fileListContent = container.querySelector('#file-list-content');
    const promptInput = container.querySelector('#upload-prompt-input');
    const summaryInfo = container.querySelector('#upload-summary-info');
    const btnNextStep = container.querySelector('#btn-next-step');

    /**
     * Renderiza la lista de archivos y actualiza los indicadores y validaciones.
     */
    function updateUI() {
      const count = state.files.length;
      fileCountBadge.textContent = count;

      if (count === 0) {
        fileListContent.innerHTML = getEmptyStateTemplate();
        btnClearAll.classList.add('hidden');
        btnNextStep.disabled = true;
        summaryInfo.className = 'upload-summary-info';
        summaryInfo.innerHTML = 'No se han seleccionado archivos';
        return;
      }

      fileListContent.innerHTML = getFileListTemplate(state.files);
      btnClearAll.classList.remove('hidden');

      const validFiles = state.files.filter(f => isFormatAllowed(f.name));
      const errorFiles = state.files.filter(f => !isFormatAllowed(f.name));
      const hasErrors = errorFiles.length > 0;

      // El botón solo se habilita si no hay errores y hay al menos un archivo válido
      btnNextStep.disabled = hasErrors || validFiles.length === 0;

      if (hasErrors) {
        summaryInfo.className = 'upload-summary-info has-error';
        const errPlural = errorFiles.length === 1 ? 'archivo con formato no permitido' : 'archivos con formatos no permitidos';
        summaryInfo.innerHTML = `<strong>Formato no disponible:</strong> ${errorFiles.length} ${errPlural}. Quita los archivos que no sean PDF o TXT para continuar.`;
      } else {
        summaryInfo.className = 'upload-summary-info';
        const totalBytes = validFiles.reduce((acc, f) => acc + (f.size || 0), 0);
        const plural = count === 1 ? 'archivo' : 'archivos';
        summaryInfo.innerHTML = `<strong>${count}</strong> ${plural} válido${count === 1 ? '' : 's'} (${formatFileSize(totalBytes)} en total)`;
      }
    }

    /**
     * Añade archivos acumulativamente, evitando duplicados exactos.
     * @param {FileList|Array<File>} newFiles
     */
    function addFiles(newFiles) {
      if (!newFiles || newFiles.length === 0) return;
      const previousCount = state.files.length;

      Array.from(newFiles).forEach((newFile) => {
        // Evita duplicados basados en nombre, tamaño y fecha
        const exists = state.files.some((f) =>
          f.name === newFile.name &&
          f.size === newFile.size &&
          f.lastModified === newFile.lastModified
        );
        if (!exists) {
          state.files.push(newFile);
        }
      });

      updateUI();
      fileListContent.querySelectorAll('.file-item').forEach((item, index) => {
        item.classList.toggle('is-new', index >= previousCount);
      });
    }

    /**
     * Remueve un archivo por su índice.
     * @param {number} index
     */
    function removeFile(index) {
      if (index >= 0 && index < state.files.length) {
        state.files.splice(index, 1);
        if (state.files.length === 0 && window.previewManager && window.previewManager.isOpen()) {
          window.previewManager.close();
        }
        updateUI();
      }
    }

    /**
     * Elimina todos los archivos seleccionados.
     */
    function clearAllFiles() {
      state.files = [];
      fileInput.value = '';
      if (window.previewManager && window.previewManager.isOpen()) {
        window.previewManager.close();
      }
      updateUI();
    }

    // --- Listeners de Eventos ---

    // Disparador de selección de archivos desde botón
    btnTriggerUpload.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    // Evento de cambio en el input de archivos
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        addFiles(fileInput.files);
        fileInput.value = ''; // Permite volver a seleccionar el mismo archivo si se quitó
      }
    });

    // Drag and Drop en la dropzone
    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-active');
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-active');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dropzone.contains(e.relatedTarget)) {
        dropzone.classList.remove('drag-active');
      }
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-active');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    });

    // Delegación de eventos para la lista de archivos (previsualizar o remover archivo)
    fileListContent.addEventListener('click', (e) => {
      // Acción de previsualizar
      const previewBtn = e.target.closest('[data-action="preview"]');
      if (previewBtn) {
        e.stopPropagation();
        const idx = parseInt(previewBtn.getAttribute('data-index'), 10);
        if (!isNaN(idx) && window.previewManager) {
          window.previewManager.open(state.files, idx);
        }
        return;
      }

      // Acción de remover
      const removeBtn = e.target.closest('[data-action="remove"]');
      if (removeBtn) {
        e.stopPropagation();
        const idx = parseInt(removeBtn.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          removeFile(idx);
        }
      }
    });

    // Botón de limpiar todo
    btnClearAll.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllFiles();
    });

    // Input de prompt
    promptInput.addEventListener('input', (e) => {
      state.prompt = e.target.value;
    });

    function updateStepIndicators(activeStep) {
      [1, 2, 3].forEach(step => {
        const indicator = document.getElementById(`step-indicator-${step}`);
        if (!indicator) return;
        indicator.classList.toggle('active', step === activeStep);
        indicator.classList.toggle('completed', step < activeStep);
        if (step === activeStep) indicator.setAttribute('aria-current', 'step');
        else indicator.removeAttribute('aria-current');
      });
    }

    function returnToMaterial() {
      const panelUpload = document.getElementById('panel-upload');
      const panelSelector = document.getElementById('panel-selector');
      if (!panelUpload || !panelSelector) return;
      panelSelector.classList.add('hidden');
      panelUpload.classList.remove('hidden');
      updateStepIndicators(1);
      document.getElementById('btn-next-step')?.focus();
    }

    // El selector H5P real se integra junto con la generación; nunca dejar el paso vacío.
    btnNextStep.addEventListener('click', () => {
      const panelUpload = document.getElementById('panel-upload');
      const panelSelector = document.getElementById('panel-selector');
      if (!panelUpload || !panelSelector) return;

      const safeList = state.files
        .filter(file => isFormatAllowed(file.name))
        .map(file => `<li>${escapeHtml(file.name)}</li>`)
        .join('');

      panelSelector.innerHTML = `
        <section class="upcoming-step-card" aria-labelledby="selector-pending-title">
          <div class="upcoming-step-art" aria-hidden="true">
            <svg viewBox="0 0 96 96" fill="none">
              <rect x="19" y="17" width="48" height="60" rx="9" transform="rotate(-9 19 17)" class="paper-shape paper-shape-back" />
              <rect x="28" y="21" width="48" height="60" rx="9" class="paper-shape paper-shape-front" />
              <path d="M39 39h25M39 48h25M39 57h16" class="paper-lines" />
              <circle cx="75" cy="25" r="8" class="paper-spark" />
            </svg>
          </div>
          <span class="home-kicker">Paso 2 · Tipo de actividad</span>
          <h2 id="selector-pending-title" tabindex="-1">El selector H5P estará disponible aquí</h2>
          <p>Ya reuniste el material. La generación y exportación H5P aún no están conectadas, así que puedes volver a revisar los documentos sin perderlos.</p>
          <ul class="upcoming-file-summary">${safeList}</ul>
          <div class="upcoming-step-actions">
            <button type="button" class="btn-secondary" id="btn-back-to-material">Volver al material</button>
          </div>
        </section>
      `;
      panelUpload.classList.add('hidden');
      panelSelector.classList.remove('hidden');
      updateStepIndicators(2);
      document.getElementById('btn-back-to-material')?.addEventListener('click', returnToMaterial);
      document.getElementById('selector-pending-title')?.focus();
    });

    // Prevenir comportamiento por defecto de arrastrar archivos a nivel de ventana
    window.addEventListener('dragover', (e) => e.preventDefault(), false);
    window.addEventListener('drop', (e) => e.preventDefault(), false);

    // Render inicial
    updateUI();
  }

  // Interfaz pública para interoperabilidad con otros módulos
  window.uploadManager = {
    getFiles: () => state.files.filter(f => isFormatAllowed(f.name)),
    getAllFiles: () => [...state.files],
    hasErrors: () => state.files.some(f => !isFormatAllowed(f.name)),
    getPrompt: () => state.prompt,
    clearFiles: () => {
      state.files = [];
      const btnClearAll = document.getElementById('btn-clear-all');
      if (btnClearAll) btnClearAll.click();
    }
  };

  // Inicializar al cargar el DOM o inmediatamente si ya cargó
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUploadPanel);
  } else {
    initUploadPanel();
  }
})();
