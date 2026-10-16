/**
 * TrueBeast Casino — UnbelievaBoat-style economy + gambling, run entirely from one
 * button panel in #casino (no slash commands). Every menu/game reply is ephemeral;
 * robberies, gifts and big wins are posted publicly in the channel.
 *
 * Money: cash (spendable, robbable) + bank (safe). Bets are moved into `escrow` when a
 * game starts and settled when it ends; escrow left over after a restart is refunded.
 * State: botConfig/casino → playersJson, panelChannelId, panelMessageId.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
        EmbedBuilder, UserSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const DOC_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/casino`;

const CHANNEL_NAME = 'casino';
const PANEL_TITLE  = '🎰 The TrueBeast Casino';
const GOLD = 0xf5b70a, GREEN = 0x22c55e, RED = 0xef4444, GREY = 0x6b7280, BLUE = 0x3b82f6;

const MIN = 60 * 1000, HOUR = 60 * MIN;
const START_CASH      = 1000;
const MIN_BET         = 10;
const MAX_BET         = 1_000_000;
const DAILY_COOLDOWN  = 20 * HOUR;
const STREAK_WINDOW   = 48 * HOUR;   // claim within this or the streak resets
const WORK_COOLDOWN   = 45 * MIN;
const CRIME_COOLDOWN  = 2 * HOUR;
const ROB_COOLDOWN    = 3 * HOUR;
const ROB_PROTECT     = 1 * HOUR;    // a victim can't be robbed again for this long
const ROB_MIN_CASH    = 250;         // both robber and victim need this much cash
const GAME_IDLE_MS    = 10 * MIN;    // idle games auto-resolve after this
const BIG_WIN         = 10_000;      // net wins at or above this get announced
const BOT_POST_TTL    = 60 * MIN;    // robbery/gift/big-win posts get cleaned up after this
const CHAT_TTL        = 5 * MIN;     // anything else said in the channel

const GAMES = {
    bj:       { name: 'Blackjack', emoji: '🃏' },
    slots:    { name: 'Slots',     emoji: '🎰' },
    roulette: { name: 'Roulette',  emoji: '🎡' },
    coinflip: { name: 'Coinflip',  emoji: '🪙' },
    mines:    { name: 'Mines',     emoji: '💣' },
    crash:    { name: 'Crash',     emoji: '📈' },
};

const SHOP = {
    padlock:     { cost: 2_500,     emoji: '🔒', name: 'Padlock',        desc: 'Blocks the next rob attempt on you (max 3)', max: 3 },
    gloves:      { cost: 4_000,     emoji: '🧤', name: 'Robber Gloves',  desc: '+20% success on your next rob', max: 3 },
    clover:      { cost: 6_000,     emoji: '🍀', name: 'Lucky Clover',   desc: 'Your next Daily pays double', max: 1 },
    high_roller: { cost: 25_000,    emoji: '🎩', name: 'High Roller',    desc: 'Title shown on your wallet and the leaderboard', title: true },
    shark:       { cost: 100_000,   emoji: '🦈', name: 'Card Shark',     desc: 'Title', title: true },
    whale:       { cost: 500_000,   emoji: '🐋', name: 'Whale',          desc: 'Title', title: true },
    royalty:     { cost: 2_500_000, emoji: '👑', name: 'Casino Royalty', desc: 'Title — the ultimate flex', title: true },
};
const TITLE_ORDER = ['royalty', 'whale', 'shark', 'high_roller'];

const WORK_LINES = [
    'You dealt cards at the blackjack table and earned', 'You mopped up spilled drinks on the casino floor for',
    'You streamed for 6 hours straight and got', 'You fixed a broken slot machine and got paid',
    'You walked TrueBeast\'s dog and were tipped', 'You sold frog plushies outside the pond for',
    'You moderated chat for an hour and earned', 'You valet parked a Lambo and got tipped',
    'You counted chips in the vault and got', 'You won a pub quiz and took home',
];
const CRIME_WIN_LINES = [
    'You pickpocketed a tourist and got', 'You ran a fake raffle and made', 'You counted cards and walked out with',
    'You hacked a vending machine and got', 'You sold "genuine" Rolexes for', 'You smuggled snacks into the cinema and resold them for',
];
const CRIME_LOSE_LINES = [
    'Security caught you counting cards. Fine:', 'You tripped the vault alarm and paid bail of',
    'The tourist was an undercover cop. Fine:', 'Your fake raffle got reported. Refunds and fines cost',
    'The vending machine fought back. Hospital bill:',
];

// ── State ───────────────────────────────────────────────────────────────────
const players = new Map();   // userId → player
const games   = new Map();   // gameId → game
let loaded = false;          // guards saves so an empty map never overwrites Firestore
let client = null;
let channelId = null;
let panelMessageId = null;
let saveTimer = null;
let panelDirty = false;
let panelQueue = Promise.resolve();

function newPlayer() {
    return {
        name: '', cash: START_CASH, bank: 0, escrow: 0,
        lastDaily: 0, streak: 0, lastWork: 0, lastCrime: 0, lastRob: 0, robbedAt: 0,
        items: {}, titles: [], stats: { games: 0, won: 0, lost: 0, biggest: 0 },
    };
}

function normalize(p = {}) {
    const d = newPlayer();
    const out = { ...d, ...p, items: { ...(p.items || {}) }, stats: { ...d.stats, ...(p.stats || {}) } };
    out.titles = Array.isArray(p.titles) ? p.titles.filter(t => SHOP[t]?.title) : [];
    for (const k of ['cash', 'bank', 'escrow']) out[k] = Math.max(0, Math.floor(Number(out[k]) || 0));
    return out;
}

function player(ix) {
    const id = ix.user.id;
    let p = players.get(id);
    if (!p) { p = newPlayer(); players.set(id, p); markDirty(); }
    const name = ix.member?.displayName || ix.user.globalName || ix.user.username;
    if (p.name !== name) { p.name = name; markDirty(); }
    return p;
}

// ── Firestore (raw REST, botConfig only — see CLAUDE.md) ────────────────────
async function loadState() {
    const res = await fetch(`${DOC_URL}?key=${FIREBASE_API_KEY}`);
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = (await res.json()).fields || {};
    return { playersJson: f.playersJson?.stringValue || '', panelChannelId: f.panelChannelId?.stringValue || '', panelMessageId: f.panelMessageId?.stringValue || '' };
}

async function saveState() {
    if (!loaded) return;
    clearTimeout(saveTimer); saveTimer = null;
    const out = {};
    for (const [id, p] of players) out[id] = p;
    const fields = {
        playersJson:    { stringValue: JSON.stringify(out) },
        panelChannelId: { stringValue: channelId || '' },
        panelMessageId: { stringValue: panelMessageId || '' },
    };
    const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
    try {
        const res = await fetch(`${DOC_URL}?${mask}&key=${FIREBASE_API_KEY}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
        });
        if (!res.ok) console.error('[Casino] save failed:', res.status, (await res.text()).slice(0, 200));
    } catch (e) { console.error('[Casino] save failed:', e.message); }
}

function markDirty() {
    panelDirty = true;
    if (!loaded || saveTimer) return;
    saveTimer = setTimeout(() => saveState(), 3000);
}

async function flushCasino() { if (loaded) await saveState(); }

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmt = n => `🪙 ${Math.floor(n).toLocaleString('en-US')}`;
const short = n => n >= 1e6 ? `${+(n / 1e6).toFixed(2)}m` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n);
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rel = ms => `<t:${Math.floor(ms / 1000)}:R>`;
const btn = (id, label, style = ButtonStyle.Secondary, emoji = null, disabled = false) => {
    const b = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(disabled);
    if (label) b.setLabel(label);
    if (emoji) b.setEmoji(emoji);
    return b;
};
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const embed = (color, title, desc) => { const e = new EmbedBuilder().setColor(color).setTitle(title); if (desc) e.setDescription(desc); return e; };
const titleOf = p => { const t = TITLE_ORDER.find(k => p.titles.includes(k)); return t ? `${SHOP[t].emoji} ${SHOP[t].name}` : null; };

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

// "500", "2.5k", "1m", "1,000", "half", "all", "max", "25%"
function parseAmount(str, available) {
    const s = String(str || '').trim().toLowerCase().replace(/[,\s_]/g, '').replace(/^🪙/, '');
    if (!s) return NaN;
    if (s === 'all' || s === 'max') return available;
    if (s === 'half') return Math.floor(available / 2);
    let m = s.match(/^(\d+(?:\.\d+)?)%$/);
    if (m) return Math.floor(available * Math.min(100, Number(m[1])) / 100);
    m = s.match(/^(\d+(?:\.\d+)?)([km]?)$/);
    if (!m) return NaN;
    return Math.floor(Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
}

function parseBet(str, p) {
    const amt = parseAmount(str, Math.min(p.cash, MAX_BET));
    if (!Number.isFinite(amt)) return { error: '❌ That isn\'t a valid amount. Try `500`, `2k`, `half` or `all`.' };
    if (amt < MIN_BET) return { error: `❌ Minimum bet is ${fmt(MIN_BET)}.${p.cash < MIN_BET ? ' You\'re broke — go 💼 Work or claim your 🎁 Daily.' : ''}` };
    if (amt > MAX_BET) return { error: `❌ Maximum bet is ${fmt(MAX_BET)}.` };
    if (amt > p.cash) return { error: `❌ You only have ${fmt(p.cash)} in cash.${p.bank ? ' Withdraw from the 🏦 Bank first.' : ''}` };
    return { amount: amt };
}

async function respond(ix, payload, mode) {
    if (mode === 'update') return ix.update(payload);
    return ix.reply({ ...payload, flags: 64 });
}

// Every casino message is a titled card: GREY = "not yet / can't", GREEN = good, RED = bad
const card = (color, title, desc) => ({ content: '', embeds: [embed(color, title, desc)], components: [] });

function errorReply(ix, title, text) {
    const payload = { ...card(GREY, title, text.replace(/^❌ /, '')), flags: 64 };
    return (ix.deferred || ix.replied) ? ix.followUp(payload) : ix.reply(payload);
}

async function post(content, pingIds = []) {
    const ch = channelId && await client.channels.fetch(channelId).catch(() => null);
    if (!ch) return;
    await ch.send({ content, allowedMentions: { users: pingIds } }).catch(e => console.error('[Casino] post failed:', e.message));
}

// ── Game bookkeeping ────────────────────────────────────────────────────────
function openGame(ix, type, bet, extra = {}) {
    const p = player(ix);
    p.cash -= bet; p.escrow += bet;
    const g = { id: Math.random().toString(36).slice(2, 10), userId: ix.user.id, type, bet, done: false, ix, timer: null, ...extra };
    games.set(g.id, g);
    touch(g);
    markDirty();
    return g;
}

function touch(g) {
    clearTimeout(g.timer);
    g.timer = setTimeout(() => expireGame(g).catch(e => console.error('[Casino] expire failed:', e.message)), GAME_IDLE_MS);
}

function closeGame(g) {
    g.done = true;
    clearTimeout(g.timer);
    if (g.tick) clearInterval(g.tick);
    games.delete(g.id);
}

// Pays out `payout` (stake included) and records stats. Returns the net change.
function settle(g, payout) {
    closeGame(g);
    const p = players.get(g.userId);
    p.escrow = Math.max(0, p.escrow - g.bet);
    p.cash += payout;
    const net = payout - g.bet;
    p.stats.games++;
    if (net > 0) { p.stats.won += net; p.stats.biggest = Math.max(p.stats.biggest, net); }
    else p.stats.lost += -net;
    markDirty();
    if (net >= BIG_WIN) {
        const x = payout / g.bet;
        post(`🎉 **${p.name}** just won **${fmt(net)}** on ${GAMES[g.type].emoji} ${GAMES[g.type].name}${x >= 2 ? ` (${+x.toFixed(2)}x)` : ''}!`);
    }
    return net;
}

function refund(g) {
    closeGame(g);
    const p = players.get(g.userId);
    p.escrow = Math.max(0, p.escrow - g.bet);
    p.cash += g.bet;
    markDirty();
}

function againRow(type, bet, extra = '') {
    return row(
        btn(`cas:a:${type}:${bet}:${extra}`, `Again (${short(bet)})`, ButtonStyle.Success, '🔁'),
        btn(`cas:p:${type}`, 'Change bet', ButtonStyle.Secondary, '✏️'),
        btn('cas:p:wallet', 'Wallet', ButtonStyle.Secondary, '💰'),
    );
}

// Wins show the full payout (stake included) so "2x" on a 500 bet reads as 1,000 back
function resultLine(net, p, bet) {
    const head = net > 0 ? `✅ **You won ${fmt(net + bet)}!** (+${fmt(net)} profit)` : net === 0 ? '➖ **Push — your bet is back.**' : `❌ **You lost ${fmt(-net)}.**`;
    return `${head}\nCash: ${fmt(p.cash)}`;
}

function betModal(type) {
    const modal = new ModalBuilder().setCustomId(`cas:m:bet:${type}`).setTitle(`${GAMES[type].emoji} ${GAMES[type].name}`);
    const inputs = [new TextInputBuilder().setCustomId('amount').setLabel('Bet amount').setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. 500, 2k, half, all').setRequired(true).setMaxLength(20)];
    if (type === 'mines') inputs.push(new TextInputBuilder().setCustomId('extra').setLabel('Number of mines (1-15)').setStyle(TextInputStyle.Short)
        .setPlaceholder('3').setRequired(false).setMaxLength(2));
    if (type === 'crash') inputs.push(new TextInputBuilder().setCustomId('extra').setLabel('Auto cash out at (optional, e.g. 2)').setStyle(TextInputStyle.Short)
        .setPlaceholder('Leave empty to cash out yourself').setRequired(false).setMaxLength(8));
    modal.addComponents(...inputs.map(i => row(i)));
    return modal;
}

async function startGame(ix, type, amountStr, extraStr, mode) {
    const p = player(ix);
    const bet = parseBet(amountStr, p);
    if (bet.error) return errorReply(ix, `${GAMES[type].emoji} ${GAMES[type].name}`, bet.error);
    switch (type) {
        case 'bj':       return bjStart(ix, p, bet.amount, mode);
        case 'slots':    return slotsPlay(ix, p, bet.amount, mode);
        case 'roulette': return choiceStart(ix, 'roulette', bet.amount, mode);
        case 'coinflip': return choiceStart(ix, 'coinflip', bet.amount, mode);
        case 'mines': {
            const m = extraStr ? parseInt(extraStr, 10) : 3;
            if (!Number.isInteger(m) || m < 1 || m > 15) return errorReply(ix, '💣 Mines', '❌ Mines must be a number from 1 to 15.');
            return minesStart(ix, bet.amount, m, mode);
        }
        case 'crash': {
            let auto = null;
            if (extraStr) {
                auto = Math.floor(parseFloat(String(extraStr).replace(/x/i, '')) * 100) / 100;
                if (!Number.isFinite(auto) || auto < 1.01 || auto > 1000) return errorReply(ix, '📈 Crash', '❌ Auto cash out must be between 1.01 and 1000.');
            }
            return crashStart(ix, bet.amount, auto, mode);
        }
    }
}

// ── Blackjack ───────────────────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function handValue(cards) {
    let t = 0, aces = 0;
    for (const c of cards) {
        if (c.r === 'A') { t += 11; aces++; } else if ('JQK'.includes(c.r)) t += 10; else t += Number(c.r);
    }
    while (t > 21 && aces) { t -= 10; aces--; }
    return t;
}
const showHand = (cards, hideSecond = false) => cards.map((c, i) => hideSecond && i === 1 ? '`??`' : `\`${c.r}${c.s}\``).join(' ');

function bjView(g, p, finished = false, net = 0) {
    const e = embed(finished ? (net > 0 ? GREEN : net < 0 ? RED : GREY) : GOLD, `🃏 Blackjack — bet ${fmt(g.bet)}`)
        .addFields(
            { name: `Your hand (${handValue(g.player)})`, value: showHand(g.player), inline: true },
            { name: `Dealer (${finished ? handValue(g.dealer) : '?'})`, value: showHand(g.dealer, !finished), inline: true },
        );
    if (finished) {
        e.setDescription(`${g.note ? g.note + '\n' : ''}${resultLine(net, p, g.bet)}`);
        return { embeds: [e], components: [againRow('bj', g.baseBet)] };
    }
    const canDouble = g.player.length === 2 && p.cash >= g.baseBet;
    return { embeds: [e], components: [row(
        btn(`cas:g:${g.id}:hit`, 'Hit', ButtonStyle.Primary, '👊'),
        btn(`cas:g:${g.id}:stand`, 'Stand', ButtonStyle.Secondary, '✋'),
        btn(`cas:g:${g.id}:double`, `Double (${short(g.baseBet)})`, ButtonStyle.Success, '💰', !canDouble),
    )] };
}

async function bjStart(ix, p, bet, mode) {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
    shuffle(deck);
    const g = openGame(ix, 'bj', bet, { deck, baseBet: bet, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()] });
    const pv = handValue(g.player), dv = handValue(g.dealer);
    if (pv === 21 || dv === 21) {
        let payout;
        if (pv === 21 && dv === 21) { payout = g.bet; g.note = 'Both blackjack!'; }
        else if (pv === 21) { payout = Math.floor(g.bet * 2.5); g.note = '🂡 **Blackjack!** Pays 3:2.'; }
        else { payout = 0; g.note = 'Dealer has blackjack.'; }
        const net = settle(g, payout);
        return respond(ix, bjView(g, p, true, net), mode);
    }
    return respond(ix, bjView(g, p), mode);
}

function bjFinish(g, p) {
    const pv = handValue(g.player);
    let payout = 0;
    if (pv > 21) g.note = 'Bust!';
    else {
        while (handValue(g.dealer) < 17) g.dealer.push(g.deck.pop());
        const dv = handValue(g.dealer);
        if (dv > 21) { payout = g.bet * 2; g.note = 'Dealer busts!'; }
        else if (pv > dv) payout = g.bet * 2;
        else if (pv === dv) payout = g.bet;
    }
    return settle(g, payout);
}

async function bjAction(ix, g, action) {
    const p = players.get(g.userId);
    if (action === 'hit') {
        g.player.push(g.deck.pop());
        const v = handValue(g.player);
        if (v >= 21) return ix.update(bjView(g, p, true, bjFinish(g, p)));
        return ix.update(bjView(g, p));
    }
    if (action === 'double') {
        if (g.player.length !== 2 || p.cash < g.baseBet) return errorReply(ix, '🃏 Blackjack', '❌ You can\'t double right now.');
        p.cash -= g.baseBet; p.escrow += g.baseBet; g.bet += g.baseBet;
        g.player.push(g.deck.pop());
        return ix.update(bjView(g, p, true, bjFinish(g, p)));
    }
    return ix.update(bjView(g, p, true, bjFinish(g, p)));
}

// ── Slots ───────────────────────────────────────────────────────────────────
// 3 of a kind pays the symbol's multiplier, any pair pays 1.2x (~97.5% RTP)
const SLOT_SYMBOLS = [
    { e: '🍒', w: 30, x: 5 }, { e: '🍋', w: 25, x: 8 }, { e: '🍊', w: 20, x: 10 }, { e: '🍇', w: 12, x: 20 },
    { e: '🔔', w: 7, x: 40 }, { e: '💎', w: 4, x: 80 }, { e: '7️⃣', w: 2, x: 200 },
];
const SLOT_TOTAL = SLOT_SYMBOLS.reduce((s, x) => s + x.w, 0);
function spinReel() {
    let r = Math.random() * SLOT_TOTAL;
    for (const s of SLOT_SYMBOLS) { if ((r -= s.w) < 0) return s; }
    return SLOT_SYMBOLS[0];
}

async function slotsPlay(ix, p, bet, mode) {
    const g = openGame(ix, 'slots', bet);
    const reels = [spinReel(), spinReel(), spinReel()];
    let payout = 0, note = 'No match.';
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
        payout = bet * reels[0].x;
        note = reels[0].e === '7️⃣' ? '💥 **JACKPOT!** 💥' : `Three ${reels[0].e}! **${reels[0].x}x**`;
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
        payout = Math.floor(bet * 1.2); note = 'A pair — **1.2x**';
    }
    const net = settle(g, payout);
    const spinning = `**[ ${spinReel().e} | ${spinReel().e} | ${spinReel().e} ]**`;
    await respond(ix, { embeds: [embed(GOLD, `🎰 Slots — bet ${fmt(bet)}`, `${spinning}\n\nSpinning...`)], components: [] }, mode);
    await new Promise(r => setTimeout(r, 1200));
    const e = embed(net > 0 ? GREEN : RED, `🎰 Slots — bet ${fmt(bet)}`, `**[ ${reels.map(r => r.e).join(' | ')} ]**\n\n${note}\n${resultLine(net, p, bet)}`)
        .setFooter({ text: SLOT_SYMBOLS.map(s => `${s.e}${s.x}x`).join('  ') + '  · any pair 1.2x' });
    await ix.editReply({ embeds: [e], components: [againRow('slots', bet)] }).catch(() => {});
}

// ── Roulette & Coinflip (pick after betting) ────────────────────────────────
const RED_NUMS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const ROULETTE_BETS = {
    red:   { label: 'Red',   emoji: '🔴', pays: 2,  win: n => RED_NUMS.has(n) },
    black: { label: 'Black', emoji: '⚫', pays: 2,  win: n => n !== 0 && !RED_NUMS.has(n) },
    green: { label: 'Green 0', emoji: '🟢', pays: 36, win: n => n === 0 },
    odd:   { label: 'Odd',   pays: 2, win: n => n % 2 === 1 },
    even:  { label: 'Even',  pays: 2, win: n => n !== 0 && n % 2 === 0 },
    low:   { label: '1-18',  pays: 2, win: n => n >= 1 && n <= 18 },
    high:  { label: '19-36', pays: 2, win: n => n >= 19 },
    d1:    { label: '1st 12', pays: 3, win: n => n >= 1 && n <= 12 },
    d2:    { label: '2nd 12', pays: 3, win: n => n >= 13 && n <= 24 },
    d3:    { label: '3rd 12', pays: 3, win: n => n >= 25 },
};
const numEmoji = n => n === 0 ? '🟢' : RED_NUMS.has(n) ? '🔴' : '⚫';

async function choiceStart(ix, type, bet, mode) {
    const g = openGame(ix, type, bet);
    const cancel = btn(`cas:g:${g.id}:cancel`, 'Cancel', ButtonStyle.Danger);
    if (type === 'coinflip') {
        return respond(ix, {
            embeds: [embed(GOLD, `🪙 Coinflip — bet ${fmt(bet)}`, 'Call it! Win pays **2x**.')],
            components: [row(btn(`cas:g:${g.id}:heads`, 'Heads', ButtonStyle.Primary, '🙂'), btn(`cas:g:${g.id}:tails`, 'Tails', ButtonStyle.Primary, '🦅'), cancel)],
        }, mode);
    }
    const b = (k, style) => btn(`cas:g:${g.id}:${k}`, ROULETTE_BETS[k].label, style, ROULETTE_BETS[k].emoji || null);
    return respond(ix, {
        embeds: [embed(GOLD, `🎡 Roulette — bet ${fmt(bet)}`, 'Pick your bet.\n🔴/⚫, odd/even, 1-18/19-36 pay **2x** · dozens pay **3x** · 🟢 0 pays **36x**')],
        components: [
            row(b('red', ButtonStyle.Danger), b('black', ButtonStyle.Secondary), b('green', ButtonStyle.Success), b('odd'), b('even')),
            row(b('low'), b('high'), b('d1'), b('d2'), b('d3')),
            row(cancel),
        ],
    }, mode);
}

async function choiceAction(ix, g, action) {
    const p = players.get(g.userId);
    if (action === 'cancel') {
        refund(g);
        return ix.update({ embeds: [embed(GREY, `${GAMES[g.type].emoji} ${GAMES[g.type].name}`, `Cancelled — ${fmt(g.bet)} returned.`)], components: [] });
    }
    if (g.type === 'coinflip') {
        if (action !== 'heads' && action !== 'tails') return;
        const side = Math.random() < 0.5 ? 'heads' : 'tails';
        const net = settle(g, side === action ? g.bet * 2 : 0);
        await ix.update({ embeds: [embed(GOLD, `🪙 Coinflip — bet ${fmt(g.bet)}`, `You called **${action}**...\n\n🪙 *flipping...*`)], components: [] });
        await new Promise(r => setTimeout(r, 1000));
        return ix.editReply({
            embeds: [embed(net > 0 ? GREEN : RED, `🪙 Coinflip — bet ${fmt(g.bet)}`, `You called **${action}** — it landed **${side === 'heads' ? '🙂 Heads' : '🦅 Tails'}**.\n\n${resultLine(net, p, g.bet)}`)],
            components: [againRow('coinflip', g.bet)],
        }).catch(() => {});
    }
    const choice = ROULETTE_BETS[action];
    if (!choice) return;
    const n = rand(0, 36);
    const net = settle(g, choice.win(n) ? g.bet * choice.pays : 0);
    await ix.update({ embeds: [embed(GOLD, `🎡 Roulette — bet ${fmt(g.bet)}`, `You bet on **${choice.label}**...\n\n🎡 *the wheel is spinning...*`)], components: [] });
    await new Promise(r => setTimeout(r, 1500));
    return ix.editReply({
        embeds: [embed(net > 0 ? GREEN : RED, `🎡 Roulette — bet ${fmt(g.bet)}`, `You bet on **${choice.label}** — the ball landed on **${numEmoji(n)} ${n}**.\n\n${resultLine(net, p, g.bet)}`)],
        components: [againRow('roulette', g.bet)],
    }).catch(() => {});
}

// ── Mines (4×5 grid) ────────────────────────────────────────────────────────
const MINES_TILES = 20;
function minesMult(m, k) {
    if (k === 0) return 1;
    let x = 0.97;
    for (let i = 0; i < k; i++) x *= (MINES_TILES - i) / (MINES_TILES - m - i);
    return Math.floor(x * 100) / 100;
}

function minesView(g, p, finished = false, net = 0) {
    const k = g.revealed.size;
    const rows = [];
    for (let r = 0; r < 4; r++) {
        const btns = [];
        for (let c = 0; c < 5; c++) {
            const i = r * 5 + c;
            const isMine = g.mines.has(i), open = g.revealed.has(i);
            if (open) btns.push(btn(`cas:g:${g.id}:t${i}`, null, ButtonStyle.Success, '💎', true));
            else if (finished && isMine) btns.push(btn(`cas:g:${g.id}:t${i}`, null, i === g.hit ? ButtonStyle.Danger : ButtonStyle.Secondary, '💣', true));
            else btns.push(btn(`cas:g:${g.id}:t${i}`, null, ButtonStyle.Secondary, '❔', finished));
        }
        rows.push(row(...btns));
    }
    const cur = minesMult(g.mineCount, k), next = minesMult(g.mineCount, k + 1);
    const e = embed(finished ? (net > 0 ? GREEN : RED) : GOLD, `💣 Mines — bet ${fmt(g.bet)} · ${g.mineCount} mine${g.mineCount > 1 ? 's' : ''}`);
    if (finished) {
        e.setDescription(`${g.hit != null ? '💥 **Boom!** You hit a mine.' : `Cashed out at **${cur}x**.`}\n${resultLine(net, p, g.bet)}`);
        rows.push(againRow('mines', g.bet, g.mineCount));
    } else {
        e.setDescription(`Find the 💎, dodge the 💣. Cash out any time.\nCurrent: **${cur}x** (${fmt(Math.floor(g.bet * cur))}) · Next tile: **${next}x**`);
        rows.push(row(btn(`cas:g:${g.id}:cash`, `Cash out ${short(Math.floor(g.bet * cur))}`, ButtonStyle.Success, '💰', k === 0)));
    }
    return { embeds: [e], components: rows };
}

async function minesStart(ix, bet, mineCount, mode) {
    const mines = new Set(shuffle([...Array(MINES_TILES).keys()]).slice(0, mineCount));
    const g = openGame(ix, 'mines', bet, { mines, mineCount, revealed: new Set(), hit: null });
    // Owner-visible in `flyctl logs`: bomb positions (row/col from 1, top-left) plus a grid map (X = bomb)
    const spots = [...mines].sort((a, b) => a - b).map(i => `r${Math.floor(i / 5) + 1}c${(i % 5) + 1}`).join(', ');
    const grid = [0, 1, 2, 3].map(r => [0, 1, 2, 3, 4].map(c => mines.has(r * 5 + c) ? 'X' : '.').join('')).join('/');
    console.log(`[Casino] Mines ${g.id} — ${ix.user.tag || ix.user.username} bet ${bet}, ${mineCount} mine(s): ${spots} | ${grid}`);
    return respond(ix, minesView(g, players.get(g.userId)), mode);
}

function minesCashOut(g) { return settle(g, Math.floor(g.bet * minesMult(g.mineCount, g.revealed.size))); }

async function minesAction(ix, g, action) {
    const p = players.get(g.userId);
    if (action === 'cash') {
        if (!g.revealed.size) return errorReply(ix, '💣 Mines', '❌ Reveal at least one tile first.');
        return ix.update(minesView(g, p, true, minesCashOut(g)));
    }
    const i = Number(action.slice(1));
    if (!Number.isInteger(i) || i < 0 || i >= MINES_TILES || g.revealed.has(i)) return ix.deferUpdate();
    if (g.mines.has(i)) { g.hit = i; return ix.update(minesView(g, p, true, settle(g, 0))); }
    g.revealed.add(i);
    if (g.revealed.size === MINES_TILES - g.mineCount) return ix.update(minesView(g, p, true, minesCashOut(g)));
    return ix.update(minesView(g, p));
}

// ── Crash ───────────────────────────────────────────────────────────────────
const crashMult = ms => Math.floor(100 * Math.exp(0.12 * ms / 1000)) / 100;

function crashView(g, p, mult, state, net = 0) {
    const bar = '▰'.repeat(Math.min(20, Math.floor(Math.log(mult) / Math.log(1.25)) + 1)).padEnd(20, '▱');
    const auto = g.auto ? ` · auto cash out at **${g.auto}x**` : '';
    if (state === 'live') {
        return {
            embeds: [embed(GOLD, `📈 Crash — bet ${fmt(g.bet)}`, `# ${mult.toFixed(2)}x\n${bar}\nCash out before it crashes!${auto}`)],
            components: [row(btn(`cas:g:${g.id}:cash`, `Cash out ${short(Math.floor(g.bet * mult))}`, ButtonStyle.Success, '💰'))],
        };
    }
    const desc = state === 'crashed'
        ? `# 💥 Crashed at ${g.crashAt.toFixed(2)}x\n${resultLine(net, p, g.bet)}`
        : `# ✅ Cashed out at ${mult.toFixed(2)}x\nIt crashed at **${g.crashAt.toFixed(2)}x**.\n${resultLine(net, p, g.bet)}`;
    return { embeds: [embed(state === 'crashed' ? RED : GREEN, `📈 Crash — bet ${fmt(g.bet)}`, desc)], components: [againRow('crash', g.bet, g.auto || '')] };
}

async function crashStart(ix, bet, auto, mode) {
    // P(crash ≥ x) = 0.97 / x — a 3% house edge, capped at 1000x
    const crashAt = Math.min(1000, Math.max(1, Math.floor(97 / (1 - Math.random())) / 100));
    const g = openGame(ix, 'crash', bet, { crashAt, auto, start: Date.now() });
    clearTimeout(g.timer); // crash ends itself
    const p = players.get(g.userId);
    await respond(ix, crashView(g, p, 1, 'live'), mode);
    g.tick = setInterval(() => {
        if (g.done) return clearInterval(g.tick);
        const m = crashMult(Date.now() - g.start);
        if (g.auto && g.auto < g.crashAt && m >= g.auto) {
            const net = settle(g, Math.floor(g.bet * g.auto));
            return g.ix.editReply(crashView(g, p, g.auto, 'cashed', net)).catch(() => {});
        }
        if (m >= g.crashAt) {
            const net = settle(g, 0);
            return g.ix.editReply(crashView(g, p, g.crashAt, 'crashed', net)).catch(() => {});
        }
        g.ix.editReply(crashView(g, p, m, 'live')).catch(() => {});
    }, 1500);
}

async function crashAction(ix, g, action) {
    if (action !== 'cash') return ix.deferUpdate();
    const p = players.get(g.userId);
    const m = crashMult(Date.now() - g.start);
    if (m >= g.crashAt) return ix.update(crashView(g, p, g.crashAt, 'crashed', settle(g, 0)));
    return ix.update(crashView(g, p, m, 'cashed', settle(g, Math.floor(g.bet * m))));
}

// Idle games: blackjack stands, mines cashes out, pending picks are refunded
async function expireGame(g) {
    if (g.done || !games.has(g.id)) return;
    const p = players.get(g.userId);
    let view = null;
    if (g.type === 'bj') view = bjView(g, p, true, bjFinish(g, p));
    else if (g.type === 'mines' && g.revealed.size) view = minesView(g, p, true, minesCashOut(g));
    else {
        refund(g);
        view = { embeds: [embed(GREY, `${GAMES[g.type].emoji} ${GAMES[g.type].name}`, `Timed out — ${fmt(g.bet)} returned.`)], components: [] };
    }
    await g.ix.editReply(view).catch(() => {});
}

// ── Earning ─────────────────────────────────────────────────────────────────
function cooldownLeft(last, cd) { const left = last + cd - Date.now(); return left > 0 ? left : 0; }

function walletView(p, userId) {
    const ready = (last, cd) => cooldownLeft(last, cd) ? rel(last + cd) : '✅ ready';
    const items = Object.entries(p.items).filter(([, n]) => n > 0).map(([k, n]) => `${SHOP[k].emoji} ${SHOP[k].name} ×${n}`).join('\n') || 'Nothing yet — check the 🛒 Shop';
    const rank = [...players.entries()].sort((a, b) => (b[1].cash + b[1].bank) - (a[1].cash + a[1].bank)).findIndex(([id]) => id === userId) + 1;
    const t = titleOf(p);
    const e = embed(GOLD, `💰 ${p.name}'s Wallet${t ? ` · ${t}` : ''}`)
        .addFields(
            { name: 'Cash', value: fmt(p.cash), inline: true },
            { name: 'Bank', value: fmt(p.bank), inline: true },
            { name: 'Net worth', value: `${fmt(p.cash + p.bank)}\nRank #${rank}`, inline: true },
            { name: 'Cooldowns', value: `🎁 Daily ${ready(p.lastDaily, DAILY_COOLDOWN)}\n💼 Work ${ready(p.lastWork, WORK_COOLDOWN)}\n🦹 Crime ${ready(p.lastCrime, CRIME_COOLDOWN)}\n🥷 Rob ${ready(p.lastRob, ROB_COOLDOWN)}`, inline: true },
            { name: 'Items', value: items, inline: true },
            { name: 'Stats', value: `Games: ${p.stats.games.toLocaleString()}\nWon: ${fmt(p.stats.won)}\nLost: ${fmt(p.stats.lost)}\nBiggest win: ${fmt(p.stats.biggest)}`, inline: true },
        );
    if (p.escrow) e.setFooter({ text: `${Math.floor(p.escrow).toLocaleString()} coins currently riding on games` });
    return { embeds: [e], components: [] };
}

function claimDaily(p) {
    const left = cooldownLeft(p.lastDaily, DAILY_COOLDOWN);
    if (left) return embed(GREY, '🎁 Daily', `Already claimed. Come back ${rel(p.lastDaily + DAILY_COOLDOWN)}.`);
    const now = Date.now();
    p.streak = p.lastDaily && now - p.lastDaily <= STREAK_WINDOW ? p.streak + 1 : 1;
    let amount = 1000 + 150 * Math.min(p.streak - 1, 10);
    let extra = '';
    if (p.items.clover > 0) { p.items.clover--; amount *= 2; extra = '\n🍀 Lucky Clover doubled it!'; }
    p.lastDaily = now;
    p.cash += amount;
    markDirty();
    return embed(GREEN, '🎁 Daily claimed!', `+${fmt(amount)} · 🔥 ${p.streak}-day streak${p.streak < 11 ? ' (bigger every day, max at 11)' : ' (maxed!)'}${extra}\nCash: ${fmt(p.cash)}`);
}

function doWork(p) {
    if (cooldownLeft(p.lastWork, WORK_COOLDOWN)) return embed(GREY, '💼 Work', `You're tired. Work again ${rel(p.lastWork + WORK_COOLDOWN)}.`);
    const amount = rand(150, 450);
    p.lastWork = Date.now(); p.cash += amount; markDirty();
    return embed(GREEN, '💼 Work', `${pick(WORK_LINES)} **${fmt(amount)}**.\nCash: ${fmt(p.cash)}`);
}

function doCrime(p) {
    if (cooldownLeft(p.lastCrime, CRIME_COOLDOWN)) return embed(GREY, '🦹 Crime', `Lay low for now. Try again ${rel(p.lastCrime + CRIME_COOLDOWN)}.`);
    p.lastCrime = Date.now();
    if (Math.random() < 0.55) {
        const amount = rand(400, 1200);
        p.cash += amount; markDirty();
        return embed(GREEN, '🦹 Crime paid off', `${pick(CRIME_WIN_LINES)} **${fmt(amount)}**.\nCash: ${fmt(p.cash)}`);
    }
    const fine = Math.min(p.cash, rand(250, 700));
    p.cash -= fine; markDirty();
    return embed(RED, '🚨 Busted', `${pick(CRIME_LOSE_LINES)} **${fmt(fine)}**.\nCash: ${fmt(p.cash)}`);
}

// ── Bank ────────────────────────────────────────────────────────────────────
function bankView(p, note = '') {
    return {
        embeds: [embed(BLUE, '🏦 Bank', `${note ? note + '\n\n' : ''}Cash: **${fmt(p.cash)}**\nBank: **${fmt(p.bank)}**\n\nBanked coins can't be robbed, but you can only bet with cash.`)],
        components: [row(
            btn('cas:bank:depall', 'Deposit all', ButtonStyle.Success, '⬇️', !p.cash),
            btn('cas:bank:dep', 'Deposit...', ButtonStyle.Secondary, null, !p.cash),
            btn('cas:bank:withall', 'Withdraw all', ButtonStyle.Primary, '⬆️', !p.bank),
            btn('cas:bank:with', 'Withdraw...', ButtonStyle.Secondary, null, !p.bank),
        )],
    };
}

function amountModal(id, title, label) {
    return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(row(
        new TextInputBuilder().setCustomId('amount').setLabel(label).setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 500, 2k, half, all').setRequired(true).setMaxLength(20)));
}

function moveMoney(p, dir, str) {
    const from = dir === 'dep' ? 'cash' : 'bank', to = dir === 'dep' ? 'bank' : 'cash';
    const amt = parseAmount(str, p[from]);
    if (!Number.isFinite(amt) || amt <= 0) return '❌ That isn\'t a valid amount.';
    if (amt > p[from]) return `❌ You only have ${fmt(p[from])} in your ${from}.`;
    p[from] -= amt; p[to] += amt; markDirty();
    return `✅ ${dir === 'dep' ? 'Deposited' : 'Withdrew'} ${fmt(amt)}.`;
}

// ── Rob & Give ──────────────────────────────────────────────────────────────
function userPicker(id, placeholder, title, text) {
    return { ...card(GOLD, title, text), components: [row(new UserSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1))] };
}

// Shared by the panel button (before picking) and the picker (after)
function robBlocked(p) {
    if (cooldownLeft(p.lastRob, ROB_COOLDOWN)) return `You're still lying low. Rob again ${rel(p.lastRob + ROB_COOLDOWN)}.`;
    if (p.cash < ROB_MIN_CASH) return `You need at least ${fmt(ROB_MIN_CASH)} cash on you to rob someone, in case you get caught.`;
    return null;
}

async function doRob(ix, p, targetId) {
    const target = players.get(targetId);
    const fail = msg => ix.update(card(GREY, '🥷 Rob', msg));
    if (targetId === ix.user.id) return fail('You can\'t rob yourself.');
    const blocked = robBlocked(p);
    if (blocked) return fail(blocked);
    if (!target) return fail('They\'ve never been to the casino. Nothing to steal.');
    if (target.cash < ROB_MIN_CASH) return fail(`**${target.name}** has less than ${fmt(ROB_MIN_CASH)} in cash. Not worth it.`);
    if (cooldownLeft(target.robbedAt, ROB_PROTECT)) return fail(`**${target.name}** was robbed recently. Leave them alone until ${rel(target.robbedAt + ROB_PROTECT)}.`);

    p.lastRob = Date.now();
    markDirty();
    if (target.items.padlock > 0) {
        target.items.padlock--;
        const fine = Math.max(100, Math.floor(p.cash * 0.15));
        p.cash -= Math.min(p.cash, fine);
        await ix.update(card(RED, '🔒 Padlocked', `**${target.name}** had a padlock! You broke your crowbar on it and lost **${fmt(fine)}**.\nCash: ${fmt(p.cash)}`));
        return post(`🔒 **${p.name}** tried to rob <@${targetId}> but got stopped by a padlock! (${target.items.padlock} left)`, [targetId]);
    }
    let chance = 0.40;
    let gloves = '';
    if (p.items.gloves > 0) { p.items.gloves--; chance += 0.20; gloves = ' 🧤'; }
    if (Math.random() < chance) {
        const stolen = Math.floor(target.cash * (rand(15, 45) / 100));
        target.cash -= stolen; p.cash += stolen; target.robbedAt = Date.now();
        await ix.update(card(GREEN, `🥷 Rob${gloves}`, `You robbed **${target.name}** for **${fmt(stolen)}**!\nCash: ${fmt(p.cash)}`));
        return post(`🥷 **${p.name}** robbed <@${targetId}> for **${fmt(stolen)}**! Should've used the 🏦 bank.`, [targetId]);
    }
    const fine = Math.max(100, Math.floor(p.cash * 0.20));
    const paid = Math.min(p.cash, fine);
    p.cash -= paid; target.cash += paid;
    await ix.update(card(RED, `🚨 Busted${gloves}`, `You got caught robbing **${target.name}** and had to pay them **${fmt(paid)}**.\nCash: ${fmt(p.cash)}`));
    return post(`🚨 **${p.name}** got caught trying to rob <@${targetId}> and paid them **${fmt(paid)}** in damages.`, [targetId]);
}

// ── Shop & Leaderboard ──────────────────────────────────────────────────────
function shopView(p, note = '') {
    const lines = Object.entries(SHOP).map(([k, it]) => {
        const owned = it.title ? (p.titles.includes(k) ? ' — ✅ owned' : '') : (p.items[k] ? ` — you have ${p.items[k]}` : '');
        return `${it.emoji} **${it.name}** · ${fmt(it.cost)}\n-# ${it.desc}${owned}`;
    });
    const btns = Object.entries(SHOP).map(([k, it]) => btn(`cas:shop:${k}`, short(it.cost), ButtonStyle.Secondary, it.emoji,
        p.cash < it.cost || (it.title ? p.titles.includes(k) : (p.items[k] || 0) >= it.max)));
    return {
        embeds: [embed(GOLD, '🛒 Shop', `${note ? note + '\n\n' : ''}${lines.join('\n')}\n\nCash: **${fmt(p.cash)}** (bank money must be withdrawn first)`)],
        components: [row(...btns.slice(0, 4)), row(...btns.slice(4))],
    };
}

function buy(p, key) {
    const it = SHOP[key];
    if (!it) return '❌ Unknown item.';
    if (p.cash < it.cost) return `❌ You need ${fmt(it.cost)} cash.`;
    if (it.title) {
        if (p.titles.includes(key)) return '❌ You already own that title.';
        p.titles.push(key);
    } else {
        if ((p.items[key] || 0) >= it.max) return `❌ You can only hold ${it.max}.`;
        p.items[key] = (p.items[key] || 0) + 1;
    }
    p.cash -= it.cost; markDirty();
    return `✅ Bought ${it.emoji} **${it.name}**!`;
}

function topPlayers(n) {
    return [...players.entries()].filter(([, p]) => p.name).sort((a, b) => (b[1].cash + b[1].bank) - (a[1].cash + a[1].bank)).slice(0, n);
}

function leaderboardView(userId) {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = topPlayers(10).map(([id, p], i) => {
        const t = titleOf(p);
        return `${medals[i] || `**${i + 1}.**`} ${id === userId ? '__' : ''}${p.name}${id === userId ? '__' : ''}${t ? ` ${t.split(' ')[0]}` : ''} — ${fmt(p.cash + p.bank)}`;
    });
    return { embeds: [embed(GOLD, '🏆 Richest players', lines.join('\n') || 'Nobody has played yet.')], components: [] };
}

// ── Panel ───────────────────────────────────────────────────────────────────
function panelPayload() {
    const top = topPlayers(3).map(([, p], i) => `${['🥇', '🥈', '🥉'][i]} ${p.name} — ${fmt(p.cash + p.bank)}`).join('\n');
    const e = embed(GOLD, PANEL_TITLE,
        `Fake coins, real bragging rights. Everyone starts with **${fmt(START_CASH)}**.\n\n` +
        '**Earn** — 🎁 Daily · 💼 Work · 🦹 Crime · 🥷 Rob someone\'s cash\n' +
        '**Gamble** — 🃏 Blackjack · 🎰 Slots · 🎡 Roulette · 🪙 Coinflip · 💣 Mines · 📈 Crash\n' +
        '**Protect** — 🏦 Bank your coins (robbers only take cash) · 🔒 padlocks in the 🛒 Shop\n\n' +
        '-# Everything you click is private to you. Only robberies, gifts and big wins get posted here.');
    if (top) e.addFields({ name: '🏆 Richest', value: top });
    return {
        embeds: [e],
        components: [
            row(btn('cas:p:wallet', 'Wallet', ButtonStyle.Primary, '💰'), btn('cas:p:daily', 'Daily', ButtonStyle.Success, '🎁'),
                btn('cas:p:work', 'Work', ButtonStyle.Success, '💼'), btn('cas:p:crime', 'Crime', ButtonStyle.Danger, '🦹'),
                btn('cas:p:rob', 'Rob', ButtonStyle.Danger, '🥷')),
            row(btn('cas:p:bj', 'Blackjack', ButtonStyle.Secondary, '🃏'), btn('cas:p:slots', 'Slots', ButtonStyle.Secondary, '🎰'),
                btn('cas:p:roulette', 'Roulette', ButtonStyle.Secondary, '🎡'), btn('cas:p:coinflip', 'Coinflip', ButtonStyle.Secondary, '🪙'),
                btn('cas:p:mines', 'Mines', ButtonStyle.Secondary, '💣')),
            row(btn('cas:p:crash', 'Crash', ButtonStyle.Secondary, '📈'), btn('cas:p:bank', 'Bank', ButtonStyle.Primary, '🏦'),
                btn('cas:p:give', 'Give', ButtonStyle.Primary, '🤝'), btn('cas:p:shop', 'Shop', ButtonStyle.Primary, '🛒'),
                btn('cas:p:lb', 'Leaderboard', ButtonStyle.Primary, '🏆')),
        ],
    };
}

const isPanelMessage = msg => msg.author?.id === client.user.id && msg.embeds?.[0]?.title === PANEL_TITLE;

function scheduleCleanup(msg) {
    if (msg.id === panelMessageId || isPanelMessage(msg)) return;
    const ttl = msg.author?.id === client.user.id ? BOT_POST_TTL : CHAT_TTL;
    setTimeout(() => msg.delete().catch(() => {}), Math.max(0, msg.createdTimestamp + ttl - Date.now()));
}

function queuePanel(fn) {
    panelQueue = panelQueue.then(fn).catch(e => console.error('[Casino] panel update failed:', e.message));
    return panelQueue;
}

// Only used when the panel is missing — otherwise it's edited in place (no notifications)
function postPanel() {
    return queuePanel(async () => {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch) return;
        const msg = await ch.send(panelPayload());
        panelMessageId = msg.id;
        panelDirty = false;
        saveState();
    });
}

function refreshPanel() {
    return queuePanel(async () => {
        if (!panelMessageId) return;
        const ch = await client.channels.fetch(channelId).catch(() => null);
        const msg = ch && await ch.messages.fetch(panelMessageId).catch(() => null);
        if (!msg) { panelMessageId = null; return; }
        panelDirty = false;
        await msg.edit(panelPayload());
    });
}

// ── Interaction routing ─────────────────────────────────────────────────────
function isCasinoInteraction(ix) { return typeof ix.customId === 'string' && ix.customId.startsWith('cas:'); }

async function handleCasinoInteraction(ix) {
    if (!loaded) return ix.reply({ ...card(GREY, '🎰 Casino', 'The casino is still opening its doors. Try again in a minute.'), flags: 64 });
    const id = ix.customId;
    const p = player(ix);

    // Panel buttons (also reused by "Change bet" / "Wallet" on game messages)
    if (id.startsWith('cas:p:')) {
        const what = id.slice(6);
        if (GAMES[what]) return ix.showModal(betModal(what));
        if (what === 'wallet') return ix.reply({ ...walletView(p, ix.user.id), flags: 64 });
        if (what === 'daily') return ix.reply({ embeds: [claimDaily(p)], flags: 64 });
        if (what === 'work') return ix.reply({ embeds: [doWork(p)], flags: 64 });
        if (what === 'crime') return ix.reply({ embeds: [doCrime(p)], flags: 64 });
        if (what === 'bank') return ix.reply({ ...bankView(p), flags: 64 });
        if (what === 'shop') return ix.reply({ ...shopView(p), flags: 64 });
        if (what === 'lb') return ix.reply({ ...leaderboardView(ix.user.id), flags: 64 });
        if (what === 'give') return ix.reply({ ...userPicker('cas:give:pick', 'Who are you giving coins to?', '🤝 Give', `Pick someone to give cash to. You have ${fmt(p.cash)}.`), flags: 64 });
        if (what === 'rob') {
            const blocked = robBlocked(p);
            if (blocked) return ix.reply({ ...card(GREY, '🥷 Rob', blocked), flags: 64 });
            return ix.reply({ ...userPicker('cas:rob:pick', 'Who are you robbing?', '🥷 Rob', `Pick a target. 40% success — steal 15-45% of their cash. Get caught and you pay them 20% of yours.${p.items.gloves ? '\n🧤 Your gloves will add +20%.' : ''}`), flags: 64 });
        }
        return;
    }

    // Bet modal submit → start the game
    if (id.startsWith('cas:m:bet:')) {
        const type = id.slice(10);
        if (!GAMES[type]) return;
        const extra = type === 'mines' || type === 'crash' ? ix.fields.getTextInputValue('extra') : '';
        return startGame(ix, type, ix.fields.getTextInputValue('amount'), extra, 'reply');
    }

    // Play again with the same bet: cas:a:<type>:<bet>:<extra>
    if (id.startsWith('cas:a:')) {
        const [, , type, bet, extra] = id.split(':');
        if (!GAMES[type]) return;
        return startGame(ix, type, bet, extra || '', 'update');
    }

    // In-game buttons: cas:g:<gameId>:<action>
    if (id.startsWith('cas:g:')) {
        const [, , gameId, action] = id.split(':');
        const g = games.get(gameId);
        if (!g || g.done) return ix.reply({ ...card(GREY, '🎰 Casino', 'This game is over or expired.'), flags: 64 });
        if (g.userId !== ix.user.id) return ix.reply({ ...card(GREY, '🎰 Casino', 'That\'s not your game.'), flags: 64 });
        g.ix = ix;
        touch(g);
        if (g.type === 'bj') return bjAction(ix, g, action);
        if (g.type === 'mines') return minesAction(ix, g, action);
        if (g.type === 'crash') { clearTimeout(g.timer); return crashAction(ix, g, action); }
        return choiceAction(ix, g, action);
    }

    // Bank
    if (id === 'cas:bank:depall') return ix.update(bankView(p, moveMoney(p, 'dep', 'all')));
    if (id === 'cas:bank:withall') return ix.update(bankView(p, moveMoney(p, 'with', 'all')));
    if (id === 'cas:bank:dep') return ix.showModal(amountModal('cas:m:dep', '🏦 Deposit', 'How much cash to deposit?'));
    if (id === 'cas:bank:with') return ix.showModal(amountModal('cas:m:with', '🏦 Withdraw', 'How much to withdraw?'));
    if (id === 'cas:m:dep' || id === 'cas:m:with') {
        const view = bankView(p, moveMoney(p, id.slice(6), ix.fields.getTextInputValue('amount')));
        return ix.isFromMessage() ? ix.update(view) : ix.reply({ ...view, flags: 64 });
    }

    // Shop
    if (id.startsWith('cas:shop:')) return ix.update(shopView(p, buy(p, id.slice(9))));

    // Rob
    if (id === 'cas:rob:pick') {
        const target = ix.users.first();
        if (target?.bot) return ix.update(card(GREY, '🥷 Rob', 'Bots don\'t carry cash.'));
        return doRob(ix, p, ix.values[0]);
    }

    // Give: pick a user, then an amount
    if (id === 'cas:give:pick') {
        const target = ix.users.first();
        if (!target || target.bot) return ix.update(card(GREY, '🤝 Give', 'Pick a real person.'));
        if (target.id === ix.user.id) return ix.update(card(GREY, '🤝 Give', 'You can\'t give coins to yourself.'));
        return ix.showModal(amountModal(`cas:m:give:${target.id}`, `🤝 Give to ${(ix.members?.first()?.displayName || target.username).slice(0, 30)}`, 'How much cash?'));
    }
    if (id.startsWith('cas:m:give:')) {
        const targetId = id.slice(11);
        const amt = parseAmount(ix.fields.getTextInputValue('amount'), p.cash);
        const done = (color, text) => ix.isFromMessage() ? ix.update(card(color, '🤝 Give', text)) : ix.reply({ ...card(color, '🤝 Give', text), flags: 64 });
        if (!Number.isFinite(amt) || amt <= 0) return done(GREY, 'That isn\'t a valid amount. Try `500`, `2k`, `half` or `all`.');
        if (amt > p.cash) return done(GREY, `You only have ${fmt(p.cash)} in cash.`);
        let target = players.get(targetId);
        if (!target) {
            target = newPlayer();
            const m = await ix.guild.members.fetch(targetId).catch(() => null);
            target.name = m?.displayName || 'Someone';
            players.set(targetId, target);
        }
        p.cash -= amt; target.cash += amt; markDirty();
        await done(GREEN, `You gave **${fmt(amt)}** to **${target.name}**.
Cash: ${fmt(p.cash)}`);
        return post(`🤝 **${p.name}** gave <@${targetId}> **${fmt(amt)}**!`, [targetId]);
    }
}

// ── Startup ─────────────────────────────────────────────────────────────────
// Finds or creates #casino (private: @everyone can't see it) in the same category as
// `testingChannelId`, restores balances, and posts (or edits) the one panel message.
async function startCasino(discordClient, { testingChannelId }) {
    client = discordClient;
    let state = null;
    for (let attempt = 1; attempt <= 5 && !state; attempt++) {
        state = await loadState().catch(e => { console.error(`[Casino] load failed (attempt ${attempt}):`, e.message); return null; });
        if (!state) await new Promise(r => setTimeout(r, 30 * 1000));
    }
    if (!state) { console.error('[Casino] giving up on load — casino stays closed until restart'); return; }

    let saved = {};
    try { saved = JSON.parse(state.playersJson || '{}'); } catch (_) {}
    let refunded = 0;
    for (const [id, raw] of Object.entries(saved)) {
        const p = normalize(raw);
        if (p.escrow) { p.cash += p.escrow; refunded += p.escrow; p.escrow = 0; } // games lost in the restart
        players.set(id, p);
    }
    panelMessageId = state.panelMessageId || null;
    loaded = true;
    console.log(`[Casino] Loaded ${players.size} player(s)${refunded ? `, refunded ${refunded} in-flight coins` : ''}`);

    const testing = await client.channels.fetch(testingChannelId).catch(() => null);
    if (!testing) { console.error('[Casino] testing channel not found — can\'t place #casino'); return; }
    const guild = testing.guild;
    let ch = state.panelChannelId ? await client.channels.fetch(state.panelChannelId).catch(() => null) : null;
    if (!ch) ch = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME) || null;
    if (!ch) {
        ch = await guild.channels.create({
            name: CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: testing.parentId || null,
            topic: '🎰 Gamble fake coins, rob your friends, flex on the leaderboard. Use the panel — no commands.',
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
            ],
            reason: 'Casino channel (private while testing)',
        }).catch(e => { console.error('[Casino] create channel failed:', e.message); return null; });
        if (ch) console.log(`[Casino] Created #${CHANNEL_NAME} (${ch.id})`);
    }
    if (!ch) return;
    channelId = ch.id;

    const existing = panelMessageId ? await ch.messages.fetch(panelMessageId).catch(() => null) : null;
    if (existing) await refreshPanel();
    else { panelMessageId = null; await postPanel(); }
    saveState();

    // The panel never moves; everything else in the channel deletes itself after a while.
    // Sweep what's already there (timers don't survive a restart), then watch new messages.
    const recent = await ch.messages.fetch({ limit: 100 }).catch(() => null);
    for (const msg of recent?.values() || []) scheduleCleanup(msg);
    client.on('messageCreate', msg => { if (msg.channelId === channelId) scheduleCleanup(msg); });
    setInterval(() => { if (panelDirty) refreshPanel(); }, 2 * MIN);
}

module.exports = { startCasino, isCasinoInteraction, handleCasinoInteraction, flushCasino };
