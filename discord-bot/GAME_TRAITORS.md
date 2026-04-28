# Beast Bot — The Traitors Game

## Overview

A social deduction game inspired by **The Traitors** TV show.

Players are secretly assigned as **Traitors** or **Faithfuls**. Traitors know each other; Faithfuls know nothing. Traitors hunt Faithfuls by night; Faithfuls try to vote out Traitors by day.

**Channel:** `1498657971994099825` (`#traitors-game`)
**Commands:** `/traitors start` · `/traitors stop` · `/traitors status` · `/traitors help`

---

## Game Flow

```
/traitors start
     │
     ▼
[LOBBY]  15-min auto-cancel timer
  Join / Leave / toggle options / host presses Start (min 4 players)
     │
     ▼
Role Assignment  → DM all players their role (Traitor or Faithful)
     │
     ▼  ─────────── ROUND LOOP (game.round++) ───────────
     │
     ▼
[NIGHT]  channel: dramatic "castle sleeps" embed
  • if shieldChallenge: DM one random Faithful "you are shielded"
  • DM each Traitor: StringSelectMenu with Murder [Name] options
  • if trtCanRecruit (1 Traitor, ≥4 living, recruitmentTwist ON): also add Recruit options
  • Votes collected via DM select menu
  • Host: "Resolve Night" button (force-resolve if Traitors are AFK)
     │
     ▼
trtResolveNight()
  murder → victim.alive=false → trtCheckWin() → trtStartMorning()
  recruit → DM target Faithful (Accept/Decline, 5-min timer)
             Accept → promote to Traitor, night passes safely
             Decline / timeout → night passes safely (Traitor's gamble)
     │
     ▼
[MORNING]  announce murder (or "castle is safe") → auto-advance to discussion after 4s
     │
     ▼
[DISCUSSION]  5-min countdown, bot posts warnings at 3min/1min/30sec
  host "Skip Discussion" button → opens vote early
     │
     ▼ (auto at 5 min or host skips)
[BANISHMENT VOTE]  3-min timer
  StringSelectMenu posted in channel (everyone can see)
  votes counted live → auto-tally when all living players have voted
  host "Reveal Result" button to force early resolve
     │
     ▼
trtResolveBanishment()
  majority → banished (alive=false)
  tie → deadlock, no banishment
  → trtCheckWin()
     │
     ├── Faithfuls win (0 Traitors) → trtEndGame('faithful')
     ├── Traitors win (Traitors ≥ Faithfuls) → trtEndGame('traitors')
     └── continue → back to [NIGHT]
```

---

## State Design

### Maps (near line 200, after IMPOSTER_QUESTIONS)

```js
const traitorGames     = new Map(); // channelId → GameState
const traitorPlayerMap = new Map(); // userId → channelId (reverse lookup)
```

### GameState Object

```js
{
  channelId:         string,           // TRT_CHANNEL_ID
  hostId:            string,
  phase:             'lobby'|'night'|'morning'|'discussion'|'vote'|'ended',
  round:             number,           // starts at 0, incremented at discussion phase

  players:           Map<userId, PlayerState>,
  traitorIds:        Set<string>,      // living Traitors (rebuilt by trtUpdateRoleSets)
  faithfulIds:       Set<string>,      // living Faithfuls

  // Night state
  nightVotes:        Map<traitorId, { action: 'murder'|'recruit', targetId: string }>,
  nightMurdered:     string|null,
  shieldedPlayerId:  string|null,
  recruitPending:    boolean,
  recruitTarget:     string|null,
  dmFailedIds:       Set<string>,      // Traitors who couldn't be DMed

  // Vote state
  banishmentVotes:   Map<voterId, targetId>,

  // Message IDs
  statusMsgId:       string|null,      // persistent embed (edited each phase)
  hostMsgId:         string|null,      // host-only controls message
  voteMsgId:         string|null,      // vote select menu message

  // Timers
  lobbyTimer:              Timeout|null,
  phaseTimer:              Timeout|null,   // discussion/vote countdown
  discussionWarningTimers: Timeout[],      // [3min, 1min, 30sec] warning edits
  recruitTimer:            Timeout|null,   // 5-min recruit offer timer

  // Options (set in lobby)
  options: {
    hiddenRoleReveal: boolean,   // default false
    shieldChallenge:  boolean,   // default false
    recruitmentTwist: boolean,   // default true
  },

  // Game log (posted at end)
  log: {
    murders:      Array<{ round, victimName, victimRole }>,
    banishments:  Array<{ round, targetName, targetRole, votes }>,
    recruitments: Array<{ round, recruiterName, targetName, accepted }>,
  },
}
```

### PlayerState

```js
{
  name:   string,
  role:   'traitor'|'faithful'|null,  // null during lobby
  alive:  boolean,
  order:  number,  // join order
}
```

---

## Constants

```js
const TRT_CHANNEL_ID         = '1498657971994099825';
const TRT_MIN_PLAYERS        = 4;
const TRT_MAX_PLAYERS        = 20;
const TRT_LOBBY_TIMEOUT_MS   = 15 * 60 * 1000;  // 15 min
const TRT_DISCUSSION_MS      =  5 * 60 * 1000;  // 5 min
const TRT_VOTE_MS            =  3 * 60 * 1000;  // 3 min
const TRT_RECRUIT_MS         =  5 * 60 * 1000;  // 5 min

function trtGetTraitorCount(n):
  15+  → 3 Traitors
  9-14 → 2 Traitors
  4-8  → 1 Traitor
```

---

## CustomId Table

| CustomId | Type | Phase | Description |
|---|---|---|---|
| `trt:join` | Button | lobby | Join lobby |
| `trt:leave` | Button | lobby | Leave lobby |
| `trt:start` | Button | lobby | Host starts game |
| `trt:opt:hidden` | Button | lobby | Toggle hiddenRoleReveal |
| `trt:opt:shield` | Button | lobby | Toggle shieldChallenge |
| `trt:opt:recruit` | Button | lobby | Toggle recruitmentTwist |
| `trt:stop` | Button | any | Host/mod force-end |
| `trt:nightvote` | StringSelectMenu | night | Traitor selects murder/recruit (DM only) |
| `trt:resolvenight` | Button | night | Host force-resolves night |
| `trt:recruit:accept` | Button | night | Faithful accepts traitor offer (DM only) |
| `trt:recruit:decline` | Button | night | Faithful declines offer (DM only) |
| `trt:skipdisc` | Button | discussion | Host skips discussion timer |
| `trt:banvote` | StringSelectMenu | vote | Player votes to banish |
| `trt:revealvote` | Button | vote | Host force-reveals banishment result |

**Night vote option values:** `murder:{userId}` or `recruit:{userId}` — action parsed from the selected value, not the customId.

---

## Host Controls Per Phase

| Phase | Host button(s) |
|---|---|
| Lobby | Start Game, End Lobby, toggle options |
| Night | Resolve Night (disabled while recruit pending) |
| Discussion | Skip Discussion, End Game |
| Vote | Reveal Result, End Game |

Any player with the host ID, MOD_ROLE_ID, or OWNER_DISCORD_ID can use host buttons.

---

## Recruitment Mechanic

**Trigger:** `trtCanRecruit(game)` — `recruitmentTwist ON` AND `traitorIds.size === 1` AND `trtAliveCount(game) >= 4`

**Flow:**
1. Traitor's night DM shows "Recruit [Name]" options alongside "Murder [Name]"
2. Traitor selects `recruit:{targetId}`
3. Bot DMs the targeted Faithful an Accept/Decline offer with a 5-min timer
4. **Accept** → player promoted to Traitor, `trtCheckWin()` fires (Traitors may win immediately), else `trtStartMorning('safe')`
5. **Decline / timeout** → night passes safely, `trtStartMorning('safe')`

Recruitment is hidden from the channel — "castle is safe" morning message in all cases.

**Edge cases:**
- Target DMs blocked → auto-decline immediately
- Recruit accept makes Traitors ≥ Faithfuls → Traitors win immediately
- Host presses "Resolve Night" while recruit pending → button is disabled

---

## Voting Algorithms

### Night Vote (trtResolveNight)
1. If `nightVotes` empty → `trtStartMorning('safe')`
2. Tally by `${action}:${targetId}` key
3. Find max votes; if tie, pick randomly from tied options
4. If `murder`: check shield → if blocked, `trtStartMorning('shield')`; else kill victim → `trtCheckWin` → `trtStartMorning('murder', targetId)`
5. If `recruit`: `trtRecruitFlow(game, channel, targetId)`

### Banishment Vote (trtResolveBanishment)
1. Count votes per targetId
2. Find max; if multiple targets at max → deadlock (no banishment)
3. Single winner → `player.alive = false` → `trtUpdateRoleSets` → post result → `trtCheckWin`

---

## Win Condition Logic

```js
async function trtCheckWin(game, channel) {
    if (game.traitorIds.size === 0)                        → faithful win
    if (game.traitorIds.size >= game.faithfulIds.size)     → traitor win
    if (trtAliveCount(game) < 3)                           → faithful win (too few to continue)
    return null  // game continues
}
```

Called after every murder (night) and every banishment (day). If non-null is returned, callers must NOT proceed to the next phase.

---

## Bot Feature Flag

`botFeatures.traitorsGame` — toggle in Admin Panel → Bot Controls.
If `false`, `/traitors start` replies with a disabled message.

---

## Embed Color Scheme

| Phase | Color | Hex |
|---|---|---|
| Lobby | Midnight purple | `0x1a0a2e` |
| Night | Near black | `0x0d0d0d` |
| Traitor DM | Blood red | `0x7c0a02` |
| Shield DM | Gold | `0xffd700` |
| Morning (murder) | Amber/dawn | `0xf97316` |
| Morning (safe) | Soft green | `0x22c55e` |
| Discussion | Council blue | `0x3b82f6` |
| Banishment vote | Voting purple | `0x7c3aed` |
| Banishment result (banished) | Red | `0xdc2626` |
| Deadlock | Grey | `0x6b7280` |
| Faithful win | Green | `0x22c55e` |
| Traitor win | Dark red | `0x7c0a02` |
| Game log | Midnight purple | `0x1a0a2e` |

---

## Failure Points & Mitigations

| Failure | Mitigation |
|---|---|
| Bot restarts mid-game | State is in-memory — game ends. `TRT_TEXT.RESTART_NOTICE` posted to channel on startup. |
| Player DMs blocked at start | Player removed, channel notified. If <4 remain, game cancelled. |
| All Traitor DMs fail | Auto-resolve night safely, notify host |
| Recruit target DMs blocked | Auto-decline immediately |
| Interaction 3s timeout | All handlers call `deferReply()` or `deferUpdate()` or `reply()` immediately |
| Lobby timeout | `lobbyTimer` fires → `trtEndGame` |
| Non-participant presses button | `game.players.has(userId)` check → ephemeral error |
| Dead player interacts | `player.alive === false` check → ephemeral error |
| Duplicate vote | `banishmentVotes.has(voterId)` / `nightVotes.has(traitorId)` → ephemeral error |
| Self-banishment vote | `targetId === voterId` check → reject ephemeral |
| Recruit offer accepted after timer | `!game.recruitPending || game.recruitTarget !== userId` → ephemeral "offer expired" |
| AFK traitor in night | Host can force-resolve with "Resolve Night" button |
| AFK voters in banishment | Vote auto-closes after 3 min; host can reveal early |

---

## Interaction Handler Routing (in index.js)

**Select menus** (before `!isButton()` gate):
```js
if (interaction.isStringSelectMenu()) {
    trt:nightvote  → handleTrtNightVote  (uses traitorPlayerMap for DM context)
    trt:banvote    → handleTrtBanVote    (uses TRT_CHANNEL_ID directly)
}
```

**Buttons** (after `!isButton()` gate):
```
trt:join          → join lobby
trt:leave         → leave lobby
trt:start         → host starts game
trt:opt:hidden    → toggle hiddenRoleReveal
trt:opt:shield    → toggle shieldChallenge
trt:opt:recruit   → toggle recruitmentTwist
trt:stop          → host/mod ends game
trt:resolvenight  → host force-resolves night
trt:skipdisc      → host skips discussion
trt:revealvote    → host force-reveals banishment result
trt:recruit:accept  → faithful accepts traitor offer (uses traitorPlayerMap)
trt:recruit:decline → faithful declines offer (uses traitorPlayerMap)
```
