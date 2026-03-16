/**
 * Seed the Firestore knowledgeBase collection with TrueBeast content.
 *
 * Run once:  node seed-knowledge.js
 *
 * BEFORE running, temporarily update your Firestore rules so
 * knowledgeBase allows writes (see instructions printed below).
 * After seeding, revert the rules.
 */

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
        id: 'about-truebeast',
        topic: 'About TrueBeast',
        content: `TrueBeast (Kiernen Irons) is a content creator and streamer who builds free tools for streamers. The TrueBeast website is at truebeast.io and includes a free toolkit of tools built specifically for streamers and content creators. All tools are completely free to use.`,
    },
    {
        id: 'multi-stream-chat',
        topic: 'Multi-Stream Chat Tool',
        content: `The Multi-Stream Chat tool lets you combine Twitch, Kick, and YouTube live chats into one OBS dock or chat overlay. No account login is needed for Twitch or Kick — just enter the channel name. YouTube requires a channel name. Once configured, click Generate to get a URL you can paste into OBS as a Browser Source (overlay) or Browser Dock. Access it at truebeast.io/tools/multichat/`,
    },
    {
        id: 'socials-rotator',
        topic: 'Social Media Rotator Tool',
        content: `The Social Media Rotator is an OBS overlay that rotates through your social media handles on screen. You enter your Twitch, Kick, YouTube, TikTok, Instagram, and Twitter/X usernames, then click Generate to get a URL for OBS Browser Source. It cycles through each platform automatically. Access it at truebeast.io/tools/socials-rotator/`,
    },
    {
        id: 'qr-generator',
        topic: 'QR Code Generator Tool',
        content: `The QR Generator lets you create a QR code overlay for OBS — useful for showing your social links or stream URL on screen. Enter any URL, customise the size and colours, then use the generated URL as an OBS Browser Source. Access it at truebeast.io/tools/qr-generator/`,
    },
    {
        id: 'ripple',
        topic: 'Ripple Tool',
        content: `Ripple is an OBS stream announcement tool. Build a message with custom text, embeds, colours, and Discord mentions, then send it directly to your Discord server from the tool. Also supports posting stream announcements to Discord with roles pings. Access it at truebeast.io/tools/ripple/`,
    },
    {
        id: 'buttonboard',
        topic: 'ButtonBoard Tool',
        content: `ButtonBoard turns any phone or tablet into a free stream deck alternative. You design a button grid on the TrueBeast website, generate a QR code, scan it on your phone, then download the companion app on your PC or Mac. Buttons can trigger keyboard shortcuts, media keys, open apps, or type text. The companion app runs in the background and communicates over WiFi. Note: this tool is currently a work in progress. Access it at truebeast.io/tools/buttonboard/`,
    },
    {
        id: 'toolkit-overview',
        topic: 'TrueBeast Toolkit — Overview',
        content: `The TrueBeast Toolkit at truebeast.io/tools/ contains all free tools built by Kiernen. Current tools include: Multi-Stream Chat, Social Media Rotator, QR Generator, Ripple (Discord announcements), and ButtonBoard (stream deck alternative). More tools are planned. All tools are browser-based and require no download except ButtonBoard's companion app.`,
    },
    {
        id: 'obs-browser-source',
        topic: 'Adding a Tool to OBS as a Browser Source',
        content: `To add any TrueBeast overlay tool to OBS: 1) Generate the overlay URL from the tool's page. 2) In OBS, click the + button in the Sources panel. 3) Select "Browser". 4) Give it a name and click OK. 5) Paste the URL into the URL field. 6) Set width/height as needed (usually 1920×1080 for fullscreen overlays). 7) Click OK. The overlay will appear in your scene.`,
    },
    {
        id: 'obs-browser-dock',
        topic: 'Adding Multi-Stream Chat as an OBS Dock',
        content: `To use Multi-Stream Chat as an OBS dock (so it appears inside OBS like a panel): 1) Generate the dock URL from the Multi-Stream Chat builder. 2) In OBS, go to View → Docks → Custom Browser Docks. 3) Enter a name (e.g. "Multi-Chat") and paste the URL. 4) Click Apply. The chat panel will appear as a dockable panel inside OBS.`,
    },
    {
        id: 'support-and-contact',
        topic: 'Support and Contact',
        content: `For help with TrueBeast tools, ask in this Discord server. You can also DM TrueBeast directly. For bugs or feature requests, mention them in the appropriate channel. TrueBeast is active on Twitch, YouTube, Kick, TikTok, and Instagram — all handles can be found at truebeast.io.`,
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
    console.log(`Project: ${PROJECT}`);
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

    console.log(`\n${ok}/${KNOWLEDGE.length} documents written successfully.`);
    if (ok < KNOWLEDGE.length) {
        console.log('\n⚠️  Some writes failed. Make sure your Firestore rules allow writes to knowledgeBase:');
        console.log('   match /knowledgeBase/{doc} { allow read, write: if true; }');
        console.log('   After seeding, change write back to: allow write: if false;');
    } else {
        console.log('\n✅  Done! Remember to revert your Firestore write rules:');
        console.log('   match /knowledgeBase/{doc} { allow read: if true; allow write: if false; }');
    }
}

seed();
