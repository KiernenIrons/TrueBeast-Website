# Security overhaul — what changed

This is the plain-language list of every change made for the gradual-access / anti-abuse / reporting overhaul. Code changes are in `discord-bot/index.js`; the one-time Discord permission setup is a separate script you already ran.

**Status: live.** The `🔓 Verified` role exists, `@everyone`'s permissions are updated, the AutoMod link rule is created, `MEDIA_UNLOCK_ROLE_ID` is set on Fly, and the bot is deployed and running this code.

---

## 1. New role: 🔓 Verified

A permanent role, separate from the visible Bronze/Silver/Gold rank badges. It's the thing Discord's own permission system actually keys off, because the rank badges reset every month and can't express "this rank or higher" in a channel permission — Verified never resets and is only removed by a mod restriction.

## 2. Media unlock rule (changed from the original brief)

You asked for **Silver I** as the unlock rank (not Bronze II as originally drafted). A member gets 🔓 Verified automatically once **all three** are true:

- Reached Silver I's XP threshold (240 XP)
- Been in the server at least **72 hours**
- Had real, rate-limited activity on **3 separate days**

These three numbers are adjustable live with `/security config threshold set` — no redeploy needed.

Existing members already at Silver I or higher were grandfathered in when the setup script ran — nobody who was already active lost access.

## 3. Anti-farming guards on chat XP

- At most one XP-eligible message per minute per person.
- A message identical to one of your last few doesn't count (stops copy-paste farming).
- No XP while you're timed out or under an open security restriction.

These guards only throttle **rank progression** (a new, separate counter). `/rank`, `/profile`, the leaderboard, and message milestones (100/500/1000 msgs) still count every message exactly like before — they were never rate-limited. Only how fast someone can climb the Bronze→Apex ranks or reach Silver I for media unlock is throttled.

One small, expected wrinkle right after deploy: rank-progression XP started this new counter from zero, so for the rest of that calendar month, everyone's message-based rank progress looked like it "reset" (voice/reaction XP and cosmetic ranks were untouched — nobody was demoted). It self-corrects as people keep chatting, and resets naturally every month anyway.

## 4. Automatic spam containment

Four triggers, each applying the same thing: a 10-minute timeout, progression frozen, and one staff alert (never an automatic ban):

| Trigger | Default threshold |
|---|---|
| Message flooding | 5 messages in 10 seconds |
| Cross-channel copy-paste spam (including via message edits) | 3 identical messages across 2+ channels in 30 seconds |
| Repeated AutoMod link blocks | 3 blocked attempts in 60 seconds |
| Rapid join surge | 5 joins in 60 seconds — **alert only**, suggests `/security lockdown`, never auto-bans |

Multiple triggers on the same person get merged into one alert instead of spamming staff. All four apply to everyone, not just new members — a long-time member's compromised account is covered too. All thresholds are adjustable via `/security config`.

This sits alongside (doesn't replace) the bot's existing heavier quarantine system for the more serious stuff it already catches (15+ msgs/60s flooding, mass-mentioning, DM-soliciting new accounts).

## 5. New mod commands: `/security`

- `/security restrict <member> <reason> [duration]` — timeout + freeze progression + open a case
- `/security release <member> [reason]` — close the case, remove the timeout if still active
- `/security lockdown [channels] [reason]` — stop ordinary posting in public channels; only touches the specific permission fields it changes, so anything else a mod adjusts mid-incident survives the later restore
- `/security restore` — reverses the last lockdown exactly
- `/security config media-channel|lockdown-channel|threshold` — the tunable knobs

All restricted to the existing mod role (or the server owner) — same check every existing mod command uses. None of these can grant roles or touch admin permissions; they only ever apply/remove the one fixed Verified role, timeouts, and specific channel permission fields.

Every case is written to Firestore immediately (not on the usual 60-second cycle), so a restart or a timeout naturally expiring never silently erases it — only `/security release` closes a case.

**Command responses are public**, same as `/ban` etc. — see section 9.

## 6. Reporting: `/report` and right-click → "Report Message"

- Private — only the reporter and staff (mod channel) ever see it. This one stays private on purpose, even though most other command responses were made public (section 9) — making a report public would defeat the point of it.
- Categories include **"Unwanted or inappropriate DM"**, which gets an extra reply explaining how to block the sender and report the DM to Discord directly (the bot can't see or act on DMs between other members).
- Never copies attachments into the report — just a message link.
- New `/privacy-tips` command explains how to turn off "Allow direct messages from server members" — a setting only the member themselves controls. Unlike `/report`, this one **is public**.
- Nothing here asks anyone for an age, or to forward images as evidence.

## 7. Discord permission changes (already applied)

Everything above (except this section) is bot logic. The actual "new members can't post media" guarantee comes from Discord's own permission system, so it holds even if the bot is offline. This was set up by running:

```
cd discord-bot
node scripts/setup-security-permissions.js --dry-run   # reviewed first
node scripts/setup-security-permissions.js             # then applied
```

That script:
1. Created the 🔓 Verified role
2. Removed from `@everyone`, and granted to Verified: thread creation, voice messages, TTS, polls, soundboard, external sounds, screen share/video, activities, and external-app message posting
3. Removed from `@everyone` only (channel-scoped, not granted anywhere by default): attachments, embedded links/GIFs, external stickers, external emojis
4. Audited the VIP role and the Server Booster role — neither granted any of the restricted permissions, so nothing needed stripping
5. Reported (without changing) other roles that carry those permissions — Admin/Owner/Bots (expected, full-permission roles) and every rank role Silver I and above, which already had `UseExternalApps` granted directly (harmless overlap since those members get it via Verified anyway)
6. Created the native AutoMod link-block rule, exempting Mods and Verified members
7. Grandfathered in the 21 members who were already Silver I+ at the time

It does **not** set per-channel media overwrites — designate your media/meme/gaming channels with `/security config media-channel add #channel`, and grant `Attach Files`/`Embed Links` to 🔓 Verified on those specific channels in Discord (the command reminds you of this each time).

## 8. Automatic NSFW detection — images and links

Runs entirely on the bot — no paid API, no per-image cost, nothing to sign up for.

**Uploaded images:**
1. The bot scans every image attachment against a model that classifies for Porn/Hentai/Sexy/Drawing/Neutral content.
2. If it's flagged (Porn + Hentai confidence ≥ 80% by default), the message is **deleted immediately**.

**Links** (added after a live test caught a real gap — see below): every link in a message is checked two ways:
1. **Known adult domains** (pornhub, xvideos, xhamster, and ~30 others) are blocked outright, no scanning needed.
2. Any direct image/GIF link **not** on that list still gets run through the same classifier as uploads.

This applies to **everyone, including `🔓 Verified` members and mods** — deliberately no rank exemption, because this is a content-policy check (is this link to known adult content), completely separate from the rank-based "can this person post links at all" AutoMod rule, which does still exempt Verified/Mods on purpose.

Either way, once flagged:
- Logged as an infraction — visible in `/infractions` and referenced automatically in the `/ban` log if that person is later banned.
- **First offense** (up to your quarantine threshold): a 10-minute timeout, same mechanism as the other automatic containment triggers.
- **Repeat offense** (2+ within 7 days by default): full **quarantine** — the existing system that strips their roles and requires them to explain themselves in the quarantine channel before a mod manually restores anything. If they never give an adequate explanation, they simply stay quarantined (and after 48h with no response at all, the bot's existing auto-ban safeguard kicks in, same as it always has).

Sensitivity, the timeout length, and how many violations trigger quarantine are all adjustable via `/security config threshold set` (types `nsfw` and `nsfw-quarantine-after`); the blocked-domain list is extendable with `/security config nsfw-domain add <domain>` — check current values with `/security config show`.

**What it does not do, on purpose:** it never re-uploads, reposts, or stores the deleted image anywhere, including in mod logs — only metadata (who, when, which channel, confidence score/domain) is kept. If an image ever looked like it could be child sexual abuse material, the correct move is reporting it directly to Discord Trust & Safety (and NCMEC, where required), not preserving it internally — nothing in this system does that reporting for you, so that step is still on you/your mod team if it ever comes up.

**What caught the gap:** you tested with your own alt account, which already holds Verified — the link went through because Verified members are *supposed* to be able to post ordinary links, and at that point nothing checked what the link actually pointed to. The domain blocklist above closes that specific hole. It's still not exhaustive — new adult sites appear constantly — so treat the blocklist as a strong baseline you can extend via `/security config nsfw-domain add`, not a guarantee. It also doesn't (yet) scan images that show up purely as Discord's own auto-generated link-preview embeds without a direct file extension in the URL (e.g. some Tenor pages) — say the word if a gap like that shows up in testing and I'll close it the same way.

## 9. Mod command responses are public again

`/ban`, `/tempban`, `/kick`, `/mute`, `/tempmute`, `/unmute`, `/unban`, `/warn`, and `/security restrict`/`release`/`lockdown`/`restore` now post their confirmation to the channel where the command was run, visible to everyone — not just the mod who ran it. `/privacy-tips` is public too.

Left private on purpose: `/report`, the "Report Message" context action, and any "❌ Mods only" permission-denied replies. Everything else the bot already sends privately (game-related messages, personal stat lookups, `/security config` tuning confirmations, `/infractions` lookups, etc.) is untouched — only the moderation-action confirmations changed.

## What's left

1. ~~Run the setup script~~ — done.
2. ~~Add `MEDIA_UNLOCK_ROLE_ID` to Fly secrets~~ — done.
3. Pick your media/meme/gaming channels and run `/security config media-channel add` for each, then grant the channel-level permission in Discord.
4. Optionally set `/security config lockdown-channel add` for your main public channels, so `/security lockdown` works with no arguments during an incident.
5. Test a harmless link as a non-Verified test account to confirm AutoMod blocks it before trusting it.
6. Work through the test checklist (fresh member restrictions, VIP/booster bypass removal, bot-offline behavior, cross-channel spam containment, non-mod command rejection, restart/rejoin persistence, report privacy, lockdown/restore, and now NSFW auto-deletion + escalation).
