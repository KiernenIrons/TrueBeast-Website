# Beast Bot — The Imposter Game

## Overview

"The Imposter" is a Spyfall-variant social deduction game built into Beast Bot.
All crewmates receive the same secret word from a themed category. One (or two)
impostors receive only the theme — they must bluff their clue without knowing the word.
Players submit clues, discuss, and vote to eliminate who they think is the imposter.

**Channel:** `1498354389356904628` (`#imposter-game`)
**Commands:** `/imposter start` · `/imposter stop`

---

## Game Flow

```
/imposter start
    │
    ▼
[LOBBY] Join button + Start button (host only)
    │   Min 4 players, max 12, 10-min lobby timeout
    │
    ▼
[CLUE PHASE] Each player presses "Give Clue" → modal → 1–5 word clue
    │   5-min timeout; skips players who don't submit
    │
    ▼
[DISCUSSION] Bot reveals ALL clues at once (anonymous or attributed)
    │   3-min open chat in the channel
    │
    ▼
[VOTE] Bot posts embed with vote buttons for each alive player
    │   2-min timeout; players who don't vote are skipped
    │   Imposter may press "Guess Word" instead of voting
    │
    ▼
[ELIMINATION] Majority vote out → announce crewmate/imposter
    │   Tie → no elimination
    │
    ▼
Win check:
  • Imposter eliminated → CREW WINS
  • Crewmate eliminated, imposter(s) still alive → imposter scores, new round
  • ≤3 players remain (imposter alive) → IMPOSTER WINS
  • Imposter guesses word correctly → IMPOSTER WINS
  • Imposter guesses word incorrectly → CREW WINS
```

---

## State Design

Everything is in-memory. No SQLite. Firestore is NOT used for live game state —
if the bot restarts mid-game, the game cancels gracefully.

### Maps (top of index.js, near other game state)

```js
// channelId → GameState
const imposterGames = new Map();

// userId → channelId (reverse lookup for interaction handlers)
const imposterPlayerMap = new Map();
```

### GameState Object

```js
{
  channelId: string,         // always IMPOSTER_CHANNEL_ID
  hostId: string,            // user who ran /imposter start
  phase: string,             // 'lobby' | 'clue' | 'discussion' | 'vote' | 'ended'
  players: Map,              // userId → { name, avatarUrl, alive, clue, vote }
  theme: string,             // e.g. "Ocean"
  word: string,              // e.g. "Submarine" — crewmates' secret word
  impostorIds: Set,          // Set<userId>
  round: number,             // starts at 1
  lobbyMsgId: string,        // message ID of the lobby embed
  gameMsgId: string,         // message ID of the current phase embed
  phaseTimer: Timeout|null,  // clearTimeout before each phase transition
  startedAt: number,         // Date.now() at game start
}
```

### PlayerState Object

```js
// value in GameState.players Map
{
  name: string,       // display name at join time
  avatarUrl: string,  // avatar URL for embeds
  alive: boolean,
  clue: string|null,  // submitted during clue phase
  vote: string|null,  // userId they voted for (or 'guess' for imposter guess)
}
```

---

## CustomId Namespacing

All customIds use the `imp:` prefix, matching the `thought:`, `lbt:` pattern.

| CustomId | Component | Purpose |
|---|---|---|
| `imp:join` | Button | Join the lobby |
| `imp:start` | Button | Host starts game (host only) |
| `imp:clue` | Button | Open clue submission modal |
| `imp:vote:{userId}` | Button | Vote to eliminate a player |
| `imp:guess` | Button | Imposter guesses the secret word |
| `imp:end` | Button | Mod/owner force-ends the game |
| `imp:clue_modal` | Modal | customId for clue modal submit |
| `imp:guess_modal` | Modal | customId for imposter guess modal |

Note: `imp:vote:{userId}` is safe — Discord user IDs are 18–19 chars, total ≈30 chars well under the 100-char limit.

---

## Slash Commands

```
/imposter start   — creates lobby embed in IMPOSTER_CHANNEL_ID
/imposter stop    — host or moderator force-ends current game
```

Registered as a subcommand group in the existing `clientReady` command array:

```js
new SlashCommandBuilder()
  .setName('imposter')
  .setDescription('Play the Imposter word deduction game')
  .addSubcommand(sub => sub.setName('start').setDescription('Start a new game in #imposter-game'))
  .addSubcommand(sub => sub.setName('stop').setDescription('End the current game'))
```

---

## Word List

Built-in array of `{ theme, words[] }` objects. ~10 themes × 5 words each.
Picked randomly each game. The bot picks ONE word from the theme for crewmates;
impostors only receive the theme name.

```js
const IMPOSTER_WORD_LIST = [
  { theme: 'Ocean',    words: ['Submarine', 'Coral Reef', 'Shark', 'Lighthouse', 'Surfboard'] },
  { theme: 'Space',    words: ['Black Hole', 'Astronaut', 'Nebula', 'Satellite', 'Comet'] },
  { theme: 'Kitchen',  words: ['Wok', 'Colander', 'Pressure Cooker', 'Grater', 'Whisk'] },
  { theme: 'School',   words: ['Detention', 'Cafeteria', 'Locker', 'Hall Pass', 'Yearbook'] },
  { theme: 'Jungle',   words: ['Quicksand', 'Canopy', 'Machete', 'Anaconda', 'Hammock'] },
  { theme: 'Casino',   words: ['Roulette', 'Craps', 'Blackjack', 'Jackpot', 'Chips'] },
  { theme: 'Hospital', words: ['Scalpel', 'Triage', 'Dialysis', 'Stethoscope', 'Surgery'] },
  { theme: 'Circus',   words: ['Trapeze', 'Ringmaster', 'Tightrope', 'Acrobat', 'Juggler'] },
  { theme: 'Arctic',   words: ['Igloo', 'Polar Bear', 'Permafrost', 'Whiteout', 'Dogsled'] },
  { theme: 'Medieval', words: ['Trebuchet', 'Moat', 'Dungeon', 'Jousting', 'Squire'] },
];
```

---

## Phase Timers

Each phase transition uses `setTimeout` stored on `game.phaseTimer`.
Always `clearTimeout(game.phaseTimer)` before setting a new one.

| Phase | Timeout | Behaviour at timeout |
|---|---|---|
| Lobby | 10 min | Cancel game, delete lobby message |
| Clue | 5 min | Skip players with no clue, advance to discussion |
| Discussion | 3 min | Auto-advance to vote phase |
| Vote | 2 min | Skip non-voters, tally with submitted votes only |

---

## Imposter Count by Player Count

| Players | Impostors |
|---|---|
| 4–6 | 1 |
| 7–12 | 2 |

---

## Failure Points & Mitigations

| Failure | Mitigation |
|---|---|
| Bot restarts mid-game | State is in-memory — post "game cancelled" to IMPOSTER_CHANNEL_ID on `clientReady` startup |
| Player DMs blocked | Catch DM error, remove from `players` and `imposterPlayerMap`, notify channel |
| Interaction 3s timeout | All async handlers call `deferReply()` or `deferUpdate()` FIRST |
| Lobby abandoned | 10-min phaseTimer auto-cancels |
| Vote tie | Announce tie, no elimination, start new round |
| Game message deleted | On catch editing gameMsgId, send new message and update gameMsgId |
| Player count drops below 3 | After each elimination, check — if imposter still in and ≤3 remain, imposter wins |
| Non-participant presses buttons | Check `game.players.has(interaction.user.id)` and reject if not |
| Wrong-phase button press | Check `game.phase` and reply ephemeral "Not the right time for that" |
| imposterPlayerMap stale | Always `delete imposterPlayerMap[userId]` when player is removed or game ends |

---

## Interaction Handler Location

All game interactions are handled inside the existing `client.on('interactionCreate', ...)` block (line ~3951 in index.js).

Button routing:
```js
if (interaction.isButton()) {
  if (interaction.customId === 'imp:join') return handleImpJoin(interaction);
  if (interaction.customId === 'imp:start') return handleImpStart(interaction);
  if (interaction.customId === 'imp:clue') return handleImpClueButton(interaction);
  if (interaction.customId.startsWith('imp:vote:')) return handleImpVote(interaction);
  if (interaction.customId === 'imp:guess') return handleImpGuessButton(interaction);
  if (interaction.customId === 'imp:end') return handleImpEnd(interaction);
}

if (interaction.isModalSubmit()) {
  if (interaction.customId === 'imp:clue_modal') return handleImpClueModal(interaction);
  if (interaction.customId === 'imp:guess_modal') return handleImpGuessModal(interaction);
}
```

Slash command routing (inside `isChatInputCommand` block):
```js
if (interaction.commandName === 'imposter') {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return handleImposterStart(interaction);
  if (sub === 'stop') return handleImposterStop(interaction);
}
```

---

## Key Constants (add near top of index.js)

```js
const IMPOSTER_CHANNEL_ID = '1498354389356904628';
const IMP_MIN_PLAYERS = 4;
const IMP_MAX_PLAYERS = 12;
const IMP_LOBBY_TIMEOUT_MS    = 10 * 60 * 1000;  // 10 min
const IMP_CLUE_TIMEOUT_MS     =  5 * 60 * 1000;  //  5 min
const IMP_DISCUSS_TIMEOUT_MS  =  3 * 60 * 1000;  //  3 min
const IMP_VOTE_TIMEOUT_MS     =  2 * 60 * 1000;  //  2 min
```

---

## Bot Feature Flag

Add to `botFeatures` object:
```js
imposterGame: true,
```

Add to admin panel `BOT_FEATURES` array:
```js
{ key: 'imposterGame', label: 'Imposter Game', desc: 'Enable /imposter game in #imposter-game' }
```

Guard in `/imposter start` handler:
```js
if (botFeatures.imposterGame === false) {
  return interaction.reply({ content: 'The Imposter game is currently disabled.', ephemeral: true });
}
```

---

## Adding New Word Categories

Edit the `IMPOSTER_WORD_LIST` array near the top of the imposter game section in `index.js`.
Each entry: `{ theme: 'Name', words: ['Word1', 'Word2', 'Word3', 'Word4', 'Word5'] }`.
Minimum 5 words per theme (bot picks 1 randomly each game).
