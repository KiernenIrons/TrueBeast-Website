/**
 * TrueBeast — 24/7 Lofi Radio Bot
 * ================================
 * Joins a Discord voice channel and streams a lofi radio station continuously.
 * Auto-reconnects on disconnect, stream errors, or server hiccups.
 *
 * Env vars (set in Railway):
 *   DISCORD_BOT_TOKEN  — from Cloudflare Worker secrets (same token)
 *   DISCORD_GUILD_ID   — from Cloudflare Worker secrets (same guild)
 *   VOICE_CHANNEL_ID   — right-click the voice channel → Copy Channel ID
 *   STREAM_URL         — (optional) override the default lofi stream
 */

require('dotenv').config();

// Register FFmpeg binary BEFORE requiring @discordjs/voice so it can find it.
// ffmpeg-static bundles the binary — this line puts it on the PATH.
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    StreamType,
} = require('@discordjs/voice');

// ── Config ────────────────────────────────────────────────────────────────────

const TOKEN      = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID   = process.env.DISCORD_GUILD_ID;
const CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

// Default stream: SomaFM "Groove Salad" — free, legal, non-profit ambient/lofi
// radio running 24/7 since 2000. No API keys, URL never expires.
//
// Other good options (set via STREAM_URL env var):
//   http://ice1.somafm.com/lush-128-mp3              (chilled indie/electronic)
//   http://ice1.somafm.com/dronezone-256-mp3         (ambient/atmospheric)
//   https://streams.ilovemusic.de/iloveradio17.mp3   (lofi hip hop)
const STREAM_URL = process.env.STREAM_URL || 'http://ice1.somafm.com/groovesalad-256-mp3';

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
    console.error('[Radio] ❌  Missing env vars. Required: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, VOICE_CHANNEL_ID');
    process.exit(1);
}

console.log('[Radio] FFmpeg path:', ffmpegPath);

// ── State ─────────────────────────────────────────────────────────────────────

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let player       = null;
let connection   = null;
let restartTimer = null;
let restartDelay = 5_000;   // starts at 5s, doubles on repeated failures (max 60s)
let streamStarted = false;  // guard: only start stream once per connection

// ── Stream ────────────────────────────────────────────────────────────────────

function playStream() {
    if (!player) return;
    clearTimeout(restartTimer);
    try {
        const resource = createAudioResource(STREAM_URL, { inputType: StreamType.Arbitrary });
        player.play(resource);
        restartDelay = 5_000; // reset backoff on successful play
        console.log('[Radio] ▶  Streaming:', STREAM_URL);
    } catch (err) {
        console.error('[Radio] Failed to create audio resource:', err.message);
        scheduleRestart();
    }
}

function scheduleRestart(delayOverride) {
    clearTimeout(restartTimer);
    const delay = delayOverride ?? restartDelay;
    restartDelay = Math.min(restartDelay * 2, 60_000); // exponential backoff, cap 60s
    console.log(`[Radio] ↻  Restarting stream in ${delay / 1000}s...`);
    restartTimer = setTimeout(playStream, delay);
}

// ── Voice ─────────────────────────────────────────────────────────────────────

function startRadio(channel) {
    console.log(`[Radio] Joining #${channel.name} in "${channel.guild.name}"...`);
    streamStarted = false;

    connection = joinVoiceChannel({
        channelId:      channel.id,
        guildId:        channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf:       true,   // bot doesn't listen — saves bandwidth
        selfMute:       false,
    });

    player = createAudioPlayer();
    connection.subscribe(player);

    // Start streaming as soon as the voice UDP handshake completes.
    // Using an event rather than await entersState() so a slow Railway
    // network handshake doesn't kill the process.
    connection.on(VoiceConnectionStatus.Ready, () => {
        console.log('[Radio] ✅ Voice connection ready.');
        if (!streamStarted) {
            streamStarted = true;
            playStream();
        }
    });

    // Stream ended naturally (server hiccup, brief network blip) → restart
    player.on(AudioPlayerStatus.Idle, () => {
        console.log('[Radio] Stream went idle — restarting...');
        scheduleRestart(2_000);
    });

    // Hard player error (e.g. FFmpeg crash, stream unreachable)
    player.on('error', (err) => {
        console.error('[Radio] Player error:', err.message);
        scheduleRestart();
    });

    // Voice connection dropped → try to self-recover, else rejoin from scratch
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        console.log('[Radio] Voice disconnected — attempting auto-reconnect...');
        try {
            // Discord sometimes briefly shows Disconnected before reconnecting itself
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
            console.log('[Radio] Reconnected to voice.');
        } catch {
            connection.destroy();
            connection = null;
            player     = null;
            console.log('[Radio] Rejoin failed — retrying in 15s...');
            setTimeout(async () => {
                try {
                    const ch = await client.channels.fetch(CHANNEL_ID);
                    startRadio(ch);
                } catch (e) {
                    console.error('[Radio] Channel fetch failed:', e.message);
                    scheduleRestart(30_000);
                }
            }, 15_000);
        }
    });

    connection.on('error', (err) => {
        console.error('[Radio] Connection error:', err.message);
    });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// 'clientReady' is the non-deprecated name in discord.js v14+
client.once('clientReady', async () => {
    console.log(`[Radio] ✅ Logged in as ${client.user.tag}`);
    console.log(`[Radio] Targeting channel ID: ${CHANNEL_ID}`);
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) {
            throw new Error(`Channel ${CHANNEL_ID} not found. Check VOICE_CHANNEL_ID env var.`);
        }
        if (!channel.isVoiceBased()) {
            throw new Error(`Channel ${CHANNEL_ID} ("${channel.name}") is not a voice channel.`);
        }
        startRadio(channel);
    } catch (err) {
        console.error('[Radio] Startup error:', err.message);
        process.exit(1);
    }
});

client.on('error', (err) => console.error('[Radio] Client error:', err.message));

client.login(TOKEN);
