/* global firebase */

/**
 * TrueBeast Website — Firebase Database Abstraction
 * ==================================================
 * Provides a single API for reading/writing ticket data.
 *
 * MODES:
 *   Firebase mode  — when SITE_CONFIG.firebase.apiKey is configured.
 *                    Tickets are stored in Firestore (cross-device, persistent).
 *   Fallback mode  — when Firebase is NOT yet configured.
 *                    Tickets are stored in browser localStorage (temporary,
 *                    same-device only). Everything still works so you can
 *                    test before finishing Firebase setup.
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
            await firebase.firestore().collection('tickets').doc(ticket.id).set(ticket);
            return ticket;
        }
        // localStorage fallback
        const existing = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
        localStorage.setItem('tb_tickets', JSON.stringify([ticket, ...existing]));
        return ticket;
    },

    async getTicket(id) {
        _ensureApp();
        if (_isConfigured()) {
            const snap = await firebase.firestore().collection('tickets').doc(id).get();
            return snap.exists ? { id: snap.id, ...snap.data() } : null;
        }
        const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
        return tickets.find(t => t.id.toLowerCase() === id.toLowerCase()) || null;
    },

    async getAllTickets() {
        _ensureApp();
        if (_isConfigured()) {
            const snap = await firebase.firestore()
                .collection('tickets')
                .orderBy('createdAt', 'desc')
                .get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
        return tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async updateTicket(id, updates) {
        _ensureApp();
        const payload = { ...updates, updatedAt: new Date().toISOString() };
        if (_isConfigured()) {
            await firebase.firestore().collection('tickets').doc(id).update(payload);
            return this.getTicket(id);
        }
        const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
        const updated = tickets.map(t => t.id === id ? { ...t, ...payload } : t);
        localStorage.setItem('tb_tickets', JSON.stringify(updated));
        return updated.find(t => t.id === id) || null;
    },

    async deleteTicket(id) {
        _ensureApp();
        if (_isConfigured()) {
            await firebase.firestore().collection('tickets').doc(id).delete();
            return;
        }
        const tickets = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
        localStorage.setItem('tb_tickets', JSON.stringify(tickets.filter(t => t.id !== id)));
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
            firebase.auth().onAuthStateChanged(callback);
        } else {
            callback(null);
        }
        return () => {};
    },

};
