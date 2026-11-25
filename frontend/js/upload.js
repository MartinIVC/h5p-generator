/**
 * upload.js
 * Componente modular para la carga de documentos (Paso 1) y la configuración de actividad e instrucciones (Paso 2).
 * Inserta la interfaz dinámicamente y gestiona la lista enumerada de archivos.
 * Valida los formatos que el extractor del backend puede procesar.
 */

(function () {
  'use strict';

  // Mantener la selección alineada con los formatos soportados por backend/chunker.js.
  const ALLOWED_EXTENSIONS = [
    'pdf', 'txt', 'md', 'csv',
    'docx', 'doc',
    'xlsx', 'xls',
    'pptx', 'odp', 'odt', 'ods', 'rtf'
  ];
  const SUPPORTED_FORMATS_LABEL = 'PDF, DOC/DOCX, XLS/XLSX, PPTX, ODT/ODS/ODP y TXT/MD/CSV/RTF';

  // String para el atributo accept del input file
  const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map(ext => `.${ext}`).join(',');

  // Catálogo completo de 12 formatos alineado con backend/templates/manifest.json (H5P-15 / H5P-16).
  const ACTIVITY_CATEGORIES = [
    { id: 'all', label: 'Todos' },
    { id: 'evaluation', label: 'Evaluación' },
    { id: 'practice', label: 'Práctica' },
    { id: 'study', label: 'Estudio' }
  ];

  const DEFAULT_PROMPT_PLACEHOLDER = 'Ejemplo: Enfoca la actividad en los conceptos clave de la unidad con dificultad intermedia y lenguaje claro…';

  const ACTIVITY_CARDS = [
    {
      type: 'questionset',
      label: 'Cuestionario',
      library: 'H5P.QuestionSet 1.17',
      category: 'evaluation',
      categoryLabel: 'Evaluación',
      minCount: 1,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'pregunta',
      unitPlural: 'preguntas',
      scopeBadge: '1 a 20 preguntas',
      defaultFileName: 'cuestionario',
      description: 'Secuencia evaluativa con navegación, progreso y puntaje final.',
      promptPlaceholder: 'Ejemplo: Evalúa los conceptos principales de la unidad con preguntas de aplicación de dificultad media…'
    },
    {
      type: 'multichoice',
      label: 'Opción Múltiple',
      library: 'H5P.MultiChoice 1.14',
      category: 'evaluation',
      categoryLabel: 'Evaluación',
      minCount: 1,
      maxCount: 1,
      defaultCount: 1,
      fixedCount: 1,
      unitSingular: 'pregunta',
      unitPlural: 'preguntas',
      scopeBadge: '1 pregunta individual',
      defaultFileName: 'opcion-multiple',
      description: 'Reactivo individual autónomo con cuatro alternativas y retroalimentación.',
      promptPlaceholder: 'Ejemplo: Plantea un caso práctico breve sobre el tema central y explica por qué la alternativa correcta lo resuelve…'
    },
    {
      type: 'truefalse',
      label: 'Verdadero o Falso',
      library: 'H5P.TrueFalse 1.8',
      category: 'evaluation',
      categoryLabel: 'Evaluación',
      minCount: 1,
      maxCount: 1,
      defaultCount: 1,
      fixedCount: 1,
      unitSingular: 'afirmación',
      unitPlural: 'afirmaciones',
      scopeBadge: '1 afirmación',
      defaultFileName: 'verdadero-falso',
      description: 'Afirmación conceptual con retroalimentación diferenciada según la respuesta.',
      promptPlaceholder: 'Ejemplo: Redacta una afirmación conceptual frecuente donde los estudiantes suelen confundirse y aclara el fundamento…'
    },
    {
      type: 'singlechoiceset',
      label: 'Selección única',
      library: 'H5P.SingleChoiceSet 1.11',
      category: 'evaluation',
      categoryLabel: 'Evaluación',
      minCount: 1,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'pregunta',
      unitPlural: 'preguntas',
      scopeBadge: '1 a 20 preguntas',
      defaultFileName: 'seleccion-unica',
      description: 'Ronda ágil de preguntas breves con respuesta inmediata y avance continuo.',
      promptPlaceholder: 'Ejemplo: Crea una ronda rápida de repaso sobre definiciones clave antes de la evaluación sumativa…'
    },
    {
      type: 'blanks',
      label: 'Rellenar los espacios',
      library: 'H5P.Blanks 1.14',
      category: 'practice',
      categoryLabel: 'Práctica',
      minCount: 1,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'enunciado',
      unitPlural: 'enunciados',
      scopeBadge: '1 a 20 enunciados',
      defaultFileName: 'rellenar-espacios',
      description: 'Oraciones con espacios para escribir términos clave del material.',
      promptPlaceholder: 'Ejemplo: Prioriza los términos técnicos clave del capítulo con oraciones claras y contexto suficiente…'
    },
    {
      type: 'dragtext',
      label: 'Arrastrar las palabras',
      library: 'H5P.DragText 1.10',
      category: 'practice',
      categoryLabel: 'Práctica',
      minCount: 1,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'enunciado',
      unitPlural: 'enunciados',
      scopeBadge: '1 a 20 enunciados',
      defaultFileName: 'arrastrar-palabras',
      description: 'Enunciados interactivos para arrastrar conceptos a su posición correcta.',
      promptPlaceholder: 'Ejemplo: Usa enunciados breves para asociar cada concepto principal con su función o característica…'
    },
    {
      type: 'summary',
      label: 'Resumen interactivo',
      library: 'H5P.Summary 1.10',
      category: 'practice',
      categoryLabel: 'Práctica',
      minCount: 1,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'bloque',
      unitPlural: 'bloques',
      scopeBadge: '1 a 20 bloques',
      defaultFileName: 'resumen-interactivo',
      description: 'Construcción guiada de un resumen eligiendo la afirmación correcta.',
      promptPlaceholder: 'Ejemplo: Sintetiza las ideas centrales en orden progresivo para repasar al cierre de la clase…'
    },
    {
      type: 'sortparagraphs',
      label: 'Ordenar los párrafos',
      library: 'H5P.SortParagraphs 0.11',
      category: 'practice',
      categoryLabel: 'Práctica',
      minCount: 3,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'párrafo',
      unitPlural: 'párrafos',
      scopeBadge: '3 a 20 párrafos',
      defaultFileName: 'ordenar-parrafos',
      description: 'Secuencia de pasos o procesos para ordenar lógica o cronológicamente.',
      promptPlaceholder: 'Ejemplo: Secuencia las etapas del proceso descrito en los apuntes desde el inicio hasta el resultado final…'
    },
    {
      type: 'crossword',
      label: 'Crucigrama',
      library: 'H5P.Crossword 0.5',
      category: 'practice',
      categoryLabel: 'Práctica',
      minCount: 2,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'palabra',
      unitPlural: 'palabras',
      scopeBadge: '2 a 20 palabras',
      defaultFileName: 'crucigrama',
      description: 'Cuadrícula interactiva de vocabulario técnico generado con pistas.',
      promptPlaceholder: 'Ejemplo: Selecciona vocabulario técnico esencial de la unidad con pistas directas para primer año…'
    },
    {
      type: 'findthewords',
      label: 'Sopa de letras',
      library: 'H5P.FindTheWords 1.4',
      category: 'practice',
      categoryLabel: 'Práctica',
      minCount: 3,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'palabra',
      unitPlural: 'palabras',
      scopeBadge: '3 a 20 palabras',
      defaultFileName: 'sopa-de-letras',
      description: 'Cuadrícula para localizar conceptos fundamentales del documento.',
      promptPlaceholder: 'Ejemplo: Incluye los términos fundamentales del glosario principal, evitando palabras demasiado largas…'
    },
    {
      type: 'accordion',
      label: 'Acordeón de conceptos',
      library: 'H5P.Accordion 1.0',
      category: 'study',
      categoryLabel: 'Estudio',
      minCount: 1,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'panel',
      unitPlural: 'paneles',
      scopeBadge: '1 a 20 paneles',
      defaultFileName: 'acordeon-conceptos',
      description: 'Paneles desplegables de consulta y síntesis estructurada por tema.',
      promptPlaceholder: 'Ejemplo: Organiza los conceptos clave en paneles concisos con un ejemplo práctico en cada explicación…'
    },
    {
      type: 'flashcards',
      label: 'Tarjetas didácticas',
      library: 'H5P.Flashcards 1.7',
      category: 'study',
      categoryLabel: 'Estudio',
      minCount: 1,
      maxCount: 20,
      defaultCount: 5,
      fixedCount: null,
      unitSingular: 'tarjeta',
      unitPlural: 'tarjetas',
      scopeBadge: '1 a 20 tarjetas',
      defaultFileName: 'tarjetas-didacticas',
      description: 'Tarjetas de repaso activo con pregunta, pista y comprobación directa.',
      promptPlaceholder: 'Ejemplo: Genera tarjetas de estudio con preguntas directas, respuestas cortas y pistas útiles para autoevaluación…'
    }
  ];

  const QUICK_COUNTS = [3, 5, 10];
  const ACTIVITY_CARD_MAP = new Map(ACTIVITY_CARDS.map(card => [card.type, card]));
  const DEFAULT_FILE_NAMES = new Set(ACTIVITY_CARDS.map(card => card.defaultFileName));

  function getActivityCard(activityType) {
    return ACTIVITY_CARD_MAP.get(activityType) || null;
  }

  function normalizeCountForCard(value, card) {
    if (!card) return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 5;
    if (card.fixedCount !== null) return card.fixedCount;
    if (Number.isInteger(value) && value >= card.minCount && value <= card.maxCount) return value;
    return Math.min(card.maxCount, Math.max(card.minCount, card.defaultCount));
  }

  // Estado interno del módulo
  const state = {
    files: [],
    prompt: '',
    courseId: null,
    courseName: '',
    draftId: null,
    restoredFiles: [],
    inspections: new Map(),
    inspectionVersion: 0,
    inspecting: false,
    inspectionError: '',
    activityType: null,
    activeCategory: 'all',
    questionCount: 5,
    lastVariableCount: 5
  };
  let draftSaveTimer = null;
  let draftStatus = null;
  let draftContextToken = 0;
  let flushDraftHandler = async () => {};
  let leaveWizardHandler = () => {};
  let draftDeletedHandler = () => {};

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
          <span class="home-kicker">PASO 01 / EL PUNTO DE PARTIDA</span>
          <h2 class="upload-panel-title">Dale forma a tu próxima actividad.</h2>
          <p class="upload-panel-subtitle">
            Añade apuntes y documentos en los formatos compatibles para inspeccionar el material base de tu actividad.
          </p>
          <div class="draft-resume-notice hidden" id="draft-resume-notice" role="status" aria-live="polite">
            <strong>Estás retomando un borrador.</strong>
            <span id="draft-resume-files"></span>
          </div>
          <p class="draft-save-status" id="draft-save-status" role="status">Los borradores se guardan en este equipo; los documentos no se copian.</p>
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
              <span>Elegir documentos</span>
            </button>

            <span class="upload-formats-hint" id="upload-formats-hint">Formatos disponibles: ${SUPPORTED_FORMATS_LABEL}.</span>
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

        <!-- Acciones del pie del panel -->
        <footer class="upload-footer-actions">
          <div class="upload-summary-info" id="upload-summary-info" role="status" aria-atomic="true">
            No se han seleccionado archivos
          </div>
          <button type="button" class="btn-primary" id="btn-next-step" disabled>
            <span>Inspeccionar documentos</span>
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
    if (window.uiEscapeHtml) return window.uiEscapeHtml(str);
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
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
    const summaryInfo = container.querySelector('#upload-summary-info');

    function updatePromptCounter(counterEl = document.getElementById('upload-prompt-counter')) {
      if (!counterEl) return;
      const len = state.prompt.length;
      counterEl.textContent = `${len.toLocaleString('es-CL')} / 10.000 caracteres`;
      counterEl.classList.toggle('is-limit', len >= 10000);
    }

    function syncPromptDom() {
      const activePromptInput = document.getElementById('upload-prompt-input');
      if (activePromptInput && activePromptInput.value !== state.prompt) {
        activePromptInput.value = state.prompt;
      }
      updatePromptCounter();
    }

    function formatDraftTime(iso, includeDate = false) {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return includeDate
        ? d.toLocaleString('es-CL')
        : d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    }
    const btnNextStep = container.querySelector('#btn-next-step');
    const resumeNotice = container.querySelector('#draft-resume-notice');
    const resumeFiles = container.querySelector('#draft-resume-files');
    draftStatus = container.querySelector('#draft-save-status');

    let activeGenerationCanceller = null;

    function getCourseName() {
      return window.coursesManager?.getActiveCourse()?.name || 'Proyecto sin ramo';
    }

    async function saveDraftNow() {
      window.clearTimeout(draftSaveTimer);
      if (!state.courseId || (!state.draftId && state.files.length === 0 && !state.prompt.trim() && !state.activityType)) return;
      if (!window.coursesManager?.saveDraft) return;

      const contextToken = draftContextToken;
      const courseId = state.courseId;
      const draftId = state.draftId;
      if (draftStatus) {
        draftStatus.setAttribute('role', 'status');
        draftStatus.textContent = 'Guardando borrador…';
      }
      try {
        const saved = await window.coursesManager.saveDraft({
          id: draftId,
          courseId,
          courseName: state.courseName || getCourseName(),
          prompt: state.prompt,
          activityType: state.activityType,
          questionCount: state.questionCount,
          files: state.files.map(file => ({
            name: file.name,
            size: file.size,
            lastModified: file.lastModified
          }))
        });
        if (contextToken === draftContextToken && state.courseId === courseId) {
          state.draftId = saved.id;
          const savedTime = formatDraftTime(saved.updatedAt, false);
          if (draftStatus) draftStatus.textContent = savedTime
            ? `Borrador guardado · ${savedTime}. Los documentos no se copiaron.`
            : 'Borrador guardado. Los documentos no se copiaron.';
        }
      } catch (err) {
        if (contextToken === draftContextToken && draftStatus) {
          draftStatus.setAttribute('role', 'alert');
          draftStatus.textContent = 'No se pudo guardar el borrador. Mantén esta ventana abierta y vuelve a intentarlo.';
        }
      }
    }

    flushDraftHandler = saveDraftNow;

    function scheduleDraftSave() {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = window.setTimeout(saveDraftNow, 350);
    }

    function forgetInspection(file) {
      const id = state.inspections.get(file);
      state.inspections.delete(file);
      if (id) window.academicAPI?.releaseDocument(id).catch(() => {});
    }

    function invalidateSelection() {
      state.inspectionVersion++;
      state.inspectionError = '';
    }

    function cancelActiveWizardOperations() {
      invalidateSelection();
      state.inspecting = false;
      if (typeof activeGenerationCanceller === 'function') {
        activeGenerationCanceller();
      }
    }

    leaveWizardHandler = cancelActiveWizardOperations;

    draftDeletedHandler = (deletedDraftId) => {
      if (!deletedDraftId || state.draftId !== deletedDraftId) return;
      window.clearTimeout(draftSaveTimer);
      draftContextToken++;
      cancelActiveWizardOperations();
      state.files.forEach(forgetInspection);
      state.files = [];
      state.prompt = '';
      state.courseId = null;
      state.courseName = '';
      state.draftId = null;
      state.restoredFiles = [];
      state.activityType = null;
      state.activeCategory = 'all';
      state.questionCount = 5;
      state.lastVariableCount = 5;
      syncPromptDom();
      resumeNotice.classList.add('hidden');
      updateUI();
    };

    function applyDraftContext(detail = {}) {
      const nextCourseId = detail.courseId || 'unassigned';
      const draft = detail.draft || null;
      const isSameLiveDraft = Boolean(draft && draft.id === state.draftId && state.courseId === nextCourseId);

      if (!isSameLiveDraft) {
        if (state.courseId && (state.draftId || state.files.length || state.prompt.trim() || state.activityType)) {
          saveDraftNow();
        }
        window.clearTimeout(draftSaveTimer);
        draftContextToken++;
        cancelActiveWizardOperations();
        state.files.forEach(forgetInspection);
        state.files = [];
        state.prompt = '';
        state.draftId = null;
        state.activityType = null;
        state.activeCategory = 'all';
        state.questionCount = 5;
        state.lastVariableCount = 5;
      }
      state.courseId = nextCourseId;
      state.courseName = draft?.courseName || getCourseName();

      if (draft) {
        state.draftId = draft.id;
        state.prompt = draft.prompt || '';
        const restoredCard = getActivityCard(draft.activityType);
        const restoredType = restoredCard ? restoredCard.type : null;
        const restoredCount = normalizeCountForCard(draft.questionCount, restoredCard);
        state.activityType = restoredType;
        state.activeCategory = 'all';
        state.questionCount = restoredCount;
        state.lastVariableCount = restoredCard?.fixedCount !== null && restoredCard
          ? 5
          : restoredCount;
        state.restoredFiles = isSameLiveDraft && state.files.length
          ? []
          : (Array.isArray(draft.files) ? draft.files : []);
        const hasSavedPrompt = Boolean(state.prompt.trim());
        resumeFiles.textContent = state.restoredFiles.length
          ? `Selecciona de nuevo ${state.restoredFiles.length} ${state.restoredFiles.length === 1 ? 'documento' : 'documentos'} para continuar. Puedes elegir archivos de reemplazo.${hasSavedPrompt ? ' Tus instrucciones guardadas estarán en el Paso 2.' : ''}`
          : isSameLiveDraft && state.files.length
            ? 'Los archivos siguen disponibles en esta sesión.'
            : hasSavedPrompt
              ? 'Tus instrucciones y configuración se conservaron para el Paso 2.'
              : 'Tu configuración se conservó para el Paso 2.';
        resumeNotice.classList.toggle('hidden', isSameLiveDraft && state.files.length > 0);
        const restoredTime = formatDraftTime(draft.updatedAt, true);
        if (draftStatus) draftStatus.textContent = restoredTime
          ? `Borrador de ${draft.courseName || getCourseName()} · guardado ${restoredTime}.`
          : `Borrador de ${draft.courseName || getCourseName()}.`;
      } else {
        state.activityType = null;
        state.activeCategory = 'all';
        state.questionCount = 5;
        state.lastVariableCount = 5;
        state.restoredFiles = [];
        resumeNotice.classList.add('hidden');
        if (draftStatus) draftStatus.textContent = 'Los borradores se guardan en este equipo; los documentos no se copian.';
      }

      syncPromptDom();
      updateUI();
    }

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
        summaryInfo.setAttribute('role', 'status');
        summaryInfo.innerHTML = state.restoredFiles.length
          ? `Este borrador recuerda ${state.restoredFiles.length} documento${state.restoredFiles.length === 1 ? '' : 's'}. Selecciónalo${state.restoredFiles.length === 1 ? '' : 's'} otra vez para continuar.`
          : 'No se han seleccionado archivos';
        return;
      }

      fileListContent.innerHTML = getFileListTemplate(state.files);
      btnClearAll.classList.remove('hidden');

      const validFiles = state.files.filter(f => isFormatAllowed(f.name));
      const errorFiles = state.files.filter(f => !isFormatAllowed(f.name));
      const hasErrors = errorFiles.length > 0;

      // El botón solo se habilita si no hay errores y hay al menos un archivo válido
      btnNextStep.disabled = state.inspecting || hasErrors || validFiles.length === 0 || count > 20;

      if (state.inspecting) {
        summaryInfo.className = 'upload-summary-info';
        summaryInfo.setAttribute('role', 'status');
        summaryInfo.textContent = 'Inspeccionando documentos…';
      } else if (state.inspectionError || count > 20) {
        summaryInfo.className = 'upload-summary-info has-error';
        summaryInfo.setAttribute('role', 'alert');
        summaryInfo.textContent = state.inspectionError || 'Puedes inspeccionar hasta 20 documentos.';
      } else if (hasErrors) {
        summaryInfo.className = 'upload-summary-info has-error';
        summaryInfo.setAttribute('role', 'alert');
        const errPlural = errorFiles.length === 1 ? 'archivo con formato no permitido' : 'archivos con formatos no permitidos';
        summaryInfo.innerHTML = `<strong>Formato no disponible:</strong> ${errorFiles.length} ${errPlural}. Formatos permitidos: ${SUPPORTED_FORMATS_LABEL}.`;
      } else {
        summaryInfo.className = 'upload-summary-info';
        summaryInfo.setAttribute('role', 'status');
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

      if (state.files.length !== previousCount) invalidateSelection();
      updateUI();
      fileListContent.querySelectorAll('.file-item').forEach((item, index) => {
        item.classList.toggle('is-new', index >= previousCount);
      });
      if (state.restoredFiles.length) {
        state.restoredFiles = [];
        resumeNotice.classList.add('hidden');
      }
      scheduleDraftSave();
    }

    /**
     * Remueve un archivo por su índice.
     * @param {number} index
     */
    function removeFile(index) {
      if (index >= 0 && index < state.files.length) {
        forgetInspection(state.files[index]);
        invalidateSelection();
        state.files.splice(index, 1);
        if (state.files.length === 0 && window.previewManager && window.previewManager.isOpen()) {
          window.previewManager.close();
        }
        updateUI();
        scheduleDraftSave();
      }
    }

    /**
     * Elimina todos los archivos seleccionados.
     */
    function clearAllFiles() {
      state.files.forEach(forgetInspection);
      invalidateSelection();
      state.files = [];
      fileInput.value = '';
      if (window.previewManager && window.previewManager.isOpen()) {
        window.previewManager.close();
      }
      updateUI();
      scheduleDraftSave();
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
      // Acción de previsualizar (solo sobre archivos con formato admitido)
      const previewBtn = e.target.closest('[data-action="preview"]');
      if (previewBtn) {
        e.stopPropagation();
        const idx = parseInt(previewBtn.getAttribute('data-index'), 10);
        if (!isNaN(idx) && window.previewManager) {
          const clickedFile = state.files[idx];
          const validFiles = state.files.filter(f => isFormatAllowed(f.name));
          const validIdx = validFiles.indexOf(clickedFile);
          if (validIdx >= 0) {
            window.previewManager.open(validFiles, validIdx);
          }
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

    document.addEventListener('h5p:start-project-creation', event => applyDraftContext(event.detail));

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

    // Inspeccionar el material antes de configurar la actividad.
    btnNextStep.addEventListener('click', async () => {
      if (state.inspecting || !state.files.length || state.files.length > 20 || state.files.some(file => !isFormatAllowed(file.name))) return;
      if (!window.academicAPI?.inspectDocument) {
        state.inspectionError = 'No se pudo iniciar la inspección. Vuelve a intentarlo.';
        updateUI();
        return;
      }
      const version = state.inspectionVersion;
      const files = [...state.files];
      state.inspecting = true;
      state.inspectionError = '';
      updateUI();
      try {
        for (const file of files) {
          if (version !== state.inspectionVersion) return;
          if (state.inspections.has(file)) continue;
          if (!file.size || file.size > 50 * 1024 * 1024) {
            state.inspectionError = `${file.name}: cada documento debe tener contenido y pesar como máximo 50 MiB.`;
            return;
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (version !== state.inspectionVersion) return;
          const result = await window.academicAPI.inspectDocument({ name: file.name, bytes });
          if (version !== state.inspectionVersion) {
            if (result?.status === 'ok') await window.academicAPI.releaseDocument(result.documentId).catch(() => {});
            return;
          }
          if (result?.status !== 'ok') {
            state.inspectionError = `${file.name}: ${result?.message || 'No se pudo inspeccionar el documento. Inténtalo nuevamente.'}`;
            return;
          }
          state.inspections.set(file, result.documentId);
        }
      } catch {
        if (version === state.inspectionVersion) state.inspectionError = 'No se pudo inspeccionar el documento. Inténtalo nuevamente.';
        return;
      } finally {
        state.inspecting = false;
        updateUI();
      }
      if (version !== state.inspectionVersion) return;
      const panelUpload = document.getElementById('panel-upload');
      const panelSelector = document.getElementById('panel-selector');
      if (!panelUpload || !panelSelector || panelUpload.classList.contains('hidden')) return;

      const categoryCounts = {
        all: ACTIVITY_CARDS.length,
        evaluation: ACTIVITY_CARDS.filter(card => card.category === 'evaluation').length,
        practice: ACTIVITY_CARDS.filter(card => card.category === 'practice').length,
        study: ACTIVITY_CARDS.filter(card => card.category === 'study').length
      };

      const categoryTabsHtml = ACTIVITY_CATEGORIES.map(cat => `
        <button type="button" class="activity-category-tab${state.activeCategory === cat.id ? ' selected' : ''}" data-category-filter="${cat.id}" aria-pressed="${state.activeCategory === cat.id ? 'true' : 'false'}">
          <span>${escapeHtml(cat.label)}</span>
          <span class="activity-category-count">${categoryCounts[cat.id]}</span>
        </button>`).join('');

      const activeCardsHtml = ACTIVITY_CARDS.map(card => `
        <button type="button" class="activity-type-card" data-activity-type="${card.type}" data-category="${card.category}" aria-pressed="false">
          <div class="activity-card-top">
            <span class="activity-card-library">${escapeHtml(card.library)}</span>
            <span class="activity-card-scope">${escapeHtml(card.scopeBadge)}</span>
          </div>
          <strong class="activity-card-title">${escapeHtml(card.label)}</strong>
          <span class="activity-card-desc">${escapeHtml(card.description)}</span>
          <span class="activity-card-check" aria-hidden="true">Seleccionado</span>
        </button>`).join('');

      const quickButtonsHtml = QUICK_COUNTS.map(num => `
        <button type="button" class="btn-quick-count" data-count="${num}" aria-pressed="false">${num}</button>`).join('');

      const initialCard = getActivityCard(state.activityType);
      const initialFileName = initialCard ? initialCard.defaultFileName : 'cuestionario';

      panelSelector.innerHTML = `
        <section class="upcoming-step-card activity-selector-card" id="activity-selector-card" aria-labelledby="selector-title">
          <span class="home-kicker">Paso 2 · Configuración de actividad</span>
          <h2 id="selector-title" tabindex="-1">Configura tu actividad H5P</h2>
          <p class="selector-intro">Elige entre los 12 formatos interactivos, define su extensión e incluye instrucciones opcionales. Al generar, el texto de los documentos y tus instrucciones se enviarán a Gemini.</p>

          <div class="activity-category-tabs" role="group" aria-label="Filtrar formatos H5P por categoría">
            ${categoryTabsHtml}
          </div>

          <div id="selected-format-hidden-notice" class="selected-format-hidden-notice hidden" role="status" aria-live="polite">
            <span id="selected-format-hidden-text"></span>
            <button type="button" class="btn-text-subtle" id="btn-show-selected-format">Mostrar categoría</button>
          </div>

          <div class="activity-selector-grid" role="group" aria-label="Formatos H5P disponibles">
            ${activeCardsHtml}
          </div>

          <div class="generation-fields">
            <div class="generation-fields-row">
              <div class="generation-field-group">
                <div class="question-count-header">
                  <label for="question-count" id="question-count-label">Cantidad de elementos</label>
                  <div class="quick-count-group" role="group" aria-label="Selección rápida de cantidad">
                    ${quickButtonsHtml}
                  </div>
                </div>
                <input id="question-count" type="number" min="1" max="20" value="${state.questionCount}" inputmode="numeric">
                <p id="question-count-hint" class="generation-field-hint">Selecciona un formato para ajustar su extensión o usa un botón rápido.</p>
              </div>
              <div class="generation-field-group">
                <label for="h5p-name">Nombre y título de la actividad</label>
                <input id="h5p-name" type="text" maxlength="180" value="${initialFileName}" autocomplete="off">
                <p class="generation-field-hint">Se usará como título en H5P y nombre sugerido al guardar.</p>
              </div>
            </div>

            <div class="upload-prompt-section">
              <div class="upload-prompt-header">
                <label for="upload-prompt-input" class="upload-prompt-label">
                  Instrucciones para la actividad (opcional)
                </label>
                <span id="upload-prompt-counter" class="upload-prompt-counter" aria-live="polite">0 / 10.000 caracteres</span>
              </div>
              <textarea
                id="upload-prompt-input"
                class="upload-prompt-textarea"
                rows="3"
                maxlength="10000"
                aria-describedby="upload-prompt-counter"
                placeholder="${escapeHtml(initialCard?.promptPlaceholder || DEFAULT_PROMPT_PLACEHOLDER)}"></textarea>
            </div>
          </div>

          <div id="generation-progress" class="generation-progress-banner hidden" aria-hidden="true">
            <span class="generation-spinner" aria-hidden="true"></span>
            <span id="generation-progress-step"></span>
            <button type="button" class="btn-secondary btn-cancel-generation" id="btn-cancel-generation">Cancelar</button>
          </div>
          <p id="generation-status" role="status" aria-live="polite"></p>

          <div class="upcoming-step-actions">
            <button type="button" class="btn-secondary" id="btn-back-to-material">Volver al material</button>
            <button type="button" class="btn-primary" id="btn-generate-h5p" disabled>Generar Evaluación</button>
            <button type="button" class="btn-primary hidden" id="btn-save-h5p">Guardar archivo H5P</button>
            <button type="button" class="btn-secondary hidden" id="btn-reveal-saved-h5p">Ver en carpeta</button>
          </div>
        </section>`;
      panelUpload.classList.add('hidden');
      panelSelector.classList.remove('hidden');
      updateStepIndicators(2);

      const selectorCard = document.getElementById('activity-selector-card');
      const backButton = document.getElementById('btn-back-to-material');
      const generateButton = document.getElementById('btn-generate-h5p');
      const saveButton = document.getElementById('btn-save-h5p');
      const revealSavedButton = document.getElementById('btn-reveal-saved-h5p');
      const status = document.getElementById('generation-status');
      const progressBanner = document.getElementById('generation-progress');
      const progressStep = document.getElementById('generation-progress-step');
      const cancelButton = document.getElementById('btn-cancel-generation');
      const countLabel = document.getElementById('question-count-label');
      const countInput = document.getElementById('question-count');
      const countHint = document.getElementById('question-count-hint');
      const nameInput = document.getElementById('h5p-name');
      const promptInput = document.getElementById('upload-prompt-input');
      const promptCounter = document.getElementById('upload-prompt-counter');
      const hiddenFormatNotice = document.getElementById('selected-format-hidden-notice');
      const hiddenFormatText = document.getElementById('selected-format-hidden-text');
      const showSelectedFormatBtn = document.getElementById('btn-show-selected-format');
      const categoryTabButtons = Array.from(panelSelector.querySelectorAll('.activity-category-tab'));
      const activeCardButtons = Array.from(panelSelector.querySelectorAll('.activity-type-card'));
      const quickCountButtons = Array.from(panelSelector.querySelectorAll('.btn-quick-count'));

      let packageId = null;
      let lastSavedProjectId = null;
      let isGenerating = false;
      let stageTimer = null;

      backButton?.addEventListener('click', () => {
        if (isGenerating) return;
        returnToMaterial();
      });

      const showStatus = (message, error = false) => {
        status.setAttribute('role', error ? 'alert' : 'status');
        status.textContent = message;
      };

      const invalidatePreparedPackage = () => {
        packageId = null;
        lastSavedProjectId = null;
        saveButton.classList.add('hidden');
        revealSavedButton?.classList.add('hidden');
      };

      const syncSelectorUI = () => {
        const selectedCard = getActivityCard(state.activityType);
        const isFixedSingle = Boolean(selectedCard && selectedCard.fixedCount !== null);
        const minCount = selectedCard ? selectedCard.minCount : 1;
        const maxCount = selectedCard ? selectedCard.maxCount : 20;

        categoryTabButtons.forEach(tab => {
          const isCurrent = tab.dataset.categoryFilter === state.activeCategory;
          tab.classList.toggle('selected', isCurrent);
          tab.setAttribute('aria-pressed', String(isCurrent));
          tab.disabled = isGenerating;
        });

        activeCardButtons.forEach(card => {
          const isSelected = card.dataset.activityType === state.activityType;
          const visible = state.activeCategory === 'all' || card.dataset.category === state.activeCategory;
          card.classList.toggle('hidden', !visible);
          card.classList.toggle('selected', isSelected);
          card.setAttribute('aria-pressed', String(isSelected));
          card.disabled = isGenerating;
        });

        const selectedHiddenByFilter = Boolean(
          selectedCard && state.activeCategory !== 'all' && selectedCard.category !== state.activeCategory
        );
        if (hiddenFormatNotice && hiddenFormatText) {
          hiddenFormatNotice.classList.toggle('hidden', !selectedHiddenByFilter);
          if (selectedHiddenByFilter) {
            hiddenFormatText.textContent = `Formato seleccionado: ${selectedCard.label} (en ${selectedCard.categoryLabel}).`;
          }
        }
        if (showSelectedFormatBtn) showSelectedFormatBtn.disabled = isGenerating;

        if (countLabel) {
          countLabel.textContent = selectedCard
            ? `Cantidad de ${selectedCard.unitPlural}`
            : 'Cantidad de elementos';
        }

        countInput.min = String(minCount);
        countInput.max = String(maxCount);

        if (isFixedSingle) {
          state.questionCount = selectedCard.fixedCount;
          countInput.value = String(selectedCard.fixedCount);
          countInput.disabled = true;
          countHint.textContent = `${selectedCard.library} exporta un reactivo individual (1 ${selectedCard.unitSingular}).`;
        } else {
          countInput.disabled = isGenerating;
          countHint.textContent = selectedCard
            ? `Elige entre ${minCount} y ${maxCount} ${selectedCard.unitPlural} o usa un botón rápido.`
            : 'Elige entre 1 y 20 elementos o usa un botón rápido.';
        }

        const parsedCount = isFixedSingle ? selectedCard.fixedCount : Number(countInput.value);
        const countValid = Number.isInteger(parsedCount) && parsedCount >= minCount && parsedCount <= maxCount;

        quickCountButtons.forEach(btn => {
          const value = Number(btn.dataset.count);
          const allowedForFormat = !isFixedSingle && value >= minCount && value <= maxCount;
          const isActive = allowedForFormat && countValid && parsedCount === value;
          btn.classList.toggle('selected', isActive);
          btn.setAttribute('aria-pressed', String(isActive));
          btn.disabled = isGenerating || !allowedForFormat;
        });

        nameInput.disabled = isGenerating;
        if (promptInput) {
          promptInput.disabled = isGenerating;
          promptInput.placeholder = selectedCard?.promptPlaceholder || DEFAULT_PROMPT_PLACEHOLDER;
        }
        if (backButton) backButton.disabled = isGenerating;
        if (revealSavedButton) revealSavedButton.disabled = isGenerating;
        generateButton.disabled = isGenerating || !selectedCard || !countValid;
      };

      const setGeneratingState = (active, stageMessage = '') => {
        isGenerating = active;
        window.clearTimeout(stageTimer);
        selectorCard?.classList.toggle('is-generating', active);
        if (selectorCard) selectorCard.setAttribute('aria-busy', String(active));
        progressBanner.classList.toggle('hidden', !active);
        progressBanner.setAttribute('aria-hidden', String(!active));
        progressStep.textContent = active ? stageMessage : '';
        if (cancelButton) {
          cancelButton.disabled = !active;
          cancelButton.textContent = 'Cancelar';
        }
        activeGenerationCanceller = active
          ? () => {
            window.academicAPI?.cancelGeneration?.().catch(() => {});
          }
          : null;
        syncSelectorUI();
      };

      cancelButton?.addEventListener('click', async () => {
        if (!isGenerating) return;
        cancelButton.disabled = true;
        cancelButton.textContent = 'Cancelando…';
        showStatus('Cancelando generación…');
        try {
          await window.academicAPI?.cancelGeneration?.();
        } catch {
          // El estado final se actualiza cuando concluye generateH5P.
        }
      });

      categoryTabButtons.forEach(tab => {
        tab.addEventListener('click', () => {
          if (isGenerating) return;
          const nextCategory = tab.dataset.categoryFilter;
          if (!nextCategory || !Object.hasOwn(categoryCounts, nextCategory)) return;
          state.activeCategory = nextCategory;
          syncSelectorUI();
        });
      });

      showSelectedFormatBtn?.addEventListener('click', () => {
        const selectedCard = getActivityCard(state.activityType);
        if (isGenerating || !selectedCard) return;
        state.activeCategory = selectedCard.category;
        syncSelectorUI();
      });

      activeCardButtons.forEach(cardBtn => {
        cardBtn.addEventListener('click', () => {
          if (isGenerating) return;
          const clickedType = cardBtn.dataset.activityType;
          const clickedCard = getActivityCard(clickedType);
          if (!clickedCard) return;

          const nextType = state.activityType === clickedType ? null : clickedType;
          const nextCard = getActivityCard(nextType);
          state.activityType = nextType;

          if (nextCard) {
            if (nextCard.fixedCount !== null) {
              state.questionCount = nextCard.fixedCount;
            } else {
              const clamped = Math.min(nextCard.maxCount, Math.max(nextCard.minCount, state.lastVariableCount));
              state.questionCount = clamped;
              countInput.value = String(clamped);
            }
            const currentName = nameInput.value.trim();
            if (!currentName || DEFAULT_FILE_NAMES.has(currentName)) {
              nameInput.value = nextCard.defaultFileName;
            }
          } else {
            state.questionCount = state.lastVariableCount;
            countInput.value = String(state.questionCount);
          }

          invalidatePreparedPackage();
          showStatus('');
          syncSelectorUI();
          scheduleDraftSave();
        });
      });

      quickCountButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const selectedCard = getActivityCard(state.activityType);
          if (isGenerating || (selectedCard && selectedCard.fixedCount !== null)) return;
          const minCount = selectedCard ? selectedCard.minCount : 1;
          const maxCount = selectedCard ? selectedCard.maxCount : 20;
          const value = Number(btn.dataset.count);
          if (!Number.isInteger(value) || value < minCount || value > maxCount) return;
          state.questionCount = value;
          state.lastVariableCount = value;
          countInput.value = String(value);
          invalidatePreparedPackage();
          showStatus('');
          syncSelectorUI();
          scheduleDraftSave();
        });
      });

      countInput.addEventListener('input', () => {
        const selectedCard = getActivityCard(state.activityType);
        if (isGenerating || (selectedCard && selectedCard.fixedCount !== null)) return;
        const minCount = selectedCard ? selectedCard.minCount : 1;
        const maxCount = selectedCard ? selectedCard.maxCount : 20;
        const unitLabel = selectedCard ? selectedCard.unitPlural : 'elementos';
        const rawValue = countInput.value.trim();
        if (rawValue === '') {
          showStatus('');
          invalidatePreparedPackage();
          syncSelectorUI();
          return;
        }
        const value = Number(rawValue);
        if (Number.isInteger(value) && value >= minCount && value <= maxCount) {
          state.questionCount = value;
          state.lastVariableCount = value;
          showStatus('');
          scheduleDraftSave();
        } else {
          showStatus(`Elige entre ${minCount} y ${maxCount} ${unitLabel}.`, true);
        }
        invalidatePreparedPackage();
        syncSelectorUI();
      });

      countInput.addEventListener('blur', () => {
        const selectedCard = getActivityCard(state.activityType);
        if (isGenerating || (selectedCard && selectedCard.fixedCount !== null)) return;
        const minCount = selectedCard ? selectedCard.minCount : 1;
        const maxCount = selectedCard ? selectedCard.maxCount : 20;
        const unitLabel = selectedCard ? selectedCard.unitPlural : 'elementos';
        const rawValue = countInput.value.trim();
        const value = Number(rawValue);
        if (!rawValue || !Number.isInteger(value) || value < minCount || value > maxCount) {
          showStatus(`Elige entre ${minCount} y ${maxCount} ${unitLabel}.`, true);
        }
      });

      if (promptInput) {
        promptInput.value = state.prompt;
        updatePromptCounter(promptCounter);
        promptInput.addEventListener('input', (e) => {
          if (isGenerating) return;
          const nextPrompt = e.target.value.slice(0, 10000);
          if (e.target.value.length > 10000) e.target.value = nextPrompt;
          state.prompt = nextPrompt;
          updatePromptCounter(promptCounter);
          invalidatePreparedPackage();
          scheduleDraftSave();
        });
      }

      syncSelectorUI();

      generateButton.addEventListener('click', async () => {
        const selectedCard = getActivityCard(state.activityType);
        if (!selectedCard) {
          showStatus('Selecciona un tipo de actividad antes de generar.', true);
          activeCardButtons.find(btn => !btn.classList.contains('hidden'))?.focus();
          return;
        }
        const count = selectedCard.fixedCount !== null ? selectedCard.fixedCount : Number(countInput.value);
        if (!Number.isInteger(count) || count < selectedCard.minCount || count > selectedCard.maxCount) {
          showStatus(`Elige entre ${selectedCard.minCount} y ${selectedCard.maxCount} ${selectedCard.unitPlural}.`, true);
          countInput.focus();
          return;
        }
        state.questionCount = count;
        if (selectedCard.fixedCount === null) state.lastVariableCount = count;
        if (state.prompt.length > 10000) { showStatus('Las instrucciones no pueden superar 10.000 caracteres.', true); return; }
        const requestedTitle = nameInput.value.trim();
        if (requestedTitle.length > 180 || /[\x00-\x1f\x7f]/.test(requestedTitle)) {
          showStatus('Escribe un nombre de actividad válido (máximo 180 caracteres).', true);
          nameInput.focus();
          return;
        }
        if (!window.configManager || !window.academicAPI?.generateH5P) { showStatus('No se pudo iniciar la generación.', true); return; }
        setGeneratingState(true, `Analizando documentos y generando ${selectedCard.label} con Gemini…`);
        try {
          await window.configManager.refreshStatus();
          if (!window.configManager.hasApiKey()) {
            setGeneratingState(false);
            await window.configManager.requireApiKey(() => generateButton.click());
            return;
          }
          invalidatePreparedPackage();
          const version = state.inspectionVersion;
          const documentIds = state.files.map(file => state.inspections.get(file));
          showStatus('Generando contenido y preparando el archivo… Los fallos temporales y las respuestas incompletas o inválidas se reintentarán de forma limitada.');
          stageTimer = window.setTimeout(() => {
            if (isGenerating) progressStep.textContent = 'Validando estructura y empaquetando el archivo H5P…';
          }, 1200);
          const payload = {
            documentIds,
            activityType: selectedCard.type,
            questionCount: count,
            instructions: state.prompt
          };
          if (requestedTitle) payload.title = requestedTitle;
          const result = await window.academicAPI.generateH5P(payload);
          if (version !== state.inspectionVersion || !generateButton.isConnected || panelSelector.classList.contains('hidden')) return;
          if (result?.status !== 'ok' || result.kind !== 'package') {
            showStatus(result?.message || 'No se pudo generar la actividad.', true); return;
          }
          packageId = result.packageId;
          saveButton.classList.remove('hidden');
          const unit = result.questionCount === 1 ? selectedCard.unitSingular : selectedCard.unitPlural;
          showStatus(`${selectedCard.label} preparada con ${result.questionCount} ${unit}. Puedes guardarlo y revisarlo en Lumi. Comprueba las respuestas y explicaciones antes de usarlo con estudiantes.`);
          saveButton.focus();
        } catch { showStatus('No se pudo generar la actividad. Inténtalo nuevamente.', true); }
        finally { setGeneratingState(false); }
      });
      saveButton.addEventListener('click', async () => {
        const suggestedName = nameInput.value.trim();
        const baseName = suggestedName.replace(/\.h5p$/i, '').trim();
        if (!baseName || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(suggestedName) || suggestedName === '.' || suggestedName === '..' || baseName === '.' || baseName === '..') {
          showStatus('Escribe un nombre de archivo válido (sin barras ni caracteres especiales como : * ? " < > |).', true); nameInput.focus(); return;
        }
        if (!packageId) return;
        saveButton.disabled = true; generateButton.disabled = true;
        if (revealSavedButton) revealSavedButton.disabled = true;
        showStatus('Elige dónde guardar el archivo…');
        try {
          const result = await window.academicAPI.saveH5PFile({ packageId, suggestedName, courseId: state.courseId || 'unassigned' });
          if (result?.status === 'cancelled') { showStatus('Guardado cancelado. Puedes intentarlo nuevamente.'); return; }
          if (result?.status !== 'ok') { showStatus(result?.message || 'No se pudo guardar el archivo.', true); return; }
          if (state.draftId) {
            const completedDraftId = state.draftId;
            window.clearTimeout(draftSaveTimer);
            state.draftId = null;
            draftContextToken++;
            window.coursesManager?.deleteDraft?.(completedDraftId).catch(() => {});
          }
          if (result.projectSaved && typeof result.projectId === 'string' && result.projectId) {
            lastSavedProjectId = result.projectId;
            revealSavedButton?.classList.remove('hidden');
          } else {
            lastSavedProjectId = null;
            revealSavedButton?.classList.add('hidden');
          }
          if (result.projectSaved) {
            Promise.resolve(window.coursesManager?.onProjectExported?.(state.courseId || 'unassigned')).catch(() => {});
          }
          showStatus(result.projectSaved ? `Archivo ${result.fileName} guardado y añadido a tus proyectos.` : `Archivo ${result.fileName} guardado. No se pudo añadir a tus proyectos.`, !result.projectSaved);
        } catch { showStatus('No se pudo guardar el archivo. Inténtalo nuevamente.', true); }
        finally { saveButton.disabled = false; syncSelectorUI(); }
      });
      revealSavedButton?.addEventListener('click', async () => {
        if (!lastSavedProjectId || !window.academicAPI?.revealProjectFile) return;
        try {
          const result = await window.academicAPI.revealProjectFile(lastSavedProjectId);
          if (result?.status === 'ok') return;
          if (result?.status === 'missing') {
            showStatus('El archivo .h5p ya no se encuentra en esa ubicación. Pudo moverse o eliminarse.', true);
            return;
          }
          showStatus('No se pudo abrir la carpeta del archivo guardado.', true);
        } catch {
          showStatus('No se pudo abrir la carpeta del archivo guardado.', true);
        }
      });
      document.getElementById('selector-title')?.focus();
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
    getActivityType: () => state.activityType,
    getQuestionCount: () => state.questionCount,
    getActivityConfig: () => ({ activityType: state.activityType, questionCount: state.questionCount }),
    getDocumentIds: () => state.files.length && state.files.every(file => state.inspections.has(file))
      ? state.files.map(file => state.inspections.get(file)) : [],
    flushDraft: () => flushDraftHandler(),
    leaveWizard: () => leaveWizardHandler(),
    onDraftDeleted: (draftId) => draftDeletedHandler(draftId),
    clearFiles: () => {
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
