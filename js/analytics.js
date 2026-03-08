/**
 * TrueBeast Analytics
 * ===================
 * Drop-in analytics tracker. Include on any page — auto-tracks page views,
 * time on page, and link/button clicks. Writes to Firebase Firestore.
 *
 * Usage on a page:
 *   <script src="/js/analytics.js"></script>
 *
 * Fire a custom event anywhere:
 *   window.TBAnalytics.track('link_gen', { tool: 'rotator', count: 3 });
 *
 * Track a button/link automatically by adding a data attribute:
 *   <a data-track="discord_link" href="...">Join Discord</a>
 *
 * ── Firestore rules to add ────────────────────────────────────────────────
 * In your Firebase console → Firestore → Rules, add inside the root match:
 *
 *   match /analytics/{eventId} {
 *     allow create: if true;                          // public write (events in)
 *     allow list, get: if request.auth != null;       // admin read only
 *   }
 *
 * ──────────────────────────────────────────────────────────────────────────
 */
(function () {
    'use strict';

    /* ── Skip admin pages ── */
    if (window.location.pathname.indexOf('/admin') === 0) return;

    var FIREBASE_VER = '10.12.2';
    var SESSION_KEY  = 'tb_sid';
    var PAGE_START   = Date.now();
    var _db          = null;
    var _queue       = [];
    var _booted      = false;

    /* ── Stable session ID (resets on new tab/browser session) ── */
    function getSid() {
        var s = sessionStorage.getItem(SESSION_KEY);
        if (!s) {
            s = Math.random().toString(36).slice(2) + Date.now().toString(36);
            sessionStorage.setItem(SESSION_KEY, s);
        }
        return s;
    }
    var SID = getSid();

    /* ── Write one event to Firestore ── */
    function writeEvent(db, evt) {
        db.collection('analytics').add(evt).catch(function (err) {
            if (err && err.code === 'permission-denied') {
                console.warn('[TBAnalytics] Firestore permission denied — add the analytics collection rule to Firebase Console → Firestore → Rules. See js/config.js comments for the rule to paste.');
            }
        });
    }

    /* ── Public tracking function ── */
    function track(type, data) {
        var evt = Object.assign({
            type:      type,
            page:      window.location.pathname,
            referrer:  document.referrer || null,
            sessionId: SID,
            ts:        new Date().toISOString(),
            ua:        navigator.userAgent.slice(0, 120),
        }, data || {});

        if (_db) {
            writeEvent(_db, evt);
        } else {
            _queue.push(evt);
        }
    }

    /* ── Init Firebase + flush queue ── */
    function initFirebase(cfg) {
        if (!window.firebase || !firebase.firestore) return;
        try {
            var app = (firebase.apps && firebase.apps.length)
                ? firebase.app()
                : firebase.initializeApp(cfg);
            _db = firebase.firestore(app);
            _queue.splice(0).forEach(function (e) { writeEvent(_db, e); });
        } catch (e) { /* silent */ }
    }

    /* ── Dynamically load a script ── */
    function loadScript(src, cb) {
        var s = document.createElement('script');
        s.src     = src;
        s.onload  = cb || function () {};
        s.onerror = function () {};
        document.head.appendChild(s);
    }

    /* ── Boot: load Firebase SDK if needed, then init ── */
    function boot() {
        if (_booted) return;
        _booted = true;

        var cfg = (typeof SITE_CONFIG !== 'undefined') ? SITE_CONFIG.firebase : null;
        if (!cfg || !cfg.apiKey) return;

        var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VER + '/';

        if (window.firebase && firebase.firestore) {
            /* Firebase already fully loaded (e.g. tech-support page) */
            initFirebase(cfg);
        } else if (window.firebase) {
            /* App loaded but Firestore not yet */
            loadScript(base + 'firebase-firestore-compat.js', function () { initFirebase(cfg); });
        } else {
            /* Load both */
            loadScript(base + 'firebase-app-compat.js', function () {
                loadScript(base + 'firebase-firestore-compat.js', function () { initFirebase(cfg); });
            });
        }
    }

    /* ── Auto: page view on load ── */
    document.addEventListener('DOMContentLoaded', function () {
        track('page_view', { title: document.title });
        boot();
    });

    /* ── Auto: time on page ── */
    window.addEventListener('beforeunload', function () {
        var seconds = Math.round((Date.now() - PAGE_START) / 1000);
        if (seconds > 2) track('time_on_page', { seconds: seconds });
    });

    /* ── Auto: click tracking via [data-track] attribute ── */
    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
        if (!el) return;
        track('click', {
            label: el.getAttribute('data-track'),
            text:  (el.textContent || '').trim().slice(0, 80),
        });
    }, true);

    /* ── Expose global API ── */
    window.TBAnalytics = {
        track:  track,
        getSid: function () { return SID; },
    };
})();
