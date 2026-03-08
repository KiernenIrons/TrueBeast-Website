/**
 * TrueBeast — 24/7 Lofi Radio Bot
 * ================================
 * Joins a Discord voice channel and streams a lofi radio station continuously.
 * Auto-reconnects on disconnect, stream errors, or server hiccups.
 *
 * Env vars (set in Railway):
 *   DISCORD_BOT_TOKEN  — your bot token
 *   DISCORD_GUILD_ID   — your server ID
 *   VOICE_CHANNEL_ID   — default voice channel to auto-join on startup
 *   STREAM_URL         — (optional) direct HTTP audio stream URL
 *
 * Slash commands (registered automatically on startup):
 *   /join  — bot joins your current voice channel
 *   /leave — bot disconnects from voice
 */

require('dotenv').config();

const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
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

// IMPORTANT: Use a direct HTTP audio stream URL — not a YouTube/Spotify/web page URL.
// YouTube page URLs (youtube.com/live/...) do NOT work here.
//
// Free, reliable direct stream options:
//   http://ice1.somafm.com/groovesalad-256-mp3   ← default (ambient/lofi, 24/7)
//   http://ice1.somafm.com/lush-128-mp3           (chilled indie/electronic)
//   http://ice1.somafm.com/dronezone-256-mp3      (dark ambient/atmospheric)
//   https://streams.ilovemusic.de/iloveradio17.mp3 (lofi hip hop)
const STREAM_URL = process.env.STREAM_URL || 'http://ice1.somafm.com/groovesalad-256-mp3';

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
    console.error('[Radio] ❌  Missing env vars. Required: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, VOICE_CHANNEL_ID');
    process.exit(1);
}

console.log('[Radio] FFmpeg path:', ffmpegPath);
console.log('[Radio] Stream URL:', STREAM_URL);

// ── State ─────────────────────────────────────────────────────────────────────

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let player        = null;
let connection    = null;
let restartTimer  = null;
let restartDelay  = 5_000;
let streamStarted = false;
let autoRejoin    = true;   // false when user explicitly runs /leave

// ── Stream ────────────────────────────────────────────────────────────────────

function playStream() {
    if (!player) return;
    clearTimeout(restartTimer);
    try {
        const resource = createAudioResource(STREAM_URL, { inputType: StreamType.Arbitrary });
        player.play(resource);
        restartDelay = 5_000;
        console.log('[Radio] ▶  Streaming:', STREAM_URL);
    } catch (err) {
        console.error('[Radio] Failed to create audio resource:', err.message);
        scheduleRestart();
    }
}

function scheduleRestart(delayOverride) {
    clearTimeout(restartTimer);
    const delay = delayOverride ?? restartDelay;
    restartDelay = Math.min(restartDelay * 2, 60_000);
    console.log(`[Radio] ↻  Restarting stream in ${delay / 1000}s...`);
    restartTimer = setTimeout(playStream, delay);
}

// ── Voice ─────────────────────────────────────────────────────────────────────

function startRadio(channel) {
    console.log(`[Radio] Joining #${channel.name} in "${channel.guild.name}"...`);
    streamStarted = false;
    autoRejoin    = true;

    connection = joinVoiceChannel({
        channelId:      channel.id,
        guildId:        channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf:       true,
        selfMute:       false,
    });

    player = createAudioPlayer();
    connection.subscribe(player);

    // Log every connection state transition so Railway logs show exactly what's happening.
    connection.on('stateChange', (oldState, newState) => {
        console.log(`[Radio] Connection state: ${oldState.status} → ${newState.status}`);
    });

    // Log every player state transition.
    player.on('stateChange', (oldState, newState) => {
        console.log(`[Radio] Player state: ${oldState.status} → ${newState.status}`);
    });

    // Start streaming as soon as the UDP handshake completes.
    connection.on(VoiceConnectionStatus.Ready, () => {
        console.log('[Radio] ✅ Voice connection ready — starting stream.');
        clearTimeout(readyFallback);
        if (!streamStarted) {
            streamStarted = true;
            playStream();
        }
    });

    // Fallback: if Ready never fires within 45s (Railway UDP quirk), try playing anyway.
    // Some Railway deployments have audio working even though the state machine stalls.
    const readyFallback = setTimeout(() => {
        if (!streamStarted && player) {
            console.log('[Radio] ⚠️  Ready event never fired — attempting fallback playback...');
            streamStarted = true;
            playStream();
        }
    }, 45_000);

    // Stream ended → restart
    player.on(AudioPlayerStatus.Idle, () => {
        console.log('[Radio] Stream went idle — restarting...');
        scheduleRestart(2_000);
    });

    // Player error → restart
    player.on('error', (err) => {
        console.error('[Radio] Player error:', err.message);
        scheduleRestart();
    });

    // Voice disconnected → try Discord's own reconnect, else rejoin from scratch
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        console.log('[Radio] Voice disconnected — checking if Discord will self-recover...');
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
            console.log('[Radio] Self-recovered — still connected.');
        } catch {
            // Truly disconnected (kicked or network loss)
            connection.destroy();
            connection = null;
            player     = null;

            if (!autoRejoin) {
                console.log('[Radio] Manual disconnect — not rejoining.');
                return;
            }

            console.log('[Radio] Rejoining in 15s...');
            setTimeout(() => rejoinDefault(), 15_000);
        }
    });

    connection.on('error', (err) => {
        console.error('[Radio] Connection error:', err.message);
    });
}

async function rejoinDefault() {
    try {
        const ch = await client.channels.fetch(CHANNEL_ID);
        if (!ch || !ch.isVoiceBased()) throw new Error('Default channel not found or not a voice channel.');
        startRadio(ch);
    } catch (err) {
        console.error('[Radio] Rejoin failed:', err.message, '— retrying in 30s...');
        setTimeout(() => rejoinDefault(), 30_000);
    }
}

// ── Slash Commands ────────────────────────────────────────────────────────────

async function registerCommands(clientId) {
    const rest = new REST().setToken(TOKEN);
    const commands = [
        new SlashCommandBuilder()
            .setName('join')
            .setDescription('Make the radio bot join your voice channel')
            .toJSON(),
        new SlashCommandBuilder()
            .setName('leave')
            .setDescription('Disconnect the radio bot from voice')
            .toJSON(),
    ];
    try {
        await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), { body: commands });
        console.log('[Radio] ✅ Slash commands registered (/join, /leave).');
    } catch (err) {
        console.error('[Radio] Failed to register slash commands:', err.message);
    }
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'join') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ You need to be in a voice channel first!', ephemeral: true });
        }
        // Clean up any existing connection
        if (connection) {
            connection.destroy();
            connection = null;
            player     = null;
        }
        clearTimeout(restartTimer);
        startRadio(voiceChannel);
        return interaction.reply({ content: `🎵 Joining **${voiceChannel.name}** — stream starting shortly!`, ephemeral: true });
    }

    if (interaction.commandName === 'leave') {
        autoRejoin = false;
        clearTimeout(restartTimer);
        if (connection) {
            connection.destroy();
            connection = null;
            player     = null;
        }
        return interaction.reply({ content: '👋 Disconnected. Use `/join` to bring me back!', ephemeral: true });
    }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
    console.log(`[Radio] ✅ Logged in as ${client.user.tag}`);
    console.log(`[Radio] Targeting channel ID: ${CHANNEL_ID}`);

    await registerCommands(client.user.id);

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) throw new Error(`Channel ${CHANNEL_ID} not found.`);
        if (!channel.isVoiceBased()) throw new Error(`Channel ${CHANNEL_ID} is not a voice channel.`);
        startRadio(channel);
    } catch (err) {
        console.error('[Radio] Startup error:', err.message);
        process.exit(1);
    }
});

client.on('error', (err) => console.error('[Radio] Client error:', err.message));

client.login(TOKEN);
