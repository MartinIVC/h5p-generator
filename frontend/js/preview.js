/**
 * preview.js
 * Módulo para la visualización previa de archivos cargados por el usuario.
 * Gestiona el visor modal, ciclo de vida de URLs Blob en memoria,
 * lectura asíncrona de archivos de texto y navegación entre documentos.
 */

(function () {
  'use strict';

  // Extensiones clasificadas por tipo de visor
  const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'json', 'log', 'rtf'];
  const OFFICE_EXTENSIONS = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'odt', 'ods', 'odp'];

  // Estado interno del visor
  const state = {
    files: [],
    currentIndex: 0,
    currentObjectUrl: null,
    isOpen: false
  };

  // Referencias a los elementos del DOM
  let modalEl = null;
  let dialogEl = null;
  let closeBtnEl = null;
  let titleEl = null;
  let subtitleEl = null;
  let bodyEl = null;
  let prevBtnEl = null;
  let nextBtnEl = null;
  let counterEl = null;
  let detailsEl = null;

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
   * Formatea el tamaño en bytes a una representación legible (KB, MB, etc.).
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Formatea la fecha de última modificación a formato local.
   * @param {number|Date} timestamp
   * @returns {string}
   */
  function formatDate(timestamp) {
    if (!timestamp) return 'Desconocida';
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Sanitiza strings para inserción segura en el DOM.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /**
   * Libera cualquier Object URL activo en memoria para evitar fugas (memory leaks).
   */
  function revokeActiveObjectUrl() {
    if (state.currentObjectUrl) {
      URL.revokeObjectURL(state.currentObjectUrl);
      state.currentObjectUrl = null;
    }
  }

  /**
   * Renderiza un archivo PDF en un iframe mediante un Object URL de blob.
   * @param {File} file
   */
  function renderPdf(file) {
    revokeActiveObjectUrl();
    state.currentObjectUrl = URL.createObjectURL(file);

    const iframe = document.createElement('iframe');
    iframe.className = 'preview-iframe';
    iframe.src = state.currentObjectUrl;
    iframe.title = `Visor PDF de ${file.name}`;

    bodyEl.innerHTML = '';
    bodyEl.appendChild(iframe);
  }

  /**
   * Renderiza archivos de texto plano o markdown con lectura segura en pre/code.
   * @param {File} file
   */
  function renderText(file) {
    revokeActiveObjectUrl();
    bodyEl.innerHTML = `
      <div class="preview-text-wrapper">
        <p class="preview-loading-text">Cargando contenido...</p>
      </div>
    `;

    const reader = new FileReader();

    reader.onload = function (event) {
      const textContent = event.target.result || '(El archivo está vacío)';

      const wrapper = document.createElement('div');
      wrapper.className = 'preview-text-wrapper';

      const pre = document.createElement('pre');
      pre.className = 'preview-text-content';

      const code = document.createElement('code');
      // Uso estricto de textContent para evitar inyección de código/XSS
      code.textContent = textContent;

      pre.appendChild(code);
      wrapper.appendChild(pre);

      bodyEl.innerHTML = '';
      bodyEl.appendChild(wrapper);
    };

    reader.onerror = function () {
      bodyEl.innerHTML = `
        <div class="preview-unsupported-card">
          <p class="preview-unsupported-desc is-error">
            No fue posible leer el archivo de texto: ${escapeHtml(file.name)}
          </p>
        </div>
      `;
    };

    reader.readAsText(file, 'utf-8');
  }

  /**
   * Renderiza una tarjeta informativa con metadatos para formatos de Office o no visualizables directamente.
   * @param {File} file
   * @param {string} ext
   */
  function renderUnsupportedOffice(file, ext) {
    revokeActiveObjectUrl();

    const isOffice = OFFICE_EXTENSIONS.includes(ext);
    const badgeText = isOffice ? 'Documento de Oficina' : 'Formato Binario';

    bodyEl.innerHTML = `
      <div class="preview-unsupported-card">
        <svg class="icon-svg preview-unsupported-icon" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>

        <h3 class="preview-unsupported-title">${escapeHtml(file.name)}</h3>
        <p class="preview-unsupported-desc">
          Este archivo es un <strong>${badgeText} (.${escapeHtml(ext.toUpperCase())})</strong>.
          La vista previa visual directa no está disponible en el explorador, pero su contenido será extraído y procesado por el sistema RAG al generar las actividades H5P.
        </p>

        <div class="preview-metadata-box">
          <div class="preview-metadata-row">
            <span class="preview-metadata-label">Extensión:</span>
            <span class="preview-metadata-value">.${escapeHtml(ext.toUpperCase())}</span>
          </div>
          <div class="preview-metadata-row">
            <span class="preview-metadata-label">Tamaño:</span>
            <span class="preview-metadata-value">${formatBytes(file.size)}</span>
          </div>
          <div class="preview-metadata-row">
            <span class="preview-metadata-label">Última modificación:</span>
            <span class="preview-metadata-value">${formatDate(file.lastModified)}</span>
          </div>
          <div class="preview-metadata-row">
            <span class="preview-metadata-label">Tipo MIME:</span>
            <span class="preview-metadata-value">${escapeHtml(file.type || 'application/octet-stream')}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza el archivo actual según el índice en el estado.
   */
  function renderCurrentFile() {
    if (!state.files || state.files.length === 0) {
      closeModal();
      return;
    }

    const total = state.files.length;
    const currentFile = state.files[state.currentIndex];
    const ext = getFileExtension(currentFile.name);

    // Actualizar cabecera
    titleEl.textContent = currentFile.name;
    titleEl.title = currentFile.name;
    subtitleEl.textContent = `${formatBytes(currentFile.size)} • Formato .${ext.toUpperCase()}`;

    // Actualizar controles de navegación y pie
    counterEl.textContent = `${state.currentIndex + 1} / ${total}`;
    prevBtnEl.disabled = state.currentIndex <= 0;
    nextBtnEl.disabled = state.currentIndex >= total - 1;

    detailsEl.textContent = `Archivo ${state.currentIndex + 1} de ${total}`;

    // Renderizar según tipo de archivo
    if (ext === 'pdf' || currentFile.type === 'application/pdf') {
      renderPdf(currentFile);
    } else if (TEXT_EXTENSIONS.includes(ext) || (currentFile.type && currentFile.type.startsWith('text/'))) {
      renderText(currentFile);
    } else {
      renderUnsupportedOffice(currentFile, ext);
    }
  }

  /**
   * Avanza al siguiente archivo.
   */
  function nextFile() {
    if (state.currentIndex < state.files.length - 1) {
      state.currentIndex++;
      renderCurrentFile();
    }
  }

  /**
   * Retrocede al archivo anterior.
   */
  function prevFile() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      renderCurrentFile();
    }
  }

  /**
   * Manejador de teclado para atajos (Escape, Flechas izquierda y derecha).
   * @param {KeyboardEvent} e
   */
  function handleKeyDown(e) {
    if (!state.isOpen) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextFile();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevFile();
    }
  }

  /**
   * Abre el modal de previsualización para una lista de archivos y un índice dado.
   * @param {Array<File>} fileList
   * @param {number} initialIndex
   */
  function openModal(fileList, initialIndex = 0) {
    if (!fileList || fileList.length === 0) return;

    state.files = Array.from(fileList);
    state.currentIndex = Math.max(0, Math.min(initialIndex, state.files.length - 1));
    state.isOpen = true;

    if (modalEl) window.uiDialog?.open(modalEl, { focus: closeBtnEl });

    renderCurrentFile();
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Cierra el modal de previsualización y limpia los recursos.
   */
  function closeModal() {
    state.isOpen = false;
    revokeActiveObjectUrl();

    if (modalEl) {
      if (window.uiDialog) window.uiDialog.close(modalEl);
      else {
        modalEl.classList.add('hidden');
        modalEl.setAttribute('aria-hidden', 'true');
      }
    }

    if (bodyEl) {
      bodyEl.innerHTML = '';
    }

    document.removeEventListener('keydown', handleKeyDown);
  }

  /**
   * Inicializa las referencias a los elementos del DOM y enlaza los eventos.
   */
  function initPreview() {
    modalEl = document.getElementById('preview-modal');
    if (!modalEl) {
      console.warn('Modal #preview-modal no encontrado en el DOM.');
      return;
    }

    dialogEl = modalEl.querySelector('.preview-dialog');
    closeBtnEl = document.getElementById('btn-close-preview');
    titleEl = document.getElementById('preview-modal-title');
    subtitleEl = document.getElementById('preview-modal-subtitle');
    bodyEl = document.getElementById('preview-body');
    prevBtnEl = document.getElementById('btn-prev-preview');
    nextBtnEl = document.getElementById('btn-next-preview');
    counterEl = document.getElementById('preview-counter');
    detailsEl = document.getElementById('preview-file-details');

    // Botón de cerrar
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        closeModal();
      });
    }

    // Clic fuera del diálogo (en el backdrop) para cerrar
    modalEl.addEventListener('click', (e) => {
      if (dialogEl && !dialogEl.contains(e.target)) {
        closeModal();
      }
    });

    // Botones de navegación
    if (prevBtnEl) {
      prevBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        prevFile();
      });
    }

    if (nextBtnEl) {
      nextBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        nextFile();
      });
    }
  }

  // Interfaz pública para ser consumida desde upload.js o cualquier otro módulo
  window.previewManager = {
    open: openModal,
    close: closeModal,
    next: nextFile,
    prev: prevFile,
    isOpen: () => state.isOpen
  };

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPreview);
  } else {
    initPreview();
  }
})();
