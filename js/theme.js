/**
 * TrueBeast — Theme (light / dark mode) + Performance Mode
 * Runs synchronously before any rendering to avoid flash of wrong theme.
 * Checks localStorage first, then system preference. Defaults to dark.
 *
 * Performance mode automatically disables backdrop-filter and heavy animations
 * when sustained FPS drops below 28 (e.g. browser with hardware acceleration off).
 * The result is cached in localStorage so it applies before first paint on return visits.
 */
(function () {
    // ── Theme ──────────────────────────────────────────────────────────────
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

    // ── Performance Mode ───────────────────────────────────────────────────
    // Apply cached result immediately so there's no flash on return visits.
    var cachedPerf = localStorage.getItem('tb-perf');
    if (cachedPerf === 'slow') document.documentElement.classList.add('perf-mode');

    // Also respect the OS "reduce motion" preference as an explicit opt-in.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.documentElement.classList.add('perf-mode');
    }

    // After the page has fully settled, measure real FPS over 2 seconds.
    // Slow = < 28 fps sustained → enable perf-mode and cache result.
    // Fast = ≥ 55 fps sustained → disable perf-mode and cache result.
    window.addEventListener('load', function () {
        // Wait 3 s for Babel/React/fonts to finish their initial burst before measuring.
        setTimeout(function () {
            var t0 = null, frames = 0;
            function tick(ts) {
                if (t0 === null) t0 = ts;
                frames++;
                if (ts - t0 < 2000) {
                    requestAnimationFrame(tick);
                } else {
                    var fps = frames / ((ts - t0) / 1000);
                    if (fps < 28) {
                        document.documentElement.classList.add('perf-mode');
                        localStorage.setItem('tb-perf', 'slow');
                    } else if (fps >= 55) {
                        document.documentElement.classList.remove('perf-mode');
                        localStorage.setItem('tb-perf', 'fast');
                    }
                    // Between 28–55 fps: keep whatever was set from localStorage, don't overwrite.
                }
            }
            requestAnimationFrame(tick);
        }, 3000);
    });

    // Expose manual override so users can toggle perf mode if needed.
    window.TBPerf = {
        enable:  function () { document.documentElement.classList.add('perf-mode');    localStorage.setItem('tb-perf', 'slow'); },
        disable: function () { document.documentElement.classList.remove('perf-mode'); localStorage.setItem('tb-perf', 'fast'); },
        isActive: function () { return document.documentElement.classList.contains('perf-mode'); },
    };
})();
