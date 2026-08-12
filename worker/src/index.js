const DISCORD_API = 'https://discord.com/api/v10';
const EPHEMERAL = 1 << 6;
const VIEW_CHANNEL = 1 << 10;
const ADMINISTRATOR = 1n << 3n;
const QUEUE_LIMIT = 20;

const MODES = [
  { key: 'sword', name: 'Sword', emoji: '⚔️' },
  { key: 'speed', name: 'Speed', emoji: '💨' },
  { key: 'pot', name: 'Pot', emoji: '🧪' },
  { key: 'nethop', name: 'NethOP', emoji: '🔥' },
  { key: 'ogvanilla', name: 'OG Vanilla', emoji: '🌿' },
  { key: 'smp', name: 'SMP', emoji: '🛡️' },
  { key: 'mace', name: 'Mace', emoji: '🔨' },
  { key: 'crystal', name: 'Crystal', emoji: '💎' },
  { key: 'axe', name: 'Axe', emoji: '🪓' },
  { key: 'uhc', name: 'UHC', emoji: '❤️' }
];

const TIERS = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
const TIER_POINTS = Object.fromEntries(TIERS.map((tier, index) => [tier, TIERS.length - index]));
const MODE_MAP = Object.fromEntries(MODES.map(mode => [mode.key, mode]));

const modeChoices = MODES.map(mode => ({ name: mode.name, value: mode.key }));
const tierChoices = TIERS.map(tier => ({ name: tier, value: tier }));

const COMMANDS = [
  {
    name: 'setup',
    description: 'Erstellt den MentalTiers Discord-Aufbau.',
    type: 1
  },
  {
    name: 'queue-open',
    description: 'Öffnet eine Tier-Test Queue.',
    type: 1,
    options: [{ name: 'mode', description: 'Gamemode', type: 3, required: true, choices: modeChoices }]
  },
  {
    name: 'queue-close',
    description: 'Schließt eine Tier-Test Queue.',
    type: 1,
    options: [{ name: 'mode', description: 'Gamemode', type: 3, required: true, choices: modeChoices }]
  },
  {
    name: 'queue-next',
    description: 'Nimmt Spieler #1 aus einer Queue.',
    type: 1,
    options: [{ name: 'mode', description: 'Gamemode', type: 3, required: true, choices: modeChoices }]
  },
  {
    name: 'result',
    description: 'Trägt ein Testergebnis ein und vergibt die Tier-Rolle.',
    type: 1,
    options: [
      { name: 'user', description: 'Getesteter Spieler', type: 6, required: true },
      { name: 'mode', description: 'Gamemode', type: 3, required: true, choices: modeChoices },
      { name: 'tier', description: 'Ergebnis', type: 3, required: true, choices: tierChoices }
    ]
  },
  {
    name: 'profile',
    description: 'Zeigt das MentalTiers Profil.',
    type: 1,
    options: [{ name: 'user', description: 'Optionaler Spieler', type: 6, required: false }]
  },
  {
    name: 'leaderboard',
    description: 'Zeigt die MentalTiers Rangliste.',
    type: 1
  },
  {
    name: 'help',
    description: 'Zeigt die MentalTiers Hilfe.',
    type: 1
  }
];

const SQL = [
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    discord_id TEXT PRIMARY KEY,
    discord_username TEXT NOT NULL,
    minecraft_name TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    tiers TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS queue_state (
    mode TEXT PRIMARY KEY,
    is_open INTEGER NOT NULL DEFAULT 0,
    channel_id TEXT,
    panel_message_id TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS queue_entries (
    mode TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    discord_username TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (mode, discord_id)
  )`,
  `CREATE TABLE IF NOT EXISTS test_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    tier TEXT NOT NULL,
    tester_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_queue_entries_mode_joined ON queue_entries(mode, joined_at)`
];

function now() {
  return new Date().toISOString();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function interactionResponse(type, data = undefined) {
  return json(data === undefined ? { type } : { type, data });
}

function message(content, ephemeral = false, extra = {}) {
  return interactionResponse(4, {
    content,
    flags: ephemeral ? EPHEMERAL : undefined,
    allowed_mentions: { parse: ['users', 'roles'] },
    ...extra
  });
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function verifyDiscordRequest(request, body, publicKeyHex) {
  const signatureHex = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(publicKeyHex);
  if (!signature || !publicKey || !timestamp) return false;

  try {
    const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
    const data = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify('Ed25519', key, signature, data);
  } catch (error) {
    console.error('Discord signature verification failed:', error);
    return false;
  }
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error('D1 binding DB fehlt.');
  await env.DB.batch(SQL.map(statement => env.DB.prepare(statement)));
  for (const mode of MODES) {
    await env.DB.prepare(
      `INSERT INTO queue_state(mode, is_open, updated_at)
       VALUES (?, 0, ?)
       ON CONFLICT(mode) DO NOTHING`
    ).bind(mode.key, now()).run();
  }
}

async function getConfig(env, key) {
  const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  return row?.value ?? null;
}

async function setConfig(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO config(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, String(value)).run();
}

async function discordFetch(env, path, options = {}) {
  if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN fehlt.');
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bot ${env.DISCORD_BOT_TOKEN}`);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(`${DISCORD_API}${path}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function actor(interaction) {
  return interaction.member?.user ?? interaction.user ?? { id: '0', username: 'Unknown' };
}

function option(interaction, name) {
  return interaction.data?.options?.find(item => item.name === name)?.value ?? null;
}

function isAdministrator(interaction) {
  try {
    return (BigInt(interaction.member?.permissions ?? '0') & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

async function isTester(env, interaction) {
  if (isAdministrator(interaction)) return true;
  const testerRoleId = await getConfig(env, 'tester_role_id');
  return Boolean(testerRoleId && interaction.member?.roles?.includes(testerRoleId));
}

async function requireTester(env, interaction) {
  if (await isTester(env, interaction)) return null;
  return message('❌ Das können nur **Mental Tester/Admins**.', true);
}

function queueButtons(modeKey, isOpen, count) {
  return [{
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        label: `Join Queue (${count}/${QUEUE_LIMIT})`,
        custom_id: `queue_join:${modeKey}`,
        disabled: !isOpen || count >= QUEUE_LIMIT
      },
      {
        type: 2,
        style: 4,
        label: 'Leave Queue',
        custom_id: `queue_leave:${modeKey}`
      },
      {
        type: 2,
        style: 2,
        label: 'View Queue',
        custom_id: `queue_view:${modeKey}`
      }
    ]
  }];
}

function queueEmbed(mode, isOpen, count) {
  return {
    title: `${mode.emoji} ${mode.name} Waitlist`,
    description: isOpen
      ? `🟢 **Queue OPEN**\n\nKlicke auf **Join Queue**, um dich für einen ${mode.name}-Test anzustellen.\nEs gibt maximal **${QUEUE_LIMIT} Plätze**.`
      : `🔴 **Queue CLOSED**\n\nAktuell nimmt die ${mode.name}-Queue keine neuen Spieler an.`,
    color: isOpen ? 0x2ecc71 : 0xed4245,
    fields: [
      { name: 'Players', value: `${count}/${QUEUE_LIMIT}`, inline: true },
      { name: 'Mode', value: mode.name, inline: true }
    ],
    footer: { text: 'MentalTiers • First come, first served' }
  };
}

async function getQueueState(env, modeKey) {
  return await env.DB.prepare('SELECT * FROM queue_state WHERE mode = ?').bind(modeKey).first();
}

async function getQueueEntries(env, modeKey, limit = QUEUE_LIMIT) {
  const result = await env.DB.prepare(
    'SELECT * FROM queue_entries WHERE mode = ? ORDER BY joined_at ASC LIMIT ?'
  ).bind(modeKey, limit).all();
  return result.results ?? [];
}

async function updateQueuePanel(env, modeKey) {
  const mode = MODE_MAP[modeKey];
  if (!mode) return;
  const state = await getQueueState(env, modeKey);
  if (!state?.channel_id || !state?.panel_message_id) return;
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM queue_entries WHERE mode = ?').bind(modeKey).first();
  const count = Number(countRow?.count ?? 0);

  await discordFetch(env, `/channels/${state.channel_id}/messages/${state.panel_message_id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      embeds: [queueEmbed(mode, Boolean(state.is_open), count)],
      components: queueButtons(modeKey, Boolean(state.is_open), count)
    })
  });
}

async function findOrCreateRole(env, guildId, name) {
  const roles = await discordFetch(env, `/guilds/${guildId}/roles`);
  let role = roles.find(item => item.name === name);
  if (!role) {
    role = await discordFetch(env, `/guilds/${guildId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name, mentionable: false })
    });
  }
  return role;
}

async function getGuildChannels(env, guildId) {
  return await discordFetch(env, `/guilds/${guildId}/channels`);
}

async function findOrCreateTextChannel(env, guildId, channels, name, parentId = null, permissionOverwrites = undefined) {
  let channel = channels.find(item => item.type === 0 && item.name === name);
  if (!channel) {
    channel = await discordFetch(env, `/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        type: 0,
        parent_id: parentId,
        permission_overwrites: permissionOverwrites
      })
    });
    channels.push(channel);
  }
  return channel;
}

async function setupGuild(env, interaction) {
  if (!isAdministrator(interaction)) {
    return message('❌ `/setup` kann nur ein Discord-Administrator benutzen.', true);
  }

  const guildId = interaction.guild_id;
  if (!guildId) return message('❌ `/setup` funktioniert nur auf dem MentalTiers-Server.', true);

  const verifiedRole = await findOrCreateRole(env, guildId, 'Mental Verified');
  const testerRole = await findOrCreateRole(env, guildId, 'Mental Tester');
  await setConfig(env, 'verified_role_id', verifiedRole.id);
  await setConfig(env, 'tester_role_id', testerRole.id);

  const channels = await getGuildChannels(env, guildId);
  let category = channels.find(item => item.type === 4 && item.name === '🏆 TIER TESTING');
  if (!category) {
    category = await discordFetch(env, `/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({
        name: '🏆 TIER TESTING',
        type: 4,
        permission_overwrites: [
          { id: guildId, type: 0, deny: String(VIEW_CHANNEL), allow: '0' },
          { id: verifiedRole.id, type: 0, allow: String(VIEW_CHANNEL), deny: '0' },
          { id: testerRole.id, type: 0, allow: String(VIEW_CHANNEL), deny: '0' }
        ]
      })
    });
    channels.push(category);
  }

  const verifyChannel = await findOrCreateTextChannel(env, guildId, channels, 'verify-account');
  await setConfig(env, 'verify_channel_id', verifyChannel.id);

  const existingVerifyPanel = await getConfig(env, 'verify_panel_message_id');
  if (!existingVerifyPanel) {
    const panel = await discordFetch(env, `/channels/${verifyChannel.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        embeds: [{
          title: '✅ MentalTiers Verification',
          description: [
            'Bevor du den Tier-Test Bereich sehen kannst, musst du deinen Minecraft-Namen bestätigen.',
            '',
            '**So geht es:**',
            '1. Klicke auf **Verify Account**',
            '2. Gib deinen Minecraft Java Namen ein',
            '3. Du bekommst automatisch **Mental Verified**',
            '',
            'ℹ️ Diese kostenlose Challenge-Version prüft den Minecraft-Namen. Eine echte Besitzprüfung per Microsoft-Login können wir später ergänzen.'
          ].join('\n'),
          color: 0x57f287,
          footer: { text: 'MentalTiers • 0€ Challenge Build' }
        }],
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 3,
            label: 'Verify Account',
            custom_id: 'verify_start',
            emoji: { name: '✅' }
          }]
        }]
      })
    });
    await setConfig(env, 'verify_panel_message_id', panel.id);
  }

  for (const mode of MODES) {
    const channel = await findOrCreateTextChannel(env, guildId, channels, `${mode.key}-waitlist`, category.id);
    const state = await getQueueState(env, mode.key);
    let panelMessageId = state?.panel_message_id;

    if (!panelMessageId) {
      const panel = await discordFetch(env, `/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          embeds: [queueEmbed(mode, false, 0)],
          components: queueButtons(mode.key, false, 0)
        })
      });
      panelMessageId = panel.id;
    }

    await env.DB.prepare(
      `INSERT INTO queue_state(mode, is_open, channel_id, panel_message_id, updated_at)
       VALUES (?, COALESCE((SELECT is_open FROM queue_state WHERE mode = ?), 0), ?, ?, ?)
       ON CONFLICT(mode) DO UPDATE SET
         channel_id = excluded.channel_id,
         panel_message_id = excluded.panel_message_id,
         updated_at = excluded.updated_at`
    ).bind(mode.key, mode.key, channel.id, panelMessageId, now()).run();
  }

  return message('✅ **MentalTiers Setup fertig!** Verified-Rolle, Tester-Rolle, Verify-Channel und alle 10 Waitlists wurden erstellt.', true);
}

async function openOrCloseQueue(env, interaction, open) {
  const denied = await requireTester(env, interaction);
  if (denied) return denied;
  const modeKey = option(interaction, 'mode');
  const mode = MODE_MAP[modeKey];
  if (!mode) return message('❌ Unbekannter Gamemode.', true);

  await env.DB.prepare('UPDATE queue_state SET is_open = ?, updated_at = ? WHERE mode = ?')
    .bind(open ? 1 : 0, now(), modeKey).run();
  await updateQueuePanel(env, modeKey);
  return message(`${open ? '🟢' : '🔴'} **${mode.name} Queue ${open ? 'OPEN' : 'CLOSED'}**.`);
}

async function queueNext(env, interaction) {
  const denied = await requireTester(env, interaction);
  if (denied) return denied;
  const modeKey = option(interaction, 'mode');
  const mode = MODE_MAP[modeKey];
  if (!mode) return message('❌ Unbekannter Gamemode.', true);

  const entry = await env.DB.prepare(
    'SELECT * FROM queue_entries WHERE mode = ? ORDER BY joined_at ASC LIMIT 1'
  ).bind(modeKey).first();

  if (!entry) return message(`Die **${mode.name} Queue** ist leer.`, true);
  await env.DB.prepare('DELETE FROM queue_entries WHERE mode = ? AND discord_id = ?')
    .bind(modeKey, entry.discord_id).run();
  await updateQueuePanel(env, modeKey);

  return message(`🧪 **NEXT TEST — ${mode.name}**\n<@${entry.discord_id}> (**${entry.minecraft_name ?? entry.discord_username}**) ist jetzt dran.\nTester: <@${actor(interaction).id}>`);
}

async function lookupMinecraftName(input) {
  const name = String(input || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, reason: 'Minecraft-Namen haben 3–16 Zeichen und nur Buchstaben, Zahlen oder _.' };

  try {
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    if (response.status === 404 || response.status === 204) return { ok: false, reason: 'Dieser Minecraft Java Name wurde nicht gefunden.' };
    if (response.ok) {
      const profile = await response.json();
      return { ok: true, name: profile.name || name, uuid: profile.id || null };
    }
  } catch (error) {
    console.warn('Minecraft lookup unavailable:', error);
  }

  // Die Verifizierung soll bei einem temporären Mojang-API-Fehler nicht komplett ausfallen.
  return { ok: true, name, uuid: null, lookupUnavailable: true };
}

function modalValue(interaction, customId) {
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === customId) return component.value;
    }
  }
  return null;
}

async function verifySubmit(env, interaction) {
  const user = actor(interaction);
  const requestedName = modalValue(interaction, 'minecraft_name');
  const lookup = await lookupMinecraftName(requestedName);
  if (!lookup.ok) return message(`❌ ${lookup.reason}`, true);

  await env.DB.prepare(
    `INSERT INTO users(discord_id, discord_username, minecraft_name, verified, tiers, updated_at)
     VALUES (?, ?, ?, 1, '{}', ?)
     ON CONFLICT(discord_id) DO UPDATE SET
       discord_username = excluded.discord_username,
       minecraft_name = excluded.minecraft_name,
       verified = 1,
       updated_at = excluded.updated_at`
  ).bind(user.id, user.username, lookup.name, now()).run();

  const verifiedRoleId = await getConfig(env, 'verified_role_id');
  let roleMessage = '';
  if (verifiedRoleId && interaction.guild_id) {
    try {
      await discordFetch(env, `/guilds/${interaction.guild_id}/members/${user.id}/roles/${verifiedRoleId}`, { method: 'PUT' });
      roleMessage = '\n✅ Die **Mental Verified** Rolle wurde vergeben.';
    } catch (error) {
      console.error(error);
      roleMessage = '\n⚠️ Dein Name wurde gespeichert, aber die Verified-Rolle konnte nicht vergeben werden. Prüfe die Bot-Rollenrechte.';
    }
  }

  const warning = lookup.lookupUnavailable ? '\n⚠️ Der externe Minecraft-Namenscheck war gerade nicht erreichbar.' : '';
  return message(`✅ **Verified!** Dein Minecraft-Name ist **${lookup.name}**.${roleMessage}${warning}`, true);
}

async function joinQueue(env, interaction, modeKey) {
  const user = actor(interaction);
  const mode = MODE_MAP[modeKey];
  if (!mode) return message('❌ Unbekannte Queue.', true);

  const profile = await env.DB.prepare('SELECT * FROM users WHERE discord_id = ?').bind(user.id).first();
  if (!profile?.verified) return message('❌ Du musst dich zuerst in **#verify-account** verifizieren.', true);

  const state = await getQueueState(env, modeKey);
  if (!state?.is_open) return message(`🔴 Die **${mode.name} Queue** ist geschlossen.`, true);

  const existing = await env.DB.prepare('SELECT discord_id FROM queue_entries WHERE mode = ? AND discord_id = ?')
    .bind(modeKey, user.id).first();
  if (existing) return message(`Du bist bereits in der **${mode.name} Queue**.`, true);

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM queue_entries WHERE mode = ?').bind(modeKey).first();
  const count = Number(countRow?.count ?? 0);
  if (count >= QUEUE_LIMIT) return message(`❌ Die **${mode.name} Queue** ist voll (${QUEUE_LIMIT}/${QUEUE_LIMIT}).`, true);

  await env.DB.prepare(
    'INSERT INTO queue_entries(mode, discord_id, discord_username, joined_at) VALUES (?, ?, ?, ?)'
  ).bind(modeKey, user.id, user.username, now()).run();

  const positionRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM queue_entries WHERE mode = ?').bind(modeKey).first();
  const position = Number(positionRow?.count ?? 1);
  await updateQueuePanel(env, modeKey);
  return message(`✅ Du bist der **${mode.name} Queue** beigetreten.\nDeine Position: **#${position}/${QUEUE_LIMIT}**`, true);
}

async function leaveQueue(env, interaction, modeKey) {
  const mode = MODE_MAP[modeKey];
  const user = actor(interaction);
  if (!mode) return message('❌ Unbekannte Queue.', true);

  const result = await env.DB.prepare('DELETE FROM queue_entries WHERE mode = ? AND discord_id = ?')
    .bind(modeKey, user.id).run();
  await updateQueuePanel(env, modeKey);
  const changed = Number(result.meta?.changes ?? 0) > 0;
  return message(changed ? `🚪 Du hast die **${mode.name} Queue** verlassen.` : `Du bist nicht in der **${mode.name} Queue**.`, true);
}

async function viewQueue(env, interaction, modeKey) {
  const mode = MODE_MAP[modeKey];
  if (!mode) return message('❌ Unbekannte Queue.', true);
  const entries = await getQueueEntries(env, modeKey);
  if (!entries.length) return message(`Die **${mode.name} Queue** ist leer.`, true);

  const lines = entries.map((entry, index) => `**#${index + 1}** <@${entry.discord_id}>`).join('\n');
  return interactionResponse(4, {
    flags: EPHEMERAL,
    embeds: [{
      title: `${mode.emoji} ${mode.name} Queue`,
      description: lines,
      color: 0x5865f2,
      footer: { text: `${entries.length}/${QUEUE_LIMIT} Spieler` }
    }]
  });
}

async function syncTierRole(env, guildId, discordId, modeKey, tier) {
  const mode = MODE_MAP[modeKey];
  const prefix = `${mode.name} • `;
  const targetName = `${prefix}${tier}`;
  const roles = await discordFetch(env, `/guilds/${guildId}/roles`);

  for (const role of roles) {
    if (role.name.startsWith(prefix) && TIERS.includes(role.name.slice(prefix.length))) {
      try {
        await discordFetch(env, `/guilds/${guildId}/members/${discordId}/roles/${role.id}`, { method: 'DELETE' });
      } catch {
        // Spieler hatte die Rolle nicht oder die Rolle ist nicht editierbar.
      }
    }
  }

  let target = roles.find(role => role.name === targetName);
  if (!target) {
    target = await discordFetch(env, `/guilds/${guildId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name: targetName, mentionable: false })
    });
  }
  await discordFetch(env, `/guilds/${guildId}/members/${discordId}/roles/${target.id}`, { method: 'PUT' });
  return target;
}

async function setResult(env, interaction) {
  const denied = await requireTester(env, interaction);
  if (denied) return denied;

  const discordId = option(interaction, 'user');
  const modeKey = option(interaction, 'mode');
  const tier = option(interaction, 'tier');
  const mode = MODE_MAP[modeKey];
  if (!discordId || !mode || !TIERS.includes(tier)) return message('❌ Ungültiges Ergebnis.', true);

  const existing = await env.DB.prepare('SELECT * FROM users WHERE discord_id = ?').bind(discordId).first();
  let tiers = {};
  try { tiers = JSON.parse(existing?.tiers || '{}'); } catch { tiers = {}; }
  tiers[modeKey] = tier;

  const resolvedUser = interaction.data?.resolved?.users?.[discordId];
  const username = resolvedUser?.username ?? existing?.discord_username ?? discordId;

  await env.DB.prepare(
    `INSERT INTO users(discord_id, discord_username, verified, tiers, updated_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET
       discord_username = excluded.discord_username,
       tiers = excluded.tiers,
       updated_at = excluded.updated_at`
  ).bind(discordId, username, JSON.stringify(tiers), now()).run();

  await env.DB.prepare(
    'INSERT INTO test_history(discord_id, mode, tier, tester_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(discordId, modeKey, tier, actor(interaction).id, now()).run();

  let roleLine = '✅ Tier gespeichert.';
  if (interaction.guild_id) {
    try {
      const role = await syncTierRole(env, interaction.guild_id, discordId, modeKey, tier);
      roleLine = `✅ Rolle **${role.name}** vergeben.`;
    } catch (error) {
      console.error(error);
      roleLine = '⚠️ Tier gespeichert, aber die Discord-Rolle konnte nicht vergeben werden. Die MentalTiers-Bot-Rolle muss über den Tier-Rollen stehen.';
    }
  }

  await env.DB.prepare('DELETE FROM queue_entries WHERE mode = ? AND discord_id = ?').bind(modeKey, discordId).run();
  await updateQueuePanel(env, modeKey);

  return interactionResponse(4, {
    embeds: [{
      title: '🏆 MentalTiers • Test Result',
      description: `<@${discordId}> wurde in **${mode.name}** als **${tier}** eingestuft.`,
      color: 0xf1c40f,
      fields: [
        { name: 'Tester', value: `<@${actor(interaction).id}>`, inline: true },
        { name: 'Mode', value: mode.name, inline: true },
        { name: 'Tier', value: tier, inline: true }
      ],
      footer: { text: roleLine },
      timestamp: now()
    }]
  });
}

function profileEmbed(discordId, username, row) {
  let tiers = {};
  try { tiers = JSON.parse(row?.tiers || '{}'); } catch { tiers = {}; }
  const tierLines = MODES.map(mode => `**${mode.name}:** ${tiers[mode.key] ?? 'Unranked'}`).join('\n');
  const mcName = row?.minecraft_name ?? 'Nicht verifiziert';

  return {
    title: `MentalTiers • ${username}`,
    description: `**Minecraft:** ${mcName}\n**Discord:** <@${discordId}>\n\n${tierLines}`,
    color: 0x5865f2,
    footer: { text: row?.verified ? '✅ Mental Verified' : '❌ Nicht verifiziert' }
  };
}

async function showProfile(env, interaction) {
  const targetId = option(interaction, 'user') ?? actor(interaction).id;
  const resolved = interaction.data?.resolved?.users?.[targetId];
  const row = await env.DB.prepare('SELECT * FROM users WHERE discord_id = ?').bind(targetId).first();
  const username = resolved?.username ?? row?.discord_username ?? actor(interaction).username;
  return interactionResponse(4, { embeds: [profileEmbed(targetId, username, row)] });
}

async function leaderboard(env) {
  const result = await env.DB.prepare('SELECT * FROM users').all();
  const ranked = (result.results ?? []).map(row => {
    let tiers = {};
    try { tiers = JSON.parse(row.tiers || '{}'); } catch { tiers = {}; }
    const score = Object.values(tiers).reduce((sum, tier) => sum + (TIER_POINTS[tier] ?? 0), 0);
    return { ...row, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);

  if (!ranked.length) return message('Noch hat niemand ein Tier.', true);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = ranked.map((row, index) => `${medals[index] ?? `**#${index + 1}**`} <@${row.discord_id}> — **${row.score} pts**`).join('\n');
  return interactionResponse(4, {
    embeds: [{ title: '🏆 MentalTiers Leaderboard', description: lines, color: 0xf1c40f, footer: { text: 'MentalTiers' } }]
  });
}

function help() {
  return interactionResponse(4, {
    flags: EPHEMERAL,
    embeds: [{
      title: 'MentalTiers • Hilfe',
      description: [
        '**Spieler**',
        '• `#verify-account` → Minecraft-Namen verifizieren',
        '• **Join Queue** → einer offenen Queue beitreten',
        '• **Leave Queue** → Queue verlassen',
        '• **View Queue** → Positionen ansehen',
        '• `/profile` → Tiers anzeigen',
        '• `/leaderboard` → Rangliste',
        '',
        '**Tester/Admins**',
        '• `/queue-open mode`',
        '• `/queue-close mode`',
        '• `/queue-next mode`',
        '• `/result user mode tier`',
        '',
        '**Admin**',
        '• `/setup` → Server-Struktur automatisch erstellen'
      ].join('\n'),
      color: 0x5865f2
    }]
  });
}

async function handleCommand(env, interaction) {
  switch (interaction.data.name) {
    case 'setup': return await setupGuild(env, interaction);
    case 'queue-open': return await openOrCloseQueue(env, interaction, true);
    case 'queue-close': return await openOrCloseQueue(env, interaction, false);
    case 'queue-next': return await queueNext(env, interaction);
    case 'result': return await setResult(env, interaction);
    case 'profile': return await showProfile(env, interaction);
    case 'leaderboard': return await leaderboard(env);
    case 'help': return help();
    default: return message('❌ Unbekannter MentalTiers Command.', true);
  }
}

async function handleComponent(env, interaction) {
  const customId = interaction.data.custom_id;
  if (customId === 'verify_start') {
    return interactionResponse(9, {
      custom_id: 'verify_modal',
      title: 'MentalTiers Verification',
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: 'minecraft_name',
          label: 'Minecraft Java Name',
          style: 1,
          min_length: 3,
          max_length: 16,
          placeholder: 'z.B. Away23',
          required: true
        }]
      }]
    });
  }

  const [action, modeKey] = customId.split(':');
  if (action === 'queue_join') return await joinQueue(env, interaction, modeKey);
  if (action === 'queue_leave') return await leaveQueue(env, interaction, modeKey);
  if (action === 'queue_view') return await viewQueue(env, interaction, modeKey);
  return message('❌ Dieser Button ist nicht mehr gültig.', true);
}

async function handleModal(env, interaction) {
  if (interaction.data.custom_id === 'verify_modal') return await verifySubmit(env, interaction);
  return message('❌ Unbekanntes Formular.', true);
}

async function registerCommands(env) {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID) {
    throw new Error('DISCORD_APPLICATION_ID oder DISCORD_GUILD_ID fehlt.');
  }
  return await discordFetch(env, `/applications/${env.DISCORD_APPLICATION_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`, {
    method: 'PUT',
    body: JSON.stringify(COMMANDS)
  });
}

async function handleInteractions(request, env) {
  const rawBody = await request.text();
  const valid = await verifyDiscordRequest(request, rawBody, env.DISCORD_PUBLIC_KEY);
  if (!valid) return new Response('invalid request signature', { status: 401 });

  let interaction;
  try { interaction = JSON.parse(rawBody); } catch { return new Response('bad json', { status: 400 }); }
  if (interaction.type === 1) return interactionResponse(1);

  try {
    await ensureSchema(env);
    if (interaction.type === 2) return await handleCommand(env, interaction);
    if (interaction.type === 3) return await handleComponent(env, interaction);
    if (interaction.type === 5) return await handleModal(env, interaction);
    return message('Diese Interaction wird noch nicht unterstützt.', true);
  } catch (error) {
    console.error(error);
    return message(`❌ MentalTiers Fehler: ${String(error.message || error).slice(0, 1500)}`, true);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return json({
        name: 'MentalTiers',
        status: 'online',
        price: '0€',
        interactions: '/interactions',
        modes: MODES.map(mode => mode.name)
      });
    }

    if (request.method === 'GET' && url.pathname === '/register') {
      if (!env.SETUP_SECRET || url.searchParams.get('key') !== env.SETUP_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      try {
        await ensureSchema(env);
        const commands = await registerCommands(env);
        return json({ ok: true, commands: commands.map(command => command.name) });
      } catch (error) {
        return json({ ok: false, error: String(error.message || error) }, 500);
      }
    }

    if (request.method === 'POST' && (url.pathname === '/interactions' || url.pathname === '/')) {
      return await handleInteractions(request, env);
    }

    return json({ error: 'not found' }, 404);
  }
};
