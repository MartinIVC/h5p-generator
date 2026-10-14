document.addEventListener('DOMContentLoaded', () => {
    const btnMenu = document.getElementById('btn-menu');
    const btnCloseMenu = document.getElementById('btn-close-menu');
    const sideMenu = document.getElementById('side-menu');
    const menuOverlay = document.getElementById('menu-overlay');

    if (!btnMenu || !sideMenu) return;

    function openMenu() {
        sideMenu.classList.add('open');
        if (menuOverlay) menuOverlay.classList.add('active');
        btnMenu.setAttribute('aria-expanded', 'true');
        sideMenu.setAttribute('aria-hidden', 'false');
        if (btnCloseMenu) btnCloseMenu.focus();
    }

    function closeMenu() {
        sideMenu.classList.remove('open');
        if (menuOverlay) menuOverlay.classList.remove('active');
        btnMenu.setAttribute('aria-expanded', 'false');
        sideMenu.setAttribute('aria-hidden', 'true');
        btnMenu.focus();
    }

    btnMenu.addEventListener('click', openMenu);
    if (btnCloseMenu) btnCloseMenu.addEventListener('click', closeMenu);
    if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sideMenu.classList.contains('open')) {
            closeMenu();
        }
    });
});