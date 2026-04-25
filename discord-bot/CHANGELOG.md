# Beast Bot Changelog

## [2026-04-25] — Fix bot intercepting Mee6 ticket button interactions

- Added early return in the `interactionCreate` catch-all so it only fires for `answer:` and `skip:` prefixed buttons (the question DM system)
- Prevents the bot from responding "Already handled" or "These buttons aren't for you" on unrecognized button clicks (e.g. Mee6's Open Ticket button)

## [2026-03-31] — Full backup system: voice (total+days), rank achievements, message backup expanded

- `saveVoiceBackup` now saves per-day breakdown in addition to total — backup format: `{ userId: { total, days: { "YYYY-MM-DD": mins } } }`
- Voice backup restore on startup now also restores the days map (not just total) and marks those users as loaded
- Added `saveRankAchBackup()` — saves peak rank index + apex count for all users every 60s to `botConfig/rankAchBackup`
- On startup, any user missing from rankAchievements primary load is filled from rankAchBackup
- All three backups (message, voice, rank achievements) run every 60s in the periodic save tick
- Voice data for all members restored manually from 2026-03-28 screenshot + 15h estimate

## [2026-03-31] — Fix voice minutes data wipe; add voice backup

- Root cause: `saveVoiceMinutes` did a full PATCH replace for `total` — if voiceMinutes failed to load at startup (quota 429), `baseTotal=0`, so the 60s tick would save `total=sessionMinutes` and overwrite the real accumulated value in Firestore
- Fixed: `total` field now saved via **Firestore atomic field-transform increment** — saves only the new delta minutes since last save, never touches historical data
- `saveVoiceDaysOnly` replaces the days-field save and is guarded by `voiceMinutesLoaded` — days are only PATCH-replaced if the user's data was successfully loaded at startup
- `savedElapsed` field added to `voiceStartTimes` to track how much of each session has been saved
- Added `saveVoiceBackup()` — saves all voice totals to `botConfig/voiceBackup` every 60s; restored on startup if primary load fails
- Updated `flushBeforeExit` and voice leave handler to use atomic delta increment
- Recovery script `recover-voice-messages.js` — shows current Firestore state, restores from messageBackup, lets owner set manual voice totals

## [2026-03-31] — Fix /me profile card: correct rank, peak rank, and reactions

- `/me` rank badge now reads from the member's actual Discord roles (authoritative) instead of recalculating from XP — eliminates wrong rank when voiceMinutes failed to load on restart
- Peak rank now uses `Math.max(storedPeak, currentRoleRank)` — can never display lower than current; auto-updates and saves if the role rank exceeds stored peak (fixes Bronze I peak when `rankAchievements` failed to load)
- Progress bar clamped to `[0, 1]` — no longer goes negative when role rank > XP-based rank
- Reactions rebuilt with **Firestore atomic field-transform increment** — each reaction session's delta is added to Firestore rather than replacing the full map, so historical reaction data can never be wiped by an empty in-memory state on restart
- Added `reactionLoadedSet` — `emojiTally` / `reactionEmojiDays` PATCH saves are now skipped for users whose data wasn't loaded at startup, preventing emoji history wipes during quota failures
- Reactions are debounced (15s per user) and flushed on error restoration — no data loss on Firestore failures

## [2026-03-31] — Counting survives deploys + /counter-set command

- Counting state now saved on shutdown — guarded by `_loaded` flag so it only saves if the bot successfully loaded from Firestore at startup (prevents zeroed in-memory state from ever wiping real data)
- Added `/counter-set <number>` (owner only) — manually set the current count to any number; also updates the record if the new value is higher
- This makes counting fully resilient: progress survives restarts/deploys, and there's a manual recovery path if anything goes wrong

## [2026-03-30] — Restore counting wall of shame + sort by biggest fail

- Recovered all wall of shame data from screenshot: TrueBeast (4x, highest 166), Ammar (2x, highest 184), Tom (1x at 55), MarsKooty (1x at 52). Record restored to 184.
- Wall of Shame now sorted by highest count ruined at (biggest fail first) instead of number of ruins — in both the counting failure embed and `/counting` command

## [2026-03-30] — Fix: read embed content from events/announcements channels

- `fetchDiscordContext()` now extracts embed title, description, fields, and footer from channel messages — not just `m.content`
- Events channel embeds (movie names, game names, event details) are now visible to the AI and used in responses

## [2026-03-30] — Fix: bot now answers event questions directly instead of redirecting

- `fetchDiscordContext()` now also fetches the 5 most recent **past** Discord scheduled events (in addition to upcoming) so the bot can answer "what was the most recent game night" etc.
- Events channel message fetch limit increased from 5 → 10; content per message 400 → 800 chars
- Announcements channel content limit also raised to 800 chars
- SYSTEM_PROMPT updated: bot is now explicitly told to answer event/game night questions from its live context rather than telling users to check a channel themselves

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
