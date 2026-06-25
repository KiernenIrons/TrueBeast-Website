# Beast Bot — The Pond

## Overview

"The Pond" is a cozy tamagotchi-style pet game with a small fireflies economy layered on
top. Each member can adopt one frog, name it, and pick its color (color doubles as a
permanent perk). Frogs need occasional care (feeding/playing) or their hunger/happiness
slowly fade; left at 0 too long they get sick or depressed, and if that isn't cured/soothed
in time, they pass on. Frogs also have a hard lifespan — they pass peacefully of old age at
75 days regardless of how well cared for they are.

**Channel:** `1517699652982407168` (`#the-pond`)
**Commands:** `/frog adopt|feed|play|cure|soothe|status|leaderboard|explore|hawk` ·
`/frog lilypad info|upgrade` · `/frog rockfight challenge|any` ·
`/frog career info|choose|respec` · `/pond view|memorial|rules` · `/pond shop buy`

Unlike the other mini-games (Imposter, Traitors, Escape Room), The Pond lives in its own
module — `pond.js` — rather than directly inside `index.js`, since most of its state is
persistent (Firestore) rather than an in-memory party-game session. Phase 2 added the
game's first **Discord buttons** (the hawk minigame board, rock-fight accept/decline) —
that short-lived state lives in-memory, keyed by message ID, following the same pattern as
Imposter/Traitors/Escape Room's session Maps in `index.js`.

This is **Phase 1 + 2** of a larger planned design. Phase 1 built the economy/decay/visual
foundation; Phase 2 (this update) added exploration, rock fights, the hawk minigame, and
careers — the systems that actually consume the blue/pink/explorer/hunter perks that Phase 1
only stored. **Phase 3** (mayor elections, partnerships, baby breeding) remains unbuilt —
see "Not Yet Implemented" below.

---

## Game Flow

```
/frog adopt name:<name> color:<choice>
    │
    ▼
[EGG] just adopted, hunger 100, happiness 100, fireflies 0, lilypad level 1
    │   ages into stages purely by time alive (not by stats):
    │   egg (0d) → tadpole (1d) → froglet (3d) → frog (14d) → elder (60d, flower crown)
    ▼
[ALIVE] hourly tick decays hunger and happiness by 2/hr each (8 per 4h), modified by color
        perk and lilypad level
  - /frog feed          → +20 hunger (+5 more at lilypad lvl 2+, or +35 total using a worm), 4h cooldown
  - /frog play          → +20 happiness (+5 more at lilypad lvl 3+, or +35 total using a toy), 4h cooldown
  - /frog status         → generated portrait + current stats/economy
  - /frog explore         → once/day, random fireflies/hunger/happiness reward (the main early income source)
  - /frog hawk            → once/day, tic-tac-toe vs a minimax AI for fireflies
  - /frog rockfight challenge|any → wager fireflies on a PvP rock fight, vs a specific player or an open queue
  - /frog career info/choose/respec → pick a career at day 14+ (free first pick, fee to change)
  - /frog lilypad info/upgrade → check/spend fireflies on lilypad levels
  - /pond shop buy        → spend fireflies on worms/toys/a nest
    │
    ├─ hunger hits 0   → [SICK] 72h grace window — `/frog cure` (35 fireflies) restores
    │                      hunger to 50; uncured after 72h → frog dies (deathReason: sickness)
    ├─ happiness hits 0 → [DEPRESSED] 72h grace window — `/frog soothe` (35 fireflies)
    │                      restores happiness to 50; unsoothed after 72h → frog runs away
    │                      for good (deathReason: ran_away)
    └─ age reaches 75 days → passes peacefully of old age (deathReason: old_age), regardless
                              of current stats
    ▼
[PASSED ON] alive:false, deathReason + lifespanDays recorded, gentle announcement posted to
            #the-pond (wording varies by deathReason)
    │
    ▼
/frog adopt — owner can adopt a new frog any time
/pond memorial — see all frogs that have passed, sorted by lifespan
/frog leaderboard — longest-living frogs, alive or passed
/pond view — generated scene of every living frog together on lily pads
```

Sickness and depression are independent — a frog can be both sick and depressed at once,
each with its own 72h timer and its own cure command.

---

## State Design

Frog state is **persistent** — it must survive bot restarts and be visible across the whole
server. Firestore security rules only allowlist specific collection names, and a dedicated
`pondFrogs` collection isn't one of them (writes come back `403 PERMISSION_DENIED`). Rather
than requiring a rules change, frog docs live under the already-allowed **`botConfig`**
collection, one doc per owner at `botConfig/pond_<ownerId>`, with a `kind: 'pondFrog'`
marker field so collection-wide queries (`/pond view`, `/pond memorial`,
`/frog leaderboard`, the weekly tax sweep) can tell them apart from the bot's other
`botConfig` docs via a Firestore `fieldFilter` on `kind`. A separate
`botConfig/pond_meta` doc (`kind: 'pondMeta'`) tracks `lastPondTaxAt` for the weekly tax,
kept out of the `pondFrog` query results on purpose.

### Frog document

```js
{
  ownerId, name, color,            // color is a key into FROG_COLORS — doubles as the frog's perk
  stage,                           // 'egg' | 'tadpole' | 'froglet' | 'frog' | 'elder' — derived from age, recomputed each tick
  hunger, happiness,                // 0-100
  fireflies,                        // currency balance
  lilypadLevel,                     // 1-10, see Lilypad Levels below
  worms, toys,                      // shop consumable counts
  hasNest,                          // purchased once, reserved for the future baby-breeding phase
  sick, sickSince,                  // true once hunger hits 0; sickSince drives the 72h cure window
  depressed, depressedSince,        // true once happiness hits 0; depressedSince drives the 72h soothe window
  lastPassiveAt,                    // ms timestamp, tracks lilypad passive-income accrual (lvl 5+)
  career,                           // key into CAREERS, or null until day 14+ and chosen
  lastExploreAt, lastHawkAt,        // ms timestamps, drive the daily explore/hawk cooldowns
  lastFisherAt,                     // ms timestamp, tracks fisher-career passive income accrual
  bornAt,                           // ms timestamp, adoption time
  lastFedAt, lastPlayedAt,          // ms timestamps, drive the 4h care cooldowns
  lastTickAt,                       // ms timestamp of the last decay tick applied
  alive, diedAt, deathReason,       // deathReason: 'old_age' | 'sickness' | 'ran_away'
  lifespanDays,                     // set once a frog passes on; document is kept (not deleted) for the memorial/leaderboard
}
```

**Firestore PATCH gotcha:** `documents.patch` replaces the *entire* document with only the
fields given unless an `updateMask` is supplied — `pondFirestoreSet()` always sends
`updateMask.fieldPaths` for exactly the fields in its `data` argument, so a partial write
like `{ fireflies }` (used by the rock-fight/tax/hawk-loss paths) merges instead of wiping
every other field off the doc. Don't drop that mask when touching this helper.

`normalizeFrog()` fills sane defaults for any of the above missing on older docs, so frogs
adopted before a feature shipped upgrade gracefully instead of crashing on `undefined`.

Dead frogs stay in the same collection with `alive: false` — `/pond memorial` and
`/frog leaderboard` just filter/sort the same Firestore query.

---

## Color Perks

Color is picked once at `/frog adopt` and is permanent — it doubles as the frog's one
perk. The `gold` color is displayed to players as **"Golden"**; the internal key stays
`gold` to match its asset filenames (no migration needed).

| Color | Display name | Perk |
|---|---|---|
| green | Lily Green | Hunger decays 10% slower |
| blue | Pond Blue | +10% fireflies from exploration |
| pink | Axolotl Pink | +10% luck — better rock-fight odds, +5pp hawk mistake chance |
| gold | Golden | 10% discount on the shop, lilypad upgrades, career respec, cure, and soothe |
| purple | Poison Dart | Happiness decays 10% slower |
| brown | Marsh Brown | Babies are worth +5 fireflies *(stored now, used once breeding ships)* |

---

## Lilypad Levels

`/frog lilypad info` shows the current level and the next upgrade's cost/effect;
`/frog lilypad upgrade` spends fireflies to advance one level (10% off for Golden frogs).

| Level | Cost (fireflies) | Effect |
|---|---|---|
| 1 | free | Tiny lilypad |
| 2 | 10 | +5 hunger from feeding |
| 3 | 15 | +5 happiness from playing |
| 4 | 25 | +2 fireflies from exploration |
| 5 | 40 | Daily passive income unlocked (+5 fireflies/day) |
| 6 | 75 | Hawk battle loss reduced to 5% of fireflies (instead of 10%) |
| 7 | 100 | +5 additional daily passive income (total +10/day) |
| 8 | 120 | +3 fireflies from exploration |
| 9 | 150 | Hunger and happiness decay 5% slower (stacks with color perk) |
| 10 | 200 | Cosmetic flower lilypad sprite |

---

## Shop

`/pond shop buy item:<worms|toys|nest> quantity:<n>` — Golden frogs get 10% off.

| Item | Cost | Effect |
|---|---|---|
| Worms | 2 fireflies each | Next `/frog feed use_item:true` gives +35 hunger instead of +20 (consumes 1) |
| Toys | 2 fireflies each | Next `/frog play use_item:true` gives +35 happiness instead of +20 (consumes 1) |
| Nest | 100 fireflies (max 1) | Reserved for the future baby-breeding phase |

---

## Exploration

`/frog explore` — once a day. Rolls a tier (common 55% / uncommon 30% / rare 15%, weights
not specified by the original design and picked here to make exploration the primary
early-game firefly source without being too swingy), then a uniform outcome within that
tier: nothing/5/10 fireflies (common), 20 fireflies/+10 happiness ("meets a turtle")/+10
hunger ("finds worms") (uncommon), or a goose stealing 10 fireflies/a 50-firefly swarm
(rare). Positive firefly gains get +10% each from the blue color perk and the explorer
career (additive, so both = +20%), plus the lilypad exploration bonus (+2 at level 4, +3
more at level 8). `rollExploration()` in `pond.js`.

## Hawk Minigame

`/frog hawk` — once a day, posts a 3x3 tic-tac-toe board as buttons. The hawk AI
(`tttBestMove()`/`tttMinimax()`) always picks the objectively best move — it would never
lose to a perfect opponent — but has a **mistake chance** (base 20%, +10pp for the hunter
career, +5pp for the pink luck perk, capped at 50%) of playing a random legal move instead.
That mistake chance is how "hunter: 10% better odds" and "pink: +10% luck" become
meaningful against what would otherwise be unbeatable, rather than bolting a fake dice roll
onto a deterministic game. Win → +20 fireflies; lose → -10% of current fireflies (-5% at
lilypad level 6+); draw → no-op. Game state lives in-memory (`pondHawkGames`, keyed by
message ID) with a 10-minute inactivity expiry.

## Rock Fights

`/frog rockfight challenge user:<@user> wager:<5-20>` (targeted) or
`/frog rockfight any wager:<5-20>` (open queue, anyone but the challenger can Accept) posts
a challenge with Accept/Decline buttons. State lives in-memory (`pondRockfights`, keyed by
message ID), 10-minute expiry. Funds are validated at challenge time and again at
resolution (not held in between), so a stale balance cancels the fight with a message
rather than erroring. Win chance is zero-sum between the two frogs — not an independent
roll per side — based on each frog's `luckBonus()`: age (capped at +15 percentage points
right at the 75-day max-age mark) plus +5pp for the pink color perk. The winner takes both
wagers. `rockfightWinChance()` in `pond.js`.

## Careers

Unlock once a frog reaches the `frog` stage (day 14+). `/frog career choose` is free the
first time; `/frog career respec` (35 fireflies, 10% off for Golden frogs) changes it
afterward.

| Career | Effect |
|---|---|
| Fisher Frog | +3 fireflies every 12 hours, same elapsed-interval accrual pattern as lilypad passive income |
| Hunter Frog | +10 percentage points to the hawk AI's mistake chance |
| Caretaker Frog | Hunger and happiness decay 10% slower — stacks multiplicatively with the color perk and lilypad level 9+ reductions |
| Explorer Frog | +10% fireflies from exploration, stacks additively with the blue color perk |
| Nursery Frog | Babies mature 10% faster *(stored now, used once breeding ships)* |

---

## Weekly Pond Tax

Once every 7 days, the hourly ticker sweeps every living frog and deducts a flat 5% of its
current fireflies balance (not per-transaction — a single weekly skim off the total), then
posts the combined amount collected to `#the-pond`. Tracked via
`botConfig/pond_meta.lastPondTaxAt`.

---

## Decay & Passive Income Tick

`startPondTicker(client)` registers an hourly `setInterval` (plus a one-off tick 10s after
the bot comes online). Each tick, `applyDecay()` is applied to every living frog,
proportional to elapsed time since `lastTickAt` (not a flat per-tick amount, so a restart or
late tick doesn't unfairly punish a frog):

1. Age cap check first — 75+ days old dies of old age regardless of stats.
2. Hunger/happiness decay (2/hr each), reduced by color perk, lilypad level 9+, and the
   caretaker career — all three stack multiplicatively.
3. Lilypad passive income credited per full day elapsed (level 5+); fisher-career income
   credited per full 12h interval elapsed, same pattern.
4. Sickness timer (hunger at 0) and depression timer (happiness at 0), independently —
   each has its own 72h grace window before death.
5. Once per 7 days, the pond tax sweep runs (see above).

---

## Visuals

Frog portraits (`/frog adopt|feed|play|cure|soothe|status`) are **animated GIFs**
(`gif-encoder-2`) compositing the real sprite artwork in `discord-bot/assets/pond/`
(eggs/tadpoles/froglets/frogs per color, lilypads per level 1-10) over a procedural
water-gradient background with a gentle idle bob and slow ripple shimmer. Elder frogs get a
small procedural flower-crown overlay on top of the frog sprite (no dedicated elder art
exists yet — they reuse the `frogs/` sprite). Adding art for a new stage is just a new
`assets/pond/<stage>/` folder named `<Stage><Color>.png` plus one line in
`loadFrogSprite()`.

`/pond view` composites every living frog (capped at 30, to stay light on the 256mb Fly VM)
into a single **animated GIF** grid scene on lily pads — same idle-bob/ripple treatment as
single portraits, with each frog's bob phase offset slightly by index (`i * 0.13`) so the
whole pond doesn't bob in perfect unison. At the 30-frog cap this takes under a second to
render and produces a sub-1MB GIF, comfortably inside Discord's upload limit.

**Deployment note:** sprite assets live at `discord-bot/assets/pond/` (inside the Docker
build context used by `discord-bot/Dockerfile`'s `COPY . .`) — they must stay under
`discord-bot/`, not the repo root, or they won't ship to production.

---

## Bot Feature Flag

`botFeatures.pondFrogs` — toggle in Admin Panel → Bot Controls, same pattern as the other
games. If `false`, any `/frog` or `/pond` command replies with a disabled message.

---

## Not Yet Implemented (planned, phased)

Phase 1 and 2 are both shipped. **Phase 3** is the only part of the original design still
unbuilt:

- Frog mayor elections (5+ residents, weekly re-election, +10% stats/income, +10% aging).
- Partnerships (+2 happiness/day, mutual feeding between two frogs).
- Baby breeding (day 14+ frogs, sellable at 7 days, eaten if the parent's hunger drops
  below 50; the `nest` shop item and `brown`/`nursery` perks are already stored, waiting
  for this to consume them).

---

## Failure Points & Mitigations

| Failure | Mitigation |
|---|---|
| Bot restarts | State is in Firestore, not memory — frogs are unaffected; decay is proportional to elapsed time, not tick count |
| Double adopt | `/frog adopt` checks for an existing living frog first |
| Care spam | 4h cooldowns on `/frog feed` and `/frog play`, checked against `lastFedAt`/`lastPlayedAt` |
| Frog dies/sickens/depresses between two commands | `getLiveFrog()` recomputes decay/death on every read, so status/feed/play/cure/soothe always see current truth |
| Older frog docs missing newer fields | `normalizeFrog()` fills defaults on read so they don't crash on `undefined` |
| Large pond | `/pond view` caps the rendered scene at 30 frogs |
| Firestore write/read failure | All Firestore helpers catch and log; missing docs/fields default safely (e.g. `pondFirestoreGet` returns `null`) |
| Partial Firestore writes wiping other fields | `pondFirestoreSet()` always sends `updateMask.fieldPaths` so a write merges instead of replacing the whole document |
| Two players accepting the same open rock-fight challenge | `state.resolved` is checked-and-set synchronously before any `await`, closing the race window (Node's single-threaded event loop) |
| Stale rock-fight/hawk state outlasting a process restart | In-memory only by design (matches Imposter/Traitors/Escape Room) — a restart simply drops in-flight games/challenges rather than leaving them stuck; the persistent frog doc is unaffected |
| Hawk/rock-fight button handler throwing | `handlePondButtonInteraction`'s `try`/`catch` uses `return await handler(...)` (not bare `return handler(...)`) — a bare `return` of a rejecting promise from inside `try` does **not** get caught by the matching `catch` in JS, which would otherwise risk an unhandled rejection crashing the process (no global `unhandledRejection` handler exists in this bot) |

---

## Interaction Handler Location

Dispatched from `client.on('interactionCreate', ...)` in `index.js`, *before* the main
slash-command `if` chain:

```js
if (interaction.isChatInputCommand() && isPondCommand(interaction.commandName)) {
    if (botFeatures.pondFrogs === false) return interaction.reply({ content: 'The Pond is currently disabled.', ephemeral: true });
    return handlePondInteraction(interaction);
}
if (interaction.isButton() && isPondButton(interaction.customId)) {
    if (botFeatures.pondFrogs === false) return interaction.reply({ content: 'The Pond is currently disabled.', ephemeral: true });
    return handlePondButtonInteraction(interaction);
}
```

Slash-command subcommand routing (`adopt`/`feed`/`play`/`cure`/`soothe`/`status`/
`leaderboard`/`explore`/`hawk`/`lilypad info|upgrade`/`rockfight challenge|any`/
`career info|choose|respec`/`view`/`memorial`/`rules`/`shop buy`) happens inside
`handlePondInteraction()`; button routing (`pond:hawk:<cell>`, `pond:rf:accept`,
`pond:rf:decline`) happens inside `handlePondButtonInteraction()`, both in `pond.js`. Pond
buttons are intercepted before the giant `imp:`/`trt:`/`esc:` button chain elsewhere in
`index.js`, same as pond slash commands already were.
