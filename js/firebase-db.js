/* global firebase */

/**
 * TrueBeast Website — Firebase Database Abstraction
 * ==================================================
 * Provides a single API for reading/writing ticket data.
 *
 * MODES:
 *   Firebase mode  — when SITE_CONFIG.firebase.apiKey is configured.
 *                    Tickets are stored in Firestore (cross-device, persistent).
 *   Fallback mode  — when Firebase is NOT yet configured, or Firestore is
 *                    unreachable (e.g. database not created yet, rules blocking,
 *                    or network issue). Tickets are stored in localStorage so
 *                    the form always completes successfully.
 *
 * Requires the Firebase compat SDK script tags to be loaded before this file:
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
 */

let _appInitialized = false;

function _isConfigured() {
    return (
        typeof SITE_CONFIG !== 'undefined' &&
        SITE_CONFIG.firebase &&
        SITE_CONFIG.firebase.apiKey &&
        SITE_CONFIG.firebase.apiKey !== 'PASTE_YOUR_FIREBASE_API_KEY' &&
        typeof firebase !== 'undefined'
    );
}

function _ensureApp() {
    if (_appInitialized) return;
    if (!_isConfigured()) return;
    try {
        firebase.app(); // already initialized (e.g. multiple calls)
    } catch {
        firebase.initializeApp(SITE_CONFIG.firebase);
    }
    _appInitialized = true;
}

/**
 * Wraps a Firestore promise with a timeout so it always resolves/rejects
 * within the given ms instead of hanging indefinitely.
 */
function _withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore timeout — check that your database is created and Security Rules are published')), ms)
    );
    return Promise.race([promise, timeout]);
}

// ---------------------------------------------------------------------------
// localStorage helpers (always available as fallback)
// ---------------------------------------------------------------------------

function _lsSave(ticket) {
    const existing = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
    localStorage.setItem('tb_tickets', JSON.stringify([ticket, ...existing]));
    return ticket;
}

function _lsGet(id) {
    const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
    return tickets.find(t => t.id.toLowerCase() === id.toLowerCase()) || null;
}

function _lsGetAll() {
    const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
    return tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function _lsUpdate(id, payload) {
    const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
    const updated = tickets.map(t => t.id === id ? { ...t, ...payload } : t);
    localStorage.setItem('tb_tickets', JSON.stringify(updated));
    return updated.find(t => t.id === id) || null;
}

function _lsDelete(id) {
    const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
    localStorage.setItem('tb_tickets', JSON.stringify(tickets.filter(t => t.id !== id)));
}

// Review localStorage fallbacks
function _lsSaveReview(review) {
    const existing = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
    localStorage.setItem('tb_reviews', JSON.stringify([review, ...existing]));
    return review;
}

function _lsGetAllReviews() {
    const reviews = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
    return reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function _lsUpdateReview(id, payload) {
    const reviews = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
    const updated = reviews.map(r => r.id === id ? { ...r, ...payload } : r);
    localStorage.setItem('tb_reviews', JSON.stringify(updated));
    return updated.find(r => r.id === id) || null;
}

function _lsDeleteReview(id) {
    const reviews = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
    localStorage.setItem('tb_reviews', JSON.stringify(reviews.filter(r => r.id !== id)));
}

// ---------------------------------------------------------------------------
// Public API — FirebaseDB
// ---------------------------------------------------------------------------

const FirebaseDB = {

    /**
     * Returns true if Firebase is configured and the SDK is loaded.
     */
    isConfigured() {
        return _isConfigured();
    },

    // -----------------------------------------------------------------------
    // Tickets
    // -----------------------------------------------------------------------

    async saveTicket(ticket) {
        _ensureApp();
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('tickets').doc(ticket.id).set(ticket),
                    8000
                );
                return ticket;
            } catch (err) {
                console.warn('FirebaseDB.saveTicket fell back to localStorage:', err.message);
            }
        }
        return _lsSave(ticket);
    },

    async getTicket(id) {
        _ensureApp();
        if (_isConfigured()) {
            try {
                const snap = await _withTimeout(
                    firebase.firestore().collection('tickets').doc(id).get(),
                    8000
                );
                return snap.exists ? { id: snap.id, ...snap.data() } : null;
            } catch (err) {
                console.warn('FirebaseDB.getTicket fell back to localStorage:', err.message);
            }
        }
        return _lsGet(id);
    },

    async getAllTickets() {
        _ensureApp();
        if (_isConfigured()) {
            try {
                const snap = await _withTimeout(
                    firebase.firestore().collection('tickets').orderBy('createdAt', 'desc').get(),
                    8000
                );
                return snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (err) {
                console.warn('FirebaseDB.getAllTickets fell back to localStorage:', err.message);
            }
        }
        return _lsGetAll();
    },

    async updateTicket(id, updates) {
        _ensureApp();
        const payload = { ...updates, updatedAt: new Date().toISOString() };
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('tickets').doc(id).update(payload),
                    8000
                );
                return this.getTicket(id);
            } catch (err) {
                console.warn('FirebaseDB.updateTicket fell back to localStorage:', err.message);
            }
        }
        return _lsUpdate(id, payload);
    },

    async deleteTicket(id) {
        _ensureApp();
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('tickets').doc(id).delete(),
                    8000
                );
                return;
            } catch (err) {
                console.warn('FirebaseDB.deleteTicket fell back to localStorage:', err.message);
            }
        }
        _lsDelete(id);
    },

    // -----------------------------------------------------------------------
    // Reviews
    // -----------------------------------------------------------------------

    async saveReview(review) {
        _ensureApp();
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('reviews').doc(review.id).set(review),
                    8000
                );
                return review;
            } catch (err) {
                console.warn('FirebaseDB.saveReview fell back to localStorage:', err.message);
            }
        }
        return _lsSaveReview(review);
    },

    async getAllReviews() {
        _ensureApp();
        if (_isConfigured()) {
            try {
                const snap = await _withTimeout(
                    firebase.firestore().collection('reviews').orderBy('createdAt', 'desc').get(),
                    8000
                );
                return snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (err) {
                console.warn('FirebaseDB.getAllReviews fell back to localStorage:', err.message);
            }
        }
        return _lsGetAllReviews();
    },

    async updateReview(id, updates) {
        _ensureApp();
        const payload = { ...updates, updatedAt: new Date().toISOString() };
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('reviews').doc(id).update(payload),
                    8000
                );
                const snap = await firebase.firestore().collection('reviews').doc(id).get();
                return snap.exists ? { id: snap.id, ...snap.data() } : null;
            } catch (err) {
                console.warn('FirebaseDB.updateReview fell back to localStorage:', err.message);
            }
        }
        return _lsUpdateReview(id, payload);
    },

    async deleteReview(id) {
        _ensureApp();
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('reviews').doc(id).delete(),
                    8000
                );
                return;
            } catch (err) {
                console.warn('FirebaseDB.deleteReview fell back to localStorage:', err.message);
            }
        }
        _lsDeleteReview(id);
    },

    // -----------------------------------------------------------------------
    // Announcements
    // -----------------------------------------------------------------------

    async saveAnnouncement(announcement) {
        _ensureApp();
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('announcements').doc(announcement.id).set(announcement),
                    8000
                );
                return announcement;
            } catch (err) {
                console.warn('FirebaseDB.saveAnnouncement fell back to localStorage:', err.message);
            }
        }
        const existing = JSON.parse(localStorage.getItem('tb_announcements') || '[]');
        localStorage.setItem('tb_announcements', JSON.stringify([announcement, ...existing]));
        return announcement;
    },

    async getAllAnnouncements() {
        _ensureApp();
        if (_isConfigured()) {
            try {
                const snap = await _withTimeout(
                    firebase.firestore().collection('announcements').orderBy('createdAt', 'desc').get(),
                    8000
                );
                return snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (err) {
                console.warn('FirebaseDB.getAllAnnouncements fell back to localStorage:', err.message);
            }
        }
        const items = JSON.parse(localStorage.getItem('tb_announcements') || '[]');
        return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async deleteAnnouncement(id) {
        _ensureApp();
        if (_isConfigured()) {
            try {
                await _withTimeout(
                    firebase.firestore().collection('announcements').doc(id).delete(),
                    8000
                );
                return;
            } catch (err) {
                console.warn('FirebaseDB.deleteAnnouncement fell back to localStorage:', err.message);
            }
        }
        const items = JSON.parse(localStorage.getItem('tb_announcements') || '[]');
        localStorage.setItem('tb_announcements', JSON.stringify(items.filter(a => a.id !== id)));
    },

    // -----------------------------------------------------------------------
    // Admin Authentication
    // -----------------------------------------------------------------------

    async adminSignIn(email, password) {
        _ensureApp();
        if (!_isConfigured()) {
            throw new Error('Firebase is not configured yet. See js/config.js for setup instructions.');
        }
        return firebase.auth().signInWithEmailAndPassword(email, password);
    },

    async adminSignOut() {
        _ensureApp();
        if (_isConfigured()) await firebase.auth().signOut();
    },

    onAuthStateChanged(callback) {
        _ensureApp();
        if (_isConfigured()) {
            // If Firebase Authentication service isn't enabled in the console,
            // onAuthStateChanged may never fire. After 6 s assume "not signed in"
            // so the page doesn't stay stuck on a blank/spinner screen.
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    console.warn('FirebaseDB: auth state timed out — is Firebase Authentication enabled in your Firebase console?');
                    callback(null);
                }
            }, 6000);
            try {
                firebase.auth().onAuthStateChanged(u => {
                    if (!settled) { settled = true; clearTimeout(timer); }
                    callback(u);
                });
            } catch (err) {
                // firebase.auth() threw synchronously — Auth service likely not enabled
                console.warn('FirebaseDB: firebase.auth() error:', err.message,
                    '\n→ Go to Firebase Console → Build → Authentication → Get started → enable Email/Password');
                if (!settled) { settled = true; clearTimeout(timer); callback(null); }
            }
        } else {
            callback(null);
        }
        return () => {};
    },

};
