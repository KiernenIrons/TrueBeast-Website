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
// radio that has run 24/7 since 2000. Zero API keys required, URL never expires.
//
// Other good options:
//   http://ice1.somafm.com/lush-128-mp3         (chilled indie/electronic)
//   http://ice1.somafm.com/dronezone-256-mp3    (ambient/atmospheric)
//   https://streams.ilovemusic.de/iloveradio17.mp3  (lofi hip hop)
const STREAM_URL = process.env.STREAM_URL || 'http://ice1.somafm.com/groovesalad-256-mp3';

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
    console.error('[Radio] ❌  Missing env vars. Required: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, VOICE_CHANNEL_ID');
    process.exit(1);
}

// ── State ─────────────────────────────────────────────────────────────────────

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let player          = null;
let connection      = null;
let restartTimer    = null;
let restartDelay    = 5_000;   // starts at 5s, doubles on repeated failures (max 60s)

// ── Stream ────────────────────────────────────────────────────────────────────

function playStream() {
    if (!player) return;
    clearTimeout(restartTimer);
    try {
        const resource = createAudioResource(STREAM_URL, { inputType: StreamType.Arbitrary });
        player.play(resource);
        restartDelay = 5_000; // reset backoff on a successful play
        console.log('[Radio] ▶  Stream started:', STREAM_URL);
    } catch (err) {
        console.error('[Radio] Failed to create audio resource:', err.message);
        scheduleRestart();
    }
}

function scheduleRestart(delayOverride) {
    clearTimeout(restartTimer);
    const delay = delayOverride ?? restartDelay;
    restartDelay = Math.min(restartDelay * 2, 60_000); // exponential backoff, cap at 60s
    console.log(`[Radio] ↻  Restarting stream in ${delay / 1000}s...`);
    restartTimer = setTimeout(playStream, delay);
}

// ── Voice ─────────────────────────────────────────────────────────────────────

async function startRadio(channel) {
    console.log(`[Radio] Joining #${channel.name} in "${channel.guild.name}"`);

    connection = joinVoiceChannel({
        channelId:       channel.id,
        guildId:         channel.guild.id,
        adapterCreator:  channel.guild.voiceAdapterCreator,
        selfDeaf:        true,   // the bot doesn't listen — saves bandwidth
        selfMute:        false,
    });

    player = createAudioPlayer();
    connection.subscribe(player);

    // Stream ended naturally (server hiccup, brief network blip) → restart
    player.on(AudioPlayerStatus.Idle, () => {
        console.log('[Radio] Stream went idle, restarting...');
        scheduleRestart(2_000);
    });

    // Hard player error
    player.on('error', (err) => {
        console.error('[Radio] Player error:', err.message);
        scheduleRestart();
    });

    // Voice connection dropped
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
            // Couldn't self-recover — destroy and rejoin from scratch
            connection.destroy();
            connection = null;
            console.log('[Radio] Rejoin failed — retrying in 15s...');
            setTimeout(async () => {
                try {
                    const ch = await client.channels.fetch(CHANNEL_ID);
                    await startRadio(ch);
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

    playStream();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
    console.log(`[Radio] ✅ Logged in as ${client.user.tag}`);
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel || !channel.isVoiceBased()) {
            throw new Error(`Channel ${CHANNEL_ID} is not a voice channel. Copy the correct ID.`);
        }
        await startRadio(channel);
    } catch (err) {
        console.error('[Radio] Startup error:', err.message);
        process.exit(1);
    }
});

client.on('error', (err) => console.error('[Radio] Client error:', err.message));

client.login(TOKEN);
