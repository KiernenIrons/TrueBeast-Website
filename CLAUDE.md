# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Two separate things live here:

1. **Website** — React 18 + TypeScript + Vite + Tailwind CSS v4. Hosted on GitHub Pages (auto-deploys on push to `main`) with Cloudflare in front. Live at `truebeast.io`.
2. **Discord bot** — Node.js single-file bot in `discord-bot/index.js` (plus `pond.js` for the frog game). Runs on Fly.io.

## Commands

### Website
```bash
npm run dev       # local dev server
npm run build     # tsc + vite build
npm run preview   # preview production build
```
Always commit and push after changes — never tell Kiernen to check localhost.

### Discord bot
```bash
cd discord-bot
npm start                        # run locally
~/.fly/bin/flyctl deploy         # deploy to Fly.io (run from discord-bot/)
~/.fly/bin/flyctl logs           # stream live logs
~/.fly/bin/flyctl ssh console    # shell into the running container
```

Env vars are set as Fly.io secrets (`flyctl secrets set KEY=value`). See `discord-bot/.env.example` for the full list.

## Website architecture

- `src/config.ts` — single source of truth: `SITE_CONFIG` holds all giveaways, tools, social links, Firebase config, YouTube API key
- `src/pages/` — all route pages
- `src/components/layout/Navigation.tsx` — 3-column navbar (logo | centered nav | auth controls); glass style `rgba(15, 15, 22, 0.38)` + `blur(24px) saturate(180%)` — do not change
- `src/contexts/AuthContext.tsx` — Firebase Auth context (login/logout)
- `src/lib/firebase.ts` — all Firebase/Firestore logic
- Admin login: `kiernenyt@gmail.com` in Firebase Auth
- SPA routing on GitHub Pages: `public/404.html` encodes path as `?p=`, `index.html` restores it via `history.replaceState`

## Bot architecture

### Single-file structure
`index.js` is one large file (~12k+ lines). All state lives in in-memory Maps at the top. The bot saves to Firestore every 60 seconds and on graceful shutdown (SIGTERM, 30s kill timeout).

### Firestore access
No Firebase SDK — all reads/writes are raw REST API calls (`fetch`). The helpers are `firestoreGet`, `firestoreSet`, and `firestoreSetWithMask`. **Critical:** Firestore security rules only allow two collection names: `botConfig` and `knowledgeBase`. Pond frog docs live at `botConfig/pond_<userId>` (tagged `kind: 'pondFrog'`). Never write to any other collection — writes will silently fail with 403.

When writing partial updates, always include `updateMask.fieldPaths` — a PATCH without it is a full document overwrite and will silently delete all other fields.

### State persistence pattern
Every major data structure follows the same pattern:
1. In-memory Map populated at startup from Firestore
2. A `_loaded` flag guards writes so an empty in-memory state never overwrites real Firestore data
3. Full backup saved to `botConfig/discordBackup` every 60s; also individual Firestore docs for critical data
4. Data restored at startup from both primary docs and backup fallback

### Bump tracking
The bot detects `/bump` by watching for Disboard's bot confirmation message (from bot ID `302050872383242240`). The last bumper's ID and next reminder time are persisted to `botConfig/disboard`.

**Weekly Bump Leaderboard**: bump counts are tracked per ISO week in `bumpCounts` (Map) and persisted to `botConfig/bumpLeaderboard`. Every hour `checkWeeklyBumpReset` runs — if the ISO week has rolled over it posts the leaderboard to the bump channel and reassigns the `BUMP_KING_ROLE_ID` role. `/bump-leaderboard` shows current week standings. The role ID (`1521821341790113862` — "Top Bumper 👑") is hardcoded in `BUMP_KING_ROLE_ID`.

### Feature flags
`botFeatures` object is refreshed from `botConfig/features` every 5 minutes. Check the relevant flag before running optional features (e.g. `if (!botFeatures.bumpReminders) return`).

### Pond game (`pond.js`)
Fully self-contained module — no circular requires with `index.js`. Exports: `pondCommands`, `isPondCommand`, `handlePondInteraction`, `isPondButton`, `handlePondButtonInteraction`, `isPondModal`, `handlePondModalInteraction`, `startPondTicker`. All frog state goes through `normalizeFrog()` to backfill missing fields safely.

### Interaction routing in index.js
`interactionCreate` dispatches in this order: autocomplete → pond commands → slash commands → buttons (pond buttons, then bot-own buttons) → modal submits (pond modals, then bot-own modals) → select menus. Each handler checks `interaction.commandName` / `interaction.customId` prefix.

### UPDATE_NOTES
The `UPDATE_NOTES` constant near the top of `index.js` is what `/bot-updates` shows users. Update it before every deploy to describe what changed.

### CHANGELOG
`discord-bot/CHANGELOG.md` — append a new dated entry for every deploy. Most recent first.

## Key channel/role IDs (hardcoded in index.js)
- `OWNER_DISCORD_ID` — `392450364340830208` (Kiernen)
- Disboard bot ID — `302050872383242240`
- `MOD_ROLE_ID` — `874315329474555944`
- Voice rank roles — `VOICE_RANK_ROLES` array with 11 tiers (Bronze I → Apex Predator)
