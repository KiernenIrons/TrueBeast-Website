# TrueBeast Website — Handover

You are continuing work on the TrueBeast website for Kiernen Irons (YouTube/gaming content creator). Here is the full context:

**Repo:** `https://github.com/KiernenIrons/TrueBeast-Website.git` — branch `main`
**Live site:** `https://truebeast.io`
**Stack:** React 18 + TypeScript + Vite + Tailwind CSS v4
**Hosting:** GitHub Pages (auto-deploys via `.github/workflows/static.yml` on every push to main) with Cloudflare in front for caching control
**Discord bot:** `discord-bot/index.js` — runs on Fly.io (`~/.fly/bin/flyctl deploy` from `discord-bot/` dir)

**Key rules:**
- Always commit and push after every change — never tell Kiernen to check localhost
- User is `kiernenyt@gmail.com` in Firebase Auth (admin login on the site)

**Architecture:**
- `src/pages/` — all pages
- `src/components/layout/Navigation.tsx` — navbar with admin login (Firebase Auth), 3-column grid layout (logo | centered nav | auth controls)
- `src/contexts/AuthContext.tsx` — Firebase auth context (login/logout)
- `src/lib/firebase.ts` — all Firebase/Firestore logic (`FirebaseDB.adminSignIn`, `FirebaseDB.adminSignOut`, `FirebaseDB.onAuthStateChanged`)
- `src/config.ts` — `SITE_CONFIG` (all giveaways, tools, social links, Firebase config, YouTube API key)
- `src/pages/Admin.tsx` — placeholder, needs building
- `discord-bot/index.js` — Discord bot (temp VCs, Disboard/Discadia bump reminders, Beast Bot AI chat with per-user conversation history)

**Recently completed:**
- Full UI overhaul (React/Vite/Tailwind, replaced old HTML site)
- Navigation: 3-column layout, centered nav items, admin login modal on the right (Firebase Auth)
- Tools page: Ripple → Socials Rotator → QR Generator → MultiChat → ButtonBoard → Resume Builder (last 3 are beta). Section label is "Recommended by Kiernen"
- Giveaways page: card grid matching old layout, sorted upcoming→open→ended, filter tabs, `entryUrl` field in config for live giveaways
- Ripple tool: write-once post to Discord/Telegram/Bluesky, side-by-side preview layout, Send button under preview
- Caching fix: Cloudflare (free) sits in front of GitHub Pages with a Cache Rule bypassing HTML caching — Ctrl+Shift+R now works
- SPA routing: `public/404.html` redirect trick for GitHub Pages direct URL navigation
- `vercel.json` exists in repo but is not being used (Vercel was considered but Cloudflare+GitHub Pages was chosen instead)

**Pending / to do:**
- Admin page (`/admin`) — needs to be built out (ticket management, announcements, analytics, etc.)
- Resume Builder — marked beta, placeholder page only, needs to be built
- Socials Rotator — Kiernen had notes/bug fixes in mind (not discussed yet)
- Gleam giveaway auto-poster for the Discord bot (plan exists but not implemented)

**SPA routing note:** GitHub Pages serves a 404 for direct URL navigation (e.g. `/giveaways`). `public/404.html` encodes the path as `?p=` and `index.html` restores it via `window.history.replaceState`. This is working correctly.

**Nav glass style:** `background: rgba(15, 15, 22, 0.38)` with `backdropFilter: blur(24px) saturate(180%)` — Kiernen approved this exact value, do not change it.

**Bot commands:** `!!help`, `!!ping`, `!!ask` (AI), `!!afk`, `!!afkcheck`, `!!unafk` — owner-only: `!!say`, `!!dm`, `!!servers`, `!!restart`
