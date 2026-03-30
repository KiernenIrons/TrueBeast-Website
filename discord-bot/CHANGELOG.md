# Beast Bot Changelog

## [2026-03-30] — AI channel + per-user context + memory persistence

- Added `AI_CHANNEL_ID = '1482956343131246673'` — bot now responds in the dedicated AI channel in addition to support channels
- Added `buildUserContext()` — injects each user's display name, rank, XP, voice time, and join date into the AI prompt for personalised responses
- Added `fetchChannelContext()` — reads the last 10 non-bot messages in the AI channel so the bot understands the ongoing conversation
- Updated `askClaude()` signature to accept `userContext` and `channelCtx` params, both injected as context sections
- Added TrueBeast `remember: X` / `note: X` shortcut — owner can type this anywhere to save a fact directly to the Firestore knowledge base (bot reacts 🧠)
- Added `scheduleAiHistorySave()` — debounced 60s Firestore write after each conversation exchange; history survives restarts
- Added AI history load in `clientReady` — restores conversation history for all users from `botConfig/aiHistory`
- Updated `SYSTEM_PROMPT` with instructions on how to use the new user context and channel context sections
- Updated `UPDATE_NOTES` to reflect all AI changes

## [2026-03-30] — Force re-registration of slash commands

- Redeployed to re-register all slash commands after they became unavailable

## [2026-03-28] — Fix reaction tracking; add Partials.Reaction

- `Partials.Reaction` was missing from the Discord client config — reaction events were silently dropped on any message not already cached (the vast majority), so reactions never tracked or persisted through restarts
- Added `Partials.Reaction` to fix all reaction tracking across all periods (today/week/month/all time)

## [2026-03-28] — Exclude private voice channel from XP

- Channel `1017862214083952671` added to `NO_XP_VC_IDS` — time spent there does not earn voice XP or contribute to rank
- Exclusion applies both to live session starts and to the startup session resume

## [2026-03-28] — Automate update announcement

- `UPDATE_NOTES` constant added near top of `index.js` — edit this array before each deploy and the startup announcement reflects it automatically
- Replaces the old hardcoded announcement fields

## [2026-03-27] — Fix monthly rank reset + XP accuracy

- `assignVoiceRank` gains `forceReset` param; monthly reset (`checkMonthlyReset`) now passes `true` so it can wipe all rank roles to Bronze I as intended — the no-demote guard was blocking the intentional monthly wipe
- `monthlyActivityScore` now calls `creditVoiceTime` first so live voice sessions are reflected immediately in XP/rank, not just after the 60s save tick

## [2026-03-27] — Never demote voice ranks on restart

- `assignVoiceRank` now checks the member's current highest rank before acting — if the XP-based target is lower or equal, returns early
- Only removes lower-tier badges when upgrading (never strips higher ones)
- Prevents unexpected rank drops on bot restart caused by slightly stale Firestore data

## [2026-03-27] — Full logging system + mod commands + /say + /dm + counting fix

- Added comprehensive audit log embeds to `#logs` channel: member join/leave/ban/unban/kick, message edit/delete, mute/unmute, nickname/role changes, VC join/leave, invite detection, avatar updates, role/channel/emoji/server events
- Added mod commands: `/ban` `/tempban` `/kick` `/mute` `/tempmute` `/unmute` `/unban` `/warn` `/infractions` `/clear-all-infractions` `/clear` `/slowmode`
- Added info commands: `/user-info` `/role-info` `/server-info`
- Added `/say` (owner only) — send a message as the bot to any channel
- Added `/dm` (mod only) — send an anonymous DM as the bot, logged in #logs
- Counting game: if the current count number is deleted, bot steps count back and notifies channel
- Infraction system persisted in Firestore (`infractions/{userId}`)
- Update announcement posted to channel `1485384313062162522` on every deploy

## [2026-03-26] — Fix /scanreactions hanging

- Replaced Discord.js `channel.messages.fetch()` and `rxn.users.fetch()` with direct REST API calls using `AbortController` hard timeouts
- `Promise.race` was leaving Discord.js's internal HTTP queue blocked; `AbortController` actually cancels the TCP connection
