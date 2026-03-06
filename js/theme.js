/**
 * TrueBeast — Theme (light / dark mode)
 * Runs synchronously before any rendering to avoid flash of wrong theme.
 * Checks localStorage first, then system preference. Defaults to dark.
 */
(function () {
    var stored = localStorage.getItem('tb-theme');
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    var isLight = stored === 'light' || (!stored && prefersLight);
    if (isLight) document.documentElement.classList.add('light');

    window.TBTheme = {
        toggle: function () {
            var nowLight = document.documentElement.classList.toggle('light');
            localStorage.setItem('tb-theme', nowLight ? 'light' : 'dark');
            window.dispatchEvent(new CustomEvent('tb-theme-change', { detail: { light: nowLight } }));
        },
        isLight: function () {
            return document.documentElement.classList.contains('light');
        },
    };
})();
