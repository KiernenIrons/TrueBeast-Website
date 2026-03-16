require('dotenv').config();

const PROJECT  = process.env.FIREBASE_PROJECT_ID;
const API_KEY  = process.env.FIREBASE_API_KEY;

if (!PROJECT || !API_KEY) {
    console.error('Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY in .env');
    process.exit(1);
}

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/knowledgeBase`;

const KNOWLEDGE = [
    {
        id: 'about-kiernen',
        topic: 'About Kiernen (TrueBeast)',
        content: `Kiernen Irons is TrueBeast — a content creator, streamer, and IT professional. Born in South Africa, lives in Ireland, and sounds American apparently. He makes gaming videos on YouTube and streams there too (moved from Twitch because Twitch sucks now). He's pretty inconsistent with uploads but passionate about growing as a creator.

He plays all kinds of games — horror, battle royales (big Apex Legends fan), cosy games, and is open to suggestions from the community for videos and streams. Not a fan of MOBAs though.

He's working on vlog-style content at some point. Personal facts: 3 sisters (2 older, 1 younger). IT professional by day. Single but not actively looking — won't say no to the right person though. He's straight. No pets, but his sister has a dog.`,
    },
    {
        id: 'about-truebeast-website',
        topic: 'About TrueBeast (brand & website)',
        content: `TrueBeast is Kiernen's brand. The website truebeast.io is a hub that showcases him as a creator, hosts free tools for streamers, and serves as a home for the community.

Why he built it: to showcase himself as a creator, advertise the community, and share genuinely useful tools and software recommendations. He's been around enough niche software to know what's good, and he wants to pass that on. Also built it for fun and to learn about web hosting — programming websites is something he's very familiar with, though this one was built with Claude AI.

Target audience: gamers, people into other people's lives, fans of game/movie nights, people who want a chill place to hang out. Pretty open for now.`,
    },
    {
        id: 'socials',
        topic: 'Kiernen\'s Social Media & Links',
        content: `All of Kiernen's socials:
- **YouTube:** @realtruebeast (main platform — most followers/subscribers here)
- **Twitch:** @realtruebeast (less active, moved to YouTube)
- **TikTok:** @realtruebeast
- **Kick:** @realtruebeast
- **Instagram:** @kiernen_100
- **Twitter/X:** @realtruebeast
- **Discord:** discord.gg/Nk8vekY
- **Website:** truebeast.io`,
    },
    {
        id: 'streaming-schedule',
        topic: 'Streaming Schedule',
        content: `There's no fixed streaming schedule — Kiernen streams when he feels like it. If he's planning to go live, he'll post in <#1324878590101159957> or <#1465840284415037633> in Discord first. If there's a notification there, you can bet he's live.

He streams on YouTube (@realtruebeast).`,
    },
    {
        id: 'events',
        topic: 'Community Events (Game Night & Movie Night)',
        content: `**Game Night:** Every Friday at 7pm
**Movie Night:** Every Saturday at 7pm

For more details on upcoming events — what game is being played, what movie is being watched — check <#1465840284415037633> in the Discord server. Details are posted there ahead of time.`,
    },
    {
        id: 'discord-server',
        topic: 'Discord Server',
        content: `The TrueBeast Discord is a chill community for gamers and people who just want somewhere relaxed to hang out. Events, announcements, gaming chat, movie nights, and more.

**Join here:** discord.gg/Nk8vekY

Game nights are Fridays at 7pm, movie nights are Saturdays at 7pm. Check <#1465840284415037633> for what's on.`,
    },
    {
        id: 'server-rules',
        topic: 'Server Rules',
        content: `The vibe is chill but there are standards. Short version: don't be a genuine asshole, don't be weird or creepy. Anyone who is will be removed without question.

Full rules:
1. **Respect is mandatory** — no harassment, intimidation, dogpiling, or targeting people
2. **No unsolicited DMs or friend requests** — zero tolerance. Only contact members with clear public consent
3. **No doxxing** — sharing personal info without consent is an instant ban
4. **Keep content appropriate** — usernames, avatars, bios, and shared content must be server-safe
5. **No spam or disruptive behaviour** — no message flooding, excessive tagging, attention farming, or derailing chats
6. **No politics or religious debates** — consistently causes conflict, not allowed
7. **No illegal content** — no piracy links, hacking tools, scams, or anything illegal
8. **NSFW only in designated channels** (if enabled), following Discord ToS
9. **Follow staff decisions** — decisions are final, appeals go to DMs or modmail
10. **No ban evasion or alt accounts** — using alts to bypass moderation = permanent removal
11. **Protect privacy** — no sharing screenshots of private conversations without consent
12. **Stay on-topic** — use the correct channels`,
    },
    {
        id: 'tech-support',
        topic: 'Tech Support',
        content: `Kiernen provides tech support through the website. For personalised help, submit a ticket at: **truebeast.io/tech-support/**

Beast Bot can also help with general tech questions — things like driver updates, OBS setup, PC troubleshooting, streaming configuration, etc. Just ask.`,
    },
    {
        id: 'ripple',
        topic: 'Ripple Tool',
        content: `Ripple lets you send announcements to multiple platforms at once. Build a rich message with custom text, embeds, colours, and Discord mentions — then fire it off to your Discord server and other platforms simultaneously. Great for stream announcements.

Access it at **truebeast.io/tools/ripple/**`,
    },
    {
        id: 'multi-stream-chat',
        topic: 'Multi-Stream Chat Tool',
        content: `Combines Twitch, Kick, and YouTube live chats into one OBS dock or overlay. No login needed for Twitch or Kick — just enter the channel name.

Generate a URL and add it to OBS as a Browser Source (overlay) or Browser Dock. Note: work in progress.

**truebeast.io/tools/multichat/**`,
    },
    {
        id: 'socials-rotator',
        topic: 'Social Media Rotator Tool',
        content: `An OBS overlay that cycles through your social media handles on screen. Enter your platform usernames, click Generate, and use the URL as an OBS Browser Source.

**truebeast.io/tools/socials-rotator/**`,
    },
    {
        id: 'qr-generator',
        topic: 'QR Code Generator Tool',
        content: `Creates a customisable QR code overlay for OBS. Enter a URL, set your colours and size, then add the generated URL as an OBS Browser Source — great for showing your socials on stream.

**truebeast.io/tools/qr-generator/**`,
    },
    {
        id: 'buttonboard',
        topic: 'ButtonBoard Tool',
        content: `Turns any phone or tablet into a free stream deck. Design a button grid on the website, download the companion app for PC/Mac, and tap buttons on your phone to trigger shortcuts, media keys, open apps, or type text. No Elgato hardware needed.

Note: work in progress. **truebeast.io/tools/buttonboard/**`,
    },
    {
        id: 'toolkit-overview',
        topic: 'TrueBeast Toolkit Overview',
        content: `All tools are completely free and browser-based. Find them at **truebeast.io/tools/**

- **Multi-Stream Chat** — combine Twitch, Kick, YouTube chat into one OBS overlay (WIP)
- **Social Media Rotator** — cycle your socials as an OBS overlay
- **QR Generator** — customisable QR code OBS overlay
- **Ripple** — send announcements to multiple platforms at once
- **ButtonBoard** — turn your phone/tablet into a stream deck (WIP)

More tools planned. No downloads required except ButtonBoard's companion app.`,
    },
    {
        id: 'obs-setup',
        topic: 'Adding a Tool to OBS',
        content: `**As a Browser Source (overlay):**
1. Generate the URL from the tool page
2. OBS → Sources panel → click + → Browser
3. Paste the URL, set width/height (usually 1920×1080)
4. Click OK

**As a Browser Dock (panel inside OBS) — for Multi-Stream Chat:**
1. Generate the dock URL from truebeast.io/tools/multichat/
2. OBS → View → Docks → Custom Browser Docks
3. Enter a name, paste the URL → Apply`,
    },
];

async function addDocument(id, data) {
    const url = `${BASE_URL}/${id}?key=${API_KEY}`;
    const body = {
        fields: {
            topic:   { stringValue: data.topic },
            content: { stringValue: data.content },
        },
    };

    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to write ${id}: ${res.status} ${err}`);
    }
    return res.json();
}

async function seed() {
    console.log('\n📋  TrueBeast Knowledge Base Seeder');
    console.log('─────────────────────────────────────');
    console.log(`Documents to seed: ${KNOWLEDGE.length}\n`);

    let ok = 0;
    for (const item of KNOWLEDGE) {
        process.stdout.write(`  Writing "${item.topic}"... `);
        try {
            await addDocument(item.id, item);
            console.log('✅');
            ok++;
        } catch (err) {
            console.log(`❌  ${err.message}`);
        }
    }
    console.log(`\n${ok}/${KNOWLEDGE.length} documents written.`);
}

seed();
