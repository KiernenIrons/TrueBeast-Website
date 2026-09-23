/**
 * Security permission setup — run ONCE, by hand, after reading the output.
 *
 * Applies the Discord-side half of the gradual-access security overhaul (see
 * SECURITY_CHANGES.md): creates the permanent "Verified" (media-unlock) role, strips
 * restricted permissions from @everyone, grants the "everywhere" tier back to Verified,
 * audits (and where safe, strips) bypasses on VIP/booster/other roles, creates the native
 * AutoMod link-block rule, and grandfathers in every current Silver I+ member.
 *
 * This does NOT touch per-channel media overwrites (Attach Files / Embed Links / etc. on
 * designated media/meme/gaming channels) — set those up in Discord directly, or track the
 * channel list with `/security config media-channel add #channel` once the bot is running
 * (that command only tracks the list; it reminds you to also grant the channel overwrite).
 *
 * Usage:
 *   node scripts/setup-security-permissions.js --dry-run   # prints every change, applies nothing
 *   node scripts/setup-security-permissions.js             # applies the changes printed above
 *
 * Requires DISCORD_BOT_TOKEN in the environment (same as the bot — copy discord-bot/.env
 * or export it directly). Run this from the discord-bot/ directory so ./.env is picked up.
 */

require('dotenv').config();
const {
    Client, GatewayIntentBits, PermissionsBitField, PermissionFlagsBits,
    AutoModerationRuleEventType, AutoModerationRuleTriggerType, AutoModerationActionType,
} = require('discord.js');

const DRY_RUN = process.argv.includes('--dry-run');
const TOKEN   = process.env.DISCORD_BOT_TOKEN;
const MOD_ROLE_ID = process.env.MOD_ROLE_ID || '874315329474555944';
const OWNER_DISCORD_ID = '392450364340830208';
const VIP_ROLE_ID = '1521840170264039605';
let   MEDIA_UNLOCK_ROLE_ID = process.env.MEDIA_UNLOCK_ROLE_ID || '';

// Keep in sync with VOICE_RANK_ROLES in index.js. Silver I is index 2 — the grandfather
// cutoff and the Firestore-adjustable default XP threshold both key off this.
const VOICE_RANK_ROLES = [
    { id: '1486023901330018335', name: '🥉 Bronze I',      minXp: 0     },
    { id: '1486023902231527597', name: '🥉 Bronze II',     minXp: 80    },
    { id: '1486023903150342204', name: '🥈 Silver I',      minXp: 240   },
    { id: '1486023903691276408', name: '🥈 Silver II',     minXp: 500   },
    { id: '1486023904412569660', name: '🥇 Gold I',        minXp: 850   },
    { id: '1486023904777470204', name: '🥇 Gold II',       minXp: 1700  },
    { id: '1486023905867993168', name: '💠 Platinum',      minXp: 3500  },
    { id: '1486023907004911808', name: '💎 Diamond',       minXp: 5500  },
    { id: '1486023909181751296', name: '🔥 Master',        minXp: 8000  },
    { id: '1486023909944983592', name: '⚔️ Grandmaster',   minXp: 13000 },
    { id: '1486023910205165579', name: '👑 Apex Predator', minXp: 20000 },
];
const SILVER_I_IDX = 2;

// "Normal community features" — unlocked everywhere for Verified, denied everywhere for @everyone.
// Filtered to whatever PermissionFlagsBits actually exposes on the installed discord.js version,
// so an older/newer library doesn't hard-crash the whole script over one exotic flag.
const EVERYWHERE_PERM_NAMES = [
    'CreatePublicThreads', 'CreatePrivateThreads', 'SendVoiceMessages', 'SendTTSMessages',
    'SendPolls', 'UseSoundboard', 'UseExternalSounds', 'Stream', 'UseEmbeddedActivities',
    'UseExternalApps',
];
// Media/links — denied to @everyone, left unset (channel-scoped only) for Verified.
const MEDIA_PERM_NAMES = ['AttachFiles', 'EmbedLinks', 'UseExternalStickers', 'UseExternalEmojis'];

function resolvePerms(names) {
    const resolved = [];
    for (const name of names) {
        if (PermissionFlagsBits[name] !== undefined) resolved.push(PermissionFlagsBits[name]);
        else console.warn(`  ⚠️  PermissionFlagsBits.${name} not found on this discord.js version — skipping it.`);
    }
    return resolved;
}

function fmtPerms(bits) {
    return bits.map(b => Object.keys(PermissionFlagsBits).find(k => PermissionFlagsBits[k] === b)).join(', ') || '(none)';
}

async function main() {
    if (!TOKEN) {
        console.error('❌ DISCORD_BOT_TOKEN not set. Run this from discord-bot/ with a .env file, or export it first.');
        process.exit(1);
    }
    console.log(DRY_RUN ? '🔎 DRY RUN — no changes will be applied.\n' : '⚠️  LIVE RUN — changes will be applied.\n');

    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
    await client.login(TOKEN);
    await new Promise(resolve => client.once('clientReady', resolve));

    const guild = client.guilds.cache.first();
    if (!guild) { console.error('❌ Bot is not in any guild.'); process.exit(1); }
    await guild.members.fetch();
    console.log(`Guild: ${guild.name} (${guild.id})\n`);

    // ── 1. Create the Verified role ─────────────────────────────────────────
    if (!MEDIA_UNLOCK_ROLE_ID) {
        console.log('1. Create "🔓 Verified" role');
        if (DRY_RUN) {
            console.log('   Would create a new role "🔓 Verified", positioned just below the mod role.\n');
        } else {
            const modRole = guild.roles.cache.get(MOD_ROLE_ID);
            const role = await guild.roles.create({
                name: '🔓 Verified',
                color: 0x22c55e,
                mentionable: false,
                reason: 'Security: permanent media-unlock role',
                position: modRole ? Math.max(modRole.position - 1, 1) : undefined,
            });
            MEDIA_UNLOCK_ROLE_ID = role.id;
            console.log(`   ✅ Created role ${role.id}`);
            console.log(`   👉 Paste this into .env / Fly secrets as MEDIA_UNLOCK_ROLE_ID=${role.id}\n`);
        }
    } else {
        console.log(`1. Verified role already set: ${MEDIA_UNLOCK_ROLE_ID}\n`);
    }
    const verifiedRole = MEDIA_UNLOCK_ROLE_ID ? guild.roles.cache.get(MEDIA_UNLOCK_ROLE_ID) : null;

    // ── 2 & 3. Guild-level permission surgery on @everyone and Verified ─────
    console.log('2/3. Guild-level permissions');
    const everyoneWide = resolvePerms(EVERYWHERE_PERM_NAMES);
    const mediaPerms    = resolvePerms(MEDIA_PERM_NAMES);
    const everyone = guild.roles.everyone;

    console.log(`   @everyone — deny: ${fmtPerms(everyoneWide)}`);
    console.log(`   @everyone — deny (media/links, channel-scoped only): ${fmtPerms(mediaPerms)}`);
    if (verifiedRole) console.log(`   🔓 Verified — grant: ${fmtPerms(everyoneWide)}`);

    if (!DRY_RUN) {
        const newEveryone = new PermissionsBitField(everyone.permissions.bitfield).remove([...everyoneWide, ...mediaPerms]);
        await everyone.setPermissions(newEveryone, 'Security: gradual-access permission gate');
        console.log('   ✅ @everyone updated');
        if (verifiedRole) {
            const newVerified = new PermissionsBitField(verifiedRole.permissions.bitfield).add(everyoneWide);
            await verifiedRole.setPermissions(newVerified, 'Security: unlock normal community features');
            console.log('   ✅ 🔓 Verified updated');
        }
    }
    console.log();

    // ── 5. Audit + strip VIP / booster bypasses ─────────────────────────────
    console.log('5. VIP / booster bypass audit');
    const bypassCandidates = [
        { label: 'VIP role', role: guild.roles.cache.get(VIP_ROLE_ID) },
        { label: 'Server Booster role', role: guild.roles.premiumSubscriberRole },
    ];
    const allRestricted = resolvePerms([...EVERYWHERE_PERM_NAMES, ...MEDIA_PERM_NAMES]);
    for (const { label, role } of bypassCandidates) {
        if (!role) { console.log(`   ${label}: not found — skipping`); continue; }
        const held = allRestricted.filter(b => role.permissions.has(b));
        if (held.length === 0) { console.log(`   ${label} (${role.id}): no restricted permissions granted — OK`); continue; }
        console.log(`   ${label} (${role.id}): grants ${fmtPerms(held)}`);
        if (!DRY_RUN) {
            const stripped = new PermissionsBitField(role.permissions.bitfield).remove(held);
            await role.setPermissions(stripped, 'Security: remove restricted-permission bypass');
            console.log(`   ✅ Stripped from ${label}`);
        }
    }
    console.log();

    // ── 6. Audit self-selected / other roles (report only — no changes) ────
    console.log('6. Other roles audit (self-selected / reaction-role panels, etc. — report only)');
    let flaggedAny = false;
    for (const role of guild.roles.cache.values()) {
        if (role.id === guild.id) continue; // @everyone
        if (role.managed) continue; // bots/integrations
        if ([MOD_ROLE_ID, VIP_ROLE_ID, MEDIA_UNLOCK_ROLE_ID, guild.roles.premiumSubscriberRole?.id].includes(role.id)) continue;
        const held = allRestricted.filter(b => role.permissions.has(b));
        if (held.length > 0) {
            flaggedAny = true;
            console.log(`   ⚠️  ${role.name} (${role.id}) grants: ${fmtPerms(held)} — review manually, not auto-changed.`);
        }
    }
    if (!flaggedAny) console.log('   No other roles carry the restricted permissions.');
    console.log();

    // ── 7. AutoMod link-block rule ───────────────────────────────────────────
    console.log('7. AutoMod link-block rule');
    const exemptRoles = [MOD_ROLE_ID, MEDIA_UNLOCK_ROLE_ID].filter(Boolean);
    console.log(`   Blocks messages containing links; exempt roles: ${exemptRoles.join(', ') || '(none — set MEDIA_UNLOCK_ROLE_ID first)'}`);
    console.log(`   ⚠️  Test this against a harmless normal message before relying on it (see SECURITY_CHANGES.md).`);
    if (!DRY_RUN) {
        try {
            await guild.autoModerationRules.create({
                name: 'Security: block links below Verified',
                eventType: AutoModerationRuleEventType.MessageSend,
                triggerType: AutoModerationRuleTriggerType.Keyword,
                triggerMetadata: { keywordFilter: ['*http://*', '*https://*', '*discord.gg/*', '*www.*'] },
                actions: [{ type: AutoModerationActionType.BlockMessage }],
                exemptRoles,
                enabled: true,
                reason: 'Security: gradual-access link gate',
            });
            console.log('   ✅ AutoMod rule created');
        } catch (e) {
            console.error(`   ❌ Failed to create AutoMod rule: ${e.message}`);
        }
    }
    console.log();

    // ── 8. Grandfather existing Silver I+ members ───────────────────────────
    console.log('8. Grandfather existing Silver I+ members');
    const silverIAndUp = new Set(VOICE_RANK_ROLES.slice(SILVER_I_IDX).map(r => r.id));
    const toGrandfather = [];
    for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        if (MEDIA_UNLOCK_ROLE_ID && member.roles.cache.has(MEDIA_UNLOCK_ROLE_ID)) continue;
        if (member.roles.cache.some(r => silverIAndUp.has(r.id))) toGrandfather.push(member);
    }
    console.log(`   ${toGrandfather.length} member(s) currently Silver I+ without Verified:`);
    for (const m of toGrandfather.slice(0, 30)) console.log(`     - ${m.user.tag} (${m.id})`);
    if (toGrandfather.length > 30) console.log(`     ...and ${toGrandfather.length - 30} more`);
    if (!DRY_RUN && verifiedRole) {
        for (const m of toGrandfather) {
            await m.roles.add(verifiedRole, 'Security: grandfathered in at rollout (already Silver I+)').catch(e => console.error(`   ❌ Failed for ${m.id}: ${e.message}`));
            await new Promise(r => setTimeout(r, 250)); // avoid rate limits
        }
        console.log(`   ✅ Grandfathered ${toGrandfather.length} member(s)`);
    }
    console.log();

    console.log(DRY_RUN ? 'Dry run complete — re-run without --dry-run to apply.' : 'Done.');
    process.exit(0);
}

main().catch(e => { console.error('❌ Script failed:', e); process.exit(1); });
