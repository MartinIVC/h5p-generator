/**
 * Búsqueda global y acciones rápidas para ramos y proyectos.
 */
(function () {
  'use strict';

  let modal;
  let courses = [];
  let projects = [];
  let drafts = [];
  let visibleItems = [];
  let activeIndex = -1;

  function escapeHTML(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function projectCourseName(project) {
    if (project.courseId === 'unassigned') return 'Sin asignar';
    return courses.find(course => course.id === project.courseId)?.name || 'Ramo eliminado';
  }

  async function loadItems() {
    const api = window.academicAPI;
    if (!api) return;
    [courses, projects] = await Promise.all([api.getCourses(), api.getProjects()]);
    drafts = await window.coursesManager?.getDrafts?.() || [];
  }

  function makeItems(query) {
    const normalized = query.trim().toLocaleLowerCase('es');
    const courseItems = courses.map(course => ({
      kind: 'course', id: course.id, title: course.name,
      subtitle: [course.code, course.term, course.archivedAt ? 'Archivado' : ''].filter(Boolean).join(' · '),
      courseId: course.id, recentAt: course.lastOpenedAt || ''
    }));
    const projectItems = projects.map(project => ({
      kind: 'project', id: project.id, title: project.title,
      subtitle: [projectCourseName(project), project.h5pType || 'H5P', project.exportedAt ? new Date(project.exportedAt).toLocaleDateString('es-CL') : ''].filter(Boolean).join(' · '),
      courseId: project.courseId || 'unassigned', recentAt: project.exportedAt || ''
    }));

    if (!normalized) {
      return {
        courses: courseItems.sort((a, b) => new Date(b.recentAt || 0) - new Date(a.recentAt || 0)).slice(0, 5),
        projects: projectItems.sort((a, b) => new Date(b.recentAt || 0) - new Date(a.recentAt || 0)).slice(0, 5)
      };
    }
    const matches = item => `${item.title} ${item.subtitle}`.toLocaleLowerCase('es').includes(normalized);
    return {
      courses: courseItems.filter(matches).slice(0, 12),
      projects: projectItems.filter(matches).slice(0, 12)
    };
  }

  function renderResults() {
    const input = modal.querySelector('#global-search-input');
    const list = modal.querySelector('#global-search-results');
    const announcement = modal.querySelector('#global-search-announcement');
    const groups = makeItems(input.value);
    visibleItems = [...groups.courses, ...groups.projects];
    if (activeIndex >= visibleItems.length) activeIndex = visibleItems.length - 1;
    const isEmptyQuery = !input.value.trim();
    const renderGroup = (title, items, offset) => items.length ? `
      <section class="global-search-group" role="group" aria-label="${title}">
        <h3>${title}</h3>
        ${items.map((item, index) => `
            <div class="global-search-result ${activeIndex === offset + index ? 'is-active' : ''}" role="option" tabindex="-1" aria-selected="${activeIndex === offset + index}" id="global-search-option-${offset + index}" data-index="${offset + index}">
              <span class="global-search-result-icon" aria-hidden="true">${item.kind === 'course' ? 'R' : 'H5P'}</span>
              <span class="global-search-result-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.subtitle || 'Sin información adicional')}</small></span>
              <span class="global-search-result-kind">${item.kind === 'course' ? 'Ramo' : 'Proyecto'}</span>
            </div>
          `).join('')}
      </section>
    ` : '';
    const hasResults = visibleItems.length > 0;
    list.innerHTML = hasResults
      ? `${renderGroup(isEmptyQuery ? 'Ramos recientes' : 'Ramos', groups.courses, 0)}${renderGroup(isEmptyQuery ? 'Proyectos recientes' : 'Proyectos', groups.projects, groups.courses.length)}`
      : `<p class="global-search-empty">${isEmptyQuery ? 'Todavía no hay ramos ni proyectos para mostrar.' : 'No hay coincidencias. Prueba con otro nombre, código o tipo de actividad.'}</p>`;
    announcement.textContent = `${visibleItems.length} ${visibleItems.length === 1 ? 'resultado' : 'resultados'}`;
    input.setAttribute('aria-activedescendant', activeIndex >= 0 ? `global-search-option-${activeIndex}` : '');
    list.querySelectorAll('.global-search-result').forEach(button => {
      button.addEventListener('click', () => choose(Number(button.dataset.index)));
    });
  }

  function setActive(index, scroll = true) {
    if (!visibleItems.length) return;
    activeIndex = (index + visibleItems.length) % visibleItems.length;
    renderResults();
    const option = modal.querySelector(`#global-search-option-${activeIndex}`);
    if (scroll) option?.scrollIntoView({ block: 'nearest' });
  }

  function choose(index) {
    const item = visibleItems[index];
    if (!item) return;
    window.uiDialog?.close(modal);
    if (item.kind === 'course') window.coursesManager?.navigateToCourseDetail(item.courseId);
    else window.coursesManager?.openProjectSearch(item.courseId, item.title);
  }

  function renderModal() {
    modal.innerHTML = `
      <section class="modal-dialog-content global-search-dialog" aria-labelledby="global-search-title">
        <header class="modal-dialog-header">
          <div><h2 class="modal-dialog-title" id="global-search-title">Buscar en la biblioteca</h2><p>Encuentra ramos y proyectos por nombre, código o tipo.</p></div>
          <button type="button" class="btn-icon" id="btn-close-global-search" aria-label="Cerrar búsqueda"><span aria-hidden="true">×</span></button>
        </header>
        <div class="global-search-input-wrap">
          <svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
          <input type="search" id="global-search-input" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="global-search-results" aria-label="Buscar ramos y proyectos" placeholder="Ej.: Biología, BIO101, cuestionario…" autocomplete="off">
          <span class="global-search-shortcut" aria-hidden="true">Esc</span>
        </div>
        <div id="global-search-announcement" class="sr-only" role="status" aria-live="polite"></div>
        <div id="global-search-results" class="global-search-results" role="listbox" aria-label="Resultados"></div>
        <footer class="global-search-quick-actions" aria-label="Acciones rápidas">
          <button type="button" class="btn-secondary" data-quick-action="new-course">Nuevo ramo</button>
          <button type="button" class="btn-secondary" data-quick-action="draft" ${drafts.length ? '' : 'disabled'}>${drafts.length ? 'Continuar borrador' : 'Sin borradores'}</button>
          <button type="button" class="btn-secondary" data-quick-action="settings">Configuración</button>
        </footer>
      </section>
    `;
    modal.querySelector('#global-search-input').addEventListener('input', () => {
      activeIndex = -1;
      renderResults();
    });
    modal.querySelector('#global-search-input').addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex < 0 ? visibleItems.length - 1 : activeIndex - 1); }
      else if (event.key === 'Enter') { event.preventDefault(); choose(activeIndex < 0 ? 0 : activeIndex); }
    });
    modal.querySelector('#btn-close-global-search').addEventListener('click', () => window.uiDialog?.close(modal));
    modal.querySelectorAll('[data-quick-action]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.quickAction;
      window.uiDialog?.close(modal);
      if (action === 'new-course') window.coursesManager?.navigateToHome().then(() => window.coursesManager?.openCourseModal());
      if (action === 'draft' && drafts[0]) window.coursesManager?.startProjectCreation(drafts[0].courseId, drafts[0]);
      if (action === 'settings') window.configManager?.openSettingsModal();
    }));
    renderResults();
  }

  async function open() {
    if (!modal) return;
    try {
      await loadItems();
    } catch (error) {
      courses = [];
      projects = [];
      drafts = [];
      window.uiMessage?.(`No se pudo cargar la búsqueda: ${error.message}`, 'error');
    }
    activeIndex = -1;
    renderModal();
    window.uiDialog?.open(modal, { focus: '#global-search-input' });
  }

  function init() {
    modal = document.getElementById('modal-global-search');
    document.getElementById('btn-global-search')?.addEventListener('click', open);
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    });
    window.globalSearch = { open };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
