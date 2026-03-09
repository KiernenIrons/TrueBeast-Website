/* ============================================================
   Clout Clicker — Game Data
   Buildings, Upgrades, Achievements
   ============================================================ */

/* ── Number formatter ─────────────────────────────────────── */
function formatNumber(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    if (n >= 1e24) return (n/1e24).toFixed(2) + ' Sp';
    if (n >= 1e21) return (n/1e21).toFixed(2) + ' Sx';
    if (n >= 1e18) return (n/1e18).toFixed(2) + ' Qi';
    if (n >= 1e15) return (n/1e15).toFixed(2) + ' Qa';
    if (n >= 1e12) return (n/1e12).toFixed(2) + ' T';
    if (n >= 1e9)  return (n/1e9).toFixed(2)  + ' B';
    if (n >= 1e6)  return (n/1e6).toFixed(2)  + ' M';
    if (n >= 1e3)  return (n/1e3).toFixed(2)  + ' K';
    if (n >= 100)  return Math.floor(n).toLocaleString();
    if (n >= 10)   return n.toFixed(1);
    if (n >= 1)    return n.toFixed(2);
    if (n > 0)     return n.toFixed(1);
    return '0';
}

function formatTime(seconds) {
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/* ── Buildings ────────────────────────────────────────────── */
const BUILDINGS = [
    { id: 'viewer',      name: 'Viewer',            emoji: '👀', baseCps: 0.1,         baseCost: 15,                desc: 'A loyal fan who watches your content on repeat.' },
    { id: 'chatter',     name: 'Stream Chatter',    emoji: '💬', baseCps: 0.5,         baseCost: 100,               desc: 'An engaged viewer spamming emotes in your chat.' },
    { id: 'clipEditor',  name: 'Clip Editor',       emoji: '✂️', baseCps: 4,           baseCost: 1100,              desc: 'Churns out viral clips from your stream 24/7.' },
    { id: 'gamingPC',    name: 'Gaming PC',          emoji: '🖥️', baseCps: 15,          baseCost: 12000,             desc: 'A monster rig pushing your content quality through the roof.' },
    { id: 'studio',      name: 'Streaming Studio',  emoji: '🎙️', baseCps: 100,         baseCost: 130000,            desc: 'A pro-grade studio for maximum streaming output.' },
    { id: 'sponsor',     name: 'Sponsor Deal',      emoji: '💰', baseCps: 400,         baseCost: 1400000,           desc: 'A brand deal that converts money into pure Clout.' },
    { id: 'merch',       name: 'Merch Store',       emoji: '👕', baseCps: 6666,        baseCost: 20000000,          desc: 'Fans buying your merch spreads your brand everywhere.' },
    { id: 'esports',     name: 'Esports Team',      emoji: '🏆', baseCps: 28888,       baseCost: 330000000,         desc: 'A pro team winning tournaments in your name.' },
    { id: 'agency',      name: 'Content Agency',    emoji: '🏢', baseCps: 153600,      baseCost: 5100000000,        desc: 'An agency of creators all under your brand umbrella.' },
    { id: 'algorithm',   name: 'Viral Algorithm',   emoji: '📈', baseCps: 921600,      baseCost: 75000000000,       desc: "You've cracked the algorithm. It works for you now." },
    { id: 'empire',      name: 'Gaming Empire',     emoji: '👑', baseCps: 5734400,     baseCost: 1000000000000,     desc: 'An empire spanning every gaming platform on Earth.' },
    { id: 'tournament',  name: 'World Tournament',  emoji: '🌍', baseCps: 36864000,    baseCost: 14000000000000,    desc: 'You run a global gaming tournament watched by billions.' },
    { id: 'realityShow', name: 'Reality Show',      emoji: '📺', baseCps: 250000000,   baseCost: 210000000000000,   desc: 'A prime-time gaming reality show running 24/7.' },
    { id: 'metaverse',   name: 'Digital Metaverse', emoji: '🌐', baseCps: 1666666666,  baseCost: 3200000000000000,  desc: 'You own an entire virtual world built around gaming.' },
    { id: 'cosmic',      name: 'Cosmic Broadcast',  emoji: '🚀', baseCps: 11500000000, baseCost: 47000000000000000, desc: 'Your content is broadcast across the cosmos itself.' },
];

/* Building cost formula */
function getBuildingCost(building, owned, qty) {
    qty = qty || 1;
    // Sum of geometric series: baseCost * 1.15^owned * (1.15^qty - 1) / (1.15 - 1)
    if (qty === 1) return Math.ceil(building.baseCost * Math.pow(1.15, owned));
    return Math.ceil(building.baseCost * Math.pow(1.15, owned) * (Math.pow(1.15, qty) - 1) / 0.15);
}

function getMaxAffordable(building, owned, clout) {
    let qty = 0;
    let cost = 0;
    while (true) {
        const nextCost = Math.ceil(building.baseCost * Math.pow(1.15, owned + qty));
        if (cost + nextCost > clout) break;
        cost += nextCost;
        qty++;
        if (qty > 10000) break;
    }
    return { qty, cost };
}

/* ── Upgrades ─────────────────────────────────────────────── */
// Building tier upgrade names
const BUILDING_UPGRADE_TIERS = [
    // viewer
    ['Fan Favorite','Loyal Followers','Subscriber Surge','Binge Watch','Super Fan','Fan Army','Legendary Fanbase','Viewer Deity'],
    // chatter
    ['Hype Train','Emote Overload','Chat MVP','Mass Hysteria','Sub Gifter','Wholesome Spam','Prime Time Chat','Infinite Hype'],
    // clipEditor
    ['Quick Cuts','Viral Edit','Highlight Factory','Cut Master','Clip God','Trending Machine','Algorithm Bait','Clip Empire'],
    // gamingPC
    ['Overclock I','RGB Everything','Water Cooling','Dual GPU','Custom Loop','1000 FPS','God Rig','Quantum Core'],
    // studio
    ['Soundproofing','4K Cameras','Green Screen','Pro Audio','Broadcast Suite','Hollywood Setup','Cinematic Studio','Cosmic Stage'],
    // sponsor
    ['Brand Mention','Sponsored Video','Long-Term Deal','Multi-Brand','Major Label','Fortune 500','Global Brand','Universal Patron'],
    // merch
    ['Logo Tee','Limited Drop','Collab Merch','Flagship Store','World Tour','Merch Empire','Luxury Line','Cultural Icon Drop'],
    // esports
    ['Team Roster','Tournament Ready','Championship Run','World Stage','Dynasty','Hall of Fame','Legendary Roster','Immortal Squad'],
    // agency
    ['Talent Pool','Creator Network','Premium Roster','Industry Deals','Media Conglomerate','Agency Titan','Global Network','Infinite Creators'],
    // algorithm
    ['SEO Boost','Trending Tags','Recommendation Engine','Search Domination','Viral Matrix','Platform God','Code of the Gods','Omniscient Feed'],
    // empire
    ['Multi-Platform','Brand Everywhere','Digital Domination','Industry Giant','Media King','World Empire','Galactic Brand','Infinite Empire'],
    // tournament
    ['Regional Event','National Cup','Continental Championship','World Series','Reality Cup','Galactic Games','Universal Tournament','Cosmic Cup'],
    // realityShow
    ['Pilot Season','Prime Time','Season Two','Emmy Sweep','Global Broadcast','Streaming Giant','Reality God','Eternal Broadcast'],
    // metaverse
    ['Beta World','Full Launch','Metaverse Market','Digital Nation','Virtual God','Infinite Worlds','Universe Owner','Cosmic Metaverse'],
    // cosmic
    ['First Signal','Galactic FM','Stellar Network','Nebula Cast','Black Hole Broadcast','Quantum Stream','Universal Feed','Cosmic Omnipresence'],
];

function generateUpgrades() {
    const ups = [];
    let id = 0;

    // 1. Building tier upgrades (15 buildings × 8 tiers = 120)
    const thresholds = [1, 5, 25, 50, 100, 150, 200, 250];
    BUILDINGS.forEach((b, bi) => {
        thresholds.forEach((thresh, ti) => {
            const names = BUILDING_UPGRADE_TIERS[bi];
            const name = names[ti];
            const cost = Math.ceil(b.baseCost * Math.pow(10, ti * 0.8 + 1));
            ups.push({
                id: `bup_${b.id}_${ti}`,
                name: name,
                desc: `Your ${b.name}s produce twice as much Clout. (Own ${thresh} ${b.name}s)`,
                cost: cost,
                emoji: b.emoji,
                type: 'building_mult',
                buildingId: b.id,
                multiplier: 2,
                condition: (s) => (s.buildings[b.id] || 0) >= thresh,
            });
            id++;
        });
    });

    // 2. Click power upgrades (5 tiers)
    const clickNames = ['Double Click','Power Click','Hyper Click','Ultra Click','Godly Click'];
    const clickCosts = [100, 500, 50000, 5000000, 500000000];
    const clickThresh = [0, 500, 5000, 50000, 500000];
    clickNames.forEach((name, i) => {
        ups.push({
            id: `click_${i}`,
            name: name,
            desc: `Double your click power. (Have clicked ${formatNumber(clickThresh[i])} times)`,
            cost: clickCosts[i],
            emoji: '👆',
            type: 'click_mult',
            multiplier: 2,
            condition: (s) => s.clicks >= clickThresh[i],
        });
    });

    // 3. Golden Clout upgrades (5)
    const goldenNames = ['Golden Fingers','Golden Touch','Gold Rush','Golden Aura','Fortune of the Feed'];
    const goldenCosts = [77777, 777777, 7777777, 77777777, 777777777];
    const goldenThresh = [1, 7, 27, 77, 777];
    goldenNames.forEach((name, i) => {
        ups.push({
            id: `golden_up_${i}`,
            name: name,
            desc: `Golden Clout effects last 10% longer. (Click ${goldenThresh[i]} golden clouts)`,
            cost: goldenCosts[i],
            emoji: '✨',
            type: 'golden_duration',
            multiplier: 1.1,
            condition: (s) => s.goldenCloutClicks >= goldenThresh[i],
        });
    });

    // 4. Total clout milestone upgrades (10)
    const milestoneData = [
        { name: 'Rising Presence', cost: 1000, thresh: 1000, emoji: '🌱', desc: 'A good start. Boost all production by 5%.' },
        { name: 'Content Creator', cost: 50000, thresh: 100000, emoji: '🎬', desc: 'You\'re officially a creator. +5% global CPS.' },
        { name: 'Trending Creator', cost: 500000, thresh: 1000000, emoji: '🔥', desc: 'You\'re trending. +5% global CPS.' },
        { name: 'Viral Royalty', cost: 5000000, thresh: 10000000, emoji: '👑', desc: 'Everyone knows your name. +5% global CPS.' },
        { name: 'Platform King', cost: 50000000, thresh: 100000000, emoji: '🏅', desc: 'You rule the platform. +5% global CPS.' },
        { name: 'Internet Legend', cost: 5e8, thresh: 1e9, emoji: '⚡', desc: 'Legends never die. +5% global CPS.' },
        { name: 'Cultural Force', cost: 5e9, thresh: 1e10, emoji: '🌊', desc: 'You shape culture itself. +5% global CPS.' },
        { name: 'Digital Myth', cost: 5e11, thresh: 1e12, emoji: '🧬', desc: 'Your story is retold forever. +5% global CPS.' },
        { name: 'Transcendent', cost: 5e14, thresh: 1e15, emoji: '🌌', desc: 'Beyond mortal comprehension. +5% global CPS.' },
        { name: 'Infinite Signal', cost: 5e17, thresh: 1e18, emoji: '♾️', desc: 'You are everywhere. +5% global CPS.' },
    ];
    milestoneData.forEach((m, i) => {
        ups.push({
            id: `milestone_${i}`,
            name: m.name,
            desc: m.desc,
            cost: m.cost,
            emoji: m.emoji,
            type: 'global_mult',
            multiplier: 1.05,
            condition: (s) => s.totalCloutEver >= m.thresh,
        });
    });

    // 5. Prestige upgrades (10 — purchasable with Viral Chips)
    const prestigeUps = [
        { id: 'prestige_0', name: 'Viral Momentum',      desc: '+5% CPS per Viral Chip.',          cost: 1,   emoji: '🧩', type: 'prestige_cps',   multiplier: 0.05 },
        { id: 'prestige_1', name: 'Golden Magnet',        desc: 'Golden Clouts appear 20% more often.', cost: 2, emoji: '🧲', type: 'golden_rate', multiplier: 0.8 },
        { id: 'prestige_2', name: 'Viral Legend',         desc: '+10% CPS bonus globally.',          cost: 3,   emoji: '🦁', type: 'global_mult', multiplier: 1.1 },
        { id: 'prestige_3', name: 'Lucky Streak',         desc: 'Lucky golden clout gives 25% more.', cost: 5,  emoji: '🍀', type: 'lucky_bonus',  multiplier: 1.25 },
        { id: 'prestige_4', name: 'Click Legacy',         desc: 'Click power +100% permanently.',    cost: 7,   emoji: '⚡', type: 'click_mult',  multiplier: 2 },
        { id: 'prestige_5', name: 'Algorithmic Mastery',  desc: 'All buildings +15% CPS.',           cost: 10,  emoji: '🤖', type: 'global_mult', multiplier: 1.15 },
        { id: 'prestige_6', name: 'Brand Everywhere',     desc: 'Offline income cap raised to 4h.',  cost: 15,  emoji: '🌐', type: 'offline_cap', multiplier: 4 },
        { id: 'prestige_7', name: 'Infinite Content',     desc: '+20% CPS globally.',                cost: 20,  emoji: '📡', type: 'global_mult', multiplier: 1.2 },
        { id: 'prestige_8', name: 'God of Clout',         desc: 'Click power ×4.',                   cost: 30,  emoji: '🌟', type: 'click_mult',  multiplier: 4 },
        { id: 'prestige_9', name: 'True Beast Mode',      desc: '+50% CPS. You are TrueBeast.',      cost: 50,  emoji: '👹', type: 'global_mult', multiplier: 1.5 },
    ];
    prestigeUps.forEach(p => {
        ups.push({
            ...p,
            condition: (s) => {
                const chips = s.viralChips || 0;
                return chips >= p.cost;
            },
            isPrestigeUpgrade: true,
        });
    });

    // 6. Synergy upgrades (15 — one per building, synergy with next building)
    const synergyData = [
        { a: 'viewer',     b: 'chatter',     name: 'Engaged Community',   desc: 'Each Viewer you own boosts Stream Chatters\' CPS by 1%.',     thresh: 10,  cost: 5000 },
        { a: 'chatter',    b: 'clipEditor',  name: 'Clip Request',         desc: 'Each Chatter boosts Clip Editors by 1%.',                      thresh: 10,  cost: 50000 },
        { a: 'clipEditor', b: 'gamingPC',    name: 'Render Farm',          desc: 'Each Clip Editor boosts Gaming PCs by 1%.',                    thresh: 10,  cost: 500000 },
        { a: 'gamingPC',   b: 'studio',      name: 'Studio PC Setup',      desc: 'Each Gaming PC boosts Studios by 1%.',                         thresh: 10,  cost: 5000000 },
        { a: 'studio',     b: 'sponsor',     name: 'Sponsor Showcase',     desc: 'Each Studio boosts Sponsor Deals by 1%.',                      thresh: 10,  cost: 50000000 },
        { a: 'sponsor',    b: 'merch',       name: 'Merch Sponsor',        desc: 'Each Sponsor Deal boosts your Merch Store by 1%.',             thresh: 10,  cost: 500000000 },
        { a: 'merch',      b: 'esports',     name: 'Team Apparel',         desc: 'Each Merch Store boosts your Esports Team by 1%.',             thresh: 10,  cost: 5e9 },
        { a: 'esports',    b: 'agency',      name: 'Pro Scouts',           desc: 'Your Esports Team recruits for your Agency (1% per team).',    thresh: 10,  cost: 5e10 },
        { a: 'agency',     b: 'algorithm',   name: 'Data-Driven Strategy', desc: 'Your Agency feeds data to your Viral Algorithm (+1% each).',   thresh: 10,  cost: 5e11 },
        { a: 'algorithm',  b: 'empire',      name: 'Empire Protocol',      desc: 'The Algorithm powers your Empire (+1% per algorithm).',        thresh: 10,  cost: 5e12 },
        { a: 'empire',     b: 'tournament',  name: 'Empire Invitational',  desc: 'Your Empire sponsors every World Tournament (+1%).',           thresh: 10,  cost: 5e14 },
        { a: 'tournament', b: 'realityShow', name: 'Show Stoppers',        desc: 'Tournaments become episodes of your Reality Show (+1%).',      thresh: 10,  cost: 5e15 },
        { a: 'realityShow',b: 'metaverse',   name: 'Virtual Premiere',     desc: 'Reality Show episodes stream live in the Metaverse (+1%).',    thresh: 10,  cost: 5e17 },
        { a: 'metaverse',  b: 'cosmic',      name: 'Digital Cosmos',       desc: 'Your Metaverse signal powers the Cosmic Broadcast (+1%).',     thresh: 10,  cost: 5e19 },
        { a: 'cosmic',     b: 'viewer',      name: 'Universal Fans',       desc: 'Cosmic Broadcasts create Viewers across the universe (+1%).',  thresh: 10,  cost: 5e21 },
    ];
    synergyData.forEach((syn, i) => {
        ups.push({
            id: `synergy_${i}`,
            name: syn.name,
            desc: syn.desc,
            cost: syn.cost,
            emoji: '🔗',
            type: 'synergy',
            buildingA: syn.a,
            buildingB: syn.b,
            synergyBonus: 0.01,
            condition: (s) => (s.buildings[syn.a] || 0) >= syn.thresh && (s.buildings[syn.b] || 0) >= 1,
        });
    });

    return ups;
}

const UPGRADES = generateUpgrades();

/* ── Achievements ─────────────────────────────────────────── */
function generateAchievements() {
    const achs = [];

    // A. Total Clout Earned milestones (26)
    const cloutMilestones = [
        [1, 'First Post', 'You made your first piece of content. The journey begins.', '📝'],
        [100, 'Getting Views', 'People are actually watching. Wild.', '👀'],
        [1000, 'Micro-Influencer', 'You have a dedicated audience of hundreds.', '🌱'],
        [10000, 'Trending', "You're showing up on people's feeds.", '🔥'],
        [100000, 'Viral Moment', "One of your posts blew up. You're officially viral.", '💥'],
        [1e6, 'Content Creator', "A million Clout. You're doing this for real.", '🎬'],
        [1e7, 'Rising Star', "The algorithm is starting to notice you.", '⭐'],
        [1e8, 'Influencer', "Brands are calling. Your community is massive.", '🤳'],
        [1e9, 'Top Creator', "Top-tier creator. Billions of Clout earned.", '🏆'],
        [1e10, 'Elite Creator', "You're in the elite tier. Untouchable.", '💎'],
        [1e11, 'Internet Famous', "Everyone on the internet knows your name.", '🌐'],
        [1e12, 'Legend', "A trillion Clout. You're a legend of the internet.", '👑'],
        [1e13, 'Gaming Icon', "Your name is synonymous with gaming.", '🎮'],
        [1e14, 'Cultural Phenomenon', "You\'ve changed the culture forever.", '🌍'],
        [1e15, 'Digital Deity', "Mortals look up at you.", '⚡'],
        [1e16, 'Multiplatform King', "You rule every platform simultaneously.", '🌟'],
        [1e17, 'Global Domination', "Every corner of the globe knows your content.", '🌏'],
        [1e18, 'Internet God', "You are the internet.", '🧬'],
        [1e19, 'Beyond Viral', "There are no words for what you are.", '♾️'],
        [1e20, 'Infinite Clout', "Clout that has no end.", '∞'],
        [1e21, 'Omnipresent', "You exist everywhere, all the time.", '🔮'],
        [1e22, 'The Algorithm', "You ARE the algorithm now.", '🤖'],
        [1e23, 'Content Singularity', "All content converges to you.", '🕳️'],
        [1e24, 'Transcendent', "Beyond human comprehension.", '🌌'],
        [1e25, 'One With The Stream', "You and streaming are one.", '🌊'],
        [1e26, 'TrueBeast', "You have achieved the ultimate title.", '🦁'],
    ];
    cloutMilestones.forEach(([thresh, name, desc, icon]) => {
        achs.push({
            id: `clout_${thresh}`,
            name, desc, icon,
            category: 'clout',
            condition: (s) => s.totalCloutEver >= thresh,
        });
    });

    // B. CPS milestones (18)
    const cpsMilestones = [
        [0.1, 'Content Trickle', 'A tiny drip of Clout flowing in.', '💧'],
        [1, 'First CPS', 'One Clout per second. Not bad.', '🐢'],
        [10, 'Getting Momentum', "Things are starting to pick up.", '🚂'],
        [100, 'Content Machine', 'A hundred Clout per second.', '⚙️'],
        [1000, 'Viral Engine', 'Your Clout machine is humming.', '🏎️'],
        [10000, 'Thousand CPS', 'Ten thousand Clout per second. Impressive.', '🚀'],
        [100000, 'CPS Legend', 'Clout is raining down on you.', '🌧️'],
        [1e6, 'Million Per Second', 'A million Clout every single second.', '💸'],
        [1e7, 'Tens of Millions', 'Beyond counting at this point.', '📊'],
        [1e8, 'Clout Waterfall', 'An unstoppable flood of Clout.', '🌊'],
        [1e9, 'Billion CPS', "A billion Clout a second. You're untouchable.", '💥'],
        [1e10, 'Clout Tsunami', 'The servers can barely keep up.', '🌪️'],
        [1e12, 'Trillion Per Second', 'One trillion Clout generated every second.', '🏦'],
        [1e15, 'Quadrillion CPS', 'Numbers that nobody has names for.', '🌌'],
        [1e18, 'Quintillion Flow', 'Quintillions generated per heartbeat.', '⚡'],
        [1e21, 'Sextillion Surge', 'The universe is made of your Clout.', '🌠'],
        [1e24, 'Septillion Supremacy', 'Septillions a second. Nothing matters anymore.', '🕳️'],
        [1e27, 'Omnipresent CPS', 'Beyond all mathematics.', '♾️'],
    ];
    cpsMilestones.forEach(([thresh, name, desc, icon]) => {
        achs.push({
            id: `cps_${thresh}`,
            name, desc, icon,
            category: 'cps',
            condition: (s) => s.cps >= thresh,
        });
    });

    // C. Click count milestones (14)
    const clickMilestones = [
        [1, 'First Click', 'You clicked. The adventure begins.', '👆'],
        [50, 'Clicker', "Fifty clicks. Keep going.", '✌️'],
        [500, 'Persistent', 'Five hundred clicks. Your finger is dedicated.', '💪'],
        [5000, 'Click Machine', "Five thousand clicks. Are you okay?", '🤖'],
        [50000, 'Click Addict', 'Fifty thousand clicks. Someone check on you.', '😅'],
        [500000, 'Click Monster', 'Half a million clicks. Absolutely unhinged.', '👹'],
        [5000000, 'Click Deity', 'Five million clicks. You have transcended.', '⚡'],
        [50000000, 'Click Legend', 'Fifty million. Your mouse is suffering.', '🖱️'],
        [5e8, 'Click God', 'A click god walks among us.', '👁️'],
        [5e9, 'Click Cosmos', 'Five billion clicks. Reality bends.', '🌌'],
        [5e10, 'Infinite Clicker', 'Your clicks echo across dimensions.', '♾️'],
        [5e11, 'Click Singularity', 'The singularity was caused by clicking.', '🕳️'],
        [5e12, 'One Trillion Clicks', 'A trillion clicks. Truly unknowable.', '∞'],
        [5e13, 'Click Transcendence', 'You have become one with the click.', '🦋'],
    ];
    clickMilestones.forEach(([thresh, name, desc, icon]) => {
        achs.push({
            id: `click_${thresh}`,
            name, desc, icon,
            category: 'clicks',
            condition: (s) => s.clicks >= thresh,
        });
    });

    // D. Per-building ownership achievements (15 buildings × 11 tiers = 165)
    const buildingOwnershipTiers = [1, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
    const buildingAchNames = {
        viewer: ['First Viewer','Small Crowd','Fan Club','Community Forming','Solid Fanbase','Army of Fans','Legion of Viewers','Viewer Battalion','Dedicated Masses','Fanatic Horde','Viewer Singularity'],
        chatter: ['First Chatter','Chat is Popping','Active Community','Spam Legends','PogChamp Army','Chat Takeover','Chatter Legion','Chat Infinite','Comment Flood','Emote Tsunami','Chat Singularity'],
        clipEditor: ['First Editor','Clip Factory','Viral Workshop','Editing Empire','Clip Dynasty','Highlight Machine','Cut God','Clip Universe','Edit Infinity','Viral Omnipresence','Clip Singularity'],
        gamingPC: ['First Rig','LAN Party','PC Master Race','Overclock City','Server Farm','Computing Empire','Digital Dominion','Processing God','Quantum Farm','Computational Infinity','PC Singularity'],
        studio: ['Home Studio','Pro Setup','Recording Empire','Studio Network','Broadcast Fleet','Studio Armada','Network of Studios','Studio Universe','Broadcast Infinity','Studio Omnipresence','Studio Singularity'],
        sponsor: ['First Deal','Brand Deals','Corporate Darling','Sponsorship King','Brand Empire','Patron of All','Sponsored Universe','Deal God','Sponsorship Infinity','Brand Omnipresence','Deal Singularity'],
        merch: ['First Tee','Small Store','Merch Queen','Brand Royalty','Merch Empire','Store Network','Merch Galaxy','Fashion God','Merch Infinity','Fashion Omnipresence','Merch Singularity'],
        esports: ['First Team','Tournament Ready','Championship Circuit','Dynasty Building','Esports Legend','Team Colossus','Tournament God','Esports Galaxy','Victory Infinity','Champion Omnipresence','Esports Singularity'],
        agency: ['Startup Agency','Growing Roster','Talent Empire','Industry Giant','Agency Network','Creator Colossus','Industry God','Agency Galaxy','Creator Infinity','Talent Omnipresence','Agency Singularity'],
        algorithm: ['First Boost','SEO King','Algorithm Whisperer','Feed God','Recommendation Empire','Viral Network','Algorithm God','Feed Galaxy','Viral Infinity','Algorithm Omnipresence','Algorithm Singularity'],
        empire: ['Empire Begins','Media Empire','Platform King','Digital Colossus','Empire Network','Emperor','Empire God','Digital Galaxy','Empire Infinity','Emperor Omnipresence','Empire Singularity'],
        tournament: ['First Event','Regional Circuit','National King','World Stage','Tournament Empire','Tournament Network','Tournament God','Event Galaxy','Victory Infinity','Champion Omnipresence','Tournament Singularity'],
        realityShow: ['Pilot Episode','Season Run','Hit Show','Awards Season','Network Giant','Show Empire','Show God','Broadcast Galaxy','Reality Infinity','Show Omnipresence','Reality Singularity'],
        metaverse: ['First World','Digital Frontier','Virtual Empire','Metaverse King','World Network','Digital Colossus','Metaverse God','Virtual Galaxy','Digital Infinity','Metaverse Omnipresence','Metaverse Singularity'],
        cosmic: ['First Signal','Galactic Voice','Star Network','Nebula Broadcaster','Cosmic Empire','Universe Announcer','Cosmic God','Galactic Galaxy','Broadcast Infinity','Cosmic Omnipresence','Cosmic Singularity'],
    };
    const buildingAchIcons = ['🌱','🏅','🥇','💎','👑','⚡','🌟','🌌','♾️','🕳️','🦁'];
    BUILDINGS.forEach((b) => {
        buildingOwnershipTiers.forEach((thresh, ti) => {
            const names = buildingAchNames[b.id];
            achs.push({
                id: `bown_${b.id}_${thresh}`,
                name: names[ti],
                desc: `Own ${thresh} ${b.name}${thresh > 1 ? 's' : ''}.`,
                icon: buildingAchIcons[ti],
                category: 'building',
                building: b.id,
                condition: (s) => (s.buildings[b.id] || 0) >= thresh,
            });
        });
    });

    // E. Golden Clout click achievements (11)
    const goldenMilestones = [
        [1,    'Golden Luck',         'You clicked your first Golden Clout.', '✨'],
        [7,    'Lucky Seven',          '7 golden clicks. Lucky indeed.', '🍀'],
        [27,   'Gold Collector',       '27 golden clouts pocketed.', '💛'],
        [77,   'Golden Hoarder',       '77 golden clouts. You hunt them down.', '🎯'],
        [777,  'Triple Lucky',         '777 — jackpot! Golden click champion.', '🎰'],
        [7777, 'Golden Obsession',     '7,777 golden clouts. You never miss one.', '👁️'],
        [77777,'Golden Legend',        "77,777 golden clouts. That's dedication.", '🌟'],
        [100,  'Century of Gold',      '100 golden clouts clicked.', '💰'],
        [500,  'Gilded',               '500 golden moments captured.', '🏅'],
        [2500, 'Golden King',          '2,500 golden clouts. Royalty.', '👑'],
        [10000,'Golden Transcendence', '10,000 golden clouts. You are golden.', '⚡'],
    ];
    goldenMilestones.forEach(([thresh, name, desc, icon]) => {
        achs.push({
            id: `golden_${thresh}`,
            name, desc, icon,
            category: 'golden',
            condition: (s) => s.goldenCloutClicks >= thresh,
        });
    });

    // F. Prestige achievements (15)
    const prestigeMilestones = [
        [1,   'Gone Viral',          "You reset everything for pure Clout. Wild.", '🔄'],
        [5,   'Serial Resetter',     "Five times going viral. Commitment.", '🔁'],
        [10,  'Viral Veteran',       "Ten prestige runs. You know the grind.", '🏋️'],
        [25,  'Viral Loyalist',      "Twenty-five runs. The loop never ends.", '🔮'],
        [50,  'Prestige Legend',     "Fifty times. Your dedication is unreal.", '💪'],
        [100, 'Century Viral',       "One hundred prestige runs. A century of virality.", '💯'],
        [150, 'Viral Machine',       "150 prestige cycles complete.", '⚙️'],
        [200, 'Double Century',      "200 times you went viral.", '🌊'],
        [300, 'Viral God',           "300 prestige runs. Godhood achieved.", '⚡'],
        [450, 'Prestige Deity',      "450 runs. Beyond mortal time.", '🌌'],
        [777, 'Lucky Viral',         "777 prestige runs. Jackpot of dedication.", '🎰'],
        [1000,'Millennium Viral',    "A thousand times you went viral.", '♾️'],
        [1500,'Prestige Transcendent',"1,500 runs. Reality is a game to you.", '🕳️'],
        [2000,'Eternal Viral',       "2,000 prestige runs. Eternal.", '🌟'],
        [3000,'Omniprestige',        "3,000 runs. You ARE prestige.", '🦁'],
    ];
    prestigeMilestones.forEach(([thresh, name, desc, icon]) => {
        achs.push({
            id: `prestige_${thresh}`,
            name, desc, icon,
            category: 'prestige',
            condition: (s) => (s.prestigeLevel || 0) >= thresh,
        });
    });

    // G. Speed run achievements (10)
    const speedAchs = [
        { id: 'speed_1k', name: 'Speed Runner',      desc: 'Reach 1,000 Clout within 1 minute of starting.',    icon: '⚡', thresh: 1000, time: 60 },
        { id: 'speed_100k', name: 'Quick Grinder',   desc: 'Reach 100K Clout within 5 minutes.',                icon: '🏃', thresh: 100000, time: 300 },
        { id: 'speed_1m', name: 'Fast Creator',      desc: 'Reach 1M Clout within 15 minutes.',                 icon: '🚀', thresh: 1e6, time: 900 },
        { id: 'speed_100m', name: 'Warp Speed',      desc: 'Reach 100M Clout within 1 hour.',                   icon: '💫', thresh: 1e8, time: 3600 },
        { id: 'speed_1b', name: 'Velocity Creator',  desc: 'Reach 1B Clout within 3 hours.',                    icon: '⚡', thresh: 1e9, time: 10800 },
        { id: 'speed_100b', name: 'Rapid Empire',    desc: 'Reach 100B Clout within 12 hours.',                 icon: '🌊', thresh: 1e11, time: 43200 },
        { id: 'speed_1t', name: 'Instant Legend',    desc: 'Reach 1T Clout within 24 hours.',                   icon: '⏱️', thresh: 1e12, time: 86400 },
        { id: 'speed_1qa', name: 'Quadrillion Rush', desc: 'Reach 1Qa Clout within 48 hours.',                  icon: '🔥', thresh: 1e15, time: 172800 },
        { id: 'speed_1qi', name: 'Quintillion Blitz', desc: 'Reach 1Qi Clout within 1 week.',  icon: '💥', thresh: 1e18, time: 604800 },
        { id: 'speed_1sx', name: 'Sextillion Sprint', desc: 'Reach 1Sx Clout within 2 weeks.', icon: '🌌', thresh: 1e21, time: 1209600 },
    ];
    speedAchs.forEach(a => {
        achs.push({
            id: a.id,
            name: a.name,
            desc: a.desc,
            icon: a.icon,
            category: 'speed',
            condition: (s) => s.totalCloutEver >= a.thresh && s.timePlayed <= a.time,
        });
    });

    // H. Special / misc achievements (50+)
    const specialAchs = [
        // Shadow / secret
        { id: 'shadow_bot', name: 'Not a Bot',         desc: 'Click 10,000 times in a single session. Totally human.', icon: '🤖', shadow: true, condition: (s) => s.sessionClicks >= 10000 },
        { id: 'shadow_insomniac', name: 'Insomniac',   desc: 'Play for 24 hours total.', icon: '😴', shadow: true, condition: (s) => s.timePlayed >= 86400 },
        { id: 'shadow_humble', name: 'Humble',          desc: 'Have zero buildings for 1 minute after buying one.', icon: '🥺', shadow: true, condition: (s) => s.humbleTimer >= 60 },
        { id: 'shadow_fast_gold', name: 'Golden Touch', desc: 'Click a Golden Clout within 1 second of it appearing.', icon: '⚡', shadow: true, condition: (s) => s.goldenFastClick === true },
        { id: 'shadow_broke', name: 'Broke Creator',   desc: 'Spend all your Clout and have 0 left.', icon: '💸', shadow: true, condition: (s) => s.clout < 1 && s.totalCloutEver >= 100 },
        { id: 'shadow_noclick', name: 'Let It Cook',   desc: 'Don\'t click the controller for 5 minutes while CPS > 0.', icon: '🍳', shadow: true, condition: (s) => s.afkTimer >= 300 && s.cps > 0 },
        { id: 'shadow_refund', name: 'Return Policy',  desc: 'Start the game fresh after earning over 1 billion Clout.', icon: '🔄', shadow: true, condition: (s) => s.prestigeLevel >= 1 && s.totalCloutEver >= 1e9 },
        { id: 'shadow_night', name: 'Night Owl',       desc: 'Play between midnight and 4am (local time).', icon: '🦉', shadow: true, condition: (s) => { const h = new Date().getHours(); return h >= 0 && h < 4 && s.timePlayed > 60; } },
        { id: 'shadow_frenzy_chain', name: 'Frenzy Chain', desc: 'Get 10 Golden Clouts in one prestige run.', icon: '⛓️', shadow: true, condition: (s) => s.goldenCloutThisRun >= 10 },
        { id: 'shadow_og', name: 'Day One',            desc: 'Play for 30 days total (play time).', icon: '🏅', shadow: true, condition: (s) => s.timePlayed >= 2592000 },

        // Combo / hoarder
        { id: 'hoarder', name: 'Hoarder', desc: 'Own 100 of every building simultaneously.', icon: '📦', condition: (s) => BUILDINGS.every(b => (s.buildings[b.id] || 0) >= 100) },
        { id: 'hoarder_200', name: 'Super Hoarder', desc: 'Own 200 of every building simultaneously.', icon: '🏰', condition: (s) => BUILDINGS.every(b => (s.buildings[b.id] || 0) >= 200) },
        { id: 'hoarder_250', name: 'Warehouse God', desc: 'Own 250 of every building simultaneously.', icon: '🌐', condition: (s) => BUILDINGS.every(b => (s.buildings[b.id] || 0) >= 250) },
        { id: 'upgrade_10', name: 'Upgrade Beginner', desc: 'Purchase 10 upgrades.', icon: '🔧', condition: (s) => s.upgrades.size >= 10 },
        { id: 'upgrade_50', name: 'Upgrade Collector', desc: 'Purchase 50 upgrades.', icon: '🛠️', condition: (s) => s.upgrades.size >= 50 },
        { id: 'upgrade_100', name: 'Upgrade Master', desc: 'Purchase 100 upgrades.', icon: '⚙️', condition: (s) => s.upgrades.size >= 100 },
        { id: 'upgrade_150', name: 'Upgrade Legend', desc: 'Purchase 150 upgrades.', icon: '🔩', condition: (s) => s.upgrades.size >= 150 },
        { id: 'upgrade_180', name: 'Upgrade God', desc: 'Purchase every upgrade available.', icon: '♾️', condition: (s) => s.upgrades.size >= UPGRADES.length - 5 },

        // First buys
        { id: 'first_building', name: 'First Investment', desc: 'Buy your first building.', icon: '🏗️', condition: (s) => Object.values(s.buildings).reduce((a,b) => a+b, 0) >= 1 },
        { id: 'first_upgrade', name: 'First Upgrade', desc: 'Purchase your first upgrade.', icon: '🆙', condition: (s) => s.upgrades.size >= 1 },
        { id: 'ten_buildings', name: 'Small Operation', desc: 'Own 10 buildings total across all types.', icon: '🏢', condition: (s) => Object.values(s.buildings).reduce((a,b) => a+b, 0) >= 10 },
        { id: '100_buildings', name: 'Content Empire', desc: 'Own 100 buildings total.', icon: '🏙️', condition: (s) => Object.values(s.buildings).reduce((a,b) => a+b, 0) >= 100 },
        { id: '500_buildings', name: 'Megacorp', desc: 'Own 500 buildings total.', icon: '🌆', condition: (s) => Object.values(s.buildings).reduce((a,b) => a+b, 0) >= 500 },
        { id: '1000_buildings', name: 'Infinite Corporation', desc: 'Own 1,000 buildings total.', icon: '🌇', condition: (s) => Object.values(s.buildings).reduce((a,b) => a+b, 0) >= 1000 },
        { id: '5000_buildings', name: 'God Corp', desc: 'Own 5,000 buildings total.', icon: '🌃', condition: (s) => Object.values(s.buildings).reduce((a,b) => a+b, 0) >= 5000 },

        // Frenzy related
        { id: 'frenzy_1', name: 'Frenzy Mode', desc: 'Activate your first Frenzy from a Golden Clout.', icon: '🌀', condition: (s) => s.frenzyCount >= 1 },
        { id: 'frenzy_7', name: 'Lucky Frenzy', desc: 'Activate 7 Frenzies.', icon: '🎯', condition: (s) => s.frenzyCount >= 7 },
        { id: 'frenzy_77', name: 'Frenzy Addict', desc: 'Activate 77 Frenzies.', icon: '🔥', condition: (s) => s.frenzyCount >= 77 },
        { id: 'click_frenzy', name: 'Click Storm', desc: 'Trigger your first Click Frenzy.', icon: '👆', condition: (s) => s.clickFrenzyCount >= 1 },
        { id: 'free_up', name: 'Free Lunch', desc: 'Receive a free upgrade from a Golden Clout.', icon: '🎁', condition: (s) => s.freeUpgradeCount >= 1 },

        // Offline
        { id: 'offline_1h', name: 'AFK Creator', desc: 'Return after being away for 1 hour and earn offline income.', icon: '💤', condition: (s) => s.longestOffline >= 3600 },
        { id: 'offline_8h', name: 'Passive Income', desc: 'Return after 8 hours away.', icon: '😴', condition: (s) => s.longestOffline >= 28800 },
        { id: 'offline_24h', name: 'Overnight Creator', desc: 'Return after 24 hours away.', icon: '🌙', condition: (s) => s.longestOffline >= 86400 },

        // Leaderboard / social
        { id: 'logged_in', name: 'Community Member', desc: 'Sign in to save your progress.', icon: '🔑', condition: (s) => s.isLoggedIn === true },
        { id: 'leaderboard_top25', name: 'Top Contender', desc: 'Appear on the global leaderboard.', icon: '📋', condition: (s) => s.isLoggedIn === true && s.totalCloutEver >= 1000 },

        // Fun / misc
        { id: 'cps_click_equal', name: 'Balanced Creator', desc: 'Have your click power equal to your CPS (within 10%).', icon: '⚖️', condition: (s) => s.cps > 0 && Math.abs(s.clickPower - s.cps) / s.cps <= 0.1 },
        { id: 'all_buildings', name: 'Full Roster', desc: 'Own at least 1 of every building type.', icon: '✅', condition: (s) => BUILDINGS.every(b => (s.buildings[b.id] || 0) >= 1) },
        { id: 'wealthy', name: 'Sitting on Clout', desc: 'Have 1 trillion Clout banked (unspent) at once.', icon: '🤑', condition: (s) => s.clout >= 1e12 },
        { id: 'ultra_wealthy', name: 'Obscene Wealth', desc: 'Have 1 quadrillion Clout banked at once.', icon: '💰', condition: (s) => s.clout >= 1e15 },
        { id: 'no_upgrades_1m', name: 'Purist', desc: 'Reach 1 million Clout with no upgrades purchased.', icon: '🏴', condition: (s) => s.totalCloutEver >= 1e6 && s.upgrades.size === 0 },
        { id: 'early_prestige', name: 'Speedrunner Prestige', desc: 'Prestige within 1 hour of starting a new run.', icon: '🏁', condition: (s) => s.prestigeLevel >= 1 && s.timeSincePrestige <= 3600 },
        { id: 'chip_hoarder', name: 'Chip Collector', desc: 'Accumulate 100 Viral Chips.', icon: '🧩', condition: (s) => (s.viralChips || 0) >= 100 },
        { id: 'chip_god', name: 'Chip God', desc: 'Accumulate 1,000 Viral Chips.', icon: '🌟', condition: (s) => (s.viralChips || 0) >= 1000 },
        { id: 'ten_prestige_ups', name: 'Prestige Shopper', desc: 'Buy 5 prestige upgrades.', icon: '🛒', condition: (s) => [...s.upgrades].filter(id => id.startsWith('prestige_')).length >= 5 },
        { id: 'all_prestige_ups', name: 'Prestige Complete', desc: 'Buy all prestige upgrades.', icon: '🎖️', condition: (s) => [...s.upgrades].filter(id => id.startsWith('prestige_')).length >= 10 },
        { id: 'save_loaded', name: 'Persistence Pays', desc: 'Load a save game.', icon: '💾', condition: (s) => s.saveLoaded === true },
    ];
    specialAchs.forEach(a => {
        achs.push({
            id: a.id,
            name: a.name,
            desc: a.desc,
            icon: a.icon,
            category: a.shadow ? 'shadow' : 'special',
            shadow: !!a.shadow,
            condition: a.condition,
        });
    });

    return achs;
}

const ACHIEVEMENTS = generateAchievements();

/* ── News ticker messages ────────────────────────────────── */
const NEWS_TICKER = [
    'Local content creator earns more Clout than the GDP of a small nation',
    'Scientists discover clicking faster actually does increase Clout production',
    'Viewer count climbs as creator opens third monitor specifically for the stats panel',
    'Esports team roster expanded to include "literally everyone"',
    'Golden Clout appears on screen; player fails to notice for 12 seconds',
    'Sponsor deal signed with company that sells "Clout Crystals" — legitimacy unclear',
    'Merch store sells out of 47,000 hoodies to an audience of 47,001',
    'Viral Algorithm achieves sentience; immediately subscribes to TrueBeast',
    'Stream chatter types "PogChamp" 11 million times; deemed a productivity record',
    'Reality show episode titled "Who Wants to Be a Clout Billionaire" breaks streaming records',
    'Digital Metaverse expands to include dedicated section called "The Clout Zone"',
    'Cosmic Broadcast picked up by alien civilization; they immediately start clipping it',
    'Player achieves 1 trillion Clout; existential dread sets in shortly after',
    'Gaming PC cooling system upgraded to include "a small waterfall"',
    'Clip Editor refuses to go home; has been in the office for 72 hours straight',
    'Content Agency signs deal with every creator on the internet simultaneously',
    'World Tournament winner receives trophy shaped like a glowing controller',
    'Breaking: Going Viral achievement requires user to actually go outside — update reversed after complaints',
    'Streaming Studio installs a second green screen "just in case"',
    'Fan mail arrives; all of it says "please add a dark mode" — already exists',
    'Prestige system discovered to be "time travel but for Clout"',
    'New research confirms: the more Clout you have, the more Clout you get',
    'TrueBeast website spotted having more active sessions than most actual social media platforms',
    'Player left game open overnight; woke up to more Clout than they can comprehend',
    'Achievement unlocked: "Reading the news ticker" — wait, that\'s not a real one',
    'Golden Clout spotted near Sponsor Deal district; authorities advise clicking immediately',
    'Viewer count reaches number that requires new unit of measurement: the "Truebyte"',
    'Game dev confirms: yes, the 🎮 controller is hand-crafted with love',
];

/* ── Export ───────────────────────────────────────────────── */
window.GameData = { BUILDINGS, UPGRADES, ACHIEVEMENTS, NEWS_TICKER, formatNumber, formatTime, getBuildingCost, getMaxAffordable };
