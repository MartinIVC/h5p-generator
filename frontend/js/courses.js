/**
 * frontend/js/courses.js
 * Módulo para el Panel de Inicio y Gestión de Ramos y Proyectos H5P.
 * Controla el catálogo de asignaturas, la vista detallada por ramo,
 * la creación/edición de cursos y la visualización de proyectos exportados.
 */

(function () {
  'use strict';

  // Paleta de colores temáticos para los ramos (Tokens de Material Design 3 en light.css)
  const COLOR_PALETTES = [
    {
      id: 'primary',
      label: 'Cian Primario',
      bg: 'var(--md-sys-color-primary)',
      light: 'var(--md-sys-color-primary-container)',
      text: 'var(--md-sys-color-on-primary-container)'
    },
    {
      id: 'secondary',
      label: 'Verde Azulado',
      bg: 'var(--md-sys-color-secondary)',
      light: 'var(--md-sys-color-secondary-container)',
      text: 'var(--md-sys-color-on-secondary-container)'
    },
    {
      id: 'tertiary',
      label: 'Púrpura Docente',
      bg: 'var(--md-sys-color-tertiary)',
      light: 'var(--md-sys-color-tertiary-container)',
      text: 'var(--md-sys-color-on-tertiary-container)'
    },
    {
      id: 'secondary-fixed',
      label: 'Turquesa Suave',
      bg: 'var(--md-sys-color-secondary-fixed-dim)',
      light: 'var(--md-sys-color-secondary-fixed)',
      text: 'var(--md-sys-color-on-secondary-fixed-variant)'
    },
    {
      id: 'tertiary-fixed',
      label: 'Lavanda Suave',
      bg: 'var(--md-sys-color-tertiary-fixed-dim)',
      light: 'var(--md-sys-color-tertiary-fixed)',
      text: 'var(--md-sys-color-on-tertiary-fixed-variant)'
    }
  ];

  /**
   * Resuelve la paleta del ramo utilizando estrictamente tokens de light.css
   * @param {string} colorTag
   * @returns {object}
   */
  function resolveCoursePalette(colorTag) {
    const aliasMap = {
      cyan: 'primary',
      emerald: 'secondary',
      blue: 'secondary-fixed',
      purple: 'tertiary',
      amber: 'tertiary-fixed'
    };
    const targetId = aliasMap[colorTag] || colorTag;
    return COLOR_PALETTES.find(p => p.id === targetId) || COLOR_PALETTES[0];
  }

  // Estado interno del módulo
  const state = {
    courses: [],
    activeCourseId: null,
    projects: [],
    searchCoursesQuery: '',
    searchProjectsQuery: '',
    isEditingCourse: false,
    editingCourseId: null,
    pendingDeleteCourse: null
  };

  // Referencias a contenedores del DOM
  let panelHome = null;
  let panelCourseDetail = null;
  let panelUpload = null;
  let panelSelector = null;
  let panelExport = null;
  let appFooter = null;
  let topbarBackBtn = null;
  let topbarTitle = null;

  /**
   * Helper para invocar la API segura de Electron con fallback seguro
   */
  const api = {
    async getCourses() {
      if (window.academicAPI && typeof window.academicAPI.getCourses === 'function') {
        return window.academicAPI.getCourses();
      }
      return JSON.parse(localStorage.getItem('h5p_courses') || '[]');
    },
    async saveCourse(courseData) {
      if (window.academicAPI && typeof window.academicAPI.saveCourse === 'function') {
        return window.academicAPI.saveCourse(courseData);
      }
      const courses = await this.getCourses();
      const id = courseData.id || `c_${Date.now()}`;
      const item = { ...courseData, id, projectsCount: courseData.projectsCount || 0 };
      const idx = courses.findIndex(c => c.id === id);
      if (idx >= 0) courses[idx] = item;
      else courses.unshift(item);
      localStorage.setItem('h5p_courses', JSON.stringify(courses));
      return item;
    },
    async deleteCourse(courseId) {
      if (window.academicAPI && typeof window.academicAPI.deleteCourse === 'function') {
        return window.academicAPI.deleteCourse(courseId);
      }
      let courses = await this.getCourses();
      courses = courses.filter(c => c.id !== courseId);
      localStorage.setItem('h5p_courses', JSON.stringify(courses));
      return true;
    },
    async getProjects(courseId) {
      if (window.academicAPI && typeof window.academicAPI.getProjects === 'function') {
        return window.academicAPI.getProjects(courseId);
      }
      const all = JSON.parse(localStorage.getItem('h5p_projects') || '[]');
      if (courseId) return all.filter(p => p.courseId === courseId);
      return all;
    },
    async saveProject(projectData) {
      if (window.academicAPI && typeof window.academicAPI.saveProject === 'function') {
        return window.academicAPI.saveProject(projectData);
      }
      const all = JSON.parse(localStorage.getItem('h5p_projects') || '[]');
      const newProj = { ...projectData, id: projectData.id || `p_${Date.now()}` };
      all.unshift(newProj);
      localStorage.setItem('h5p_projects', JSON.stringify(all));
      return newProj;
    },
    async deleteProject(projectId) {
      if (window.academicAPI && typeof window.academicAPI.deleteProject === 'function') {
        return window.academicAPI.deleteProject(projectId);
      }
      let all = JSON.parse(localStorage.getItem('h5p_projects') || '[]');
      all = all.filter(p => p.id !== projectId);
      localStorage.setItem('h5p_projects', JSON.stringify(all));
      return true;
    },
    async revealFile(filePath) {
      if (window.academicAPI && typeof window.academicAPI.revealFile === 'function') {
        return window.academicAPI.revealFile(filePath);
      }
      alert(`Archivo en: ${filePath}`);
      return true;
    }
  };

  /**
   * Formatea una fecha ISO a representación amigable (ej: "24 oct. 2026, 14:30")
   */
  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('es-CL', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  /**
   * Escapa cadenas para prevenir inyecciones HTML
   */
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =========================================================================
  // VISTAS Y NAVEGACIÓN
  // =========================================================================

  /**
   * Navega a la pantalla de inicio (Catálogo de Ramos)
   */
  async function navigateToHome() {
    state.activeCourseId = null;
    
    // Visibilidad de secciones
    if (panelHome) panelHome.classList.remove('hidden');
    if (panelCourseDetail) panelCourseDetail.classList.add('hidden');
    if (panelUpload) panelUpload.classList.add('hidden');
    if (panelSelector) panelSelector.classList.add('hidden');
    if (panelExport) panelExport.classList.add('hidden');
    if (appFooter) appFooter.classList.add('hidden');

    // Barra superior
    if (topbarBackBtn) topbarBackBtn.classList.add('hidden');
    if (topbarTitle) topbarTitle.textContent = 'Generador H5P';

    await loadCourses();
    renderHomeView();
  }

  /**
   * Navega a la vista de detalle de un ramo específico
   */
  async function navigateToCourseDetail(courseId) {
    state.activeCourseId = courseId;
    state.searchProjectsQuery = '';

    const course = state.courses.find(c => c.id === courseId);
    if (!course) {
      navigateToHome();
      return;
    }

    // Visibilidad de secciones
    if (panelHome) panelHome.classList.add('hidden');
    if (panelCourseDetail) panelCourseDetail.classList.remove('hidden');
    if (panelUpload) panelUpload.classList.add('hidden');
    if (panelSelector) panelSelector.classList.add('hidden');
    if (panelExport) panelExport.classList.add('hidden');
    if (appFooter) appFooter.classList.add('hidden');

    // Barra superior
    if (topbarBackBtn) {
      topbarBackBtn.classList.remove('hidden');
      topbarBackBtn.setAttribute('title', 'Volver a Mis Ramos');
      topbarBackBtn.onclick = navigateToHome;
    }
    if (topbarTitle) {
      topbarTitle.textContent = `${course.code ? course.code + ' - ' : ''}${course.name}`;
    }

    await loadProjectsForActiveCourse();
    renderCourseDetailView();
  }

  /**
   * Inicia el proceso de creación de proyecto H5P para el ramo activo
   */
  function startProjectCreation(courseId) {
    if (courseId) {
      state.activeCourseId = courseId;
    }

    const course = state.courses.find(c => c.id === state.activeCourseId);

    // Visibilidad de secciones
    if (panelHome) panelHome.classList.add('hidden');
    if (panelCourseDetail) panelCourseDetail.classList.add('hidden');
    if (panelUpload) panelUpload.classList.remove('hidden');
    if (panelSelector) panelSelector.classList.add('hidden');
    if (panelExport) panelExport.classList.add('hidden');
    if (appFooter) appFooter.classList.remove('hidden');

    // Barra superior
    if (topbarBackBtn) {
      topbarBackBtn.classList.remove('hidden');
      topbarBackBtn.setAttribute('title', 'Volver al Ramo');
      topbarBackBtn.onclick = () => {
        if (state.activeCourseId) navigateToCourseDetail(state.activeCourseId);
        else navigateToHome();
      };
    }

    // Asegurar que el stepper marque el paso 1 activo
    const step1 = document.getElementById('step-indicator-1');
    const step2 = document.getElementById('step-indicator-2');
    const step3 = document.getElementById('step-indicator-3');
    if (step1) {
      step1.classList.add('active');
      step1.classList.remove('completed');
      step1.setAttribute('aria-current', 'step');
    }
    if (step2) {
      step2.classList.remove('active', 'completed');
      step2.removeAttribute('aria-current');
    }
    if (step3) {
      step3.classList.remove('active', 'completed');
      step3.removeAttribute('aria-current');
    }

    // Actualizar banner contextual de ramo en el panel de subida
    updateCourseContextBanner(course);
  }

  /**
   * Muestra u oculta el banner contextual de la asignatura dentro del asistente
   */
  function updateCourseContextBanner(course) {
    let banner = document.getElementById('course-context-banner');
    if (!banner && panelUpload) {
      banner = document.createElement('div');
      banner.id = 'course-context-banner';
      banner.className = 'course-context-banner';
      const wrapper = panelUpload.querySelector('.upload-card-wrapper');
      if (wrapper) {
        wrapper.insertBefore(banner, wrapper.firstChild);
      } else {
        panelUpload.insertBefore(banner, panelUpload.firstChild);
      }
    }

    if (!banner) return;

    if (course) {
      const palette = resolveCoursePalette(course.colorTag);
      banner.innerHTML = `
        <div class="course-context-content">
          <div class="course-context-tag" style="background-color: ${palette.light}; color: ${palette.text};">
            <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <strong>${escapeHTML(course.code || 'ASIGNATURA')}</strong>
          </div>
          <div class="course-context-name">
            <span>Generando recurso para:</span>
            <strong>${escapeHTML(course.name)}</strong>
            ${course.term ? `<span class="course-term-pill">${escapeHTML(course.term)}</span>` : ''}
          </div>
        </div>
        <button type="button" class="btn-text-subtle" id="btn-switch-course">
          Cambiar de Ramo
        </button>
      `;
      banner.classList.remove('hidden');

      const btnSwitch = banner.querySelector('#btn-switch-course');
      if (btnSwitch) {
        btnSwitch.addEventListener('click', navigateToHome);
      }
    } else {
      banner.innerHTML = `
        <div class="course-context-content">
          <span class="course-context-icon">💡</span>
          <span>Proyecto General (sin asignatura vinculada)</span>
        </div>
        <button type="button" class="btn-text-subtle" id="btn-switch-course">
          Vincular a un Ramo
        </button>
      `;
      banner.classList.remove('hidden');

      const btnSwitch = banner.querySelector('#btn-switch-course');
      if (btnSwitch) {
        btnSwitch.addEventListener('click', navigateToHome);
      }
    }
  }

  // =========================================================================
  // CARGA DE DATOS
  // =========================================================================

  async function loadCourses() {
    try {
      state.courses = await api.getCourses();
    } catch (err) {
      console.error('[courses.js] Error cargando ramos:', err);
      state.courses = [];
    }
  }

  async function loadProjectsForActiveCourse() {
    try {
      state.projects = await api.getProjects(state.activeCourseId);
    } catch (err) {
      console.error('[courses.js] Error cargando proyectos:', err);
      state.projects = [];
    }
  }

  // =========================================================================
  // RENDER: PANEL DE INICIO (HOME)
  // =========================================================================

  function renderHomeView() {
    if (!panelHome) return;

    const filteredCourses = state.courses.filter(c => {
      if (!state.searchCoursesQuery) return true;
      const q = state.searchCoursesQuery.toLowerCase();
      return (
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.term && c.term.toLowerCase().includes(q))
      );
    });

    const totalProjects = state.courses.reduce((acc, c) => acc + (c.projectsCount || 0), 0);

    let coursesCardsHTML = '';
    if (filteredCourses.length === 0) {
      if (state.searchCoursesQuery) {
        coursesCardsHTML = `
          <div class="empty-results-box">
            <svg class="icon-svg empty-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <p>No se encontraron asignaturas que coincidan con "<strong>${escapeHTML(state.searchCoursesQuery)}</strong>".</p>
            <button type="button" class="btn-text-subtle" id="btn-clear-course-search">Limpiar búsqueda</button>
          </div>
        `;
      } else {
        coursesCardsHTML = `
          <div class="courses-empty-hero">
            <div class="hero-icon-bubble">
              <svg class="icon-svg" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                <path d="M9 10h6"></path>
                <path d="M9 6h6"></path>
              </svg>
            </div>
            <h3 class="hero-title">¡Bienvenido, Profesor!</h3>
            <p class="hero-desc">
              Organiza tus asignaturas docentes para gestionar y crear actividades interactivas H5P a partir de tus documentos y apuntes.
            </p>
            <button type="button" class="btn-primary" id="btn-empty-create-course">
              <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Crear mi primer Ramo</span>
            </button>
          </div>
        `;
      }
    } else {
      coursesCardsHTML = `
        <div class="courses-grid" role="list" aria-label="Lista de ramos">
          ${filteredCourses.map(course => {
            const palette = resolveCoursePalette(course.colorTag);
            return `
              <article class="course-card" data-course-id="${course.id}" role="listitem" tabindex="0">
                <div class="course-card-accent" style="background-color: ${palette.bg};"></div>
                <div class="course-card-body">
                  <header class="course-card-header">
                    <div class="course-badge-wrap">
                      ${course.code ? `<span class="course-code-badge" style="background-color: ${palette.light}; color: ${palette.text};">${escapeHTML(course.code)}</span>` : ''}
                      ${course.term ? `<span class="course-term-badge">${escapeHTML(course.term)}</span>` : ''}
                    </div>
                    <div class="course-card-actions" onclick="event.stopPropagation();">
                      <button type="button" class="btn-icon-subtle btn-edit-course" data-id="${course.id}" title="Editar asignatura" aria-label="Editar asignatura">
                        <svg class="icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M12 20h9"></path>
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                      </button>
                      <button type="button" class="btn-icon-subtle btn-delete-course" data-id="${course.id}" title="Eliminar asignatura" aria-label="Eliminar asignatura">
                        <svg class="icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </header>

                  <h3 class="course-card-title">${escapeHTML(course.name)}</h3>
                  ${course.description ? `<p class="course-card-desc">${escapeHTML(course.description)}</p>` : ''}

                  <footer class="course-card-footer">
                    <div class="course-projects-metric">
                      <svg class="icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                      </svg>
                      <span><strong>${course.projectsCount || 0}</strong> ${course.projectsCount === 1 ? 'actividad' : 'actividades'} H5P</span>
                    </div>
                    <span class="course-card-cta">
                      Abrir
                      <svg class="icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </span>
                  </footer>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      `;
    }

    panelHome.innerHTML = `
      <div class="home-container">
        <header class="home-hero-header">
          <div class="home-title-wrap">
            <h2 class="home-title">Mis Ramos</h2>
            <p class="home-subtitle">
              Gestiona tus asignaturas y accede a los proyectos exportados correspondientes.
            </p>
          </div>
          <div class="home-header-actions">
            <button type="button" class="btn-primary" id="btn-top-create-course">
              <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Nuevo Ramo</span>
            </button>
          </div>
        </header>

        ${state.courses.length > 0 ? `
          <div class="home-search-bar">
            <div class="search-input-wrap">
              <svg class="icon-svg search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="search"
                id="search-courses-input"
                class="search-input"
                placeholder="Buscar por código, nombre o semestre..."
                value="${escapeHTML(state.searchCoursesQuery)}"
              />
            </div>
            <div class="home-stats-pill">
              <span>Total: <strong>${state.courses.length}</strong> ramos</span>
              <span class="dot-divider">•</span>
              <span><strong>${totalProjects}</strong> proyectos exportados</span>
            </div>
          </div>
        ` : ''}

        <div class="home-courses-content">
          ${coursesCardsHTML}
        </div>
      </div>
    `;

    // Event listeners del Home
    attachHomeEventListeners();
  }

  function attachHomeEventListeners() {
    const btnTopCreate = document.getElementById('btn-top-create-course');
    if (btnTopCreate) btnTopCreate.addEventListener('click', () => openCourseModal());

    const btnEmptyCreate = document.getElementById('btn-empty-create-course');
    if (btnEmptyCreate) btnEmptyCreate.addEventListener('click', () => openCourseModal());

    const searchInput = document.getElementById('search-courses-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchCoursesQuery = e.target.value;
        renderHomeView();
        // Mantener el foco y cursor
        const inputAfter = document.getElementById('search-courses-input');
        if (inputAfter) {
          inputAfter.focus();
          inputAfter.setSelectionRange(inputAfter.value.length, inputAfter.value.length);
        }
      });
    }

    const btnClearSearch = document.getElementById('btn-clear-course-search');
    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        state.searchCoursesQuery = '';
        renderHomeView();
      });
    }

    // Clic en tarjetas de ramos
    const courseCards = panelHome.querySelectorAll('.course-card');
    courseCards.forEach(card => {
      const courseId = card.getAttribute('data-course-id');
      card.addEventListener('click', () => navigateToCourseDetail(courseId));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigateToCourseDetail(courseId);
        }
      });
    });

    // Clic en editar ramo
    const editBtns = panelHome.querySelectorAll('.btn-edit-course');
    editBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const courseId = btn.getAttribute('data-id');
        openCourseModal(courseId);
      });
    });

    // Clic en eliminar ramo
    const deleteBtns = panelHome.querySelectorAll('.btn-delete-course');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const courseId = btn.getAttribute('data-id');
        openDeleteConfirmModal(courseId);
      });
    });
  }

  // =========================================================================
  // RENDER: VISTA DETALLE DE RAMO Y PROYECTOS
  // =========================================================================

  function renderCourseDetailView() {
    if (!panelCourseDetail) return;

    const course = state.courses.find(c => c.id === state.activeCourseId);
    if (!course) {
      navigateToHome();
      return;
    }

    const palette = resolveCoursePalette(course.colorTag);

    const filteredProjects = state.projects.filter(p => {
      if (!state.searchProjectsQuery) return true;
      const q = state.searchProjectsQuery.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        (p.h5pType && p.h5pType.toLowerCase().includes(q))
      );
    });

    let projectsHTML = '';
    if (filteredProjects.length === 0) {
      if (state.searchProjectsQuery) {
        projectsHTML = `
          <div class="empty-results-box">
            <p>No se encontraron proyectos en este ramo que coincidan con "<strong>${escapeHTML(state.searchProjectsQuery)}</strong>".</p>
          </div>
        `;
      } else {
        projectsHTML = `
          <div class="projects-empty-state">
            <div class="projects-empty-icon">
              <svg class="icon-svg" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
            </div>
            <h4>Sin proyectos exportados aún</h4>
            <p>Genera actividades H5P interactivas para esta asignatura a partir de tus documentos docentes.</p>
            <button type="button" class="btn-primary" id="btn-empty-start-project">
              <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Crear Proyecto H5P</span>
            </button>
          </div>
        `;
      }
    } else {
      projectsHTML = `
        <div class="projects-grid" role="list" aria-label="Lista de proyectos del ramo">
          ${filteredProjects.map(proj => {
            return `
              <div class="project-card" data-project-id="${proj.id}" role="listitem">
                <div class="project-card-header">
                  <div class="project-type-badge">${escapeHTML(proj.h5pType || 'H5P')}</div>
                  <span class="project-date-badge">${formatDate(proj.exportedAt)}</span>
                </div>
                
                <h4 class="project-title">${escapeHTML(proj.title)}</h4>
                
                ${proj.sourceFiles && proj.sourceFiles.length > 0 ? `
                  <div class="project-sources-info" title="${proj.sourceFiles.map(f => f.name || f).join(', ')}">
                    <svg class="icon-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    </svg>
                    <span>${proj.sourceFiles.length} ${proj.sourceFiles.length === 1 ? 'documento base' : 'documentos base'}</span>
                  </div>
                ` : ''}

                ${proj.promptSummary ? `
                  <p class="project-prompt-preview">"${escapeHTML(proj.promptSummary)}"</p>
                ` : ''}

                <div class="project-card-footer">
                  <button type="button" class="btn-secondary btn-reveal-project" data-path="${escapeHTML(proj.filePath || '')}" title="Abrir carpeta donde se guardó el archivo .h5p">
                    <svg class="icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span>Ver en carpeta</span>
                  </button>
                  <button type="button" class="btn-icon-subtle btn-delete-project" data-id="${proj.id}" title="Eliminar registro del proyecto" aria-label="Eliminar registro">
                    <svg class="icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    panelCourseDetail.innerHTML = `
      <div class="course-detail-container">
        <!-- Barra de retorno y acciones de asignatura -->
        <div class="course-detail-nav">
          <button type="button" class="btn-text-nav" id="btn-nav-back-home">
            <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Volver a Mis Ramos</span>
          </button>
          <div class="course-detail-edit-actions">
            <button type="button" class="btn-icon-subtle" id="btn-detail-edit-course" title="Editar información del ramo">
              <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Banner de Cabecera del Ramo -->
        <header class="course-detail-header" style="border-left: 6px solid ${palette.bg};">
          <div class="course-detail-meta">
            <div class="course-badge-wrap">
              ${course.code ? `<span class="course-code-badge" style="background-color: ${palette.light}; color: ${palette.text};">${escapeHTML(course.code)}</span>` : ''}
              ${course.term ? `<span class="course-term-badge">${escapeHTML(course.term)}</span>` : ''}
            </div>
            <h2 class="course-detail-title">${escapeHTML(course.name)}</h2>
            ${course.description ? `<p class="course-detail-desc">${escapeHTML(course.description)}</p>` : ''}
          </div>

          <!-- Acciones principales requeridas: Crear y Abrir proyectos -->
          <div class="course-detail-main-actions">
            <button type="button" class="btn-primary btn-action-large" id="btn-course-create-project">
              <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Crear Proyecto</span>
            </button>

            <button type="button" class="btn-secondary btn-action-large" id="btn-course-open-project" title="Abrir y editar proyectos existentes con Lumi">
              <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>Abrir Proyectos</span>
              <span class="badge-lumi-tag">Lumi</span>
            </button>
          </div>
        </header>

        <!-- Sección de Proyectos Realizados -->
        <section class="course-projects-section">
          <div class="course-projects-bar">
            <div class="projects-bar-left">
              <h3 class="projects-bar-title">Proyectos Realizados</h3>
              <span class="projects-count-pill">${state.projects.length}</span>
            </div>
            ${state.projects.length > 0 ? `
              <div class="search-input-wrap projects-search-wrap">
                <svg class="icon-svg search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="search"
                  id="search-projects-input"
                  class="search-input"
                  placeholder="Buscar proyecto..."
                  value="${escapeHTML(state.searchProjectsQuery)}"
                />
              </div>
            ` : ''}
          </div>

          <div class="projects-content-wrap">
            ${projectsHTML}
          </div>
        </section>
      </div>
    `;

    attachCourseDetailEventListeners();
  }

  function attachCourseDetailEventListeners() {
    const btnBack = document.getElementById('btn-nav-back-home');
    if (btnBack) btnBack.addEventListener('click', navigateToHome);

    const btnEdit = document.getElementById('btn-detail-edit-course');
    if (btnEdit) btnEdit.addEventListener('click', () => openCourseModal(state.activeCourseId));

    const btnCreateProj = document.getElementById('btn-course-create-project');
    if (btnCreateProj) btnCreateProj.addEventListener('click', () => startProjectCreation(state.activeCourseId));

    const btnEmptyCreateProj = document.getElementById('btn-empty-start-project');
    if (btnEmptyCreateProj) btnEmptyCreateProj.addEventListener('click', () => startProjectCreation(state.activeCourseId));

    // Acción Abrir Proyecto (Lumi)
    const btnOpenProj = document.getElementById('btn-course-open-project');
    if (btnOpenProj) {
      btnOpenProj.addEventListener('click', () => openLumiInfoModal());
    }

    // Buscador de proyectos
    const searchProjInput = document.getElementById('search-projects-input');
    if (searchProjInput) {
      searchProjInput.addEventListener('input', (e) => {
        state.searchProjectsQuery = e.target.value;
        renderCourseDetailView();
        const inputAfter = document.getElementById('search-projects-input');
        if (inputAfter) {
          inputAfter.focus();
          inputAfter.setSelectionRange(inputAfter.value.length, inputAfter.value.length);
        }
      });
    }

    // Abrir ubicación en carpeta
    const revealBtns = panelCourseDetail.querySelectorAll('.btn-reveal-project');
    revealBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.getAttribute('data-path');
        if (!path) {
          alert('No hay una ruta local registrada para este proyecto.');
          return;
        }
        await api.revealFile(path);
      });
    });

    // Eliminar registro de proyecto
    const deleteProjBtns = panelCourseDetail.querySelectorAll('.btn-delete-project');
    deleteProjBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('¿Deseas eliminar este registro de proyecto? (El archivo .h5p en disco no se borrará).')) {
          await api.deleteProject(id);
          await loadProjectsForActiveCourse();
          await loadCourses();
          renderCourseDetailView();
        }
      });
    });
  }

  // =========================================================================
  // MODALES (CREAR/EDITAR RAMO, CONFIRMACIÓN, LUMI)
  // =========================================================================

  /**
   * Abre el modal para crear o editar un ramo
   */
  function openCourseModal(courseId = null) {
    state.isEditingCourse = Boolean(courseId);
    state.editingCourseId = courseId;

    let initialData = {
      code: '',
      name: '',
      term: '',
      colorTag: 'primary',
      description: ''
    };

    if (courseId) {
      const course = state.courses.find(c => c.id === courseId);
      if (course) {
        initialData = {
          code: course.code || '',
          name: course.name || '',
          term: course.term || '',
          colorTag: course.colorTag || 'primary',
          description: course.description || ''
        };
      }
    }

    const modal = document.getElementById('modal-course-form');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal-dialog-content">
        <header class="modal-dialog-header">
          <div class="modal-dialog-title-wrap">
            <svg class="icon-svg modal-header-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <h3 class="modal-dialog-title">${state.isEditingCourse ? 'Editar Ramo' : 'Nuevo Ramo'}</h3>
          </div>
          <button type="button" class="btn-icon btn-close-dialog" id="btn-close-course-modal" aria-label="Cerrar ventana">
            <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>

        <form id="form-course" class="modal-dialog-form">
          <div class="form-row-2">
            <div class="form-group">
              <label for="input-course-code" class="form-label">Código Asignatura</label>
              <input
                type="text"
                id="input-course-code"
                class="form-control"
                placeholder="ej: INF-220, MAT-101"
                value="${escapeHTML(initialData.code)}"
                maxlength="20"
              />
              <span class="form-hint">Opcional pero recomendado</span>
            </div>

            <div class="form-group">
              <label for="input-course-term" class="form-label">Semestre / Periodo</label>
              <input
                type="text"
                id="input-course-term"
                class="form-control"
                placeholder="ej: 2026-1, Otoño"
                value="${escapeHTML(initialData.term)}"
                maxlength="30"
              />
            </div>
          </div>

          <div class="form-group">
            <label for="input-course-name" class="form-label">Nombre de la Asignatura <span class="required-star">*</span></label>
            <input
              type="text"
              id="input-course-name"
              class="form-control"
              placeholder="ej: Estructuras de Datos y Algoritmos"
              value="${escapeHTML(initialData.name)}"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label">Color identificador</label>
            <div class="color-picker-group">
              ${COLOR_PALETTES.map(p => `
                <label class="color-option-label" title="${p.label}">
                  <input
                    type="radio"
                    name="course-color"
                    value="${p.id}"
                    ${resolveCoursePalette(initialData.colorTag).id === p.id ? 'checked' : ''}
                  />
                  <span class="color-swatch" style="background-color: ${p.bg};"></span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-group">
            <label for="input-course-desc" class="form-label">Descripción u Observaciones (opcional)</label>
            <textarea
              id="input-course-desc"
              class="form-control form-textarea"
              rows="2"
              placeholder="ej: Sección 1 - Martes y Jueves, Campus Central..."
            >${escapeHTML(initialData.description)}</textarea>
          </div>

          <footer class="modal-dialog-footer">
            <button type="button" class="btn-secondary" id="btn-cancel-course-modal">Cancelar</button>
            <button type="submit" class="btn-primary" id="btn-save-course">
              <span>${state.isEditingCourse ? 'Guardar Cambios' : 'Crear Ramo'}</span>
            </button>
          </footer>
        </form>
      </div>
    `;

    modal.classList.remove('hidden');

    const inputName = document.getElementById('input-course-name');
    if (inputName) setTimeout(() => inputName.focus(), 100);

    const closeModal = () => modal.classList.add('hidden');

    const btnClose = document.getElementById('btn-close-course-modal');
    if (btnClose) btnClose.addEventListener('click', closeModal);

    const btnCancel = document.getElementById('btn-cancel-course-modal');
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    // Guardado
    const form = document.getElementById('form-course');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('input-course-code').value.trim();
        const name = document.getElementById('input-course-name').value.trim();
        const term = document.getElementById('input-course-term').value.trim();
        const desc = document.getElementById('input-course-desc').value.trim();
        const selectedColor = form.querySelector('input[name="course-color"]:checked')?.value || 'primary';

        if (!name) {
          alert('Por favor ingresa el nombre de la asignatura.');
          return;
        }

        try {
          const payload = {
            id: state.isEditingCourse ? state.editingCourseId : undefined,
            code,
            name,
            term,
            colorTag: selectedColor,
            description: desc
          };

          const saved = await api.saveCourse(payload);
          closeModal();
          await loadCourses();

          if (state.activeCourseId === saved.id) {
            renderCourseDetailView();
          } else {
            renderHomeView();
          }
        } catch (err) {
          alert(`Error al guardar ramo: ${err.message}`);
        }
      });
    }
  }

  /**
   * Modal de confirmación para eliminar un ramo asegurando la integridad de proyectos
   */
  function openDeleteConfirmModal(courseId) {
    const course = state.courses.find(c => c.id === courseId);
    if (!course) return;

    state.pendingDeleteCourse = course;

    const modal = document.getElementById('modal-confirm-dialog');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal-dialog-content confirm-dialog-box">
        <header class="modal-dialog-header">
          <div class="modal-dialog-title-wrap danger-text">
            <svg class="icon-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <h3 class="modal-dialog-title">¿Eliminar Ramo?</h3>
          </div>
          <button type="button" class="btn-icon btn-close-dialog" id="btn-close-confirm-modal" aria-label="Cerrar">
            <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>

        <div class="confirm-dialog-body">
          <p>
            Estás a punto de eliminar la asignatura <strong>${escapeHTML(course.name)}</strong>
            ${course.code ? `(<em>${escapeHTML(course.code)}</em>)` : ''}.
          </p>
          <div class="confirm-reassurance-box">
            <svg class="icon-svg info-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <p>
              <strong>Protección de material docente:</strong> Tus proyectos exportados e interactivos <strong>no se borrarán</strong>.
              Se conservarán de manera segura en la categoría general <em>"Sin Asignar"</em> para que puedas seguir usándolos o reasignarlos.
            </p>
          </div>
        </div>

        <footer class="modal-dialog-footer">
          <button type="button" class="btn-secondary" id="btn-cancel-delete">Cancelar</button>
          <button type="button" class="btn-text-danger" id="btn-confirm-delete">Eliminar Ramo</button>
        </footer>
      </div>
    `;

    modal.classList.remove('hidden');

    const closeModal = () => modal.classList.add('hidden');

    const btnClose = document.getElementById('btn-close-confirm-modal');
    if (btnClose) btnClose.addEventListener('click', closeModal);

    const btnCancel = document.getElementById('btn-cancel-delete');
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    const btnConfirm = document.getElementById('btn-confirm-delete');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', async () => {
        await api.deleteCourse(course.id);
        closeModal();
        if (state.activeCourseId === course.id) {
          navigateToHome();
        } else {
          await loadCourses();
          renderHomeView();
        }
      });
    }
  }

  /**
   * Modal informativo sobre la integración futura con Lumi
   */
  function openLumiInfoModal() {
    const modal = document.getElementById('modal-confirm-dialog');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal-dialog-content lumi-dialog-box">
        <header class="modal-dialog-header">
          <div class="modal-dialog-title-wrap">
            <svg class="icon-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <h3 class="modal-dialog-title">Integración con Lumi</h3>
          </div>
          <button type="button" class="btn-icon btn-close-dialog" id="btn-close-lumi-modal" aria-label="Cerrar">
            <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>

        <div class="lumi-dialog-body">
          <div class="lumi-badge-hero">Próximamente</div>
          <p>
            La funcionalidad <strong>Abrir Proyecto</strong> permitirá editar e interactuar de forma nativa con los paquetes <code>.h5p</code> directamente a través de la herramienta de escritorio <strong>Lumi</strong>.
          </p>
          <p class="lumi-subtext">
            Por el momento, puedes hacer clic en el botón <strong>"Ver en carpeta"</strong> de cualquiera de tus actividades para abrir la ubicación física del archivo en tu computadora e importarlo manualmente a Moodle, Canvas o Lumi.
          </p>
        </div>

        <footer class="modal-dialog-footer">
          <button type="button" class="btn-primary" id="btn-close-lumi-btn">Entendido</button>
        </footer>
      </div>
    `;

    modal.classList.remove('hidden');

    const closeModal = () => modal.classList.add('hidden');
    const btnClose = document.getElementById('btn-close-lumi-modal');
    if (btnClose) btnClose.addEventListener('click', closeModal);
    const btnOk = document.getElementById('btn-close-lumi-btn');
    if (btnOk) btnOk.addEventListener('click', closeModal);
  }

  // =========================================================================
  // INICIALIZACIÓN
  // =========================================================================

  async function init() {
    panelHome = document.getElementById('panel-home');
    panelCourseDetail = document.getElementById('panel-course-detail');
    panelUpload = document.getElementById('panel-upload');
    panelSelector = document.getElementById('panel-selector');
    panelExport = document.getElementById('panel-export');
    appFooter = document.getElementById('app-footer');
    topbarBackBtn = document.getElementById('btn-topbar-back');
    topbarTitle = document.getElementById('app-topbar-title');

    // Conectar navegación del menú lateral
    const menuOptHistory = document.getElementById('menu-opt-history');
    if (menuOptHistory) {
      menuOptHistory.addEventListener('click', () => {
        const btnCloseMenu = document.getElementById('btn-close-menu');
        if (btnCloseMenu) btnCloseMenu.click();
        navigateToHome();
      });
    }

    // Inicialmente cargar ramos y mostrar panel de inicio
    await loadCourses();
    navigateToHome();
  }

  // Interfaz pública
  window.coursesManager = {
    init,
    navigateToHome,
    navigateToCourseDetail,
    startProjectCreation,
    getActiveCourse: () => state.courses.find(c => c.id === state.activeCourseId) || null,
    registerProjectExport: async (projectData) => {
      const activeCourse = state.courses.find(c => c.id === state.activeCourseId);
      const payload = {
        ...projectData,
        courseId: activeCourse ? activeCourse.id : 'unassigned'
      };
      const saved = await api.saveProject(payload);
      await loadCourses();
      return saved;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
