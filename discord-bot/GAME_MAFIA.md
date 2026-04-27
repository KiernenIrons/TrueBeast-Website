# Beast Bot — Mafia Night
## Full Architecture & Design Document

---

## 1. OVERVIEW

A Discord-native, fully automated Mafia/Werewolf social deduction game designed for
voice-chat game nights. Players sit in voice chat for discussion; the bot handles all
mechanics via a dedicated text channel (#mafia-night) and private DMs.

**No external databases.** State lives in memory, persisted to a local JSON file for
crash recovery. Completed game logs are posted to the Botlogs Discord channel.

---

## 2. GAME STATE MACHINE

```
[IDLE]
  │  /mafia setup (mod creates persistent embed)
  ▼
[LOBBY]
  │  Players click Join. Mod clicks Start (min players met).
  ▼
[STARTING]
  │  Bot assigns roles, sends DMs. ~5 second buffer.
  ▼
[NIGHT]
  │  Night action DMs sent. Actions collected privately.
  │  Timer: 90s (configurable). Auto-advance on all submitted.
  ▼
[NIGHT_RESOLVING]
  │  Actions resolved in order. Results computed (not yet announced).
  ▼
[DAY_ANNOUNCE]
  │  Deaths/survivals posted. No discussion yet. ~10s pause.
  ▼
[DAY_DISCUSSION]
  │  Channel unlocked. Timer: 3 min (configurable). Voice chat active.
  ▼
[DAY_VOTING]
  │  Vote dropdown posted. Timer: 90s. Auto-advance when all vote.
  ▼
[VOTE_RESOLVING]
  │  Votes tallied. Tie → runoff vote (60s). No tie → elimination.
  ▼
[ELIMINATION_REVEAL]
  │  Eliminated player + role revealed. Win conditions checked.
  │
  ├── Win condition met → [GAME_OVER]
  │     Full role reveal. Stats logged. Botlogs posted.
  │
  └── No winner yet → [NIGHT] (loop)
```

---

## 3. PHASE DETAIL

### LOBBY
- Persistent embed in #mafia-night (one message, edited in-place throughout game)
- Shows: rules summary, player list, game status, config (timers, roles enabled)
- Buttons: `[Join Game]` `[Leave Game]` `[Start Game ▶]` (mod only) `[Config ⚙️]` (mod only)
- Constraints: min 5 players, max 20. No joining after game starts.
- Lobby timeout: 30 minutes of inactivity → auto-cancel

### NIGHT PHASE
- Bot edits main embed to show: 🌙 NIGHT PHASE — Round N
- #mafia-night channel permissions set to: send_messages = DENY for @everyone
- Each role with a night action receives a fresh DM with action dropdown
- Mafia receive a combined team DM (all mafia see same interface; first to submit acts for team)
- Timer: 90 seconds. On expire: unsubmitted actions auto-skipped
- "Waiting for actions…" progress shown in embed: "3 / 5 actions submitted"

### NIGHT ACTION RESOLUTION ORDER
```
1. Bodyguard shields activate
2. Doctor protection activates (overrides bodyguard if same target)
3. Serial Killer attacks
4. Mafia attacks (blocked by Doctor/Bodyguard protection)
5. Detective investigation resolves
6. Vigilante shot resolves
```
All results computed simultaneously before any announcement.

### DAY ANNOUNCE
- Channel permissions restored (send_messages = ALLOW)
- Bot posts announcement embed listing:
  - ☠️ Players who died (role NOT revealed yet — only on elimination by vote)
  - 💚 Players who survived attacks (no details on who protected them)
  - Detective privately receives their investigation result via DM

### DAY DISCUSSION
- Bot posts timer embed that counts down (edited every 30s)
- Players debate via voice chat; text channel open for memes/reactions
- Timer: 3 minutes (configurable by mod)
- Mod can `/mafia skip` to end discussion early

### DAY VOTING
- Bot posts voting embed with `[Cast Vote ▸]` button
- Clicking opens a Select Menu (dropdown) listing all ALIVE players
- Player selects target, confirms. Vote is locked.
- Players CAN change vote until timer ends (last selection counts)
- Vote progress shown in embed: "7 / 9 players have voted"
- Votes are ANONYMOUS until reveal (no public vote tracking during)
- Timer: 90 seconds (configurable)
- Dead players: cannot see vote button (ephemeral "you are dead" if they try)

### VOTE RESOLUTION & TIE HANDLING

**Standard:** Highest vote count → eliminated.

**Tie:** Runoff vote immediately.
- Bot posts new embed: "TIE between @PlayerA and @PlayerB — runoff vote! 60 seconds."
- Same mechanics, same players vote
- Second tie → NO elimination this round (announced: "The village couldn't decide.")
- Reason: Runoff adds drama and fairness. No-elimination on double-tie prevents infinite loops.

### ELIMINATION REVEAL
- Bot reveals: eliminated player's name + their role + flavor text
- Example: `"@John was eliminated by the village. He was... a Villager. 😔"`
- Example: `"@Sarah was eliminated. She was... MAFIA. 🔫 The village rejoices!"`
- Jester: `"@Mike was eliminated. He was... the Jester. 🃏 The Jester WINS!"`
- Win condition immediately checked after reveal

### GAME OVER
- Bot posts final embed: winner faction + celebration
- FULL role reveal of all players (living and dead)
- Complete timeline: who died when, what roles were active
- Stats saved to `data/mafia-stats.json`
- Full log posted to Botlogs channel

---

## 4. ROLE SYSTEM

### Standard Roles

| Role | Faction | Night Action | Win Condition |
|---|---|---|---|
| Villager | Village | None | All Mafia eliminated |
| Mafia | Mafia | Kill one player | Mafia ≥ Village alive count |
| Detective | Village | Investigate one player (learns: MAFIA / NOT MAFIA) | All Mafia eliminated |
| Doctor | Village | Protect one player (cannot repeat same target 2 nights in a row) | All Mafia eliminated |

### Optional / Advanced Roles

| Role | Faction | Night Action | Win Condition | Notes |
|---|---|---|---|---|
| Jester | Neutral | None | Get voted out by village | Dies at night = loss |
| Serial Killer | Neutral | Kill one player per night | Last player standing | Villagers AND Mafia must eliminate SK |
| Bodyguard | Village | Protect one player; dies in their place if attacked | All Mafia eliminated | One-time self-sacrifice |
| Mayor | Village | None (passive) | All Mafia eliminated | Vote counts double; role revealed on death |
| Vigilante | Village | Kill one player (2 uses total) | All Mafia eliminated | Killing a villager wastes a use |
| Medium | Village | None during night | All Mafia eliminated | Can read dead player messages in dead chat |
| Godfather | Mafia | None (passive) | Mafia wins | Appears as NOT MAFIA to Detective |

### Role Balancing Algorithm

```
Players 4–5:   1 Mafia, rest Villagers
Players 6–7:   1 Mafia, 1 Detective, rest Villagers
Players 8–9:   2 Mafia, 1 Detective, 1 Doctor, rest Villagers
Players 10–12: 2 Mafia, 1 Detective, 1 Doctor, optional Jester, rest Villagers
Players 13–15: 3 Mafia, 1 Detective, 1 Doctor, 1 Jester, rest Villagers
Players 16–20: 3 Mafia, 1 Godfather, 1 Detective, 1 Doctor, 1 Jester, 1 SK, rest Villagers

Rule: Mafia count = floor(playerCount / 4), min 1, max 4
Special roles added one at a time as player count grows
Never add a special role that would make one faction unwinnable
```

### Win Condition Priority (checked in this order)
```
1. Jester voted out → Jester wins immediately
2. Serial Killer is last non-dead role → SK wins
3. Mafia alive ≥ living Village-faction players → Mafia wins
4. All Mafia dead (and no SK) → Village wins
5. No condition met → continue
```

### Role DM Templates

**Mafia:**
```
🔫 YOU ARE MAFIA
Your goal: Eliminate all villagers.
Your team: @Alice, @Bob (also Mafia)
Each night: Select one player to kill.
During the day: Act innocent. Vote out villagers.
```

**Detective:**
```
🔍 YOU ARE THE DETECTIVE
Your goal: Help the village find the Mafia.
Each night: Investigate one player — you learn if they are MAFIA or NOT MAFIA.
Note: The Godfather (if present) will appear as NOT MAFIA.
Keep your role secret — Mafia will target you if exposed.
```

**Doctor:**
```
💊 YOU ARE THE DOCTOR
Your goal: Keep villagers alive.
Each night: Choose one player to protect. They survive any attack.
You cannot protect the same person two nights in a row.
You may protect yourself.
```

---

## 5. NIGHT ACTION DM INTERFACE

Each action-having role receives a DM containing:
- An embed explaining the action
- A Select Menu (dropdown) listing eligible targets
- A `[Submit Action]` confirm button
- A `[Skip My Action]` button (optional, useful if unsure)

Custom ID format: `mafia:action:{gameId}:{roleType}:{userId}`
This ensures old game's buttons don't affect a new game.

### Mafia Team DM
- ALL mafia members receive the same DM (but each is their own message)
- First mafia member to submit locks the kill target
- Other mafia members are notified: "Kill target locked: @John"
- Their dropdown becomes disabled
- This avoids the need for a "Mafia group chat" channel

### Action Eligibility Rules
| Role | Can target | Cannot target |
|---|---|---|
| Mafia | Any alive non-Mafia | Self, other Mafia members |
| Detective | Any alive player | Self |
| Doctor | Any alive player | Same player as last night |
| Serial Killer | Any alive player | Self |
| Vigilante | Any alive player | Self |

---

## 6. DISCORD INTERACTION ARCHITECTURE

### Persistent Main Embed (edited in-place, never deleted)
Lives in #mafia-night. One message ID stored in game state.

**Lobby state:**
```
┌─────────────────────────────────────┐
│  🌙 MAFIA NIGHT                     │
│  Status: Waiting for players...     │
│                                     │
│  Players (4/5 minimum):             │
│  1. @Alice                          │
│  2. @Bob                            │
│  3. @Charlie                        │
│  4. @Diana                          │
│                                     │
│  Config: 3 min discussion • 90s vote│
│  Roles: Detective, Doctor enabled   │
│  [Join Game 🙋] [Leave Game 🚪]     │
│  [Start Game ▶] [Settings ⚙️]       │
└─────────────────────────────────────┘
```

**Night state:**
```
┌─────────────────────────────────────┐
│  🌙 NIGHT — Round 2                 │
│  The village sleeps...              │
│                                     │
│  Alive (6): Alice Bob Charlie ...   │
│  Dead (2): @Diana (Villager)        │
│            @Eve (Mafia) ☠️          │
│                                     │
│  Actions: ████░░ 4/6 submitted      │
│  Timer: 00:47 remaining             │
└─────────────────────────────────────┘
```

### Interaction Component Types

| Interaction | Component | Where |
|---|---|---|
| Join lobby | Button | Main embed |
| Leave lobby | Button | Main embed |
| Start game | Button (mod only) | Main embed |
| Settings | Button (mod only) | Main embed |
| Cast vote | Button → Select Menu + Confirm | Phase message |
| Night action | Select Menu + Confirm button | DM |
| Change vote | Select Menu (re-select before timer) | Phase message |
| Skip action | Button | DM |
| Mod controls | Ephemeral panel | /mafia command |

### Slash Commands

```
/mafia setup        — post the permanent game embed (mod only)
/mafia start        — force start game (mod only, skips min player check)
/mafia end          — force end current game (mod only)
/mafia pause        — pause current game (mod only)
/mafia skip         — skip current phase timer (mod only)
/mafia kick @player — remove player from game (mod only)
/mafia config       — open settings panel (mod only)
/mafia stats        — show your win/loss record
/mafia leaderboard  — show server leaderboard
/mafia roles        — list all roles and their descriptions (public)
/mafia help         — how to play guide (public)
```

---

## 7. DATABASE / STATE MANAGEMENT

### No external database. Three data stores:

**1. In-Memory (primary, authoritative)**
```js
// One game per guild
const mafiaGames = new Map(); // guildId → MafiaGame instance
```

**2. JSON file (crash recovery)**
Path: `discord-bot/data/mafia-state.json`
Written after every phase transition.
On startup: if file exists and game was in progress → attempt restore.
Format: serialized MafiaGame state (Maps converted to arrays).

**3. Discord channel (permanent log)**
On game end: full log posted to Botlogs channel as embed + JSON attachment.
This is the permanent record — not queryable but searchable in Discord.

**4. Stats JSON (optional leaderboard)**
Path: `discord-bot/data/mafia-stats.json`
Updated on game end.
Format:
```json
{
  "userId": {
    "gamesPlayed": 12,
    "wins": 7,
    "losses": 5,
    "rolesPlayed": { "Mafia": 3, "Detective": 2, "Villager": 7 },
    "timesVotedOut": 4,
    "nightKills": 6
  }
}
```

### MafiaGame State Shape

```js
{
  // Identity
  gameId: string,           // nanoid (used in customIds to invalidate old buttons)
  guildId: string,
  channelId: string,        // #mafia-night
  hostId: string,

  // Phase
  phase: GamePhase,         // enum (see state machine above)
  round: number,            // day number (starts at 1)

  // Players
  players: Map<userId, {
    userId: string,
    name: string,
    role: RoleType,
    alive: boolean,
    protected: boolean,     // reset each night
    lastProtectedBy: string|null,  // for Doctor "can't repeat" rule
    actionTaken: boolean,   // reset each night/vote phase
    vote: string|null,      // current vote target userId
    disconnected: boolean,
    missedActions: number,  // auto-eliminate after 2
  }>,

  // Roles
  // NOTE: role data is also inside players map — this is the lookup index
  roleGroups: {
    mafia: Set<userId>,
    village: Set<userId>,
    neutral: Set<userId>,
  },

  // Night state (reset each night)
  nightActions: {
    mafiaTarget: string|null,       // userId
    mafiaSubmittedBy: string|null,  // which mafia member submitted
    detectiveTargets: Map<userId, string>,  // detective → target
    doctorTargets: Map<userId, string>,     // doctor → target
    skTarget: string|null,
    vigilanteTargets: Map<userId, string>,
  },

  // Voting state (reset each vote phase)
  votes: Map<userId, string>,   // voter → target
  runoffCandidates: string[]|null,

  // UI
  mainMsgId: string,        // persistent embed message ID
  phaseMsgId: string,       // current phase announcement ID
  voteMsgId: string,        // vote embed ID

  // Timers
  phaseTimer: Timeout|null,
  timerDisplay: Timeout|null,   // interval that updates timer in embed

  // Config
  config: {
    minPlayers: 5,
    maxPlayers: 20,
    nightActionTimeout: 90,    // seconds
    discussionTime: 180,       // seconds
    voteTimeout: 90,           // seconds
    runoffTimeout: 60,         // seconds
    rolesEnabled: {
      detective: true,
      doctor: true,
      jester: false,
      serialKiller: false,
      bodyguard: false,
      mayor: false,
      vigilante: false,
      godfather: false,
      medium: false,
    },
    anonymousVoting: true,
    deadChat: false,
    deadChatChannelId: null,
  },

  // Log
  log: [
    { type: 'join'|'death'|'vote'|'action'|'phase', round, timestamp, data },
    ...
  ],

  startedAt: number,
  lobbyIdleTimer: Timeout|null,
}
```

---

## 8. EDGE CASES & FAILURE POINTS

### Player Disconnect / Leave Server

**Scenario:** Player leaves Discord server or loses connection mid-game.

**Detection:**
- `guildMemberRemove` event in index.js → check if userId is in any active game
- `guildMemberUpdate` could detect extended offline (not reliable — don't use)

**Resolution:**
- If in LOBBY: silently remove, update embed
- If in active game (night or day): mark `disconnected: true`
  - They are skipped for night action (treated as "skip")
  - They cannot vote
  - They CAN still be targeted/killed at night (they're still "alive" in game)
  - After 2 consecutive missed action phases: auto-eliminate with message:
    `"@Player left the server and has been eliminated."`
  - Immediately recheck win conditions

---

### Bot Restart Mid-Game

**Prevention:**
- Write `mafia-state.json` after EVERY phase transition (not every action — too frequent)
- File is written synchronously or with immediate flush

**Recovery on startup:**
1. Check if `mafia-state.json` exists and `phase !== 'idle'`
2. Attempt to fetch guild, channel, all player members
3. Re-fetch main message by ID (to confirm it still exists)
4. Post: "⚠️ Bot restarted — attempting to resume game..."
5. If `phase === 'night'`: re-send night action DMs to players who hadn't acted
6. If `phase === 'day_voting'`: re-post vote message
7. Resume phase timers with remaining time (stored in state)

**If recovery fails** (message deleted, channel gone, etc.):
- Post to any available channel: "Game was cancelled due to bot restart."
- Clear state file

---

### Interaction Token Expiration (15-minute Discord limit)

**Problem:** Discord interaction tokens expire after 15 minutes.
Night actions are DMs that stay up for potentially hours.

**Solution:**
- Night action DMs are **NOT** sent as interaction responses
- They are sent as **new bot DM messages** triggered by the phase start
- Buttons/selects in these messages use `messageCreate` → collect via `createMessageComponentCollector` OR use `client.on('interactionCreate')` with custom IDs
- Custom ID includes `gameId` — if gameId doesn't match current game, silently ignore
- On timeout: collector ends, phase advances, DM is edited to show "⏱️ Time expired"

**Pattern:**
```
Phase starts → bot.users.fetch(uid) → user.send({ embeds, components })
Interaction comes in → validate gameId + phase + player status → process
```
This completely avoids the interaction token expiration problem.

---

### Duplicate Votes / Actions

**Vote:**
- `votes.has(voterId)` check before recording
- If already voted: update vote to new target (last vote wins), reply ephemeral:
  `"Vote changed to @NewTarget"`
- Once timer expires: votes are locked, new interactions ignored

**Night actions:**
- `actionTaken` flag on PlayerState
- Once set to true, second action attempt → ephemeral: "You already submitted your action."
- Exception: Mafia team — if mafiaTarget is already set, inform other mafia members

---

### Voting for Eliminated / Dead Player

**Prevention by design:**
- Vote dropdown lists ONLY `alive: true` players
- Even if someone spams an old interaction: server-side `alive` check before recording vote

---

### Mafia Kill + Doctor Protect Same Target

**Resolution:**
```
if (mafiaTarget === doctorTarget) {
  // Player survives
  morningAnnouncement.push({ type: 'survived', userId: mafiaTarget });
  // No death
} else {
  // Player dies
  kill(mafiaTarget);
  morningAnnouncement.push({ type: 'killed', userId: mafiaTarget });
}
```

---

### Serial Killer + Mafia Same Target

Both attack same player → player dies once. SK gets attribution (since SK resolves first).

---

### Doctor Protecting Same Person Twice

Tracked via `lastProtectedBy` field. If Doctor tries to select same target:
- Dropdown should gray out that option (provide disabled option in select)
- If somehow submitted anyway: server-side check, reject with ephemeral error

---

### Host Leaves Mid-Game

1. Check if `hostId` matches `guildMemberRemove` userId
2. Find next available mod/admin in the guild: `guild.members.fetch()` → find role
3. If no mod available: promote first player in join order
4. DM new host: "You are now the game host. Use /mafia commands to control the game."
5. Update `hostId` in game state

---

### Minimum Player Drop (players leave mid-game)

If alive player count drops below 2 → game ends immediately with a draw.
Announce: "Not enough players remain. Game over — no winner."

---

### All Mafia Disconnected

Treat disconnected mafia as having no kill action that night (same as skip).
Village gets a free night. Recheck win conditions normally.

---

### Timer Drift / Long Delays

Use `Date.now()` timestamp to track when phase started, not just setTimeout.
Timer display calculates remaining time as `(startedAt + duration) - Date.now()`.
This prevents timer from showing wrong values after bot hitch.

---

### Players Trying to Screenshot DM Roles

**Technical:** Cannot prevent screenshots.

**Design mitigations:**
- Roles sent in plain DM text (no embedded images that are harder to screenshot discretely)
- Actually, this doesn't matter — social trust in a Discord game night is self-enforced
- Rule communicated in /mafia help: "Sharing your role DM is against game rules and ruins the fun"
- Mods can use `/mafia kick @player` to remove confirmed cheaters
- Consider: Detective knowing someone is Mafia but not being able to prove it publicly is a FEATURE

---

### Large Game (16-20 players) Discord Rate Limits

Sending 20 DMs simultaneously hits Discord rate limits.

**Solution:** Stagger DM sends with 100-200ms delay between each.
```js
for (const [uid, player] of game.players) {
  await sendRoleDM(uid, player);
  await new Promise(r => setTimeout(r, 150)); // 150ms gap
}
```

---

### `interactionCreate` Event Flooding

With 20 players all clicking simultaneously, event handler must be fast.

**Solution:**
- Phase + player validation is O(1) Map lookup — no async needed
- Database writes (JSON file) are async and don't block response
- Defer interactions immediately: `interaction.deferReply({ ephemeral: true })`
- Process action, then editReply

---

## 9. SECURITY & ANTI-CHEAT

| Threat | Mitigation |
|---|---|
| Non-player clicking game buttons | Check `game.players.has(userId)` before any action |
| Dead player voting | Check `player.alive === true` before recording vote |
| Double voting | `votes.has(userId)` check; last vote wins (by design) |
| Double night action | `actionTaken` flag; set immediately on first submission |
| Old game buttons affecting new game | `gameId` in all custom IDs; mismatch → silently ignore |
| Mod controls by non-mods | `userId === OWNER_DISCORD_ID \|\| member.roles.cache.has(MOD_ROLE_ID)` check |
| Role reveal in public channel | Bot NEVER posts role info in public channel during game |
| Parallel game creation | `mafiaGames.has(guildId)` check before starting new game |
| Interaction replay attacks | Phase check + `actionTaken` makes replay a no-op |
| Flooding with fake interactions | Discord gateway handles this; bot-side: early return on invalid state |
| Bot account impersonation | Irrelevant — bot messages are always from the registered bot account |

---

## 10. CHANNEL PERMISSION MANAGEMENT

### Night Phase → Lock Channel
```js
await channel.permissionOverwrites.edit(guild.roles.everyone, {
  SendMessages: false,
  AddReactions: false,
});
// Bot explicitly allowed:
await channel.permissionOverwrites.edit(guild.members.me, {
  SendMessages: true,
});
```

### Day Phase → Unlock Channel
```js
await channel.permissionOverwrites.edit(guild.roles.everyone, {
  SendMessages: null,  // null = inherit from parent
  AddReactions: null,
});
```

**Note:** This requires the bot to have `Manage Channels` permission.
If mod doesn't want to grant this: skip locking, add note to rules that players should
stay quiet at night (self-enforced, works fine for established communities).

---

## 11. DEAD CHAT (Optional)

If `config.deadChat = true` and `config.deadChatChannelId` is set:

1. On elimination: grant the dead player access to dead chat channel
2. Dead players can discuss freely there (they know who's alive and can watch drama)
3. Dead players CANNOT communicate back to living players
4. Medium role: can read a limited number of dead chat messages per night

Implementation: manage per-user channel permission overwrite on the dead chat channel.

---

## 12. MODERATOR CONTROL PANEL

All mod controls are via `/mafia` slash commands with ephemeral responses.

```
/mafia end          → posts confirmation button → confirmed → game ends with "Game cancelled by mod"
/mafia pause        → stops all timers, posts "Game paused by mod — /mafia resume to continue"
/mafia resume       → resumes timers with remaining time
/mafia skip         → immediately fires the current phase timer callback
/mafia kick @user   → eliminates player, reveals role, rechecks win conditions
/mafia config       → opens ephemeral settings embed with buttons to toggle roles/timers
/mafia reveal @user → (owner only) privately reveals a player's role to the mod (for dispute resolution)
```

---

## 13. GAME LOGGING

### During Game
All significant events appended to `game.log[]`:
```js
{ type: 'PHASE_CHANGE', round: 1, phase: 'NIGHT', timestamp: 1234567890 }
{ type: 'NIGHT_ACTION', round: 1, actor: 'uid1', role: 'MAFIA', target: 'uid2' }
{ type: 'NIGHT_ACTION', round: 1, actor: 'uid3', role: 'DOCTOR', target: 'uid2' }
{ type: 'NIGHT_RESULT', round: 1, attacked: 'uid2', protected: true, died: false }
{ type: 'VOTE', round: 1, voter: 'uid4', target: 'uid5' }
{ type: 'ELIMINATION', round: 1, userId: 'uid5', role: 'VILLAGER', method: 'vote' }
{ type: 'WIN', winner: 'VILLAGE', survivors: ['uid1', 'uid3'], round: 2 }
```

### On Game End → Post to Botlogs
Bot posts an embed to LOG_CHANNEL_ID (Botlogs) containing:
- Game summary (winner, rounds, player count)
- Full player list with roles
- Timeline of deaths

Optionally attach the full `game.log` as a JSON file for archival.

---

## 14. RECOMMENDED FILE STRUCTURE

```
discord-bot/
│
├── index.js                        ← main bot (add mafia module require here)
│
├── games/
│   └── mafia/
│       ├── MafiaGame.js            ← game state class (single source of truth)
│       ├── roles.js                ← role definitions, balancing, DM templates
│       ├── commands.js             ← slash command definitions for /mafia
│       ├── handlers.js             ← interactionCreate routing (all imp: customIds)
│       ├── persistence.js          ← JSON file read/write, crash recovery
│       ├── logger.js               ← Botlogs channel posting
│       │
│       ├── phases/
│       │   ├── lobby.js            ← join/leave/start, lobby embed, settings
│       │   ├── night.js            ← night start, DM sends, action collection
│       │   ├── resolution.js       ← night action resolution logic (pure functions)
│       │   ├── day.js              ← death announcements, discussion timer
│       │   ├── voting.js           ← vote collection, tally, runoff logic
│       │   └── elimination.js      ← reveal, win condition check, game end
│       │
│       └── ui/
│           ├── embeds.js           ← all embed builders (pure functions, no side effects)
│           └── components.js       ← button/select/modal builders (pure functions)
│
└── data/
    ├── mafia-state.json            ← active game (written each phase change)
    └── mafia-stats.json            ← cumulative player stats (written on game end)
```

### Why This Structure

- **Phases are isolated:** each phase file exports `enter(game, client)` and optionally `exit()`.
  Transitions are: `await enterNight(game, client)` — clean and testable.
- **Pure UI functions:** embed builders take `game` as input, return embed object. No Discord calls inside.
  This makes future refactors easy and prevents accidental double-posts.
- **Handlers.js is thin:** just routes `interaction.customId` to the right phase handler.
  All real logic lives in phase files.
- **MafiaGame.js owns state:** no raw object literals — a class with methods like
  `game.killPlayer(uid)`, `game.recordVote(voterId, targetId)`, `game.checkWinConditions()`.
  This prevents state mutation bugs across files.

---

## 15. INTEGRATION WITH EXISTING BOT

The existing `discord-bot/index.js` needs minimal changes:

```js
// Near top of index.js
const mafiaModule = require('./games/mafia/handlers');

// In interactionCreate handler (before the if (!interaction.isButton()) return):
if (interaction.customId.startsWith('mafia:') || interaction.commandName === 'mafia') {
  return mafiaModule.handle(interaction, client);
}

// In clientReady, add mafia commands to the commands array:
...require('./games/mafia/commands').definitions,

// In guildMemberRemove event:
mafiaModule.handleMemberLeave(member, client);
```

This keeps the main file clean and the game fully self-contained.

---

## 16. OPTIONAL ADVANCED FEATURES (Recommended Future Additions)

### Spectator Mode
- Players who join server mid-game can `/mafia spectate`
- Bot grants them read access to the dead chat channel (if enabled)
- Spectators see the full game but cannot interact
- Spectators see what the audience sees (deaths, not roles)

### Custom Role Packs
```js
// Stored in data/mafia-rolepacks.json
{
  "horror": {
    "name": "Horror Night",
    "roles": { "mafia": "Vampires", "detective": "Van Helsing", ... },
    "flavour": "dark"
  }
}
```
`/mafia config rolepack horror` → renames roles for the session. Purely cosmetic.

### Ranked Leaderboard
- Track wins per role type
- Season system: reset quarterly
- `/mafia leaderboard` shows top 10 by win rate (min 5 games played)

### Anonymous Voting Mode
- All votes hidden until reveal
- Bot DMs each player their confirmed vote (receipt)
- Reveal shows all votes simultaneously at the end

### Ghost Votes (Dead Chat Influence)
- Dead players can vote on a "Ghost Poll" each day
- Result shown to living players as a mysterious hint: "The spirits favor @Alice..."
- Ghost votes don't count for elimination but create social pressure

### Game Replay
- Full log stored in JSON lets you reconstruct the entire game
- Future: web interface at truebeast.io/mafia/replay/{gameId}

---

## 17. IMPLEMENTATION RECOMMENDATIONS

### What to Build First (MVP)
1. Lobby system (Join/Leave/Start embed)
2. Role assignment (Villager + Mafia only) + DMs
3. Night phase (Mafia kill only, no specials)
4. Day announce + voting
5. Win condition detection (basic)
6. Botlogs posting

Test with 5 players (2 Mafia, 3 Villagers). Get the loop working before adding special roles.

### What to Build Second
1. Detective + Doctor night actions
2. Timer system with live embed updates
3. Tie runoff
4. Jester
5. Crash recovery

### What to Build Third (polish)
1. Channel locking (night phase)
2. Dead chat
3. Stats / leaderboard
4. Mod controls panel
5. Serial Killer + advanced roles

### Technology Choices

| Decision | Recommendation | Reason |
|---|---|---|
| State persistence | JSON file | Simple, no deps, sufficient for one active game |
| Stats storage | JSON file | Simple; if it grows large, migrate to SQLite later |
| Timer management | setTimeout + Date.now() for display | Reliable, easy to pause/resume |
| DM action collection | New bot messages (not interaction followups) | Avoids 15-min token expiry |
| Vote UI | Select menu + Confirm button | Prevents accidental votes; allows changing mind |
| Embed updates | Edit in-place (never delete+repost) | Cleaner UX, no notification spam |
| Custom ID format | `mafia:{action}:{gameId}:{extra}` | GameId invalidates stale buttons |
| File architecture | Modular (games/mafia/) | Index.js is already 7000+ lines |
| Night action DMs | Staggered 150ms apart | Avoid Discord rate limits with large lobbies |

### Performance Notes
- One game per server = one Map entry per guild
- All lookups are O(1) Map operations
- JSON file writes are async (don't block interactions)
- Timer intervals (for countdown display) should update every 30s not every 1s (reduces API calls)
- Embed updates throttled: don't edit more than once per 2 seconds (Discord rate limit on edits)

---

## 18. FAILURE POINT ANALYSIS (Summary)

| Failure | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bot restart mid-game | Medium | High | JSON persistence + startup recovery |
| Player DM blocked | Low-Medium | Medium | Catch error, remove player, announce |
| Interaction token expired | High (long nights) | High | Use fresh DM messages, not interaction replies |
| Discord API outage | Very Low | Total | Nothing to do; game cancels gracefully |
| 20 DMs rate limited | Medium (large game) | Low | 150ms stagger between DMs |
| Embed edit rate limited | Medium | Low | Throttle updates to max 1 per 2s |
| Host leaves | Low | Medium | Auto-promote, notify new host |
| All mafia disconnect | Very Low | Medium | Treat as skip; village gets free night |
| Win condition not triggered | Low (bug risk) | High | Test every win condition combination |
| State corruption | Low | High | JSON file is write-on-transition, not write-on-action |
| Dead player voting | Very Low | Low | Server-side alive check prevents it |
| Stale button from old game | Medium | Low | gameId in customId; mismatch = ignore |

---

*Document version: 1.0 — Created for TrueBeast Beast Bot*
*Channel: #mafia-night (ID to be configured on setup)*
*See also: GAME_IMPOSTER.md for the simpler question-based Imposter game*
