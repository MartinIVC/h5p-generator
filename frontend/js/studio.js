/** Persistent desktop navigation; the compact menu remains available on small windows. */
(function () {
  'use strict';

  const sidebar = document.querySelector('.workspace-sidebar');
  const themeButton = document.getElementById('btn-quick-theme');
  const main = document.getElementById('main-content');

  function updateNavigation() {
    const isTrash = !document.getElementById('panel-trash').classList.contains('hidden');
    const selected = isTrash ? 'trash' : 'home';
    sidebar.querySelectorAll('.studio-nav-item').forEach(button => {
      const active = button.dataset.studioAction === selected;
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
  new MutationObserver(updateNavigation).observe(document.getElementById('panel-trash'), { attributes: true, attributeFilter: ['class'] });
})();
