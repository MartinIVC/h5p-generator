/** Persistent desktop navigation; the compact menu remains available on small windows. */
(function () {
  'use strict';

  const sidebar = document.querySelector('.workspace-sidebar');
  const themeButton = document.getElementById('btn-quick-theme');
  const main = document.getElementById('main-content');

  function updateNavigation() {
    const panelTrash = document.getElementById('panel-trash');
    const panelHome = document.getElementById('panel-home');
    const isTrash = Boolean(panelTrash && !panelTrash.classList.contains('hidden'));
    const isHome = Boolean(panelHome && !panelHome.classList.contains('hidden'));
    const selected = isTrash ? 'trash' : (isHome ? 'home' : null);
    sidebar.querySelectorAll('.studio-nav-item').forEach(button => {
      const active = selected !== null && button.dataset.studioAction === selected;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  document.querySelectorAll('[data-studio-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.studioAction;
      if (action === 'settings') return window.configManager?.openSettingsModal();
      if (action === 'trash') await window.coursesManager?.navigateToTrash();
      else if (action === 'guide') {
        await window.coursesManager?.openOnboarding();
        document.getElementById('onboarding-title')?.scrollIntoView({ block: 'center' });
      } else {
        await window.coursesManager?.navigateToHome();
        if (action === 'drafts') {
          const drafts = document.getElementById('saved-drafts-title');
          if (drafts) drafts.scrollIntoView({ block: 'start' });
          else window.uiMessage?.('Todavía no hay borradores. Se guardan automáticamente al preparar una actividad.', 'info');
        } else main.scrollTo({ top: 0 });
      }
      updateNavigation();
    });
  });

  function updateThemeButton() {
    const dark = document.documentElement.classList.contains('dark');
    themeButton.setAttribute('aria-label', `Cambiar a tema ${dark ? 'claro' : 'oscuro'}`);
    themeButton.setAttribute('title', `Cambiar a tema ${dark ? 'claro' : 'oscuro'}`);
    themeButton.setAttribute('aria-pressed', String(dark));
  }
  themeButton.addEventListener('click', () => {
    window.configManager?.setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  });
  new MutationObserver(updateThemeButton).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  updateThemeButton();

  document.addEventListener('h5p:library-rendered', event => {
    document.getElementById('sidebar-course-count').textContent = event.detail.courses;
    document.getElementById('sidebar-draft-count').textContent = event.detail.drafts;
    updateNavigation();
  });
  const navObserver = new MutationObserver(updateNavigation);
  const trashEl = document.getElementById('panel-trash');
  const homeEl = document.getElementById('panel-home');
  if (trashEl) navObserver.observe(trashEl, { attributes: true, attributeFilter: ['class'] });
  if (homeEl) navObserver.observe(homeEl, { attributes: true, attributeFilter: ['class'] });
  updateNavigation();
})();
