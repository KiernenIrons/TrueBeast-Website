# Trading Card Game — Setup

A Twitch channel-points redeem ("Open a Card Pack") that draws cards server-side,
writes them live to Firestore, plays a pack-opening animation on an OBS overlay,
and shows a public leaderboard/collection browser at `truebeast.io/cards`.

Everything you'd tune day-to-day (pack size, reveal timing, rarity odds, which
card set is active) lives in **`src/cards/config.ts`** — no other file needs
touching for that. This doc is the one-time infrastructure setup.

If you're a **different streamer forking this repo** to run your own TCG, skip to
["Running your own instance"](#running-your-own-instance-other-streamers) at the bottom first.

---

## 1. Twitch Developer Console app

If you already have a Twitch app registered (TrueBeast's does, for the VIP-role
Twitch-sub check in `cloudflare-worker/email-proxy.js`), you can reuse the same
Client ID/Secret — no need to register a second app. Otherwise:

1. Go to https://dev.twitch.tv/console/apps → **Register Your Application**
2. Name: anything (e.g. "TrueBeast Cards"). OAuth Redirect URL: leave blank for
   now — you'll add the real one in step 4 once the Worker is deployed.
3. Category: "Game Integration". Save, then copy the **Client ID** and generate
   a **Client Secret**.

## 2. Firebase project (dedicated — separate from `truebeast-support`)

1. https://console.firebase.google.com → **Create a project** → name it
   `truebeast-cards` (or similar) → disable Analytics → Create.
2. **Build → Firestore Database → Create database** → production mode → pick a
   region → Enable.
3. **Rules** tab → paste:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /packEvents/{eventId} {
         allow read:  if true;   // public — overlay + library read live
         allow write: if false;  // server-only, via Worker's service account
       }
       match /userCollections/{docId} {
         allow read:  if true;   // public — leaderboard + profile pages
         allow write: if false;  // server-only
       }
       match /redemptions/{redemptionId} {
         allow read, write: if false; // idempotency markers, admin-only
       }
     }
   }
   ```

   → **Publish**.
4. **Project Settings** (gear icon) → **Your apps** → Web icon (`</>`) → register
   an app → copy the config values into `CARDS_FIREBASE_CONFIG` in
   `src/cards/config.ts`.
5. **Project Settings → Service Accounts → Generate new private key** → downloads
   a JSON file. You'll need its `client_email` and `private_key` fields for the
   Worker secrets in step 4 below.

## 3. Create the Channel Points reward

Twitch Creator Dashboard → **Viewer Rewards → Channel Points → Manage Rewards**
→ **Add New Custom Reward**. Title it exactly what `CARDS_CONFIG.rewardName`
says (default: "Open a Card Pack"), set a cost/image, save.

You do **not** need its Reward ID yet — getting a Custom Reward's ID requires a
broadcaster-authorized user token (an app access token alone gets rejected with
"Missing User OAuth Token"), and step 5 below already produces exactly that
kind of token as part of the one-time authorization. The callback page there
lists all your rewards with their IDs for you automatically.

## 4. Deploy the Cloudflare Worker

Same method you already use for `email-proxy.js` — no CLI needed:

1. Cloudflare dashboard → **Workers & Pages → Create → Create Worker**, name it
   `truebeast-cards`, deploy the default template.
2. Open it → **Edit code** → delete the placeholder → paste in the entire
   contents of `cloudflare-worker/cards-worker/index.js` → **Deploy**.
3. Note the URL it gives you (e.g. `https://truebeast-cards.your-subdomain.workers.dev`).
4. Worker → **Settings → Variables and Secrets → Add** — add each of these
   (mark everything **except** `WORKER_ORIGIN` as "Encrypt"/secret, same as
   your other worker's secrets):

   | Name | Value |
   |---|---|
   | `TWITCH_CLIENT_ID` | from step 1 |
   | `TWITCH_CLIENT_SECRET` | from step 1 |
   | `TWITCH_BROADCASTER_ID` | same value already set on your `email-proxy` worker for VIP checks |
   | `TWITCH_EVENTSUB_SECRET` | any long random string you invent |
   | `OAUTH_STATE_SECRET` | any long random string you invent |
   | `FIREBASE_PROJECT_ID` | your `truebeast-cards` project ID |
   | `FIREBASE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the service account JSON |
   | `FIREBASE_SERVICE_ACCOUNT_KEY` | `private_key` from the service account JSON (keep the `\n`s) |
   | `WORKER_ORIGIN` | the worker's own URL from step 3 (not a secret, plain variable) |

   `TWITCH_REWARD_ID` is set in step 5, below — deploy without it first.
5. Worker → **Settings → Triggers → Cron Triggers → Add** → schedule
   `0 */6 * * *` (keeps the EventSub subscription alive automatically).

(If you'd rather use the `wrangler` CLI instead of the dashboard, `wrangler.toml`
in that same folder works too — `wrangler deploy` then `wrangler secret put NAME`
for each row above. Either method produces the same result.)

Also set that same URL + `/oauth/callback` as an **OAuth Redirect URL** on your
Twitch app (dev console → your app → Manage → OAuth Redirect URLs).

## 5. One-time broadcaster authorization

Visit `<your-worker-url>/oauth/start` in a browser **while logged into Twitch as
the broadcaster** and approve the request. Only the broadcaster can authorize
this specific event type — that's a Twitch platform rule, not a bug here.

The callback page shows a **list of your custom rewards with their IDs** —
find "Open a Card Pack" in the list and save its `id` as the `TWITCH_REWARD_ID`
secret. (Nothing else from this page needs saving — the actual EventSub
subscription is created using an app access token, not anything from this
consent step; the consent just needs to happen once so Twitch has this scope
on file for the broadcaster + Client ID.)

Once `TWITCH_REWARD_ID` is saved, visit `/oauth/start` **one more time** — now
that it exists, the callback page automatically creates the EventSub
subscription and shows you the result.

(The cron trigger in `wrangler.toml` re-checks this subscription every 6 hours
and recreates it automatically if Twitch ever revokes it, so this is truly
one-time.)

## 6. OBS overlay

Add a **Browser Source** in OBS pointing at:
```
https://truebeast.io/overlay/cards
```
Transparent background, no interaction needed — it plays automatically the
instant someone redeems, straight from Firestore's realtime listener (no
extra polling or websocket infra involved).

## 7. Twitch Panel (ships today)

Creator Dashboard → your channel page → **Edit Panels → Add Panel → Image** →
upload any image, set the link to `https://truebeast.io/cards`. This is a
static image + single link — Twitch doesn't support per-row click targets in a
plain Panel. Real click-through-to-profile interactivity needs a Panel
Extension (next section).

## 8. Fast-follow: interactive Panel Extension

For "click a name in the panel → jump straight to their profile," build a
Twitch Panel Extension (a small standalone web app Twitch embeds in an iframe)
and submit it for review — Twitch review is required before real viewers (not
just your own whitelisted test accounts) can see it, so submit early and let
it run in the background while everything else above is already live. Ask
whoever picks this up next to scaffold it with the [Developer Rig](https://dev.twitch.tv/docs/extensions/getting-started/)
and point its data reads at the same public `userCollections`/leaderboard
Firestore query already used by `src/pages/cards/Leaderboard.tsx`.

---

## Customizing (no infra changes needed)

All of this lives in `src/cards/config.ts`:
- `packSize` — cards per pack
- `revealDurationSeconds` — how long each card stays on screen during the overlay reveal
- `RARITIES` — rarity tiers, draw-odds `weight`, and leaderboard `value`
- `activeCardSet` — which folder under `card-sets/` this instance uses

To add your own cards, copy `card-sets/starter/cards.json`'s shape into a new
folder (e.g. `card-sets/my-set/cards.json`) and point `activeCardSet` at it.

## Running your own instance (other streamers)

Twitch requires every broadcaster to individually authorize EventSub for their
own channel — there's no way around that, so there's no shared multi-tenant
service to sign up for here. Instead:

1. Fork this repo.
2. Follow steps 1–5 above with **your own** Twitch app, Firebase project, and
   Cloudflare account (all free tiers).
3. Either pick one of the premade folders under `card-sets/` or author your own
   following the same JSON shape, then point `CARDS_CONFIG.activeCardSet` at it.
4. Deploy the site (same GitHub Pages + Cloudflare setup already documented for
   the main `src/config.ts` Firebase section).

Nothing above requires the original TrueBeast Firebase/Twitch/Cloudflare
accounts — every streamer's instance is fully independent.
