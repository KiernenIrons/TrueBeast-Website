# Security overhaul — what changed

This is the plain-language list of every change made for the gradual-access / anti-abuse / reporting overhaul. Code changes are in `discord-bot/index.js`; the one-time Discord permission setup is a separate script you run yourself.

**Nothing here is live yet.** The bot code is ready, but the actual Discord permission changes only happen when you run `scripts/setup-security-permissions.js` (see "What you still need to do" below).

---

## 1. New role: 🔓 Verified

A permanent role, separate from the visible Bronze/Silver/Gold rank badges. It's the thing Discord's own permission system actually keys off, because the rank badges reset every month and can't express "this rank or higher" in a channel permission — Verified never resets and is only removed by a mod restriction.

## 2. Media unlock rule (changed from the original brief)

You asked for **Silver I** as the unlock rank (not Bronze II as originally drafted). A member gets 🔓 Verified automatically once **all three** are true:

- Reached Silver I's XP threshold (240 XP)
- Been in the server at least **72 hours**
- Had real, rate-limited activity on **3 separate days**

These three numbers are adjustable live with `/security config threshold set` — no redeploy needed.

Existing members already at Silver I or higher get grandfathered in automatically by the setup script — nobody currently active loses access.

## 3. Anti-farming guards on chat XP

- At most one XP-eligible message per minute per person.
- A message identical to one of your last few doesn't count (stops copy-paste farming).
- No XP while you're timed out or under an open security restriction.

These guards only throttle **rank progression** (a new, separate counter). `/rank`, `/profile`, the leaderboard, and message milestones (100/500/1000 msgs) still count every message exactly like before — they were never rate-limited. Only how fast someone can climb the Bronze→Apex ranks or reach Silver I for media unlock is throttled.

One small, expected wrinkle right after deploy: rank-progression XP starts this new counter from zero, so for the rest of the current calendar month, everyone's message-based rank progress looks like it "reset" (voice/reaction XP and cosmetic ranks are untouched — nobody is demoted). It self-corrects as people keep chatting under the new counter, and resets naturally every month anyway.

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

## 6. Reporting: `/report` and right-click → "Report Message"

- Private — only the reporter and staff (mod channel) ever see it.
- Categories include **"Unwanted or inappropriate DM"**, which gets an extra reply explaining how to block the sender and report the DM to Discord directly (the bot can't see or act on DMs between other members).
- Never copies attachments into the report — just a message link.
- New `/privacy-tips` command explains how to turn off "Allow direct messages from server members" — a setting only the member themselves controls.
- Nothing here asks anyone for an age, or to forward images as evidence.

## 7. Discord permission changes (script, not automatic)

Everything above is bot logic. The actual "new members can't post media" guarantee comes from Discord's own permission system, so it holds even if the bot is offline — that requires running:

```
cd discord-bot
node scripts/setup-security-permissions.js --dry-run   # review first
node scripts/setup-security-permissions.js             # then apply
```

That script:
1. Creates the 🔓 Verified role (prints its ID — put it in `.env` / Fly secrets as `MEDIA_UNLOCK_ROLE_ID`)
2. Removes from `@everyone`, and grants to Verified: thread creation, voice messages, TTS, polls, soundboard, external sounds, screen share/video, activities, and external-app message posting
3. Removes from `@everyone` only (channel-scoped, not granted anywhere by default): attachments, embedded links/GIFs, external stickers, external emojis
4. Audits and strips the same restricted permissions from the VIP role and the Server Booster role, if they grant any
5. Reports (without changing) any other role — including self-selected/reaction-role-panel roles — that grants those permissions, so you can review manually
6. Creates a native AutoMod rule blocking links, exempt for mods and Verified members — **test it against a harmless message before relying on it**
7. Grandfathers in every current Silver I+ member

It does **not** set per-channel media overwrites — designate your media/meme/gaming channels with `/security config media-channel add #channel` once the bot's running, and grant `Attach Files`/`Embed Links` to 🔓 Verified on those specific channels in Discord (the command reminds you of this each time).

## What you still need to do

1. Run the setup script (dry-run first).
2. Add `MEDIA_UNLOCK_ROLE_ID` to Fly secrets.
3. Pick your media/meme/gaming channels and run `/security config media-channel add` for each, then grant the channel-level permission in Discord.
4. Optionally set `/security config lockdown-channel add` for your main public channels, so `/security lockdown` works with no arguments during an incident.
5. Test a harmless link as a non-Verified test account to confirm AutoMod blocks it before trusting it.
6. Work through the test checklist in the implementation plan (fresh member restrictions, VIP/booster bypass removal, bot-offline behavior, cross-channel spam containment, non-mod command rejection, restart/rejoin persistence, report privacy, lockdown/restore).
