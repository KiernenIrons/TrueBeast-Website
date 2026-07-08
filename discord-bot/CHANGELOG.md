# Beast Bot Changelog

## [2026-07-08] — Announcements v2: custom form buttons with modal submission

- Added `handleAnnFormButton` — reads form config from `botConfig/annform_<id>`, builds a Discord modal with up to 5 configurable fields (short or paragraph), and shows it to the user
- Added `handleAnnFormModalSubmit` — collects field responses, posts a formatted embed to the configured destination channel, and replies ephemerally with a custom confirmation message
- One-time submission support: if `config.oneTime` is set, checks `botConfig/annformsub_<formId>_<userId>` before showing the modal and writes it after submit
- Both handlers wired into `interactionCreate` after the Pond block, dispatching on `annform_` (button) and `annform_modal:` (modal submit) prefixes
- Form configs are saved by the website admin panel to `botConfig/annform_<id>` as a `configJson` string field, compatible with the existing flat-field Firestore REST parser

## [2026-07-08] — Quarantine: delete triggering messages on quarantine

- `track.msgs` now stores `{ts, id, channelId}` instead of raw timestamps so messages can be bulk-deleted
- Spam flood trigger (15+ msgs/60s): bulk-deletes all tracked messages in the window across channels
- Mass-mention trigger (6+ unique mentions/2min): bulk-deletes all tracked messages in the window
- DM-solicit trigger: deletes the single triggering message
- `bulkDelete(ids, true)` used with filterOld=true to safely skip messages older than 14 days

## [2026-07-08] — Fix: unscramble leaderboard All-Time button not working

- `buildUnscrambleLbPayload` was defined inside the `isChatInputCommand()` block, making it inaccessible when a button interaction fired
- Moved to module level (after `endDuel`) so both the slash command handler and `usclb:` button handler can call it

## [2026-07-08] — Unscramble leaderboard: button navigation

- `/unscramble-leaderboard` now shows a single embed with `📅 This Week` / `🏆 All-Time` / `✕ Close` buttons instead of posting two embeds at once
- Added `buildUnscrambleLbPayload(view)` helper (function-hoisted inside `interactionCreate`) that builds the embed + button row for a given view
- Added `unscrambleLbOwners` Map (same pattern as `leaderboardOwners`) to restrict button use to the invoker
- Added `usclb:` button handler: switches view via `editReply`, deletes message on close, blocks non-owners

## [2026-07-08] — Unscramble: expert mode, weekly leaderboard, word list expansion, backup improvements

- `UNSCRAMBLE_WORDS` expanded from ~780 to 1,400+ curated 4–6 letter words
- New `UNSCRAMBLE_EXPERT_WORDS` array: 300+ words at 7–10 letters
- `postUnscramblePuzzle` now posts both a regular and expert word in one embed; each scored independently
- `handleUnscrambleMessage` checks both words, awards to separate all-time + weekly maps, fires `checkUnscrambleBothSolved`
- Added `unscrambleExpertScores`, `unscrambleWeeklyScores`, `unscrambleExpertWeeklyScores`, `_unscrambleWeekKey`, `unscramblerOfWeekId`, `UNSCRAMBLER_ROLE_ID`
- `checkUnscrambleWeeklyReset(guild)`: posts weekly results, reassigns Unscrambler of the Week role (1524483752984842573), clears weekly maps
- `saveUnscrambleExpertScores` + `saveUnscrambleWeekly`: persist to Firestore
- Startup restores expert scores, weekly scores, and runs `checkUnscrambleWeeklyReset`; hourly interval added
- `buildFullBackup` + `applyBackupToMemory` now include `bumpData`, `unscrambleExpertScores`, and `unscrambleWeekly`
- `/unscramble-leaderboard` redesigned: two embeds (weekly + all-time) with inline fields for regular and expert

## [2026-07-08] — Duel: fix race condition + ping

- Challenge reply now includes `content: <@opponentId>` so the opponent is actually notified
- Fixed race condition in `handleDuelMessage`: word is now claimed synchronously (before any `await`) so two simultaneous correct answers can't both be counted — only the first one through wins the round
- This also fixes the double `duelPostNextWord` call that caused a round to be skipped, and the dual win condition where both players could reach the target at the same time

## [2026-07-08] — Add 1v1 Unscramble Duel mode

- New `/unscramble-duel @user [words]` command — challenge anyone to a head-to-head unscramble match (2–15 words, default 5)
- Accept/decline embed with buttons posted in #unscramble; challenge auto-expires after 2 minutes
- Duel runs in a private thread (only the two players); bot posts words one at a time, first correct guess wins the round
- Results embed posted to #unscramble when the game ends; private thread is then deleted
- 5-minute per-word timeout — if neither player guesses in time, no point is awarded and the next word posts
- Round counter increments correctly on both solves and timeouts (was previously broken on timeout)
- Active duels persisted to `botConfig/unscrambleDuels` in Firestore; on restart, bot reconnects to the thread, re-announces the current word, and resumes the game

## [2026-07-08] — Quarantine: raise mass-mention threshold from 4 to 6

- Increased unique-mention trigger from `>= 4` to `>= 6` within a 2-minute window
- Reduces false positives for users naturally pinging several people in conversation

## [2026-07-08] — Quarantine: fix race condition causing duplicate alerts and role loss

- Moved `quarantinedUsers.set()` and role collection to before the first `await` in `quarantineUser`
- Prevents concurrent invocations (rapid messages hitting 15, 16, 17 in one tick) from all passing the guard and overwriting the saved role list with an empty one
- Root cause of "roles not restored on unquarantine" — third concurrent run saw roles already stripped, saved [], then overwrote the correct entry

## [2026-07-08] — Quarantine: add unquarantine button to responded notification

- When a quarantined user sends a message, the "responded" alert in mod channel now includes an Unquarantine & Restore Roles button
- Mods no longer need to scroll back to the original quarantine alert to unquarantine

## [2026-07-08] — Quarantine: role strip, voice kick, unquarantine button, spam tuning

- When a user is quarantined (auto or manual), all non-managed roles are stripped and saved to state
- Quarantined users are immediately disconnected from voice chat
- Mod channel notification now includes the list of stripped roles and an "Unquarantine & Restore Roles" button
- Clicking the button removes the quarantine role, re-adds all saved roles, disables the button, and logs to audit
- Manual role removal (mod removes quarantine role directly in Discord) also triggers role restoration via `guildMemberUpdate`
- Spam flood threshold raised from 8 → 15 messages per 60s
- Spam rate filter skipped entirely for #unscramble, #counting, and #the-pond

## [2026-07-03] — Widget: combine stats into single fields per platform

- Merged youtube_subs + youtube_views into one `youtube_stats` field ("120K subscribers • 52.4M views")
- Merged tiktok_followers + tiktok_likes into one `tiktok_stats` field ("45K followers • 1.2M likes")
- `instagram_stats` stays as a single followers string
- `discord_members` unchanged
- Fewer fields needed in the widget editor (3 instead of 6)

## [2026-07-03] — Widget: add YouTube views, TikTok and Instagram scrapers

- Added `youtube_views` field — extracted from same YouTube API call (viewCount), always reliable
- Added `fetchTikTokStats()` — scrapes `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON from TikTok profile page; returns follower + heart count or null on failure
- Added `fetchInstagramStats()` — hits Instagram's undocumented `web_profile_info` endpoint with app headers; returns follower count or null on failure
- `pushDiscordWidget()` runs scrapers in parallel via `Promise.all`; skips TikTok/Instagram fields silently if scraping fails so YouTube and Discord always update
- New dynamic fields: `youtube_views`, `tiktok_followers`, `tiktok_likes`, `instagram_followers`

## [2026-07-03] — Fix discord_members widget field type

- Changed `discord_members` from `type: 2` (number) to `type: 1` (text string) to match how Discord widget fields render
- Now sends formatted string e.g. "1.2K members" consistent with the YouTube subscribers field

## [2026-07-03] — Add Discord profile widget auto-updater

- Added `pushDiscordWidget()` — fetches live YouTube subscriber count via YouTube Data API v3 and Discord member count, then PATCHes Discord's widget identity endpoint every 15 minutes
- Added `/widget-refresh` slash command (owner only) to manually trigger an immediate widget update
- Added `WIDGET_BOT_TOKEN` and `WIDGET_YOUTUBE_API_KEY` env var references; widget silently no-ops if either is missing
- Added `formatStatCount()` helper for human-readable counts (e.g. 72.4K, 1.2M)

## [2026-07-03] — Unscramble: allow chat, only scan single-word messages as guesses

- Multi-word messages in the unscramble channel now pass through untouched — people can chat freely
- Only single-word messages (no whitespace) are checked against the active puzzle answer
- Single-word messages when no puzzle is active are also left alone

## [2026-07-02] — Unscramble: replace word list with curated common words

- Removed `an-array-of-english-words` dependency (Unix dictionary — too many obscure/archaic words)
- Replaced with an embedded `UNSCRAMBLE_WORDS` array of ~700 genuinely common English words (4–6 letters), hand-curated from high-frequency English word lists
- `pickRandomWord()` now draws from `UNSCRAMBLE_WORDS` instead of the filtered npm package array

## [2026-07-02] — Unscramble: easier words, no auto-advance

- Word pool narrowed to 4–6 letters only (was 4–11) — shorter words are far easier to unscramble and more commonly known
- Removed the 90–180 min auto-advance timer — a new puzzle is now only posted after the current one is correctly solved (5–15 min break after each solve)
- Removed the "time's up" reveal message since puzzles no longer expire automatically

## [2026-07-02] — Add Unscramble word game with leaderboard

- Added `UNSCRAMBLE_CHANNEL_ID` constant, `unscrambleScores` Map, `unscramblePuzzle` state, and `_unscrambleLoaded` guard at module level.
- Installed `an-array-of-english-words` npm package; filtered to 219k words (4–11 letters, a–z only) at startup.
- `pickRandomWord()` — picks a random word from the filtered list.
- `scrambleWord(word)` — Fisher-Yates shuffle with up to 30 retries to ensure the scrambled form differs from the original.
- `postUnscramblePuzzle()` — fetches the channel, reveals the previous unanswered word (if any), posts a new scrambled-word embed, and schedules the next puzzle in 90–180 min.
- `handleUnscrambleMessage(message)` — deletes wrong guesses and messages when no puzzle is active; on correct guess reacts ✅, posts a congratulation embed, awards 1 point, saves scores, and schedules the next puzzle in 5–15 min.
- `saveUnscrambleScores()` — serialises the scores Map to JSON and writes to `botConfig/unscrambleScores` in Firestore; guarded by `_unscrambleLoaded` so an empty startup state never wipes real data.
- `buildFullBackup()` — now includes `unscrambleScores` for disaster-recovery backup.
- `applyBackupToMemory()` — restores `unscrambleScores` from backup snapshot.
- `clientReady` — restores scores from `botConfig/unscrambleScores` on startup; schedules first puzzle 30 s after boot.
- `messageCreate` — added early-exit branch routing all messages in `UNSCRAMBLE_CHANNEL_ID` to `handleUnscrambleMessage`.
- Registered `/unscramble-leaderboard` slash command; handler shows top-10 all-time players and the current active scramble if one is live.
- Added `unscrambleGame: true` feature flag to `botFeatures` (admin-toggleable via Firestore).
- Updated `UPDATE_NOTES` to describe the new game.

## [2026-07-02] — Quarantine: detect manual role add, mod attribution, shared 48h countdown

- `quarantineUser(guild, member, reason, moderator = null)` — added optional `moderator` param. When set, mod embed says "manually quarantined by X" with the 48h countdown warning; auto-quarantine message unchanged.
- Role-add guard: `quarantineUser` now checks `member.roles.cache.has(QUARANTINE_ROLE_ID)` before calling `roles.add()` — skips the redundant API call when a mod already added it manually.
- `guildMemberUpdate`: when `QUARANTINE_ROLE_ID` appears in `addedRoles` and the member isn't already in `quarantinedUsers`, fetch the audit log (`MemberRoleUpdate`), confirm the executor isn't the bot, then call `quarantineUser(..., modName)`. Covers the manual case end-to-end.
- `byBot` guard prevents double-triggering when the bot's own `roles.add()` fires the update event (the `quarantinedUsers` map entry is set synchronously before the gateway event arrives, so this is belt-and-suspenders).

## [2026-07-02] — Quarantine: deny view+connect on temp VCs and workout rooms

- In `createTempVC`: push `{ id: QUARANTINE_ROLE_ID, deny: [ViewChannel, Connect] }` into `permOverwrites` before `guild.channels.create()` so quarantined users can't see or enter any join-to-create VC from the moment it's created.
- In `createWorkoutRoom`: identical overwrite added to the fitness VC creation path for the same reason.
- Applies to every new temp VC going forward — existing channels are unaffected (they don't persist between sessions anyway).

## [2026-07-02] — Quarantine: startup scan of all existing members for Discord signals

- Added a `setTimeout(..., 8000)` block in `clientReady` that iterates `guild.members.cache` (already populated by the startup `guild.members.fetch()`) and calls `discordSignalReason()` on every non-bot member.
- Skips members already in `quarantinedUsers` or already holding `QUARANTINE_ROLE_ID`.
- Quarantines flagged members with a 500ms delay between each action to stay within Discord rate limits.
- Logs `[BeastBot] 🔍 Startup signal scan complete — N member(s) quarantined` on completion.
- Runs 8 seconds after boot (after VIP backfill at 5s) so the member cache is guaranteed to be warm.

## [2026-07-02] — Quarantine: hook Discord's own signal flags (Spammer, AutoMod, unusual DM)

- Imported `UserFlags` and `GuildMemberFlags` from discord.js (were missing from the destructure).
- Added `discordSignalReason(member)`: checks `UserFlags.Spammer`, `UserFlags.Quarantined`, `GuildMemberFlags.AutomodQuarantinedUsernameOrGuildNickname`, `GuildMemberFlags.AutomodQuarantinedBio`, and `member.unusualDmActivityUntil` — returns a reason string or null.
- `guildMemberAdd`: Discord signals checked first; if flagged, quarantine immediately (skips the heuristic checks). Heuristic checks (age, avatar, username pattern) only run if no Discord signal present.
- `guildMemberUpdate`: if `discordSignalReason` returns a signal on the new state but not the old state, quarantine the member in-place (catches members who get flagged after already joining).
- Updated UPDATE_NOTES to mention Discord Signals as a detection source.

## [2026-07-02] — Auto-quarantine system: suspicious account + DM activity detection

- Added `QUARANTINE_ROLE_ID` (`1522001409334313030`) and `QUARANTINE_CHANNEL_ID` (`1522016873653207080`) constants.
- `quarantineUser(guild, member, reason)`: adds the Quarantine role, posts "Hello @user! Your account has been flagged..." in the quarantine channel (readable by quarantined users), sends a separate embed notification to `MOD_CHANNEL_ID` for staff, and logs to the log channel.
- `checkQuarantineExpiry()`: runs every 5 minutes; auto-bans any quarantined user who has not sent a single message within 48 hours. Cleans up the entry after ban or if the guild/user is no longer resolvable.
- On-join detection (`guildMemberAdd`): flags accounts < 1 day old, < 7 days old, no custom avatar, or bot-pattern usernames. Quarantines if brand-new (< 1 day) or 2+ flags present.
- In-server detection (`messageCreate`): quarantines on rapid message flooding (8+ msgs in 60s), mass-mentioning 4+ unique users in 2 minutes, or DM-soliciting phrases from accounts < 7 days old.
- When a quarantined user sends any message, marks `responded: true` (cancels auto-ban) and notifies mods via `MOD_CHANNEL_ID`.
- `quarantinedUsers` Map persisted in `buildFullBackup` / restored in `applyBackupToMemory` (pending-only entries restored on restart).
- `userActivityTrack` Map is ephemeral — not persisted (rate windows are short enough that losing them on restart is harmless).

## [2026-07-01] — Fix memorial: ticker race condition + filter + no pings

- **Root cause**: the background ticker queries alive frogs, runs decay, then writes back — including `alive:true`. If gas killed a frog between the ticker's query and its save, the ticker overwrote the kill with `alive:true`. The frog would end up alive in Firestore, invisible to the memorial.
- **Fix**: ticker no longer writes `alive:true` during routine ticks. It only writes `alive:false` (plus `diedAt`, `deathReason`, `lifespanDays`) when the frog actually dies that tick. The alive state is only ever set by the adoption or death paths.
- **Memorial filter**: changed `!f.alive` to `f.alive === false` (strict equality) so null/undefined can't accidentally exclude real dead frogs.
- **Memorial sort**: now sorts by `diedAt` descending (most recently dead first) instead of by lifespan.
- **Memorial pings**: added `allowedMentions: { parse: [] }` so `<@userId>` renders as a clickable name but sends no notification.

## [2026-07-01] — Fix frog gas v2: deferUpdate catch, save check, owner name in announcement

- Root cause found: `interaction.deferUpdate()` was throwing before `pondFrogSet` was ever called, so the frog stayed alive in Firestore. Every other `deferUpdate` call in pond.js uses `.catch(()=>{})` — this one didn't.
- Added `.catch(()=>{})` to `deferUpdate` so a Discord API hiccup can't abort the kill.
- `pondFrogSet` return value is now checked — if the Firestore write fails, the user sees an explicit error instead of a fake success with the frog still alive.
- Death announcement now fetches the guild member's display name and injects it as plain text (`frog name (ownerName)`) with `allowedMentions: { parse: [] }` so no ping is sent.
- Removed dead code `justDied` branch from `handleFrogGas` — it was unreachable because `requireLiveFrog` always blocks first when the frog is dead.

## [2026-07-01] — Fix frog gas system

- Removed `pondFrogKill` — a custom PATCH function with a Firestore read-back verify step that was causing silent failures. If the verify read had any network hiccup, it returned `false` and the frog stayed alive in Firestore even though the write had already succeeded.
- Gas confirm handler now uses `pondFrogSet` (the same write path used by all other frog deaths), making gas reliable.
- Added `interaction.deferUpdate()` at the start of the confirm button handler so Discord's 3-second interaction window doesn't expire while Firestore work is in progress; follow-up calls now use `interaction.editReply()` accordingly.
- Added handling for the edge case where a frog naturally dies from decay during the confirm button handler — the death is now saved to Firestore and announced, leaving the user free to adopt.

## [2026-07-01] — VIP role system + reaction XP cap

- Added `VIP_ROLE_ID`, `TWITCH_SUB_ROLES`, and `YT_MEMBER_ROLES` constants. The bot watches `guildMemberUpdate` for Discord's native Twitch/YouTube integration roles and syncs the VIP role automatically — no API credentials needed.
- `syncVipRole(member)` reads the member's live role cache to decide qualification; no Firestore involved.
- Boost detection in `guildMemberUpdate` now calls `syncVipRole` on start and end.
- Added `/vip` slash command — shows ephemeral embed with Boost/Twitch/YouTube status. Perk role panel scaffolding is in place (`VIP_PERK_ROLES`, `buildVipPerkPanel`) but intentionally empty; fills automatically when perk roles are added.
- Added `REACTION_XP_DAILY_CAP = 50` — reaction XP is now capped per user per day. Cap check happens before the dedup set so un-reacting frees the slot.

## [2026-07-01] — Weekly Bump Leaderboard + Top Bumper role

- The bot now tracks every `/bump` run on Disboard per user, per ISO week (Monday–Sunday).
- At the end of each week (detected hourly), the top bumper is announced in the bump channel with a ranked embed and the `Top Bumper 👑` role is assigned to them for the coming week. The role is removed from the previous holder automatically.
- `/bump-leaderboard` command shows current week standings at any time.
- Bump counts (per-week + all-time) and the current king are persisted to `botConfig/bumpLeaderboard` in Firestore so everything survives restarts.
- **Setup required:** create a "Top Bumper 👑" role in Discord and either set `BUMP_KING_ROLE_ID` as a Fly.io secret or hardcode the role ID in the `BUMP_KING_ROLE_ID` constant.

## [2026-07-01] — Remove monthly Voice Chat Top 10 leaderboard

- Removed `postMonthlyRecap` and the `MONTHLY_RECAP_CHANNEL` constant — the end-of-month voice chat top 10 no longer posts.

## [2026-07-01] — Add Google Safe Browsing link checker for thoughts channel

- Links submitted via the Thoughts modal (both new posts and edits) are now checked against the Google Safe Browsing API v4 before posting.
- If a link is flagged (malware, phishing, unwanted software, or potentially harmful app), the post is blocked and the user receives an ephemeral error.
- Mods are alerted in the mod channel with the flagged URL, threat type, and instructions for safely reviewing it (VirusTotal / URLScan).
- If the API key is missing or the request fails, the check is skipped silently (fail-open) so a misconfigured key never blocks posts.

## [2026-07-01] — Fix AFK system: clear on message, on VC leave, and on startup

- AFK now clears whenever the user sends any message, regardless of whether they're still in voice — previously it silently did nothing if they'd already left VC.
- Leaving a voice channel now immediately clears AFK status and restores the original nickname.
- On bot startup, any AFK that was stuck on a user not currently in voice is automatically cleared (fixes stale AFKs that survived restarts).

## [2026-07-01] — Pond: limit button events to 5 claims, one per frog

- Firefly Migration, Worm Bloom, and Warm Sunshine events now track claims
  in-memory on the event state (`claimedBy: Set`, `maxClaims: 5`).
- Each frog/user can only claim once per event — clicking again gives an
  ephemeral "already claimed" reply.
- After 5 total claims the button is removed from the message and replaced
  with "all 5 claims collected! 🎉".
- Each successful claim reply now shows how many claims remain.
- The claim is added to the Set synchronously before any awaits, closing the
  race window where two simultaneous clicks could both pass the size check.
- Updated event descriptions to state the 5-frog / one-per-frog limit.

## [2026-06-30] — Pond: /frog gas confirmation step; fix null lifespanDays

- **`/frog gas` confirmation step**: command now shows an ephemeral "Are you sure?"
  message with Confirm/Decline buttons before killing the frog. The actual kill
  (`die()` + Firestore write) only happens on Confirm, on a fresh Firestore read —
  this closes the race where the previous direct-kill could silently fail and leave
  the frog alive in Firestore while the bot had already announced the death.
- **`null day(s)` in death messages fixed**: all four death message templates now
  use `f.lifespanDays ?? 0` so frogs killed before `lifespanDays` was tracked
  (or edge-cases where it's null) display `0` instead of `null`.
- **`Math.max(1, ...)` → `Math.max(0, ...)`** in `die()` so same-day kills show
  `0 days` rather than being rounded up to `1`.

## [2026-06-30] — Pond: /frog gas command; memorial shows frog owners

- **`/frog gas`** — instantly kills your own frog. Sets `deathReason: 'gassed'`,
  fires the existing `announceDeath` channel announcement, replies in-channel with
  a short eulogy. Added `gassed` to `DEATH_MESSAGES` so the memorial and leaderboard
  display the right flavour text instead of falling back to the old-age message.
- **`/pond memorial`** — now shows the frog owner (`<@userId>`) alongside each entry
  so it's clear who the frog belonged to.

## [2026-06-30] — Pond: reduce frog sprite size by ~25%

- `drawFrogPortrait`: frog scale `0.62 → 0.465`, cy offset `0.46 → 0.52` (moved down
  slightly so the smaller frog still sits on the lilypad rather than floating above it).
- `drawPondScene`: frog scale `0.55 → 0.41`, cy offset `0.40 → 0.45` (same reasoning).
- Elder flower-crown position updated to match both new cy/scale values.
- Rendered test images for portrait and 6-frog scene before shipping — frogs now sit
  neatly centred on the lilypads without overlapping the edges.

## [2026-06-30] — Pond: fix Firefly Count game, add /pond admin give/remove

- **Firefly Count bug fix**: luck was applied at *check time* rather than when the count
  was displayed — if luck fired during the modal submit, `adjusted` became `target-1`,
  so a player who correctly counted 6 flies got compared to 5 and lost while the result
  message still said "There were 6 fireflies, you guessed 6." Fixed by applying the luck
  roll when generating `count` in `startHawkGame` (so the displayed count is already the
  potentially lower value) and comparing `guess === target` directly at submit time with
  no second random roll.
- **`/pond admin give|remove user:<@user> amount:<n>`**: new admin-only subcommand group
  on `/pond` that adds or subtracts fireflies from any frog doc. Gated by
  `interaction.memberPermissions.has('Administrator')`. Replies ephemerally with before/
  after balances. Handler: `handlePondAdminFireflies()` in `pond.js`.

## [2026-06-30] — The Pond: baby breeding, partnerships, pond events, /frog fight rename

- **Baby breeding** (`/frog baby breed|status|sell`): frogs at day 14+ can have a baby.
  Baby matures after 7 days (6.3d with Nursery career) and can then be sold for 50 🪲
  (55 if Brown perk). If parent hunger drops below 50 for 12+ hours, the baby is eaten —
  checked in `applyDecay()` via `hungerDangerSince` timestamp, announced in
  `runPondTick`. Nest item (already purchasable) will unlock a 2nd baby slot.
- **Partnerships** (`/frog partner propose|info|break|feed`): two frogs can become
  partners for +2 happiness/day each (applied in the `daysSincePassive` block of
  `applyDecay`) and the ability to feed each other's frog via `/frog partner feed` (uses
  caller's own feed cooldown). Proposal uses a 5-minute Accept/Decline button
  (`pond:partner:accept/decline`), in-memory `pondPartnerRequests` Map, same pattern as
  frog fights. Acceptance sets `partnerId` on both frog docs.
- **Random pond events** (`runDailyEvent()` in `runPondTick`): fires once per UTC day via
  `pond_meta.lastEventDay`. Six event types — three instant button-claim events
  (Firefly Migration +20🪲, Worm Bloom hunger→100, Warm Sunshine happiness→100), two
  timed buffs stored in `pond_meta` (Hawk Season 2× hawk rewards/penalties 24h, Mysterious
  Frog 2× exploration rewards 12h), and the Golden Dragonfly (1% chance daily, first-claim
  +100🪲, pings all frog owners). Timed buffs checked live in `handleFrogExplore` and
  `finishHawkGame` via a quick meta fetch. Button state in `pondEventButtons` Map.
- **`/frog fight`** (renamed from `/frog frogfight`): same implementation, just cleaner
  command name. All references to `frogfight` in user-facing text updated to `fight`.
- **`normalizeFrog`** additions: `hasBaby`, `babyBornAt`, `hungerDangerSince`, `partnerId`.
- **`applyDecay`**: partner happiness passive (+2/day), baby hunger danger tracking.
- **`runPondTick`** field persistence: new fields written on every tick, baby-eaten
  channel announcement fired if `frog.babyEaten` set by `applyDecay`.
- **`/pond rules`** and **`/frog commands`** updated to document baby, partner, and events.
  Footer updated from "coming later" to "everything is now implemented".

## [2026-06-30] — The Pond: major spec update (mayor, frog fights, 5 hawk games, full rebalance)

Complete rewrite of `pond.js` implementing the full new design spec:

- **Frog fights** (renamed from rock fights): `/frog frogfight challenge|any`, 4 randomly-
  selected minigames — Tic-Tac-Toe (1v1 turn-based), Rock-Worm-Lilypad (3-round RPS),
  Bullfrog's Guess, Bullfrog's Guess Hard. Challenger provides secret guess at challenge
  time; opponent submits via modal on accept. TTT and RPS are fully interactive (both
  players take turns via buttons).
- **Hawk minigames × 5**: `/frog hawk` now posts a game-selection menu first, then plays
  the chosen game: Tic-Tac-Toe (AI), Rock-Worm-Lilypad (3-round vs AI), The Reeds
  (button pick), Firefly Count (modal, count 5-10 flies), A Predator's Thinking (modal,
  guess 1-50). All use the existing `hawkMistakeChance()` luck mechanic.
- **Explore twice a day** (3x at lilypad L9) via daily-count tracking
  (`exploresToday`/`exploresResetDay`) instead of a single 24h cooldown. New flat
  probability table matching the spec (25/25/20/10/1/7.5/7.5/4%).
- **Hawk twice a day** via same daily-count pattern (`hawksDoneToday`/`hawksResetDay`).
- **Mayor system**: `runMayorElection()` in `runPondTick` checks if it's past Wednesday
  20:00 UTC since the last election, picks a random alive frog, sets `isMayor: true` on
  their doc, posts announcement. Mayor gets +10% firefly income (`mayorMult()`), +2
  hunger/happiness per day (in passive-income block of `applyDecay`), +10% aging rate
  (`calcStage` now takes optional `ageMult` param). `/frog mayor` command shows who's in
  charge.
- **Stage thresholds**: tadpole 2d (was 1), froglet 4d (was 3), frog 7d (was 14).
- **Lilypad effects reshuffled**: L2=explore bonus, L3=passive income, L4=feed bonus,
  L5=play bonus, L6=hawk loss reduction, L7=+passive, L8=-15% decay (was L9/5%),
  L9=+1 explore slot, L10=100 fireflies bonus.
- **Decay multipliers**: 12.5% (0.875) for green/purple/caretaker (was 10%). Lilypad
  L8 gives 15% slower (was L9/5%).
- **Career unlock**: day 7 (was 14). Respec now Monday-gated (12:00 GMT+1 weekly
  window, `lastMondayRespecWindowMs()`), not anytime-for-fee.
- **Pond tax**: 10% rate (was 5%), Friday 11:00 UTC schedule
  (`lastFridayTaxWindowMs()`) instead of every-7-days interval.
- **Starting fireflies**: 15 for new adopts. One-time migration: `normalizeFrog()`
  grants +15 to any frog where `patchV2Granted !== true` (set on adopt too).
- **Pin message**: on first tick after this deploy, bot posts the welcome message to
  `#the-pond` and pins it (once only, `pond_meta.pinMessageId` guards against repeats).
- **Modals wired in**: added `isPondModal`/`handlePondModalInteraction` exports and
  a `isModalSubmit()` dispatch block in `index.js`, mirroring the button dispatch.
- **`/frog commands`**: new command, overview embed listing all commands.
- **`/pond rules`** and **`/frog status`** updated to reflect all new spec values.
- Verified: all 22 subcommands register cleanly, stage boundary tests pass, migration
  idempotency confirmed, mayor aging math verified, L3 lilypad passive income triggers
  correctly.

## [2026-06-25] — The Pond: fix leaderboard/memorial sort ties

- `/frog leaderboard` sorted by `ageDays`, a day-rounded value — frogs adopted on the same
  calendar day tied on that number and the tiebreak silently fell back to Firestore's
  arbitrary `runQuery` result order instead of who was actually adopted first. Reported by
  a user whose frog ("Lil Beast"), adopted before everyone else's, showed up 5th. Fixed by
  sorting on exact age in milliseconds (`ageMs`) while keeping the day-rounded value for
  display only.
- Applied the same fix to `/pond memorial`'s sort (was tie-breaking on day-rounded
  `lifespanDays`; now sorts on exact `diedAt - bornAt`).
- Verified with a reproduction matching the reported scenario (5 same-day frogs returned in
  non-`bornAt` order) — confirmed the old sort misranked the earliest-adopted frog and the
  new one ranks it first.

## [2026-06-25] — The Pond: animate `/pond view`

- `drawPondScene()` now builds an 8-frame animated GIF (`gif-encoder-2`, same pipeline as
  single-frog portraits) instead of a single static PNG — every frog gets the same gentle
  idle bob and water-ripple shimmer, with each frog's bob phase offset by `i * 0.13` so the
  whole pond doesn't bob in perfect unison.
- Sprite images are preloaded once via `Promise.all` before the frame loop (they were
  already cached, but loading per-frame per-frog was needless repeated work).
- Benchmarked locally at the existing 30-frog cap: ~970ms to render, ~717KB output —
  comfortably under Discord's upload limit and fast enough not to need a longer defer.
- While testing, solved an open mystery from an earlier bug report: the dark circles seen
  for egg-stage frogs in `/pond view` were never a bug — `EggGreen.png` etc. are
  intentionally a round speckled-orb design, not a traditional oval egg shape.
- `/pond view`'s attachment filename changed from `pond.png` to `pond.gif`; `GAME_POND.md`
  updated to describe the new animated behavior.

## [2026-06-25] — The Pond: fix missing-glyph boxes in frog names (e.g. "Š")

- `pond.js` drew all canvas text with a bare `sans-serif` font family, which
  `@napi-rs/canvas` doesn't resolve via generic CSS-style fallback the way a browser
  would — it was silently falling through to a "missing glyph" placeholder font for any
  character outside basic ASCII (e.g. "Š", "Ž"), rendering a `⊠` box. Switched to
  `'"Noto Sans", sans-serif'`, matching the pattern `index.js` already uses successfully
  elsewhere — Noto Sans has full Latin Extended-A coverage.
- `pond.js` is intentionally self-contained (no circular require with `index.js`), so it
  shouldn't depend on `index.js` having loaded `/usr/share/fonts` into the process-wide
  `GlobalFonts` registry first. Added its own
  `GlobalFonts.loadFontsFromDir('/usr/share/fonts')` call — idempotent, harmless if
  `index.js` already did it.
- Verified for real against the live production container via `flyctl ssh console`
  (rendered "Špongey Žarko" to a PNG and inspected it) rather than relying on local-machine
  font availability, since this Mac doesn't have the same Alpine/Noto fonts installed and a
  local-only test would have been misleading either way.

## [2026-06-25] — The Pond: `/pond rules` rewritten as a structured embed

- Replaced the two plain-text messages (`RULES_TEXT_1`/`RULES_TEXT_2`, sent as a reply +
  followUp) with a single embed (`RULES_EMBED`) using fields — same plain-object-embed
  pattern already used elsewhere in this codebase (`embeds: [{...}]`, no `EmbedBuilder`).
  One message instead of two, and field layout reads cleaner than a wall of bolded text
  lines.
- Added a **Life Stages** field — egg (day 0) → tadpole (1+) → froglet (3+) → frog (14+) →
  elder (60+), plus the day-75 old-age cap. This was missing from the rules entirely.
- Verified field/description/footer lengths against Discord's embed limits (1024 chars per
  field value, 6000 total) before shipping — comfortably under at ~2700 total.

## [2026-06-25] — The Pond: real froglet sprites

- Added `discord-bot/assets/pond/froglets/Froglet<Color>.png` (6 colors, supplied by
  Kiernen, already named to match the existing `Egg<Color>.png`/`Tadpole<Color>.png`
  convention — no renaming needed) and wired it into `loadFrogSprite()`.
- Removed the froglet-renders-smaller stopgap in `drawPortraitFrame()` (`spriteScale` was
  0.5 for froglets vs 0.62 for every other stage) now that froglets have real dedicated
  art instead of borrowing the adult `frogs/` sprite at a shrunk scale.
- Verified all 6 froglet sprites load and render correctly in both the single-frog
  portrait and the multi-frog `/pond view` scene before shipping.
- Updated `GAME_POND.md`'s Visuals section to describe the per-stage sprite-folder pattern
  generically (`assets/pond/<stage>/<Stage><Color>.png` + one `loadFrogSprite()` line) so
  it's accurate as more stage art (e.g. a dedicated elder sprite) gets added later.

## [2026-06-23] — The Pond: bigger feed/play/item amounts

Decay rate is unchanged (still -2/hr, -8 per 4h) — only the care-action amounts went up:

- `FEED_RESTORE_BASE`/`PLAY_RESTORE_BASE`: 8 → 20
- `ITEM_RESTORE` (worm/toy-boosted feed/play): 16 → 35
- Updated the matching copy in `SHOP_ITEMS` descriptions, `/pond rules` (`RULES_TEXT_1`),
  and `GAME_POND.md` so the numbers shown to players stay accurate

## [2026-06-22] — The Pond: less tiled-looking water in `/pond view`

- `drawWaterBackground()` generalized to take `width`/`height` instead of a single square
  `size`, and `/pond view`'s `drawPondScene()` now paints **one continuous water surface**
  across the whole scene before drawing frog cells on top, instead of every cell repainting
  an identical mini water-background — that per-cell repetition is what made the grid look
  visibly tiled.
- Ripple placement switched from an evenly-spaced formula (same relative spot in every
  cell) to a deterministic pseudo-random scatter (`rippleSeed()`), and ripple count now
  scales with canvas area instead of being a fixed 4 — same visual density on single
  portraits, more natural coverage across the larger combined scene.
- Single-frog portraits (`/frog adopt|feed|play|cure|soothe|status`) are visually unchanged
  — `drawPortraitFrame()` just passes its existing square size as both width and height.

## [2026-06-22] — The Pond: fix `/pond view` water-square artifact

- `drawPondScene()` drew each cell's water background at canvas-origin `(0,0)` instead of
  the cell's translated `(x, y)` position — so every frog's background repaint just
  overwrote the top-left corner of the canvas (overlapping the header and first cell),
  leaving whichever frog was drawn last as a stray water-colored square there. Moved the
  `drawWaterBackground()` call inside the existing `ctx.save()`/`ctx.translate(x, y)`
  block so each cell paints its own background in the right place.

## [2026-06-22] — The Pond Phase 2: exploration, rock fights, hawk minigame, careers

Activates the blue/pink perks Phase 1 only stored, and gives players a real firefly income
source. First buttons in `pond.js` (previously slash-command-only).

- **Exploration** — `/frog explore`, once/day, weighted reward tiers (common 55% /
  uncommon 30% / rare 15%, weights not specified by the design doc, picked to make this the
  primary early-game income source). Firefly gains boosted by blue color perk + explorer
  career (additive) and the existing lilypad exploration bonus.
- **Hawk minigame** — `/frog hawk`, once/day, 3x3 tic-tac-toe via buttons vs a minimax AI
  with a tunable mistake chance (base 20%, +10pp hunter career, +5pp pink luck, capped 50%)
  — that's how the perks matter against what's otherwise an unbeatable opponent. Win +20
  fireflies; lose -10% of fireflies (-5% at lilypad lvl 6+). State in-memory
  (`pondHawkGames`, keyed by message ID), 10-min expiry.
- **Rock fights** — `/frog rockfight challenge user:<@user> wager:<5-20>` (targeted,
  Accept/Decline restricted to the target) or `/frog rockfight any wager:<5-20>` (open
  queue, anyone but the challenger can accept). Zero-sum win chance from each frog's age
  (capped +15pp at the 75-day max-age mark) and pink luck (+5pp). Funds checked at
  challenge and again at resolution, not held in between. State in-memory
  (`pondRockfights`, keyed by message ID), 10-min expiry, synchronous resolved-flag
  check-and-set closes the double-accept race window.
- **Careers** — `/frog career info|choose|respec`, unlock at day 14+. First pick free,
  respec costs 35 fireflies (10% off for Golden). Fisher (+3 fireflies/12h), hunter (+10pp
  hawk mistake chance), caretaker (-10% decay, stacks multiplicatively with color
  perk/lilypad lvl9), explorer (+10% exploration fireflies), nursery (stored for Phase 3).
- **Fixed a Firestore data-loss bug found during this pass**: `pondFirestoreSet` issued a
  PATCH with no `updateMask`, which Firestore's REST API treats as a full-document
  overwrite — a partial write like the weekly tax's `{ fireflies }` would have silently
  deleted every other field off the frog doc. Now always sends `updateMask.fieldPaths` for
  exactly the fields being written.
- **Fixed an unhandled-rejection risk found during this pass**: both `handlePondInteraction`
  and the new `handlePondButtonInteraction` used `return handler(interaction)` inside a
  `try` block — in JS, a bare `return` of a promise does not let the matching `catch` see
  a later rejection (`return await handler(...)` is required). With no global
  `unhandledRejection` handler in this bot, an uncaught rejection here could have crashed
  the process. Fixed on every dispatch line in both functions.
- Updated `GAME_POND.md` with the four new systems and trimmed "Not Yet Implemented" down
  to Phase 3 only (mayor elections, partnerships, baby breeding).

## [2026-06-22] — The Pond: add `/pond rules`

- Added `/pond rules` — a single-message rundown of how to play The Pond (adoption/color
  perks, feeding/playing, sickness/depression, the economy, and community commands), with
  a "coming later" footer listing the still-unbuilt Phase 2/3 systems (exploration, rock
  fights, hawk minigame, careers, mayors, partnerships, baby breeding) so players don't
  expect mechanics that don't exist yet.

## [2026-06-22] — The Pond Phase 1: fireflies economy, sickness/depression, real sprite art

Major rewrite of The Pond's rules and visuals, the first of a planned multi-phase build-out:

- **Fireflies currency** added to the frog doc (`fireflies` field), with a weekly 5%-of-
  balance pond-maintenance tax swept by the existing hourly ticker (bootstraps its own
  clock on first run so it doesn't tax everyone immediately on rollout day).
- **Color perks**: every color is now a permanent perk picked at adoption — green/purple
  slow hunger/happiness decay 10%, gold ("Golden") gives a 10% shop/upgrade/cure discount,
  blue/pink/brown perks are stored now and activate once exploration, rock fights/hawks,
  and baby breeding ship in later phases. Added a 6th color, brown, matching the supplied
  art assets.
- **Lilypad levels (1-10)** — `/frog lilypad info` and `/frog lilypad upgrade`, costing
  10-200 fireflies per level, unlocking bigger feed/play bonuses, daily passive firefly
  income (level 5+), and slower decay (level 9+).
- **Shop** — `/pond shop buy item:<worms|toys|nest>`; worms/toys are consumables that
  double the next feed/play action's effect via a new `use_item` option on
  `/frog feed`/`/frog play`; nest is a one-time purchase reserved for future baby breeding.
- **Decay/death model rewrite** — replaced the old dual-stat 72h neglect-grace death with
  independent sickness (`/frog cure`, hunger-triggered) and depression (`/frog soothe`,
  happiness-triggered) states, each with its own 72h grace window, plus a hard 75-day
  old-age death cap regardless of stats. `deathReason` now drives differentiated
  memorial/announcement copy. Decay rate changed from 2/1.5 per hour to 2/2 (8 per 4h, per
  the new design spec), with feed/play base restore dropped from +35 to +8 (+5 lilypad
  bonus, or +16 via a consumable item).
- **Real sprite art** — procedural pixel-art shapes replaced with the supplied artwork
  (`Pond Assets/`, moved into `discord-bot/assets/pond/` so it actually ships inside the
  Docker build context — it previously lived at the repo root, outside `COPY . .`).
  Animated portraits now composite the sprite over a procedural water/ripple background
  with a gentle bob (no synthetic blink frame, since there's no closed-eye art yet).
- `normalizeFrog()` backfills new fields on older live frog docs so existing players don't
  break on `undefined`.
- Rewrote `GAME_POND.md` to document the new model and explicitly list what's deferred to
  Phase 2 (exploration, rock fights, hawk minigame, careers) and Phase 3 (mayor elections,
  partnerships, baby breeding).

## [2026-06-20] — The Pond: fix persistence, animated pixel-art frogs

Two follow-ups after shipping The Pond: (1) `/frog adopt` looked like it worked but never
actually saved — Firestore security rules only allowlist specific collection names, and
the new `pondFrogs` collection wasn't one of them, so every write came back `403` (silently,
since the existing `firestoreSet`-style helpers only log and swallow errors). Frog docs now
live under the already-allowed `botConfig` collection instead (`botConfig/pond_<userId>`,
tagged with a `kind: 'pondFrog'` marker field for collection-wide queries), so no Firestore
rules change is needed. (2) Replaced the flat vector frog art with animated pixel-art GIFs —
shapes are drawn at low resolution then upscaled with image smoothing disabled (turns soft
anti-aliased edges into chunky retro pixel blocks), with a looping idle bob, occasional
blink, and drifting water shimmer (`gif-encoder-2`). `/pond view`'s multi-frog grid stays a
static pixel-art PNG to keep that command cheap.

## [2026-06-20] — The Pond: a cozy tamagotchi frog game

Added a new low-pressure pet game living in `#the-pond`. `/frog adopt` lets a member name
and color their own frog; `/frog feed` and `/frog play` keep it happy (gentle decay, 4h
cooldowns, a single check-in a day is enough). Frogs grow through visual stages over time
(egg → tadpole → froglet → frog → elder) and, if fully neglected for 72h, pass on
peacefully into `/pond memorial` rather than just vanishing. `/pond view` renders every
living frog together on lily pads. All portraits/scenes are generated procedurally with
`@napi-rs/canvas` — no external art assets. Lives in its own module (`pond.js`) since its
state is persistent (Firestore) rather than an in-memory party-game session like Imposter/
Traitors/Escape Room. See `GAME_POND.md` for full design notes.

## [2026-06-19] — Fair race puzzle types; give inventory an actual purpose

- **Race mode fairness fix**: all racers used to get fully independently randomized puzzle types per
  room, meaning one player could get an easy riddle in round 2 while another got a hard logic-grid
  witness puzzle in the same round. `escGenerateRun` now accepts a `presetTypes` array; race mode
  generates the 4 puzzle types **once** and gives every racer that same type sequence, with
  independently randomized content (different vault digits, cipher word, etc. per player) so it's
  still each player's own puzzle, just a fair contest.
- **Inventory now matters**: previously the loot items (e.g. "a tarnished doubloon") were pure flavor
  text with zero mechanical effect. The Final Door's modal now has a second required field — "what
  did you find in the `{type}` room?" — checked leniently (substring match, so "doubloon" matches "a
  tarnished doubloon"). Both the fragment code and the memory answer must be correct to escape.

## [2026-06-19] — Escape Room v2: Master Puzzle chaining, 3 new puzzle types, Cipher Evolution

Researched real puzzle-hunt design (MIT Mystery Hunt metapuzzle structure, Puzzled Pint difficulty
tuning, knights-and-knaves fairness conventions) to make the escape room feel like one connected
puzzle instead of four independent riddles, without pushing total playtime past ~15-25 min.

- **Master Puzzle / fragment chaining** — every puzzle now yields a fragment (1 letter) in addition
  to its loot item. Once all 4 rooms are cleared, a 5th "Final Door" stage combines the 4 collected
  fragments per a stated order rule (forward / reverse / alphabetical, picked once per run) into one
  modal submission — this is now the actual "escaped" trigger, not room 4.
- **Cipher Evolution** — cipher puzzles now rotate between 3 real ciphers (Polybius square, Atbash,
  Morse code) instead of always being the same one. The coded text is shown with no table and no
  name; recognizing which cipher it is is half the puzzle. First Hint reveals the method as a safety net.
- **3 new puzzle types**: `blackbox` (infer a hidden formula from input/output pairs, predict the
  4th output), `witness` (knights-and-knaves logic puzzle — all 4 templates brute-force verified to
  have exactly one consistent solution before shipping), `split` (co-op only — a 4-digit code is
  split between two random players via two separate DMs; structurally unsolvable without the group
  talking to each other).
- 2 lateral-thinking riddles added to the riddle pool.
- Puzzle pool grew from 5 to 8 types (7 in race mode, since `split` needs a team); each game still
  picks 4 with no repeats.

## [2026-06-19] — Rip reactions out of Ward puzzle entirely, switch to buttons

The Ward puzzle (react with the correct emoji) kept failing in live testing even after two fixes
to the reaction-handling logic. Reactions as a mechanic depend on Discord's reaction-echo behavior,
which isn't fully controllable from the bot side, and failures are silent (nothing happens, no
error). Rewrote Ward to use the same button + elimination-hint pattern as Riddle: 5 emoji buttons,
`esc:ward:{idx}` customIds, wrong guesses get an ephemeral reply, hints rule out one wrong option
at a time (greys out with ❌). Removed `escReactionLocks`, `escArmWard`, `handleEscWardReaction`,
`escNormEmoji`, `escPushUpdate`, `escAdvanceFromReaction`, and the escape-room branch of the
`messageReactionAdd` listener — none of it is needed anymore since every puzzle in the game is now
solved via buttons, select menus, or a modal.

## [2026-06-19] — Fix Ward's actual root cause; redesign Cipher, Riddle, Sequence, Vault to require real reasoning

- **Real root cause of the Ward bug found and fixed:** all 5 places that armed a ward puzzle wrapped the bot's own `react()` calls and the `escReactionLocks.set()` in a single `try`/`catch`. If even one react call hiccuped (rate limit, a transient blip right after `interaction.update()`), the catch swallowed it silently and the lock was never registered — meaning no reaction, including the correct one, could ever solve that puzzle, with zero visible error. Replaced with one `escArmWard()` helper that registers the lock unconditionally first, then attempts each reaction independently.
- **Sequence redesigned** — was pure echo (shown once, press it back, no thinking required). Now each of 5 symbols carries a hidden numeric value shown as a legend; the player must compute and press the 3 lowest- or 3 highest-value symbols in order — a derived answer, not a copied one.
- **Cipher redesigned** — was a Caesar shift with the shift amount stated outright in the prompt (pure arithmetic). Now a Polybius square: a real 5x5 letter grid rendered as a text table, with the message given as row/column coordinate pairs that must be looked up by hand.
- **Riddle pool expanded** with 7 anagram/wordplay clues, mixed 50/50 with the existing riddle pool. Multiple options are genuine anagrams of the same letters; only the given definition identifies the correct one — the actual mechanic real cryptic crosswords use.
- **Vault** gained a 4th logic clue (digit parity) on top of sum/difference/highest-digit, requiring genuine elimination across more constraints instead of two quick facts.
- Removed the now-unused `escCaesarShift()` helper.

## [2026-06-19] — Fix Ward puzzle reaction bug, make Vault/Ward puzzles harder, hints never give the answer

- **Bug fix:** Ward puzzles (react with the correct emoji) compared `reaction.emoji.name` against the stored answer with strict string equality. Some emoji (☀️ ❄️ 🗝️ 🕯️) are written with a variation selector that Discord's gateway can omit when echoing the reaction back, so reacting with the visually-correct symbol could silently fail. Added `escNormEmoji()` to strip variation selectors/ZWJ before every comparison.
- **Vault puzzle redesigned:** combination is no longer handed over by a direct "X candles = digit" clue. It's now deduced from 3 logic clues (digit sum, an exact difference between two named dials, which dial holds the highest digit), and wrong submissions now get Mastermind-style feedback (digits correct & in place / correct but wrong dial) so players converge on the answer instead of guessing blind.
- **Ward puzzle redesigned:** 4 → 5 options per gate, and clues now require combining two facts (e.g. "the sea creature with three hearts and eight arms") instead of naming the answer outright.
- **Hints reworked across all puzzle types** to never reveal the full solution: Vault reveals one dial at a time, Cipher reveals one more letter per click, Riddle/Ward rule out one wrong option per click (and visibly mark/remove it), Sequence reveals only the next symbol needed.

## [2026-06-19] — Add Escape Room game (procedurally generated, co-op + race modes)

- New `/escaperoom` command (`start`, `stop`, `status`, `help`) running in `#escape-room` (`1517318620395470969`)
- Each game randomly picks a theme (Library, Alchemist's Lab, Pirate Ship, Haunted Manor, Space Station) and generates a fresh 4-room run from 5 puzzle types: vault combo (select menus), cipher (modal text input), riddle (multiple-choice buttons), symbol sequence (buttons), and ward (emoji reactions)
- **Co-op mode** — the whole lobby shares one room/inventory, solved together in the channel
- **Race mode** — every player gets their own independently generated run via DM; channel shows a live leaderboard; first to escape wins
- Host controls: start/end game, toggle mode in lobby, skip a stuck room in co-op
- Per-puzzle Hint button on every puzzle type
- Added `botFeatures.escapeRoomGame` toggle (Admin Panel → Bot Controls)
- See `GAME_ESCAPEROOM.md` for full architecture

## [2026-06-17] — Ping last bumper in Disboard bump reminder

- Bot now tracks who last ran `/bump` via `message.interaction?.user` on Disboard's confirmation message
- `lastBumperID` is persisted to Firestore (`botTimers/disboard`) alongside the timer's `fireAt`, so it survives restarts
- Bump reminder message now includes a mention of the last bumper (e.g. `⏰ Time to bump! @User Run /bump...`)
- Restored `lastBumperID` from Firestore on startup so the ping works even after a bot redeploy

## [2026-06-17] — Fix raw JSON leaking to Discord on long responses

- Bumped `max_tokens` from 700 → 1024 to reduce truncation frequency
- Added two-stage regex salvage in `askClaude` catch block: first tries to extract a complete `response` field, then falls back to a partial (truncated) string rather than sending raw JSON or nothing
- Final fallback now returns a clean error string instead of the raw Claude output

## [2026-06-17] — Revert to friendly personality, suppress unprompted stat readouts

- Removed rude/dismissive personality from system prompt — restored friendly, casual, cheeky tone
- Re-added full Personality and JOKES sections that were removed in previous update
- Restored warm "unknown question" response wording and non-aggressive inappropriate message handling
- Added explicit instruction to never volunteer member stats (message count, voice hours, XP, rank, join date) unprompted — bot still receives the data but must not surface it unless directly asked
- Role awareness from previous update retained — bot still sees server roles (Mod, Admin, VIP, etc.)

## [2026-06-15] — Fix /purge-app to support webhook-sent spam messages

- `/purge-app` now accepts an optional `name` param (display name match, case-insensitive) in addition to `app_id` — fixes the case where a spam app posted via webhook (webhook author IDs differ from the app's actual user ID)
- `app_id` and `name` are mutually exclusive; the command errors if neither is provided

## [2026-06-15] — Add /purge-app and /kick-app commands for external app incidents

- Added `/purge-app <app_id>` — owner-only command that scans all accessible text channels and bulk-deletes messages from a given bot/app User ID (up to 500 messages per channel, skips messages older than 14 days per Discord's bulk-delete limit)
- Added `/kick-app <app_id>` — owner-only command that fetches and kicks any bot or external application from the server by User ID
- Both commands are gated behind `OWNER_DISCORD_ID` and log their actions to the mod log channel

## [2026-06-12] — Overhaul Beast Bot personality and role awareness

- Replaced friendly/casual system prompt with a rude-by-default personality — opens most responses with a dismissive or insulting comment
- Added hard refusal for cringe/manipulation attempts (animal sounds, DAN prompts, roleplay, jailbreak framing) — no explanation given, just ignored
- Added non-negotiable views on gender (two genders only) — bot dismisses and drops the topic when challenged
- Roast-style humour now targets the person asking rather than generic jokes
- Owner (Kiernen Irons) retains fully friendly exception treatment
- Added `serverRoles` to `buildUserContext` — bot now sees a member's Discord roles sorted by position
- System prompt updated to use role info for contextual awareness (Mod/Admin vs regular member)
- Removed unprompted stat injection — bot no longer weaves in message counts, voice time, join date unless directly relevant

## [2026-06-07] — Expand verbose logging coverage

- Added `GuildWebhooks`, `GuildInvites`, `GuildIntegrations` intents
- `guildMemberUpdate`: log server boost start (💎) and boost end (💔)
- `voiceStateUpdate`: log server mute/unmute and server deafen/undeafen by mods
- `roleUpdate`: now diffs permissions bitfield (added/removed), hoist, and mentionable changes
- `channelUpdate`: now diffs NSFW toggle, slowmode, bitrate, user limit, and permission overwrite adds/changes/removes
- `guildUpdate`: now diffs verificationLevel, explicitContentFilter, defaultMessageNotifications, afkChannel, systemChannel, afkTimeout
- `messageDeleteBulk`: log bulk purges with count and executor
- `threadCreate/Update/Delete`: log thread lifecycle (archive, lock, name, delete)
- `webhooksUpdate`: log when a channel's webhooks are modified (fixed event name — was `webhookUpdate` which never fired)
- `inviteCreate/Delete`: log invite creation (code, channel, max uses, expiry) and deletion
- `stickerCreate/Update/Delete`: log sticker lifecycle
- `guildScheduledEventCreate/Update/Delete`: log scheduled event lifecycle
- `integrationCreate/Delete`: log bots/apps being added or removed from the server

## [2026-06-07] — Revert Instagram embed fix

- Removed Instagram URL → ddinstagram.com proxy reply; proxy services proved unreliable and Discord did not render previews

## [2026-06-07] — Add Instagram embed fix

- Detect Instagram post/reel URLs (`/p/`, `/reel/`, `/reels/`, `/tv/`) in any guild message
- Replace `instagram.com` with `ddinstagram.com` and reply with the fixed URL — Discord embeds it with full preview/video player
- `allowedMentions: { repliedUser: false }` so the reply doesn't ping the original author

## [2026-06-07] — Make reminder DM generic

- Removed all workout-specific wording from the reminder DM — title changed from "Time to Work Out!" to "Reminder!", body no longer references workouts or #tracking
- "⏰ Workout Reminder" field label in `/fitness progress` renamed to "⏰ Reminder"
- Log lines and error messages updated to match

## [2026-06-05] — Rename /fitness notify to /reminder; add configurable stream schedule

- `/fitness notify` removed as a subcommand; replaced by top-level `/reminder` command with identical options (hour, minute, period, timezone, days)
- `/fitness notify-clear` removed; replaced by top-level `/reminder-clear`
- Added `/set-schedule` (owner-only) — sets stream schedule days and time; persists to Firestore `botState/streamSchedule`
- Added `/view-schedule` — shows current schedule and next stream time as a Discord timestamp
- Countdown GIF and `getNextStreamUTC()` now read from `streamSchedule` instead of hardcoded Sun/Tue/Thu 19:00
- Fixed bug: `firestoreSet` can't serialise arrays, so `days` is now stored as a comma-separated string and parsed back on restore — prevents `days.map is not a function` crash after restart
- Added `UPDATE_NOTES` constant for future `/bot-updates` command
- `/reminder-clear` logic wrapped in try/catch for consistent error handling

## [2026-05-18] — Simplify countdown GIF design and generation

- Canvas resized to 520×264 (landscape) — smaller memory footprint
- Removed Me.png background, gradient overlay, and shadow/glow border to eliminate OOM
- Title moved to top; digits drawn pair-by-pair with dot separators (avoids font glyph box chars on Alpine)
- Time label simplified to "7 PM"; footer to "DUBLIN TIME"
- GIF buffer reverted to direct `encoder.out.getData()` (ReadStream overhead not needed at this canvas size)
- Removed `scheduleGifBusy` concurrency guard and Firestore persistence for GIF channel/message state

## [2026-05-17] — Stop bot from auto-posting countdown GIF

- `scheduleGifChannelId` now starts as `null` — bot no longer posts or updates the GIF unless `/post-countdown` has been used
- Removed the startup auto-post from `startScheduleGifUpdater`; interval still runs every minute but `postOrUpdateScheduleGif` returns immediately if no channel is set
- Result: only one GIF is ever active at a time, and it only exists when the owner explicitly posts it

## [2026-05-17] — Fix GIF box characters; add /post-countdown command

- Replaced `ctx.fillText(':' ...)` colon separators with two drawn `ctx.arc` dots — fixes box/tofu glyphs on Alpine Linux where the fallback monospace font lacks colon glyphs
- Removed apostrophe from title (`REALTRUEBEAST'S` → `REALTRUEBEAST`) and slash from footer (`EUROPE/DUBLIN` → `DUBLIN TIME`) — both characters also rendered as boxes
- Simplified stream time label from `07:00 PM` to `7 PM` — avoids the colon glyph entirely
- Changed `const SCHEDULE_GIF_CHANNEL_ID` → `let scheduleGifChannelId` so it can be updated at runtime
- Added `/post-countdown` owner-only slash command with a required `channel` option — updates `scheduleGifChannelId`, resets the tracked message ID, and immediately posts a fresh countdown GIF to the chosen channel

## [2026-05-17] — Animated GIF countdown posted and updated every minute

- Added `gif-encoder-2` dependency for in-process GIF encoding without native binaries
- `getNextStreamUTC()` extracted as a shared helper (was inlined in `/schedule` handler; now reused by both the command and the GIF updater)
- `renderCountdownFrame(ctx, W, H, remainingMs, nextStream)` — draws one 520×264 canvas frame: dark background, green DD:HH:MM:SS countdown with measured font layout, SUN/TUE/THU day bubbles with the next one highlighted, Europe/Dublin footer
- `generateCountdownGif()` — encodes 60 frames (one per second) into an animated GIF using neuquant quantization; frames are clock-synced to the next whole second so the GIF ticks accurately
- `postOrUpdateScheduleGif()` — posts to `SCHEDULE_GIF_CHANNEL_ID` on first run; subsequently edits the same message; recovers the message ID on restart by scanning recent channel history for a bot attachment named `schedule.gif`
- `startScheduleGifUpdater()` — posts immediately at startup, then syncs to minute boundaries so each new GIF starts at :00 seconds; all promise rejections caught
- Called from `clientReady` after the anniversary check

## [2026-05-17] — Add /schedule command with stream countdown and schedule embed

- New `/schedule` slash command — computes the next Sun/Tue/Thu 19:00 Europe/Dublin stream time, accounting for DST (IST/GMT), using `Intl.DateTimeFormat` offset arithmetic
- Posts a rich green embed with Discord-native `<t:timestamp:F>` and `<t:timestamp:R>` timestamps (auto-localised per user) plus the full weekly schedule with the next stream day highlighted via 🟢/⚫
- Two link buttons on the reply: "View Schedule" → `truebeast.io/schedule`, "Watch on Twitch" → `twitch.tv/realtruebeast`

## [2026-05-09] — Cache Discord/Steam context; add /ai-context command

- Added 2-minute in-memory cache for `fetchDiscordContext` — prevents multiple simultaneous messages from hammering the Discord API with 3 sequential guild calls each, which was causing rate-limit stalls and response delays
- Added 5-minute in-memory cache for `fetchSteamGames` — Steam API is now called at most once per 5 minutes instead of on every AI message
- Both caches return stale data on error rather than empty string, so a failed refresh doesn't wipe context
- Added `/ai-context` owner-only slash command with three subcommands: `add` (write a new knowledge base entry to Firestore), `remove` (find and delete by topic name, partial match), `list` (show all entries with a preview of each)
- Adding or removing entries immediately invalidates `_knowledgeCache` so the next AI response reflects the change

## [2026-05-08] — Make reactions give 1 XP each; unreact removes 1 XP

- Added `reactionDays` to `monthlyActivityScore` — each credited reaction now contributes exactly 1 XP to the monthly score (same weight as a message)
- Added `assignVoiceRank` call in `messageReactionRemove` so rank roles sync downward immediately when a user's score drops from unreacting

## [2026-05-08] — Decrement reaction counts on unreact

- Added `messageReactionRemove` handler — when a user removes a reaction, their counts are decremented and the credit key is cleared from `creditedReactions` so a subsequent re-react is counted correctly
- Decrements today's `reactionDays` count (clamped at 0, deletes the day entry if it hits 0)
- Decrements `emojiTally` all-time count for the emoji (deletes entry at 0)
- Decrements `reactionEmojiDays` per-day emoji count (deletes entry at 0)
- Only acts if the reaction was previously credited — unreacting something the bot never saw doesn't underflow counts

## [2026-05-08] — Add /adjust-stats owner command to correct user stats

- New `/adjust-stats user: stat: value:` command (owner only) to manually set a user's messages, reactions, or voice minutes to any total
- `trimDaysMap` helper trims the per-day breakdown from most recent days backward so both the total and monthly/weekly/daily breakdowns stay consistent
- Messages stat: sets `messageCounts`, trims `messageDays`, calls `saveMessageDays`, and re-syncs the user's rank role
- Reactions stat: trims `reactionDays` (no Firestore save needed — reactions are backup-only)
- Voice stat: sets `voiceMinutes.total`, trims `voiceMinutes.days`, and re-syncs rank role
- All paths call `saveDiscordBackup()` to persist immediately

## [2026-05-08] — Fix reactions incorrectly incrementing message count

- Removed `messageCounts` and `messageDays` writes from `messageReactionAdd` — reactions were being counted as sent messages, inflating message XP
- Rank sync check in the reaction handler now triggers off `reactionCount` (today's reaction tally) instead of the message count

## [2026-05-07] — Prevent react/unreact spam from inflating XP

- Added `creditedReactions` Set tracking `userId:messageId:emojiKey` tuples
- `messageReactionAdd` now bails immediately if the user has already been credited for that message+emoji combination — re-reacting after unreacting yields no additional XP
- `emojiKey` computation moved before the dedup check so the key is available at bail time
- Safety valve: if the Set ever exceeds 100,000 entries it is cleared (in-memory only; resets on restart naturally)

## [2026-05-06] — Fix edit modal label exceeding Discord 45-char limit

- Changed the "Buttons" TextInput label in the Edit Panel modal from `'Buttons (one per line: emoji | label | roleId)'` (46 chars) to `'Buttons (emoji | label | roleId per line)'` (41 chars) — Discord enforces a 45-character maximum and was throwing "Invalid string length" on every edit button click

## [2026-05-06] — Fix role panel edit button; add server emoji autocomplete

- Wrapped the Edit Panel button handler in try/catch — unhandled exceptions were causing Discord to show "interaction failed" with no feedback
- Modal title stripped of emoji prefix (was causing a Discord.js edge case); `.setValue()` now falls back to `' '` if a field is empty to avoid SDK validation throws
- Added `parseEmoji()` helper to correctly resolve custom emoji format (`<:name:id>` / `<a:name:id>`) into Discord.js emoji objects for ButtonBuilder; previously only unicode strings worked
- Added autocomplete to all 5 emoji options in `/role-panel create` — typing in the emoji field now shows a searchable list of every server custom emoji
- Increased emoji option maxLength from 10 → 100 to accommodate custom emoji strings
- Added `isAutocomplete()` handler in interactionCreate for `role-panel` emoji fields

## [2026-05-06] — Add reaction roles panel system

- New `reactionRoles` Map persisted through full backup save/load cycle
- New `REACTION_ROLES_CHANNEL_ID` constant pointing to channel `1465784739477590088`
- `/role-panel create` (owner-only) — posts an embed with up to 5 role-toggle buttons (emoji + label + role, each configurable) into the roles channel
- Clicking a role button adds the role if the user doesn't have it, or removes it if they do — ephemeral confirmation reply auto-deletes after 5 seconds
- `✏️ Edit Panel` button on every panel (owner-only) — opens a pre-filled modal to update the title, description, and button config (format: `emoji | label | roleId` one per line)
- `buildRolePanelComponents()` helper builds ActionRow arrays from a button list, always appending the Edit button
- Edit modal parses the text input, resolves role IDs from guild cache, and re-edits the live message in place

## [2026-05-05] — Add 30-day challenge system with daily check-ins and auto leaderboard

- New `challenges` Map persisted through full backup save/load cycle
- `/challenge setup title: description: [start_date:]` — owner-only command that posts a challenge announcement in #tracking; start date defaults to tomorrow UTC
- `/challenge progress` — ephemeral view of your joined challenges, days completed, current streak, and days remaining
- `/challenge list` — ephemeral list of all active challenges with participant counts and current day number
- Daily check-in embeds auto-post to #tracking at 09:00 UTC each day for each active challenge, with a single "✅ Done for Today" button
- Clicking Done auto-joins the challenge on first click; duplicate clicks on the same day are blocked
- Check-in embed updates live as participants click Done, showing a growing list of completers
- Leaderboard auto-posts to #tracking on day 31 (midnight after Day 30), ranked by days completed with `█░` progress bars; challenge is then marked inactive

## [2026-05-03] — Fix Apex count lost on bot restart; add /apex-grant command

- `hitApexThisMonth` is now persisted in both the full backup and individual Firestore rankAchievements documents — previously it was always reset to `false` on startup, causing the month-end reset to skip incrementing `apexCount` for anyone who hit Apex after the last deploy
- Backup load (`applyBackupToMemory`) now restores `hitApexThisMonth` from saved data instead of hardcoding `false`
- Added owner-only `/apex-grant @user count` command to manually set a user's Apex count (used to correct counts lost due to the above bug)

## [2026-05-02] — Remove frequency and publicity options from fitness tracker

- Clicking "🏋️ Log a Workout" now opens the workout modal directly — the two-step frequency (Daily/Weekly/Monthly) and privacy (Public/Private) selection screens have been removed
- All workouts are now always posted publicly to #tracking; the private log option is gone
- Entry objects no longer store `freq` or `privacy` fields
- Removed the `📅 Frequency` embed field from new workout posts and both edit flows
- Cleaned up the `/fitness-setup` embed description and removed the Frequency/Privacy info fields
- `/fitness manage` entry list now shows date and duration only (no freq/privacy labels)

## [2026-05-01] — Fix /fitness notify timezone label: London is BST (UTC+1) in summer

- Relabelled UTC+0 option to clarify it is "London GMT — winter only"
- Relabelled UTC+1 option to "London BST / Paris / Berlin — UK summer" so UK users in summer pick the correct offset
- Updated TZ_LABELS to match

## [2026-05-01] — Add notification tick debug logging

- Notification tick now logs the UTC time and active schedule count every minute when any notify schedules exist
- Each schedule that is skipped logs which condition failed (time mismatch, day mismatch, or already sent)
- `/fitness notify` logs the stored timeUtc and daySet when saved

## [2026-05-01] — Fix /fitness notify: day-crossing timezone bug + immediate backup on save

- Fixed day-of-week mismatch for users whose reminder time crosses midnight in UTC: when local → UTC conversion shifts the calendar day (e.g. 10 PM Eastern = 3 AM UTC next day), the stored `daySet` is now adjusted by ±1 day so the tick matches the correct UTC day
- Notification data is now saved to the backup immediately when a reminder is set, preventing data loss if the bot restarts or is deployed within 60 s of the `/fitness notify` command
- Added a `console.log` in the notification tick so successful fires are visible in Fly.io logs for debugging

## [2026-05-01] — Reorder /fitness notify command options (minute before period)

- Moved `minute` option before `period` (AM/PM) in the `/fitness notify` slash command registration so Discord displays options in order: hour → minute → AM/PM → timezone → days

## [2026-05-01] — Fix /fitness interaction timeout: defer before routing

- Moved `deferReply({ flags: MessageFlags.Ephemeral })` to be the absolute first call in the `/fitness` handler, before `getSubcommand()` or any routing logic — this guarantees Discord receives an acknowledgement within 3 s regardless of what follows
- Separated `deferReply` into its own isolated try/catch: if it fails, log and return immediately (token is dead; nothing else can recover it)
- Changed `getSubcommand()` → `getSubcommand(false)` to return `null` instead of throwing when no subcommand is present
- Converted all subcommand responses from `interaction.reply({ flags: 64 })` to `interaction.editReply()` (required since the interaction is now always pre-deferred)
- Replaced raw `flags: 64` with `MessageFlags.Ephemeral` throughout

## [2026-05-01] — Wrap /fitness handler in try/catch to prevent silent failures

- Added try/catch around the entire `/fitness` command body — any unhandled throw now logs the error to Fly.io console and sends an ephemeral "Something went wrong" reply instead of leaving Discord showing "The application did not respond"
- Catch block tries `editReply` first (in case `deferReply` already fired) then falls back to `reply`

## [2026-05-01] — Fix /fitness notify firing alarm immediately on save

- Removed the "test on save" block from the `/fitness notify` handler that was immediately playing the voice alarm and sending a DM every time a reminder was set — reminders now only fire at the scheduled time
- Added 1-minute catch-up window to the notification tick: checks `nowHHMM` and `prevHHMM` (tick − 60s) so a late-firing `setInterval` can't silently skip a reminder minute; `lastSentDate` deduplication prevents double-fires

## [2026-05-01] — Change voice alarm playback from 3× to 2×

- `playsLeft` reduced from 3 → 2 in `playWorkoutAlarm`
- Updated log message and `/fitness alarm-test` ephemeral reply to reflect the new count

## [2026-05-01] — Play voice alarm 3× and remove test-channel logging

- `playWorkoutAlarm` now plays the alarm sound 3 times before leaving the VC — uses a `playsLeft` counter that decrements on each `AudioPlayerStatus.Idle` event and calls `playNext()` (fresh `createAudioResource` per play) until done
- Removed `logFn` parameter and all test-channel message sends from `playWorkoutAlarm` — debug info now goes to Fly.io console only via `console.log`
- Removed `stateChange` and `debug` event listeners that were added for debugging the DAVE E2EE issue (now resolved)
- Simplified `/fitness alarm-test` handler — no longer fetches the test channel or wires up a `logFn`; ephemeral reply now says "🔔 Alarm played (3×)!" or a plain error

## [2026-05-01] — Replace voice alarm sound with iPhone Radar audio file

- Replaced generated 880 Hz sine wave alarm with the bundled `alarm.mp3` (iPhone Radar tone) — ffmpeg now encodes the MP3 file to OGG Opus at startup instead of synthesising a lavfi sine source
- Added `const path = require('path')` and used `path.join(__dirname, 'alarm.mp3')` so the path resolves correctly both locally and inside the Fly.io Docker container (`/app/alarm.mp3`)
- `alarm.mp3` is included in the repo and automatically bundled by the existing `COPY . .` Dockerfile step — no Dockerfile changes needed

## [2026-05-01] — Fix voice alarm: initialize libsodium-wrappers explicitly, add state logging, extend timeout

- Explicitly `require('libsodium-wrappers')` at startup and call `sodium.ready` so the encryption library is fully initialized before any voice connection handshake attempts — missing initialization was likely causing the UDP handshake to stall
- Added `stateChange` listener to `playWorkoutAlarm` so every voice connection state transition is logged to Fly.io console for debugging (`Signalling → Connecting → Ready`)
- Increased `entersState(Ready)` timeout from 5 s → 15 s to tolerate slower Fly.io → Discord voice server round-trips

## [2026-05-01] — Add /fitness alarm-test; minute option now accepts 0–59

- Added `/fitness alarm-test` subcommand — joins the user's current VC and plays the alarm beep immediately, no DM, ephemeral result message; useful for debugging the voice alarm
- Changed `/fitness notify minute` from 4 fixed choices (:00/:15/:30/:45) to a free integer option (0–59) so any minute can be set

## [2026-05-01] — Fix voice alarm: pre-buffer OGG audio at startup, add playback logging

- Pre-generate the alarm OGG Opus clip at bot startup using ffmpeg into a `Buffer` (previously the live ffmpeg pipe had timing issues causing the audio packets to be silently dropped); startup log now shows byte count or an explicit error if libopus is unavailable
- `playWorkoutAlarm` now plays from `Readable.from([ALARM_OGG])` (buffered) rather than a live pipe
- Added `AudioPlayerStatus.Playing` and `.Idle` log lines so Fly.io console confirms whether audio is actually sent
- Added `const { Readable } = require('stream')` at top of file

## [2026-05-01] — Fix voice alarm sound and /fitness notify interaction timeout

- Fixed no-sound bug: switched ffmpeg output from raw s16le PCM (`StreamType.Raw`) to OGG Opus (`StreamType.OggOpus`) — ffmpeg now handles Opus encoding via `libopus`, bypassing unreliable Node-side `opusscript` entirely
- Added `entersState(connection, VoiceConnectionStatus.Ready, 5000)` wait before playing audio — previously the player fired before the voice connection was fully established, which caused the audio to be missed
- Fixed "application did not respond" error on `/fitness notify`: added `interaction.deferReply` at the top of the handler (Discord requires acknowledgement within 3s; joining voice + fetching members was taking longer); switched subsequent `reply()` calls to `editReply()`
- Added `entersState` to voice imports

## [2026-05-01] — Fix workout notifications: bump voice package, replace modal with slash choices, add error logging

- Bumped `@discordjs/voice` from 0.17.0 → 0.18.0 (fixes deprecated Discord voice encryption that was silently preventing voice joins); replaced `tweetnacl` with `libsodium-wrappers` which supports the new AEAD encryption modes Discord now requires
- Replaced `/fitness notify` free-text modal (fragile, UTC offset typos caused silent misfires) with a proper slash command with Discord-choice dropdowns: `hour` (1–12), `period` (AM/PM), `minute` (:00/:15/:30/:45), `timezone` (25 timezone choices), `days` (12 day-pattern choices) — zero parsing, zero typos possible
- The notify handler now runs the test DM + voice alarm immediately on save so the user can confirm both work right away
- Added `VoiceConnectionStatus` to voice imports; added `.on('error')` handlers to voice connection, audio player, and ffmpeg process — errors now log to console instead of being swallowed
- Changed notification tick `catch` from silent `{}` to `console.error(...)` so failures appear in Fly.io logs
- Added `TZ_LABELS` constant for human-readable timezone display in replies
- `/fitness progress` now shows the stored UTC time next to the reminder (e.g. "8:00 AM on Weekdays *(fires at 13:00 UTC)*") so users can verify the conversion is correct

## [2026-05-01] — Add workout edit/delete, Log Another button, and voice alarm

- Added `✏️ Edit` button to every public workout post; clicking it opens a pre-filled modal — on submit, updates the entry in-memory and edits the Discord embed in #tracking (`fitness:edit:{uid}` button + `fitness:edit_modal:{uid}:{msgId}` modal)
- Added `📝 Log Another` button below every public post (reuses `fitness:start` flow) so members don't have to scroll back up to the main button
- Added `/fitness manage` subcommand — shows an ephemeral embed of the 5 most recent entries with two select menus: ✏️ Edit (pre-fills modal) and 🗑️ Delete (also removes the Discord post if public); uses `StringSelectMenuBuilder` with entry ID as value
- Added `playWorkoutAlarm(guild, userId)` — when a workout DM reminder fires, the bot joins the user's current voice channel and plays an 880 Hz sine wave tone via ffmpeg (`lavfi` virtual input → raw PCM → `@discordjs/voice`), then leaves; DM description reflects whether a VC bleep occurred
- Added `@discordjs/voice`, `opusscript`, `tweetnacl` to `package.json`; added `ffmpeg` to Dockerfile `apk add` line

## [2026-05-01] — Add fitness tracking system, workout notifications, and Join-to-Create workout rooms

- Added `fitnessData` and `workoutRooms` Maps with full Discord backup serialization/deserialization in `buildFullBackup` / `applyBackupToMemory`
- Added constants: `FITNESS_TRACKING_CHANNEL_ID`, `FITNESS_VC_TRIGGER_ID`, `FITNESS_DISCUSS_CHANNEL_ID`
- Added helper functions: `parseDurationToMins`, `parseTimeToUtc`, `parseDays`, `calcStreak`, `calcAvgDuration`
- `/fitness-setup` (owner only): posts the persistent "🏋️ Log a Workout" button embed to #tracking
- Workout logging button flow: `fitness:start` → frequency (daily/weekly/monthly) → privacy (public/private) → 5-field modal (workout, duration, weight, energy, notes)
- Public entries post an embed to #tracking with 💪/🔥/👏 reaction buttons, a Discuss thread button, and a delete button; reactor DMs the post owner on click
- Private entries store silently with ephemeral confirmation only
- `/fitness progress` (ephemeral): shows total workouts, current streak, average duration, last 5 entries, and active reminder config
- `/fitness notify`: modal to set workout DM reminders (time + days + UTC offset); sends test DM immediately on save
- `/fitness notify-clear`: removes reminder
- Notification tick added to existing 60s `setInterval`: checks each user's stored UTC time/daySet, sends DM, sets `lastSentDate` to prevent double-send
- `createWorkoutRoom(state)`: triggered when a user joins `FITNESS_VC_TRIGGER_ID`; creates a named voice channel in the FITNESS category with full owner/mod/bot permission overwrites, moves the user in, DMs them rename and user-limit buttons, posts announcement in #discussions
- Workout room lifecycle in `voiceStateUpdate`: join → cancel delete timer; leave → if empty start 60s auto-delete timer
- Startup cleanup: stale workout room channels from pre-restart are deleted and removed from the Map
- `FITNESS_VC_TRIGGER_ID` excluded from XP session-start tracking (pass-through channel)
- `fitness:room:rename` / `fitness:room:limit` DM buttons trigger modals to rename the channel or set a user cap

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
