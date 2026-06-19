# Beast Bot — Escape Room

## Overview

A procedurally generated escape room party game. Every run picks a random **theme**, assembles
**4 rooms** from 8 puzzle-type generators (one of which is co-op only), and finishes with a **Master
Puzzle** that combines a fragment collected from each room — so the run feels like one connected
escape, not four independent riddles. Fully text/embed/component based — no images, no message
reactions anywhere in the game (every puzzle is solved with buttons, select menus, or a modal).

**Channel:** `1517318620395470969` (`#escape-room`)
**Commands:** `/escaperoom start [mode]` · `/escaperoom stop` · `/escaperoom status` · `/escaperoom help`

---

## Modes

| Mode | Description |
|---|---|
| `coop` (default) | One shared room. Everyone in the lobby sees the same puzzle message in `#escape-room` and shares one inventory/fragment set. Anyone can attempt the current puzzle. Pool includes the co-op-exclusive `split` puzzle. |
| `race` | Each player gets their **own** independently generated 4-room run, delivered via DM, each with their own Master Puzzle at the end. The channel shows a live leaderboard. First to escape wins; game ends when everyone finishes or time runs out. |

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
Theme picked at random; a 4-room run is generated (8 puzzle types in coop / 7 in race, pick 4, shuffled)
    │
    ├── Co-op  → one puzzle message posted to #escape-room, host control message with Skip Room / End Game
    └── Race   → each player DMed their own intro + first puzzle; leaderboard posted to #escape-room
    │
    ▼  players solve puzzles (buttons / select menus / modal)
Each solved puzzle: item → inventory, fragment (1 letter) → fragments[], advance to next room
    │
    ▼  all 4 rooms cleared
[FINAL DOOR]  Master Puzzle — combine the 4 collected fragments per a stated order rule
    (forward / reverse / alphabetical, picked once per run) and submit via modal
    │
    ▼  final code correct (or time runs out — 25 min hard limit, warnings at 10/5/2 min)
[END]  Co-op: "team escaped" or "trapped" message.  Race: per-player escape message + final leaderboard.
```

---

## State Design

All state is in-memory — no persistence. If the bot restarts mid-game, the game is lost.

### Maps (near other game state, after `TRT_TEXT`)

```js
const escapeGames     = new Map(); // channelId → GameState
const escapePlayerMap = new Map(); // userId → channelId
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
  fragments: string[],              // 1 uppercase letter per solved room, feeds the Master Puzzle
  finalPuzzle: FinalPuzzleState|null,  // created once all 4 rooms are cleared
  hintsUsed: number,
  finished: boolean,                // only true once the FINAL puzzle (not just room 4) is solved
  finishedAt: number|null,
  startedAt: number,
  msgId: string|null,        // the live puzzle message (channel msg for coop, DM msg for race)
}
```

### FinalPuzzleState

```js
{
  orderKind: 'forward'|'reverse'|'alpha',
  orderText: string,    // human-readable rule shown in the prompt and in hints
  answer: string,       // fragments combined per orderKind — e.g. 'BTEJ'
  solved: boolean,
}
```

`escAtFinalPuzzle(progress)` is true once `currentRoomIndex >= rooms.length` and `finalPuzzle` exists
but isn't solved yet — this is the state between "room 4 cleared" and "actually escaped."

### Puzzle object (`room.puzzle`)

```js
{ type: 'vault'|'cipher'|'riddle'|'sequence'|'ward'|'blackbox'|'witness'|'split', prompt: string, data: {...type-specific}, fragment: string }
```

Every generator returns a `fragment` — a single uppercase letter derived from that puzzle's own
solution (e.g. the cipher's decoded word's first letter, the vault's digit-sum mod 26, the witness
puzzle's liar's name initial). See `escFragFromAnswer()` and each generator for the exact derivation.

---

## Puzzle Types

| Type | Input style | Mechanic |
|---|---|---|
| `vault` | 3 select menus (Dial 1-3) + Submit button | Combination (3 distinct digits 1-9) must be **deduced** from 4 logic clues (digit sum, an exact difference between two named dials, which dial holds the highest digit, how many digits are even). Wrong submissions get Mastermind-style feedback. |
| `cipher` | Button → Modal text input | **Cipher Evolution**: rotates between 3 real ciphers (Polybius square, Atbash, Morse code) each game. The coded text is shown with **no table and no name** — recognizing which cipher it is is half the puzzle. First Hint reveals the method + lookup table as a safety net. |
| `riddle` | 4 buttons (A-D) | 50/50 split between a classic riddle (pool of 10, including 2 lateral-thinking trick riddles) and an **anagram/wordplay clue** (pool of 7) — letters to unscramble plus a definition, where multiple options are genuine anagrams of the same letters and only the definition picks the correct one. |
| `sequence` | 5 emoji buttons | Each of 5 symbols is shown with a hidden numeric value; the player must compute and press the **3 lowest-** or **3 highest-value** symbols in order — derived from the legend, not copied off the screen. |
| `ward` | 5 emoji buttons | The clue requires combining two facts (e.g. "the sea creature with three hearts and eight arms") rather than naming the answer directly. |
| `blackbox` | Button → Modal text input | Black-box function puzzle: 3 input→output pairs from a hidden formula (`f(x) = 3x + 9` or `f(x) = 4x² + 2`); player infers the rule and predicts a 4th output. Infinitely replayable from random coefficients. |
| `witness` | 3 buttons | Knights-and-knaves logic puzzle: 3 named witnesses make statements under a stated truth-count rule (e.g. "exactly one is lying"); player picks who's lying/truthful. **All 4 templates were brute-force verified to have exactly one consistent solution** — see `ESC_WITNESS_TEMPLATES`. |
| `split` | Button → Modal text input (**co-op only**) | Asymmetric information puzzle: a 4-digit code is split between two random players in the group via two separate DMs. Neither half alone is enough — the puzzle is structurally unsolvable without the group actually talking to each other. Skipped in race mode (no one to split info with). |

### Hints never hand over the solution

Every puzzle has a **Hint** button, but it only narrows things down — it never reveals the full answer in one click:

- **Vault** — reveals one dial's value at a time (3 hints = fully solved, but that costs 3 clicks)
- **Cipher** — first hint reveals the cipher method + table (not letters); subsequent hints reveal one more decoded letter each
- **Riddle / Witness / Ward** — rules out one wrong option per click (button greys out with ❌)
- **Sequence** — reveals only the *next* symbol you need to press, not the whole sequence
- **Blackbox** — first hint names the formula shape (linear/quadratic), second reveals the actual coefficients — you still have to compute the answer yourself
- **Split** — just reminds you the code is split between two players; no digits revealed (revealing them would defeat the point)
- **Final Door** — restates the fragments you collected and the combination rule; never different from what was already shown when you found each fragment

Each game generates 4 puzzle types from the pool (`ESC_PUZZLE_TYPES` for race, `ESC_PUZZLE_TYPES_COOP` adds `split` for co-op), shuffled, no repeats.

### Why Ward moved off reactions

Ward originally worked via message reactions. Two real problems showed up in live testing: a bug where
the bot's own `react()` calls and the lock registration shared a `try`/`catch`, so any single failed
react silently made the puzzle unsolvable; and an emoji-variation-selector normalization gotcha where
Discord could echo a reaction back without the selector the source code used. Both were fixed once,
but reactions kept failing in practice — the failure mode is silent and depends on Discord's
reaction-echo behavior, which isn't fully controllable bot-side. Ward was rewritten to use the same
button + elimination-hint pattern as Riddle: same reliability as every other puzzle (a real component
interaction), no reaction listener, no emoji-string-comparison gotchas.

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
| `esc:ward:{optionIndex}` | Button | Pick a ward symbol |
| `esc:blackbox:open` | Button | Opens the output-submission modal |
| `esc:blackbox_modal` | Modal | Black-box answer submission |
| `esc:witness:{optionIndex}` | Button | Pick a witness |
| `esc:split:open` | Button | Opens the gate-code modal |
| `esc:split_modal` | Modal | Split-clue code submission |
| `esc:final:open` | Button | Opens the Master Puzzle modal |
| `esc:final:hint` | Button | Restates fragments + order rule |
| `esc:final_modal` | Modal | Master Puzzle code submission — this is the actual "escaped" trigger |

---

## Host Controls

| Phase | Host button(s) |
|---|---|
| Lobby | Start Game, Toggle Mode, Cancel |
| Playing (co-op) | Skip Room, End Game |
| Playing (race) | End Game |

Any player with the host ID, `MOD_ROLE_ID`, or `OWNER_DISCORD_ID` can use host buttons (`escIsHost`).
Skipping a room still pushes that room's fragment into `progress.fragments` (so the Master Puzzle stays
consistent) but does not add the room's loot item to the inventory.

---

## Timing

- Lobby: 15-minute auto-cancel (`ESC_LOBBY_TIMEOUT_MS`)
- Run: 25-minute hard time limit (`ESC_TIME_LIMIT_MS`), with channel warnings at 10/5/2 minutes remaining
- On expiry: co-op ends as "trapped"; race ends and posts final standings for whoever hasn't escaped yet
- Design target: a 4-room run + Master Puzzle should land in ~15-25 min for a reasonably sharp group — the Master Puzzle is intentionally lightweight (combine what you already collected, not a new hard puzzle) to keep the capstone fast.

---

## Failure Points & Mitigations

| Failure | Mitigation |
|---|---|
| Bot restarts mid-game | State is in-memory — game ends. Acceptable for a party game. |
| Player DMs blocked (race mode) | Removed from the race at start; channel notified. If 0 players remain, game cancelled. |
| Non-participant interacts | `escGetContext` returns `null` → ephemeral "no active puzzle" reply |
| Host presses Skip Room outside co-op/playing | Guarded — ephemeral "not available" reply |
| Lobby abandoned | `lobbyTimer` (15 min) auto-cancels |
| `split` puzzle's DM fails to one of the two players | Caught individually (`.catch(() => {})` per DM) — the other player's DM still sends; the puzzle becomes harder but not unsolvable since the channel hint nudges players to coordinate |

---

## Fairness note on `witness`

Knights-and-knaves puzzles are easy to accidentally make unfair (an unverified statement set can have
zero or multiple consistent solutions). All 4 templates in `ESC_WITNESS_TEMPLATES` were brute-force
verified across all 8 true/false combinations before being added — each has **exactly one** consistent
assignment. If you add a new template, verify it the same way before shipping it.

---

## Bot Feature Flag

`botFeatures.escapeRoomGame` — toggle in Admin Panel → Bot Controls. If `false`, `/escaperoom start` replies with a disabled message.

---

## Interaction Handler Routing (in index.js)

```js
// Modals (before the isButton gate)
interaction.isModalSubmit() && interaction.customId === 'esc:cipher_modal'   → handleEscCipherModal
interaction.isModalSubmit() && interaction.customId === 'esc:blackbox_modal' → handleEscBlackboxModal
interaction.isModalSubmit() && interaction.customId === 'esc:split_modal'    → handleEscSplitModal
interaction.isModalSubmit() && interaction.customId === 'esc:final_modal'   → handleEscFinalModal

// Select menu
interaction.isStringSelectMenu() && customId.startsWith('esc:vault:dial:') → handleEscVaultDial

// Buttons — single dispatcher, all esc: logic lives in handleEscButton()
interaction.customId.startsWith('esc:') → handleEscButton(interaction)
```
