require('dotenv').config();

const PROJECT  = process.env.FIREBASE_PROJECT_ID;
const API_KEY  = process.env.FIREBASE_API_KEY;
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/knowledgeBase`;

const DOCS = [
    {
        id: 'about-kiernen',
        topic: 'About Kiernen (TrueBeast)',
        content: `Kiernen Irons is TrueBeast — a content creator, streamer, and IT professional. Born in South Africa, lives in Ireland, sounds American apparently. He's 25 years old (born July 31, 2000).

He makes gaming videos on YouTube and streams there too (moved from Twitch because Twitch sucks now). Pretty inconsistent with uploads — his words — but he's passionate about growing as a creator.

He plays all kinds of games — horror, battle royales, cosy games, and is open to suggestions from the community. Not a fan of MOBAs.

Personal facts: 3 sisters (2 older, 1 younger). IT professional by day. Single but not actively looking — won't say no to the right person. He's straight. No pets, but his sister has a dog.`,
    },
    {
        id: 'content-style',
        topic: 'Kiernen\'s Content Style',
        content: `Kiernen's content is casual and genuine. When he plays games it's simple — load up a game, have a good time. No tryhard energy.

When he makes talking-to-camera videos he's super chill. He used to script himself to stay on topic but it made him sound like a robot, so he scrapped that. Now he just sits down and talks until he's said what he needs to say. What you see is what you get — no performance, just him being himself.

He's working on vlog-style content at some point too.`,
    },
    {
        id: 'community-vibe',
        topic: 'TrueBeast Community Vibe',
        content: `The TrueBeast community is genuinely diverse — people from all over the world, guys and girls, couples and singles, gamers and non-gamers, young and old. It's not built around one specific type of person or game.

The server is for everybody. It's a chill place to hang out, join game nights, watch movies together, and just vibe. Nobody gets rejected unless they're being a genuine asshole or creeping people out.

Join at: discord.gg/Nk8vekY`,
    },
    {
        id: 'software-recommendations',
        topic: 'Software Recommendations',
        content: `Kiernen has been around enough niche software to know what's worth using. His personal software recommendations are listed on the toolkit page at **truebeast.io/tools/** — scroll towards the bottom to find the recommendations section. Each one has a link to the download page.

The list will keep growing over time as he finds more tools worth recommending.`,
    },
    {
        id: 'giveaways',
        topic: 'Giveaways',
        content: `TrueBeast runs giveaways for the community. You can find a full list of past giveaways, current giveaways, and upcoming giveaways on the giveaway page at **truebeast.io** — check the navigation for the Giveaways section.`,
    },
    {
        id: 'streaming-plans',
        topic: 'Future Plans & Streaming',
        content: `No big announcements right now. Kiernen wants to keep making videos and streaming — he's just lazy (his words). When he does go live or drop something new, he'll post in the #announcements or #events channel in Discord first. That's your best bet for staying in the loop.`,
    },
];

async function upsert(id, data) {
    const res = await fetch(`${BASE_URL}/${id}?key=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: {
                topic:   { stringValue: data.topic },
                content: { stringValue: data.content },
            },
        }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

(async () => {
    console.log(`\nSeeding ${DOCS.length} docs...\n`);
    let ok = 0;
    for (const doc of DOCS) {
        process.stdout.write(`  ${doc.topic}... `);
        try { await upsert(doc.id, doc); console.log('✅'); ok++; }
        catch (e) { console.log(`❌ ${e.message}`); }
    }
    console.log(`\n${ok}/${DOCS.length} done.`);
})();
