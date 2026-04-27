# Beast Bot — The Imposter Game

## Overview

"The Imposter" is a social deduction / bluffing party game for the TrueBeast Discord.

Everyone gets the **same question** via DM — except one person (the Imposter) who secretly
receives a **different but similar question**. Players answer privately, then the host
reveals all answers and the real question. Each player explains their answer in order;
the Imposter must sound convincing despite answering a different question. Everyone votes.

**Channel:** `1498354389356904628` (`#imposter-game`)
**Commands:** `/imposter start` · `/imposter stop`

---

## Game Flow

```
/imposter start
    │
    ▼
[LOBBY] Join button + Start button (host only). Min 3 players, max 12. 15-min timeout.
    │
    ▼  host presses Start
[ANSWER PHASE]
  - Bot DMs every player their question
  - Crewmates get: realQuestion
  - Imposter gets: altQuestion (and is told they are the Imposter)
  - Players press "Submit Answer" → modal → private answer collected
  - Bot shows live progress (✅ / ⏳ per player) — NO answers shown yet
  - Host sees a separate control message with "Reveal Answers" button
    │
    ▼  host presses Reveal Answers (when ready)
[REVEALED]
  - Bot posts all answers + the REAL question revealed to channel
  - Shows explanation order (randomised at game start)
  - Players go around in order explaining their answer (free chat — no bot mechanic)
  - Host control: "Start Voting" button
    │
    ▼  host presses Start Voting
[VOTE PHASE]
  - Bot posts voting embed with one button per player
  - Players click who they think is the Imposter (one vote each)
  - Vote count updates live on the embed
  - Auto-reveals when ALL players have voted
  - Host can press "Reveal Imposter" at any time to force reveal
    │
    ▼  all voted or host triggers
[REVEAL]
  - Shows who was the Imposter, both questions, vote results, winner
  - Run /imposter start to play again
```

---

## State Design

All state is in-memory. No SQLite. No Firestore. If the bot restarts mid-game,
the game is lost — this is acceptable for a live party game.

### Maps (top of index.js)

```js
const imposterGames = new Map();      // channelId → GameState
const imposterPlayerMap = new Map();  // userId → channelId (reverse lookup)
```

### GameState Object

```js
{
  channelId: string,       // always IMPOSTER_CHANNEL_ID
  hostId: string,          // who ran /imposter start
  phase: string,           // 'lobby' | 'answer' | 'revealed' | 'vote' | 'ended'
  players: Map,            // userId → PlayerState (see below)
  realQuestion: string,    // question sent to crewmates; revealed at end of answer phase
  altQuestion: string,     // question sent to the imposter only
  impostorId: string|null, // single imposter's userId
  lobbyMsgId: string,      // message ID of the lobby embed
  gameMsgId: string,       // message ID of the current main phase message
  hostMsgId: string,       // message ID of the host-only control message
  lobbyTimer: Timeout|null,
}
```

### PlayerState Object

```js
// value in GameState.players Map
{
  name: string,        // display name at join time
  answer: string|null, // submitted during answer phase
  vote: string|null,   // userId they voted for (set during vote phase)
  order: number,       // explanation order (randomised at game start, 1-indexed)
}
```

---

## CustomId Namespacing

All customIds use `imp:` prefix.

| CustomId | Component | Purpose |
|---|---|---|
| `imp:join` | Button | Join the lobby |
| `imp:start` | Button | Host starts the game |
| `imp:answer` | Button | Open answer submission modal |
| `imp:reveal` | Button | Host reveals all answers + real question |
| `imp:startvote` | Button | Host starts the voting phase |
| `imp:vote:{userId}` | Button | Vote for a specific player |
| `imp:showresult` | Button | Host force-reveals the imposter |
| `imp:end` | Button | Host/mod ends the game early |
| `imp:answer_modal` | Modal | Answer submission modal ID |

`imp:vote:{userId}` — user IDs are 18–19 chars, total ~28 chars, well under 100-char Discord limit.

---

## Slash Commands

```
/imposter start   — create lobby in IMPOSTER_CHANNEL_ID
/imposter stop    — host or mod force-end the game
```

Registered as a subcommand group in the `clientReady` command array.

---

## Question Pairs

Built-in array of 25 `{ real, alt }` pairs. One is selected randomly each game.
The `real` question goes to all crewmates and is revealed at the end of the answer phase.
The `alt` question goes to the imposter only (never shown publicly during the game).

To add more questions, edit the `IMPOSTER_QUESTIONS` array near the top of `index.js`.
Keep pairs similar enough that answers overlap, but different enough to spot.

Good pair examples:
- Real: "What's something you'd find at a birthday party?" / Alt: "What's something you'd find at a wedding?"
- Real: "Describe the worst first date imaginable." / Alt: "Describe the most awkward social situation imaginable."

---

## Host Control Flow

The host runs `/imposter start`, joins the game, and controls 3 transitions:
1. **Start Game** button in lobby → kicks off answer phase
2. **Reveal Answers** button in host-only message → reveals all answers + real question
3. **Start Voting** button after reveal → opens voting
4. **Reveal Imposter** button (optional) → force-reveals if not waiting for all votes

Anyone with the host ID or MOD_ROLE_ID or OWNER_DISCORD_ID can press host buttons.
(`impIsHost(interaction, game)` checks this.)

---

## Key Constants

```js
const IMPOSTER_CHANNEL_ID  = '1498354389356904628';
const IMP_MIN_PLAYERS      = 3;
const IMP_MAX_PLAYERS      = 12;
const IMP_LOBBY_TIMEOUT_MS = 15 * 60 * 1000;  // 15 min
```

---

## Bot Feature Flag

`botFeatures.imposterGame` — toggle in Admin Panel → Bot Controls.
If set to `false`, `/imposter start` replies with a disabled message.

---

## Failure Points & Mitigations

| Failure | Mitigation |
|---|---|
| Bot restarts mid-game | State is in-memory — game ends. Message lost. Acceptable for party game. |
| Player DMs blocked | Caught per-player; that player is removed from game, channel notified |
| Interaction 3s timeout | All async handlers call `deferReply()` or `deferUpdate()` immediately |
| Lobby abandoned | `lobbyTimer` (15 min) auto-cancels and posts cancellation embed |
| Non-participant presses buttons | `game.players.has(userId)` check → ephemeral "not in game" reply |
| Wrong phase button press | `game.phase` check → ephemeral error reply |
| `imposterPlayerMap` stale | `impCleanup()` deletes all player entries when game ends |
| Host message missing | `hostMsgId` fetch wrapped in `.catch(() => {})` |
| All players same answer | No bot-side deduplication — intentional, adds to social dynamics |
| Vote tie | `impTallyAndReveal` shows the tie in results embed without picking a winner |

---

## Interaction Handler Location

Inside `client.on('interactionCreate', ...)` in `index.js`.

**Modal routing** (before the `if (!interaction.isButton()) return;` gate):
```js
if (interaction.isModalSubmit() && interaction.customId === 'imp:answer_modal') → handleAnswerModal
```

**Button routing** (after the gate):
```js
imp:join        → join lobby
imp:start       → host starts game, DMs sent
imp:answer      → show answer modal
imp:reveal      → host reveals answers
imp:startvote   → host opens vote phase
imp:vote:{uid}  → player votes; auto-reveals when all voted
imp:showresult  → host force-reveals imposter
imp:end         → host/mod ends game
```
