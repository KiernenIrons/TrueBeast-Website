# Beast Bot — Escape Room

## Overview

A procedurally generated escape room party game. Every run picks a random **theme** and assembles
**4 rooms** from 5 puzzle-type generators, so no two games play the same. Fully text/button/emoji
based — no images.

**Channel:** `1517318620395470969` (`#escape-room`)
**Commands:** `/escaperoom start [mode]` · `/escaperoom stop` · `/escaperoom status` · `/escaperoom help`

---

## Modes

| Mode | Description |
|---|---|
| `coop` (default) | One shared room. Everyone in the lobby sees the same puzzle message in `#escape-room` and shares one inventory. Anyone can attempt the current puzzle. |
| `race` | Each player gets their **own** independently generated 4-room run, delivered via DM. The channel shows a live leaderboard. First to escape wins; game ends when everyone finishes or time runs out. |

Mode is chosen with `/escaperoom start mode:<coop|race>` (defaults to `coop`), or toggled by the host in the lobby with the **Toggle Mode** button.

---

## Game Flow

```
/escaperoom start
    │
    ▼
[LOBBY]  Join / Leave / Toggle Mode / host Start / Cancel. 15-min auto-cancel.
    │
    ▼  host presses Start
Theme is picked at random; a 4-room run is generated (5 puzzle types, pick 4, shuffled order)
    │
    ├── Co-op  → one puzzle message posted to #escape-room, host control message with Skip Room / End Game
    └── Race   → each player DMed their own intro + first puzzle; leaderboard posted to #escape-room
    │
    ▼  players solve puzzles (buttons / select menus / modal / emoji reactions)
Each solved puzzle: item added to inventory → advance to next room → re-render
    │
    ▼  all rooms cleared (or time runs out — 25 min hard limit, warnings at 10/5/2 min)
[END]  Co-op: "team escaped" or "trapped" message.  Race: per-player escape message + final leaderboard.
```

---

## State Design

All state is in-memory — no persistence. If the bot restarts mid-game, the game is lost.

### Maps (near other game state, after `TRT_TEXT`)

```js
const escapeGames      = new Map(); // channelId → GameState
const escapePlayerMap  = new Map(); // userId → channelId
const escReactionLocks = new Map(); // messageId → { channelId, userIdForDm: string|null } — routes ward-puzzle reactions
```

### GameState

```js
{
  channelId, hostId, phase: 'lobby'|'playing'|'ended',
  mode: 'coop'|'race',
  players: Map<userId, PlayerState>,
  progress: ProgressState|null,      // coop only — shared progress object
  lobbyMsgId, hostMsgId, leaderboardMsgId,
  lobbyTimer, deadlineTimer, warningTimers: Timeout[],
  startedAt, deadlineTs,
}
```

### PlayerState

```js
{ name: string, progress: ProgressState|null }  // progress populated per-player only in race mode
```

### ProgressState (the actual "run" — one per game in co-op, one per player in race)

```js
{
  theme: { name, emoji, color, intro, loot: string[] },
  rooms: [{ roomNumber, item, puzzle, solved }],   // 4 rooms, generated once at start
  currentRoomIndex: number,
  inventory: string[],
  hintsUsed: number,
  finished: boolean,
  finishedAt: number|null,
  startedAt: number,
  msgId: string|null,        // the live puzzle message (channel msg for coop, DM msg for race)
  dmChannelId: string|null,  // race only
}
```

### Puzzle object (`room.puzzle`)

```js
{ type: 'vault'|'cipher'|'riddle'|'sequence'|'ward', prompt: string, data: {...type-specific} }
```

---

## Puzzle Types

| Type | Input style | Mechanic |
|---|---|---|
| `vault` | 3 select menus (Dial 1-3) + Submit button | Combination (3 distinct digits 1-9) must be **deduced** from 3 logic clues (digit sum, an exact difference between two named dials, which dial holds the highest digit). Wrong submissions get Mastermind-style feedback — how many digits are correct & in place, how many are correct but in the wrong dial — so trial and error converges instead of just failing. |
| `cipher` | Button → Modal text input | A theme word is Caesar-shifted by a random amount; player types the decoded word |
| `riddle` | 4 buttons (A-D) | Riddle from a pool of 10, options shuffled each time |
| `sequence` | 5 emoji buttons | A random 3-4 symbol sequence is shown; player must press the same symbols in order (wrong press resets progress) |
| `ward` | Emoji **reactions** (no buttons) | Bot reacts to its own message with 5 emoji; the clue requires combining two facts (e.g. "the sea creature with three hearts and eight arms") rather than naming the answer directly. Wrong reactions are auto-removed so the player can retry. |

### Hints never hand over the solution

Every puzzle has a **Hint** button, but it only narrows things down — it never reveals the full answer in one click:

- **Vault** — reveals one dial's value at a time (3 hints = fully solved, but that costs 3 clicks)
- **Cipher** — reveals one more decoded letter each click (`_ _ _` → `S _ _` → `S H _` → ...)
- **Riddle** — rules out one wrong option per click (button greys out with ❌), leaving the correct answer plus one decoy at minimum
- **Sequence** — reveals only the *next* symbol you need to press, not the whole sequence
- **Ward** — rules out one wrong emoji per click and removes that reaction from the message

Each game generates 4 of the 5 types (shuffled, no repeats) — `ESC_PUZZLE_TYPES` in `index.js`.

### Emoji comparison gotcha (fixed)

Ward puzzles compare `reaction.emoji.name` against the puzzle's stored answer. Some emoji (☀️, ❄️, 🗝️, 🕯️) are written in source with a variation selector (U+FE0F), but Discord's gateway can echo reactions back *without* it — a strict string comparison silently failed even when the player reacted with the visually-correct symbol. Fixed by `escNormEmoji()`, which strips variation selectors/ZWJ before comparing on both sides (used for the correctness check, the wrong-reaction removal, and the hint's reaction-removal lookup).

---

## Why two different "render and advance" paths

Button/select/modal-driven solves use `interaction.update(...)` directly — fast, no extra fetch,
and works identically whether the message lives in `#escape-room` (co-op) or in a player's DM (race),
since the interaction is always bound to the message it came from.

**Ward puzzles are the exception**: solving them happens via a *reaction*, not an interaction, so there's
no `interaction` object to call `.update()` on. `escPushUpdate()` re-fetches the message by ID and edits
it directly — this is the only code path that needs the stored `progress.msgId`.

---

## CustomId Table

| CustomId | Component | Purpose |
|---|---|---|
| `esc:join` / `esc:leave` | Button | Lobby join/leave |
| `esc:opt:mode` | Button | Host toggles coop/race |
| `esc:start` | Button | Host starts the game |
| `esc:end` | Button | Host/mod ends the game |
| `esc:hostskip` | Button | Host skips the current room (co-op only) |
| `esc:hint` | Button | Reveal the current puzzle's hint (ephemeral) |
| `esc:vault:dial:{0\|1\|2}` | StringSelectMenu | Set a vault dial |
| `esc:vault:submit` | Button | Attempt to open the vault |
| `esc:cipher:open` | Button | Opens the decode modal |
| `esc:cipher_modal` | Modal | Cipher answer submission |
| `esc:riddle:{optionIndex}` | Button | Pick a riddle answer |
| `esc:sequence:{emoji}` | Button | Press a sequence symbol |

Ward puzzles use **message reactions**, not customIds — routed via `escReactionLocks` keyed by message ID.

---

## Host Controls

| Phase | Host button(s) |
|---|---|
| Lobby | Start Game, Toggle Mode, Cancel |
| Playing (co-op) | Skip Room, End Game |
| Playing (race) | End Game |

Any player with the host ID, `MOD_ROLE_ID`, or `OWNER_DISCORD_ID` can use host buttons (`escIsHost`).

---

## Timing

- Lobby: 15-minute auto-cancel (`ESC_LOBBY_TIMEOUT_MS`)
- Run: 25-minute hard time limit (`ESC_TIME_LIMIT_MS`), with channel warnings at 10/5/2 minutes remaining
- On expiry: co-op ends as "trapped"; race ends and posts final standings for whoever hasn't escaped yet

---

## Failure Points & Mitigations

| Failure | Mitigation |
|---|---|
| Bot restarts mid-game | State is in-memory — game ends. Acceptable for a party game. |
| Player DMs blocked (race mode) | Removed from the race at start; channel notified. If 0 players remain, game cancelled. |
| Non-participant interacts | `escGetContext` returns `null` → ephemeral "no active puzzle" reply |
| Reacts with wrong ward emoji | Reaction is removed (`reaction.users.remove`) so the player can retry |
| Host presses Skip Room outside co-op/playing | Guarded — ephemeral "not available" reply |
| Lobby abandoned | `lobbyTimer` (15 min) auto-cancels |

---

## Bot Feature Flag

`botFeatures.escapeRoomGame` — toggle in Admin Panel → Bot Controls. If `false`, `/escaperoom start` replies with a disabled message.

---

## Interaction Handler Routing (in index.js)

```js
// Modal (before the isButton gate)
interaction.isModalSubmit() && interaction.customId === 'esc:cipher_modal' → handleEscCipherModal

// Select menu
interaction.isStringSelectMenu() && customId.startsWith('esc:vault:dial:') → handleEscVaultDial

// Buttons — single dispatcher, all esc: logic lives in handleEscButton()
interaction.customId.startsWith('esc:') → handleEscButton(interaction)

// Reactions (messageReactionAdd, checked before the guild-only gate so DMs work too)
escReactionLocks.get(reaction.message.id) → handleEscWardReaction(reaction, user, lock)
```
