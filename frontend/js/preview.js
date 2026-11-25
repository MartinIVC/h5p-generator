/**
 * preview.js
 * Módulo para la visualización previa de archivos cargados por el usuario.
 * Gestiona el visor modal, ciclo de vida de URLs Blob en memoria,
 * lectura asíncrona de archivos de texto y navegación entre documentos.
 */

(function () {
  'use strict';

  // Extensiones clasificadas por tipo de visor
  const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'json', 'log'];
  const OFFICE_EXTENSIONS = ['docx', 'doc', 'pptx', 'xlsx', 'xls', 'odt', 'ods', 'odp', 'rtf'];
  const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;

  // Estado interno del visor
  const state = {
    files: [],
    currentIndex: 0,
    isOpen: false,
    pdfDoc: null,
    pdfPage: 1,
    pdfTotalPages: 0,
    pdfScale: 1,
    pdfAutoFit: true,
    pdfRenderTask: null,
    pdfLoadingTask: null,
    pdfRenderToken: 0
  };

  let pdfjsModulePromise = null;
  const PDF_MIN_SCALE = 0.5;
  const PDF_MAX_SCALE = 2.5;
  const PDF_SCALE_STEP = 0.2;

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
  let loadStatusEl = null;
  let loadToken = 0;

  function setLoadStatus(message, isError = false) {
    if (!loadStatusEl) return;
    loadStatusEl.setAttribute('role', isError ? 'alert' : 'status');
    loadStatusEl.textContent = message;
  }

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
    if (Number.isNaN(date.getTime())) return 'Desconocida';
    return date.toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Sanitiza strings para inserción segura en atributos y texto HTML.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (window.uiEscapeHtml) return window.uiEscapeHtml(str);
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  /**
   * Carga bajo demanda PDF.js desde el paquete local sin usar el visor nativo PDFium en iframe.
   */
  function loadPdfJs() {
    if (!pdfjsModulePromise) {
      const pdfModuleUrl = new URL(
        '../backend/node_modules/pdfjs-dist/build/pdf.min.mjs',
        window.location.href
      ).href;
      const pdfWorkerUrl = new URL(
        '../backend/node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
        window.location.href
      ).href;
      pdfjsModulePromise = import(pdfModuleUrl)
        .then(mod => {
          mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          return mod;
        })
        .catch(error => {
          pdfjsModulePromise = null;
          throw error;
        });
    }
    return pdfjsModulePromise;
  }

  /**
   * Cancela y libera cualquier tarea o documento PDF.js activo en memoria.
   */
  function cleanupPdfResources() {
    state.pdfRenderToken++;
    if (state.pdfRenderTask) {
      try { state.pdfRenderTask.cancel(); } catch {}
      state.pdfRenderTask = null;
    }
    if (state.pdfLoadingTask) {
      try { state.pdfLoadingTask.destroy(); } catch {}
      state.pdfLoadingTask = null;
    }
    if (state.pdfDoc) {
      const doc = state.pdfDoc;
      state.pdfDoc = null;
      try { doc.destroy(); } catch {}
    }
    state.pdfPage = 1;
    state.pdfTotalPages = 0;
    state.pdfScale = 1;
    state.pdfAutoFit = true;
  }

  function renderPdfErrorCard(message) {
    bodyEl.innerHTML = `
      <div class="preview-unsupported-card">
        <p class="preview-unsupported-desc is-error">${escapeHtml(message)}</p>
      </div>
    `;
    setLoadStatus('No se pudo cargar la vista previa.', true);
  }

  /**
   * Renderiza la página actual del documento PDF sobre un elemento <canvas>.
   */
  async function drawCurrentPdfPage(token) {
    if (!state.isOpen || token !== loadToken || !state.pdfDoc) return;
    const canvas = bodyEl.querySelector('.preview-pdf-canvas');
    const stage = bodyEl.querySelector('.preview-pdf-stage');
    const pageIndicator = bodyEl.querySelector('#pdf-page-indicator');
    const zoomIndicator = bodyEl.querySelector('#pdf-zoom-indicator');
    const prevPageBtn = bodyEl.querySelector('#btn-pdf-prev');
    const nextPageBtn = bodyEl.querySelector('#btn-pdf-next');
    const zoomOutBtn = bodyEl.querySelector('#btn-pdf-zoom-out');
    const zoomInBtn = bodyEl.querySelector('#btn-pdf-zoom-in');
    if (!canvas || !stage) return;

    if (state.pdfRenderTask) {
      try { state.pdfRenderTask.cancel(); } catch {}
      state.pdfRenderTask = null;
    }

    const renderToken = ++state.pdfRenderToken;
    setLoadStatus(`Renderizando página ${state.pdfPage} de ${state.pdfTotalPages}…`);

    try {
      const page = await state.pdfDoc.getPage(state.pdfPage);
      if (!state.isOpen || token !== loadToken || renderToken !== state.pdfRenderToken) return;

      const baseViewport = page.getViewport({ scale: 1 });
      if (state.pdfAutoFit && baseViewport.width > 0) {
        const availableWidth = Math.max(240, stage.clientWidth - 32);
        const fitScale = availableWidth / baseViewport.width;
        state.pdfScale = Math.max(PDF_MIN_SCALE, Math.min(PDF_MAX_SCALE, fitScale));
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssViewport = page.getViewport({ scale: state.pdfScale });
      const renderViewport = page.getViewport({ scale: state.pdfScale * dpr });

      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${Math.max(1, Math.floor(cssViewport.width))}px`;
      canvas.style.height = `${Math.max(1, Math.floor(cssViewport.height))}px`;
      canvas.setAttribute('aria-label', `Página ${state.pdfPage} de ${state.pdfTotalPages}`);

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
      state.pdfRenderTask = renderTask;
      await renderTask.promise;
      if (state.pdfRenderTask === renderTask) state.pdfRenderTask = null;

      if (!state.isOpen || token !== loadToken || renderToken !== state.pdfRenderToken) return;
      if (pageIndicator) pageIndicator.textContent = `Página ${state.pdfPage} / ${state.pdfTotalPages}`;
      if (zoomIndicator) zoomIndicator.textContent = `${Math.round(state.pdfScale * 100)}%`;
      if (prevPageBtn) prevPageBtn.disabled = state.pdfPage <= 1;
      if (nextPageBtn) nextPageBtn.disabled = state.pdfPage >= state.pdfTotalPages;
      if (zoomOutBtn) zoomOutBtn.disabled = state.pdfScale <= PDF_MIN_SCALE + 0.01;
      if (zoomInBtn) zoomInBtn.disabled = state.pdfScale >= PDF_MAX_SCALE - 0.01;
      setLoadStatus('Vista previa lista.');
    } catch (error) {
      if (error?.name === 'RenderingCancelledException') return;
      if (!state.isOpen || token !== loadToken || renderToken !== state.pdfRenderToken) return;
      renderPdfErrorCard('No fue posible renderizar esta página del PDF.');
    }
  }

  /**
   * Renderiza un archivo PDF en <canvas> mediante PDF.js (multiplataforma, sin iframe blob:).
   * @param {File} file
   * @param {number} token
   */
  async function renderPdf(file, token) {
    bodyEl.innerHTML = '';
    cleanupPdfResources();
    setLoadStatus('Cargando vista previa…');
    bodyEl.innerHTML = `
      <div class="preview-pdf-shell">
        <div class="preview-pdf-toolbar" role="toolbar" aria-label="Controles del visor PDF">
          <div class="preview-pdf-toolbar-group">
            <button type="button" class="btn-secondary btn-pdf-tool" id="btn-pdf-prev" disabled aria-label="Página anterior">Anterior</button>
            <span class="preview-pdf-indicator" id="pdf-page-indicator" aria-live="polite">Cargando…</span>
            <button type="button" class="btn-secondary btn-pdf-tool" id="btn-pdf-next" disabled aria-label="Página siguiente">Siguiente</button>
          </div>
          <div class="preview-pdf-toolbar-group">
            <button type="button" class="btn-secondary btn-pdf-tool" id="btn-pdf-zoom-out" disabled aria-label="Reducir zoom">−</button>
            <span class="preview-pdf-indicator" id="pdf-zoom-indicator">100%</span>
            <button type="button" class="btn-secondary btn-pdf-tool" id="btn-pdf-zoom-in" disabled aria-label="Aumentar zoom">+</button>
            <button type="button" class="btn-secondary btn-pdf-tool" id="btn-pdf-fit" disabled>Ajustar</button>
          </div>
        </div>
        <div class="preview-pdf-stage">
          <canvas class="preview-pdf-canvas" role="img" aria-label="Vista previa de documento PDF"></canvas>
        </div>
      </div>
    `;

    try {
      const [pdfjs, buffer] = await Promise.all([loadPdfJs(), file.arrayBuffer()]);
      if (!state.isOpen || token !== loadToken) return;

      const data = new Uint8Array(buffer);
      const loadingTask = pdfjs.getDocument({
        data,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true
      });
      state.pdfLoadingTask = loadingTask;
      const pdfDoc = await loadingTask.promise;
      if (state.pdfLoadingTask === loadingTask) state.pdfLoadingTask = null;

      if (!state.isOpen || token !== loadToken) {
        try { pdfDoc.destroy(); } catch {}
        return;
      }

      state.pdfDoc = pdfDoc;
      state.pdfTotalPages = pdfDoc.numPages;
      state.pdfPage = 1;
      state.pdfAutoFit = true;

      const prevPageBtn = bodyEl.querySelector('#btn-pdf-prev');
      const nextPageBtn = bodyEl.querySelector('#btn-pdf-next');
      const zoomOutBtn = bodyEl.querySelector('#btn-pdf-zoom-out');
      const zoomInBtn = bodyEl.querySelector('#btn-pdf-zoom-in');
      const fitBtn = bodyEl.querySelector('#btn-pdf-fit');
      if (fitBtn) fitBtn.disabled = false;

      prevPageBtn?.addEventListener('click', () => {
        if (state.pdfPage > 1) {
          state.pdfPage--;
          drawCurrentPdfPage(token);
        }
      });
      nextPageBtn?.addEventListener('click', () => {
        if (state.pdfPage < state.pdfTotalPages) {
          state.pdfPage++;
          drawCurrentPdfPage(token);
        }
      });
      zoomOutBtn?.addEventListener('click', () => {
        state.pdfAutoFit = false;
        state.pdfScale = Math.max(PDF_MIN_SCALE, Number((state.pdfScale - PDF_SCALE_STEP).toFixed(2)));
        drawCurrentPdfPage(token);
      });
      zoomInBtn?.addEventListener('click', () => {
        state.pdfAutoFit = false;
        state.pdfScale = Math.min(PDF_MAX_SCALE, Number((state.pdfScale + PDF_SCALE_STEP).toFixed(2)));
        drawCurrentPdfPage(token);
      });
      fitBtn?.addEventListener('click', () => {
        state.pdfAutoFit = true;
        drawCurrentPdfPage(token);
      });

      await drawCurrentPdfPage(token);
    } catch {
      if (!state.isOpen || token !== loadToken) return;
      cleanupPdfResources();
      renderPdfErrorCard('No fue posible abrir este archivo PDF. Comprueba que no esté dañado o protegido con contraseña.');
    }
  }

  /**
   * Renderiza archivos de texto plano o markdown con lectura segura en pre/code.
   * @param {File} file
   */
  function renderText(file, token) {
    bodyEl.innerHTML = '';
    cleanupPdfResources();
    setLoadStatus('Cargando vista previa…');
    bodyEl.innerHTML = `
      <div class="preview-text-wrapper">
        <p class="preview-loading-text" aria-hidden="true">Cargando contenido...</p>
      </div>
    `;

    const reader = new FileReader();
    const isTruncated = typeof file.size === 'number' && file.size > MAX_TEXT_PREVIEW_BYTES;
    const targetBlob = isTruncated && typeof file.slice === 'function'
      ? file.slice(0, MAX_TEXT_PREVIEW_BYTES)
      : file;

    reader.onload = function (event) {
      if (!state.isOpen || token !== loadToken) return;
      const textContent = event.target.result || '(El archivo está vacío)';

      const wrapper = document.createElement('div');
      wrapper.className = 'preview-text-wrapper';

      if (isTruncated) {
        const notice = document.createElement('p');
        notice.className = 'preview-text-notice';
        notice.setAttribute('role', 'status');
        notice.textContent = `Vista previa parcial: se muestran los primeros 512 KB de ${formatBytes(file.size)}. El archivo completo se analizará al generar.`;
        wrapper.appendChild(notice);
      }

      const pre = document.createElement('pre');
      pre.className = 'preview-text-content';

      const code = document.createElement('code');
      // Uso estricto de textContent para evitar inyección de código/XSS
      code.textContent = textContent;

      pre.appendChild(code);
      wrapper.appendChild(pre);

      bodyEl.innerHTML = '';
      bodyEl.appendChild(wrapper);
      setLoadStatus(isTruncated ? 'Vista previa parcial lista.' : 'Vista previa lista.');
    };

    reader.onerror = function () {
      if (!state.isOpen || token !== loadToken) return;
      bodyEl.innerHTML = `
        <div class="preview-unsupported-card">
          <p class="preview-unsupported-desc is-error">
            No fue posible leer el archivo de texto.
          </p>
        </div>
      `;
      setLoadStatus('No se pudo cargar la vista previa.', true);
    };

    reader.readAsText(targetBlob, 'utf-8');
  }

  /**
   * Renderiza una tarjeta informativa con metadatos para formatos de Office o no visualizables directamente.
   * @param {File} file
   * @param {string} ext
   */
  function renderUnsupportedOffice(file, ext) {
    bodyEl.innerHTML = '';
    cleanupPdfResources();
    setLoadStatus('Este formato no tiene vista previa.');

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
    const token = ++loadToken;

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
      renderPdf(currentFile, token);
    } else if (TEXT_EXTENSIONS.includes(ext) || (currentFile.type && currentFile.type.startsWith('text/'))) {
      renderText(currentFile, token);
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
    } else if (e.key === 'PageDown' && state.pdfDoc && state.pdfPage < state.pdfTotalPages) {
      e.preventDefault();
      state.pdfPage++;
      drawCurrentPdfPage(loadToken);
    } else if (e.key === 'PageUp' && state.pdfDoc && state.pdfPage > 1) {
      e.preventDefault();
      state.pdfPage--;
      drawCurrentPdfPage(loadToken);
    }
  }

  function cleanupModalState() {
    state.isOpen = false;
    loadToken++;
    cleanupPdfResources();
    if (loadStatusEl) loadStatusEl.textContent = '';
    if (bodyEl) bodyEl.innerHTML = '';
    document.removeEventListener('keydown', handleKeyDown);
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

    if (modalEl) {
      window.uiDialog?.open(modalEl, {
        focus: closeBtnEl,
        onEscape: closeModal,
        onClose: cleanupModalState
      });
    }

    renderCurrentFile();
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Cierra el modal de previsualización y limpia los recursos.
   */
  function closeModal() {
    if (modalEl) {
      if (window.uiDialog) window.uiDialog.close(modalEl);
      else {
        modalEl.classList.add('hidden');
        modalEl.setAttribute('aria-hidden', 'true');
        cleanupModalState();
      }
    } else {
      cleanupModalState();
    }
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
    loadStatusEl = document.getElementById('preview-load-status');
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
