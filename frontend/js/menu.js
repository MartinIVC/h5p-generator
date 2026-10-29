document.addEventListener('DOMContentLoaded', () => {
    const btnMenu = document.getElementById('btn-menu');
    const btnCloseMenu = document.getElementById('btn-close-menu');
    const sideMenu = document.getElementById('side-menu');
    const menuOverlay = document.getElementById('menu-overlay');
    let menuOpener = null;

    if (!btnMenu || !sideMenu) return;

    function openMenu() {
        menuOpener = document.activeElement;
        sideMenu.classList.add('open');
        sideMenu.removeAttribute('inert');
        if (menuOverlay) menuOverlay.classList.add('active');
        btnMenu.setAttribute('aria-expanded', 'true');
        sideMenu.setAttribute('aria-hidden', 'false');
        if (btnCloseMenu) btnCloseMenu.focus();
    }

    function closeMenu() {
        sideMenu.classList.remove('open');
        sideMenu.setAttribute('inert', '');
        if (menuOverlay) menuOverlay.classList.remove('active');
        btnMenu.setAttribute('aria-expanded', 'false');
        sideMenu.setAttribute('aria-hidden', 'true');
        if (menuOpener && menuOpener.isConnected) menuOpener.focus();
        menuOpener = null;
    }

    btnMenu.addEventListener('click', openMenu);
    if (btnCloseMenu) btnCloseMenu.addEventListener('click', closeMenu);
    if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && sideMenu.classList.contains('open') && window.uiDialog) {
            const focusable = window.uiDialog.focusableElements(sideMenu);
            if (!focusable.length) {
                event.preventDefault();
                btnCloseMenu?.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !sideMenu.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !sideMenu.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        }
        if (event.key === 'Escape' && sideMenu.classList.contains('open')) {
            closeMenu();
        }
    });
});
