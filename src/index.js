const http = require('node:http');
const crypto = require('node:crypto');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require('discord.js');

const {
  MODES,
  TIERS,
  REGIONS,
  QUEUE_LIMIT,
  TIER_POINTS,
  MODE_LABELS,
  REGION_LABELS
} = require('./constants');
const { readDb, writeDb, ensureUser, ensureQueue, ensureGuild } = require('./store');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VERIFY_SERVER_IP = process.env.VERIFY_SERVER_IP || 'VERIFY-SERVER-IP-NOCH-SETZEN';
const VERIFY_API_SECRET = process.env.VERIFY_API_SECRET || '';
const VERIFY_API_PORT = Number(process.env.PORT || process.env.VERIFY_API_PORT || 8787);
const TEST_COOLDOWN_DAYS = Math.max(0, Number(process.env.TEST_COOLDOWN_DAYS || 7));
const ENABLED_REGIONS = (process.env.ENABLED_REGIONS || 'eu')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(value => REGIONS.includes(value));

if (!TOKEN) {
  console.error('DISCORD_TOKEN fehlt. Lege ihn als Secret/Umgebungsvariable an.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const modeChoices = MODES.map(mode => ({ name: MODE_LABELS[mode], value: mode }));
const tierChoices = TIERS.map(tier => ({ name: tier, value: tier }));
const regionChoices = REGIONS.map(region => ({ name: REGION_LABELS[region], value: region }));

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Erstellt MentalTiers Rollen, Verify-Panel und Waitlist-Channels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Zeigt das MentalTiers-Profil eines Spielers.')
    .addUserOption(option => option.setName('user').setDescription('Spieler').setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Zeigt die globale MentalTiers-Rangliste.'),

  new SlashCommandBuilder()
    .setName('queue-open')
    .setDescription('Oeffnet eine 20-Slot-Testqueue. Tester/Admin only.')
    .addStringOption(option => option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices))
    .addStringOption(option => option.setName('region').setDescription('Region').setRequired(false).addChoices(...regionChoices)),

  new SlashCommandBuilder()
    .setName('queue-close')
    .setDescription('Schliesst eine Testqueue fuer neue Spieler. Tester/Admin only.')
    .addStringOption(option => option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices))
    .addStringOption(option => option.setName('region').setDescription('Region').setRequired(false).addChoices(...regionChoices)),

  new SlashCommandBuilder()
    .setName('queue-next')
    .setDescription('Nimmt den naechsten Spieler aus der Queue. Tester/Admin only.')
    .addStringOption(option => option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices))
    .addStringOption(option => option.setName('region').setDescription('Region').setRequired(false).addChoices(...regionChoices)),

  new SlashCommandBuilder()
    .setName('queue-clear')
    .setDescription('Leert eine Queue komplett. Admin only.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices))
    .addStringOption(option => option.setName('region').setDescription('Region').setRequired(false).addChoices(...regionChoices)),

  new SlashCommandBuilder()
    .setName('test-result')
    .setDescription('Speichert das Tier nach einem Test. Tester/Admin only.')
    .addUserOption(option => option.setName('user').setDescription('Getesteter Spieler').setRequired(true))
    .addStringOption(option => option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices))
    .addStringOption(option => option.setName('tier').setDescription('Ergebnis').setRequired(true).addChoices(...tierChoices)),

  new SlashCommandBuilder()
    .setName('tier-set')
    .setDescription('Setzt ein Tier manuell. Tester/Admin only.')
    .addUserOption(option => option.setName('user').setDescription('Spieler').setRequired(true))
    .addStringOption(option => option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices))
    .addStringOption(option => option.setName('tier').setDescription('Tier').setRequired(true).addChoices(...tierChoices)),

  new SlashCommandBuilder()
    .setName('tier-remove')
    .setDescription('Entfernt ein Tier. Tester/Admin only.')
    .addUserOption(option => option.setName('user').setDescription('Spieler').setRequired(true))
    .addStringOption(option => option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices)),

  new SlashCommandBuilder()
    .setName('verify-reset')
    .setDescription('Entfernt die Minecraft-Verknuepfung eines Spielers. Admin only.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => option.setName('user').setDescription('Spieler').setRequired(true)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Zeigt die MentalTiers Commands.')
].map(command => command.toJSON());

function queueKey(region, mode) {
  return `${region}:${mode}`;
}

function getRegion(interaction) {
  return interaction.options?.getString('region') || ENABLED_REGIONS[0] || 'eu';
}

function formatRemaining(ms) {
  if (ms <= 0) return 'bereit';
  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ');
}

function generateVerifyCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[crypto.randomInt(0, alphabet.length)];
  return code;
}

function isValidMinecraftName(name) {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

function isTester(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const db = readDb();
  const setup = db.guilds?.[member.guild.id];
  if (setup?.testerRoleId && member.roles.cache.has(setup.testerRoleId)) return true;

  return member.roles.cache.some(role => role.name.toLowerCase().includes('tester'));
}

function requireTester(interaction) {
  if (isTester(interaction.member)) return true;
  interaction.reply({ content: '❌ Nur **Tester/Admins** koennen das benutzen.', ephemeral: true }).catch(() => null);
  return false;
}

function tierRoleName(mode, tier) {
  return `Mental ${MODE_LABELS[mode]} • ${tier}`;
}

async function syncTierRole(member, mode, tier) {
  if (!member?.guild) return;
  const guild = member.guild;
  const prefix = `Mental ${MODE_LABELS[mode]} • `;

  for (const role of member.roles.cache.filter(role => role.name.startsWith(prefix)).values()) {
    if (role.editable) await member.roles.remove(role).catch(() => null);
  }

  let role = guild.roles.cache.find(item => item.name === tierRoleName(mode, tier));
  if (!role) role = await guild.roles.create({ name: tierRoleName(mode, tier), reason: 'MentalTiers Auto-Tierrolle' });
  if (role.editable) await member.roles.add(role).catch(() => null);
}

async function removeTierRole(member, mode) {
  if (!member?.guild) return;
  const prefix = `Mental ${MODE_LABELS[mode]} • `;
  for (const role of member.roles.cache.filter(role => role.name.startsWith(prefix)).values()) {
    if (role.editable) await member.roles.remove(role).catch(() => null);
  }
}

function formatProfile(discordUser, record) {
  const verified = record?.minecraftName
    ? `✅ **Verified:** ${record.minecraftName}`
    : '❌ **Minecraft:** nicht verifiziert';
  const tiers = MODES.map(mode => `**${MODE_LABELS[mode]}:** ${record?.tiers?.[mode] || 'Unranked'}`);

  return new EmbedBuilder()
    .setTitle(`MentalTiers • ${discordUser.username}`)
    .setDescription([verified, '', ...tiers].join('\n'))
    .setThumbnail(discordUser.displayAvatarURL())
    .setFooter({ text: 'MentalTiers' })
    .setTimestamp();
}

function verifyPanel() {
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Evaluation Testing Waitlist')
    .setDescription([
      '**Complete the steps below to unlock the MentalTiers testing queues.**',
      '',
      '**Step 1 — Verify Account**',
      '• Click **Verify Account** and enter your Minecraft IGN.',
      '• You receive a **6-character code**.',
      `• Join the verification server: **${VERIFY_SERVER_IP}**`,
      '• In Minecraft run `/confirm CODE`.',
      '• Each Minecraft account can only be linked to one Discord account.',
      '',
      '**Step 2 — Enter a Waitlist**',
      '• After verification the waitlist channels unlock automatically.',
      `• When a tester opens a queue, press **Join Queue**.`,
      `• Every queue has a maximum of **${QUEUE_LIMIT} players**.`,
      '',
      '⚠️ False account information can result in a denied test.'
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_account').setLabel('Verify Account').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('view_cooldown').setLabel('View Cooldown').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

function queueEmbed(region, mode, state) {
  const open = Boolean(state.open);
  const entries = state.entries || [];
  const spots = `${entries.length}/${QUEUE_LIMIT}`;
  const lines = entries.slice(0, QUEUE_LIMIT).map((entry, index) =>
    `**${index + 1}.** <@${entry.discordId}> • \`${entry.minecraftName}\``
  );

  const embed = new EmbedBuilder()
    .setColor(open ? 0x57F287 : 0xED4245)
    .setTitle(open ? `${MODE_LABELS[mode]} Testing Waitlist • ${REGION_LABELS[region]}` : `No ${REGION_LABELS[region]}-Testers Online`)
    .setDescription(open
      ? [
          `🟢 **Queue OPEN** — ${spots} players`,
          `Press **Join Queue** to enter. Maximum ${QUEUE_LIMIT} players.`,
          '',
          lines.length ? lines.join('\n') : '*Nobody is waiting yet.*'
        ].join('\n')
      : [
          'No testers for this region are available at this time.',
          'The queue is currently closed. Check back when a tester opens it.',
          '',
          `**Mode:** ${MODE_LABELS[mode]}`,
          state.lastSessionAt ? `**Last testing session:** <t:${Math.floor(new Date(state.lastSessionAt).getTime() / 1000)}:R>` : '**Last testing session:** none yet'
        ].join('\n'))
    .setFooter({ text: `MentalTiers • ${spots} slots used` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_join:${region}:${mode}`)
      .setLabel(open && entries.length < QUEUE_LIMIT ? 'Join Queue' : entries.length >= QUEUE_LIMIT ? 'Queue Full' : 'Queue Closed')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!open || entries.length >= QUEUE_LIMIT),
    new ButtonBuilder().setCustomId(`queue_leave:${region}:${mode}`).setLabel('Leave Queue').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`queue_view:${region}:${mode}`).setLabel('View Queue').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

async function refreshQueuePanel(guild, region, mode) {
  const db = readDb();
  const setup = ensureGuild(db, guild.id);
  const key = queueKey(region, mode);
  const channelId = setup.queueChannels[key];
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = ensureQueue(db, region, mode);
  let message = null;
  const knownMessageId = setup.queueMessages[key];
  if (knownMessageId) message = await channel.messages.fetch(knownMessageId).catch(() => null);

  if (message) {
    await message.edit(queueEmbed(region, mode, state)).catch(() => null);
  } else {
    message = await channel.send(queueEmbed(region, mode, state));
    setup.queueMessages[key] = message.id;
    writeDb(db);
  }
}

async function findOrCreateRole(guild, name) {
  const existing = guild.roles.cache.find(role => role.name === name);
  if (existing) return existing;
  return guild.roles.create({ name, reason: 'MentalTiers setup' });
}

async function findOrCreateCategory(guild, name, permissionOverwrites) {
  const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === name);
  if (existing) return existing;
  return guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites, reason: 'MentalTiers setup' });
}

async function findOrCreateTextChannel(guild, name, parentId) {
  const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === name && channel.parentId === parentId);
  if (existing) return existing;
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId, reason: 'MentalTiers setup' });
}

async function runSetup(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: true });
  await guild.roles.fetch();
  await guild.channels.fetch();

  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply('❌ Der Bot braucht **Manage Roles** und **Manage Channels**.');
  }

  const verifiedRole = await findOrCreateRole(guild, 'Mental Verified');
  const testerRole = await findOrCreateRole(guild, 'Mental Tester');

  const verifyCategory = await findOrCreateCategory(guild, 'MentalTiers • Verification', [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel] }
  ]);
  const verifyChannel = await findOrCreateTextChannel(guild, 'verify-account', verifyCategory.id);
  await verifyChannel.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: true,
    SendMessages: false
  });

  const db = readDb();
  const setup = ensureGuild(db, guild.id);
  setup.verifiedRoleId = verifiedRole.id;
  setup.testerRoleId = testerRole.id;
  setup.verifyCategoryId = verifyCategory.id;
  setup.verifyChannelId = verifyChannel.id;

  let verifyMessage = setup.verifyMessageId
    ? await verifyChannel.messages.fetch(setup.verifyMessageId).catch(() => null)
    : null;
  if (verifyMessage) await verifyMessage.edit(verifyPanel());
  else {
    verifyMessage = await verifyChannel.send(verifyPanel());
    setup.verifyMessageId = verifyMessage.id;
  }

  for (const region of ENABLED_REGIONS.length ? ENABLED_REGIONS : ['eu']) {
    const category = await findOrCreateCategory(guild, `Waitlist ${REGION_LABELS[region]}`, [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
      { id: testerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
    ]);
    setup.queueCategoryIds[region] = category.id;

    for (const mode of MODES) {
      const channel = await findOrCreateTextChannel(guild, `${mode}-waitlist`, category.id);
      setup.queueChannels[queueKey(region, mode)] = channel.id;
      ensureQueue(db, region, mode);
    }
  }

  writeDb(db);

  for (const region of ENABLED_REGIONS.length ? ENABLED_REGIONS : ['eu']) {
    for (const mode of MODES) await refreshQueuePanel(guild, region, mode);
  }

  return interaction.editReply([
    '✅ **MentalTiers Setup fertig.**',
    `• Verify: <#${verifyChannel.id}>`,
    `• Rolle: <@&${verifiedRole.id}>`,
    `• Tester: <@&${testerRole.id}>`,
    `• ${MODES.length} Waitlist-Channels pro aktivierter Region`,
    `• ${QUEUE_LIMIT} Plaetze pro Queue`
  ].join('\n'));
}

async function handleVerifyModal(interaction) {
  const minecraftName = interaction.fields.getTextInputValue('minecraft_ign').trim();
  if (!isValidMinecraftName(minecraftName)) {
    return interaction.reply({ content: '❌ Ungueltiger Minecraft-Name. Erlaubt sind 3–16 Zeichen: Buchstaben, Zahlen und `_`.', ephemeral: true });
  }

  const db = readDb();
  const normalized = minecraftName.toLowerCase();
  const linked = db.minecraftLinks[normalized];
  if (linked && linked !== interaction.user.id) {
    return interaction.reply({ content: '❌ Dieser Minecraft-Account ist bereits mit einem anderen Discord-Account verknuepft.', ephemeral: true });
  }

  const existingUser = ensureUser(db, interaction.user);
  if (existingUser.verifiedAt && existingUser.minecraftName) {
    return interaction.reply({ content: `✅ Du bist bereits als **${existingUser.minecraftName}** verifiziert.`, ephemeral: true });
  }

  const pendingForName = Object.values(db.pendingVerifications).find(item =>
    item.minecraftName?.toLowerCase() === normalized && item.discordId !== interaction.user.id && new Date(item.expiresAt).getTime() > Date.now()
  );
  if (pendingForName) {
    return interaction.reply({ content: '❌ Fuer diesen Minecraft-Account laeuft bereits eine andere Verifizierung.', ephemeral: true });
  }

  const code = generateVerifyCode();
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  db.pendingVerifications[interaction.user.id] = {
    discordId: interaction.user.id,
    discordUsername: interaction.user.username,
    guildId: interaction.guildId,
    minecraftName,
    code,
    createdAt: new Date().toISOString(),
    expiresAt
  };
  writeDb(db);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Minecraft Account Verification')
    .setDescription([
      `**Minecraft IGN:** \`${minecraftName}\``,
      `**Server:** \`${VERIFY_SERVER_IP}\``,
      `**Your code:** \`${code}\``,
      '',
      '1. Join the server above.',
      `2. Run **\`/confirm ${code}\`** in Minecraft.`,
      '3. MentalTiers will unlock your waitlist channels automatically.',
      '',
      '⏳ The code expires in **20 minutes**.'
    ].join('\n'));

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleQueueButton(interaction, action, region, mode) {
  if (!REGIONS.includes(region) || !MODES.includes(mode)) {
    return interaction.reply({ content: '❌ Unbekannte Queue.', ephemeral: true });
  }

  const db = readDb();
  const user = ensureUser(db, interaction.user);
  const state = ensureQueue(db, region, mode);

  if (action === 'view') {
    const lines = state.entries.map((entry, index) => `**${index + 1}.** <@${entry.discordId}> • \`${entry.minecraftName}\``);
    const embed = new EmbedBuilder()
      .setTitle(`${MODE_LABELS[mode]} Queue • ${REGION_LABELS[region]}`)
      .setDescription(lines.length ? lines.join('\n') : '*Queue is empty.*')
      .setFooter({ text: `${state.entries.length}/${QUEUE_LIMIT} • ${state.open ? 'OPEN' : 'CLOSED'}` });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (!user.verifiedAt || !user.minecraftName) {
    return interaction.reply({ content: '❌ Du musst zuerst deinen Minecraft-Account in **#verify-account** verifizieren.', ephemeral: true });
  }

  if (action === 'join') {
    if (!state.open) return interaction.reply({ content: '🔴 Diese Queue ist gerade geschlossen.', ephemeral: true });
    if (state.entries.length >= QUEUE_LIMIT) return interaction.reply({ content: '❌ Die Queue ist bereits voll (20/20).', ephemeral: true });

    const cooldownUntil = user.cooldowns?.[mode] ? new Date(user.cooldowns[mode]).getTime() : 0;
    if (cooldownUntil > Date.now()) {
      return interaction.reply({ content: `⏳ Dein **${MODE_LABELS[mode]}**-Cooldown laeuft noch **${formatRemaining(cooldownUntil - Date.now())}**.`, ephemeral: true });
    }

    const duplicate = Object.values(db.queues).some(queue =>
      (queue.entries || []).some(entry => entry.discordId === interaction.user.id && entry.mode === mode)
    ) || state.entries.some(entry => entry.discordId === interaction.user.id);

    if (duplicate) return interaction.reply({ content: `❌ Du bist bereits in einer **${MODE_LABELS[mode]}**-Queue.`, ephemeral: true });

    state.entries.push({
      discordId: interaction.user.id,
      discordUsername: interaction.user.username,
      minecraftName: user.minecraftName,
      mode,
      region,
      joinedAt: new Date().toISOString()
    });
    writeDb(db);
    await refreshQueuePanel(interaction.guild, region, mode);
    return interaction.reply({ content: `✅ Du bist jetzt **#${state.entries.length}** in der **${MODE_LABELS[mode]} ${REGION_LABELS[region]}** Queue.`, ephemeral: true });
  }

  if (action === 'leave') {
    const index = state.entries.findIndex(entry => entry.discordId === interaction.user.id);
    if (index === -1) return interaction.reply({ content: 'Du bist nicht in dieser Queue.', ephemeral: true });
    state.entries.splice(index, 1);
    writeDb(db);
    await refreshQueuePanel(interaction.guild, region, mode);
    return interaction.reply({ content: `✅ Du hast die **${MODE_LABELS[mode]}** Queue verlassen.`, ephemeral: true });
  }
}

async function handleCooldownButton(interaction) {
  const db = readDb();
  const user = ensureUser(db, interaction.user);
  const lines = MODES.map(mode => {
    const until = user.cooldowns?.[mode] ? new Date(user.cooldowns[mode]).getTime() : 0;
    return `**${MODE_LABELS[mode]}:** ${until > Date.now() ? `⏳ ${formatRemaining(until - Date.now())}` : '✅ Ready'}`;
  });
  return interaction.reply({ embeds: [new EmbedBuilder().setTitle('MentalTiers • Cooldowns').setDescription(lines.join('\n'))], ephemeral: true });
}

async function handleButton(interaction) {
  if (interaction.customId === 'verify_account') {
    const modal = new ModalBuilder().setCustomId('verify_account_modal').setTitle('Verify Minecraft Account');
    const input = new TextInputBuilder()
      .setCustomId('minecraft_ign')
      .setLabel('Minecraft IGN')
      .setPlaceholder('Example: Away232323')
      .setStyle(TextInputStyle.Short)
      .setMinLength(3)
      .setMaxLength(16)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'view_cooldown') return handleCooldownButton(interaction);

  const match = interaction.customId.match(/^queue_(join|leave|view):([a-z]+):([a-z]+)$/);
  if (match) return handleQueueButton(interaction, match[1], match[2], match[3]);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log(`Slash commands registered for guild ${GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Global slash commands registered.');
  }
}

async function handleCommand(interaction) {
  if (interaction.commandName === 'setup') return runSetup(interaction);

  if (interaction.commandName === 'help') {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('MentalTiers • Help').setDescription([
        '`/profile` – show tiers + verified IGN',
        '`/leaderboard` – global ranking',
        '`/queue-open` – open a mode queue (Tester)',
        '`/queue-close` – close a mode queue (Tester)',
        '`/queue-next` – take the next player (Tester)',
        '`/test-result` – save a test result (Tester)',
        '`/tier-set` / `/tier-remove` – admin/tester tier tools',
        '`/setup` – create the Discord structure (Admin)'
      ].join('\n'))],
      ephemeral: true
    });
  }

  if (interaction.commandName === 'profile') {
    const target = interaction.options.getUser('user') || interaction.user;
    const db = readDb();
    return interaction.reply({ embeds: [formatProfile(target, db.users[target.id])] });
  }

  if (interaction.commandName === 'leaderboard') {
    const db = readDb();
    const ranked = Object.values(db.users)
      .map(user => ({
        ...user,
        score: Object.values(user.tiers || {}).reduce((sum, tier) => sum + (TIER_POINTS[tier] || 0), 0)
      }))
      .filter(user => user.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const description = ranked.length
      ? ranked.map((user, index) => `**${index + 1}.** <@${user.discordId}> — **${user.score} pts**`).join('\n')
      : '*No ranked players yet.*';
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 MentalTiers Leaderboard').setDescription(description)] });
  }

  if (['queue-open', 'queue-close', 'queue-next', 'test-result', 'tier-set', 'tier-remove'].includes(interaction.commandName)) {
    if (!requireTester(interaction)) return;
  }

  if (interaction.commandName === 'queue-open') {
    const mode = interaction.options.getString('mode', true);
    const region = getRegion(interaction);
    const db = readDb();
    const state = ensureQueue(db, region, mode);
    state.open = true;
    state.openedBy = interaction.user.id;
    state.openedAt = new Date().toISOString();
    writeDb(db);
    await refreshQueuePanel(interaction.guild, region, mode);
    return interaction.reply(`🟢 **${MODE_LABELS[mode]} ${REGION_LABELS[region]}** queue is now OPEN (${state.entries.length}/${QUEUE_LIMIT}).`);
  }

  if (interaction.commandName === 'queue-close') {
    const mode = interaction.options.getString('mode', true);
    const region = getRegion(interaction);
    const db = readDb();
    const state = ensureQueue(db, region, mode);
    state.open = false;
    state.lastSessionAt = new Date().toISOString();
    writeDb(db);
    await refreshQueuePanel(interaction.guild, region, mode);
    return interaction.reply(`🔴 **${MODE_LABELS[mode]} ${REGION_LABELS[region]}** queue is now CLOSED. Existing players remain in line.`);
  }

  if (interaction.commandName === 'queue-clear') {
    const mode = interaction.options.getString('mode', true);
    const region = getRegion(interaction);
    const db = readDb();
    const state = ensureQueue(db, region, mode);
    state.entries = [];
    writeDb(db);
    await refreshQueuePanel(interaction.guild, region, mode);
    return interaction.reply({ content: `🗑️ **${MODE_LABELS[mode]} ${REGION_LABELS[region]}** queue cleared.`, ephemeral: true });
  }

  if (interaction.commandName === 'queue-next') {
    const mode = interaction.options.getString('mode', true);
    const region = getRegion(interaction);
    const db = readDb();
    const state = ensureQueue(db, region, mode);
    if (!state.entries.length) return interaction.reply({ content: 'Queue is empty.', ephemeral: true });

    const next = state.entries.shift();
    db.activeTests.push({
      discordId: next.discordId,
      minecraftName: next.minecraftName,
      testerId: interaction.user.id,
      mode,
      region,
      startedAt: new Date().toISOString()
    });
    writeDb(db);
    await refreshQueuePanel(interaction.guild, region, mode);

    const user = await client.users.fetch(next.discordId).catch(() => null);
    await user?.send(`🧪 Your **${MODE_LABELS[mode]} ${REGION_LABELS[region]}** MentalTiers test is ready. Tester: <@${interaction.user.id}>`).catch(() => null);

    return interaction.reply(`🧪 **NEXT:** <@${next.discordId}> (\`${next.minecraftName}\`) — Tester: <@${interaction.user.id}>`);
  }

  if (interaction.commandName === 'tier-set' || interaction.commandName === 'test-result') {
    const target = interaction.options.getUser('user', true);
    const mode = interaction.options.getString('mode', true);
    const tier = interaction.options.getString('tier', true);
    const db = readDb();
    const record = ensureUser(db, target);
    record.tiers[mode] = tier;
    record.updatedAt = new Date().toISOString();

    if (interaction.commandName === 'test-result') {
      record.cooldowns[mode] = new Date(Date.now() + TEST_COOLDOWN_DAYS * 86400000).toISOString();
      db.activeTests = db.activeTests.filter(test => !(test.discordId === target.id && test.mode === mode));
      for (const state of Object.values(db.queues)) {
        state.entries = (state.entries || []).filter(entry => !(entry.discordId === target.id && entry.mode === mode));
      }
    }

    writeDb(db);
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    await syncTierRole(member, mode, tier);

    const embed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle('🏆 MentalTiers • Test Result')
      .setDescription(`<@${target.id}> has been ranked **${tier}** in **${MODE_LABELS[mode]}**.`)
      .addFields(
        { name: 'Tester', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Minecraft', value: record.minecraftName || 'Not linked', inline: true },
        { name: 'Cooldown', value: interaction.commandName === 'test-result' ? `${TEST_COOLDOWN_DAYS} days` : 'unchanged', inline: true }
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'tier-remove') {
    const target = interaction.options.getUser('user', true);
    const mode = interaction.options.getString('mode', true);
    const db = readDb();
    if (db.users[target.id]?.tiers) delete db.users[target.id].tiers[mode];
    writeDb(db);
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    await removeTierRole(member, mode);
    return interaction.reply(`🗑️ Removed <@${target.id}>'s **${MODE_LABELS[mode]}** tier.`);
  }

  if (interaction.commandName === 'verify-reset') {
    const target = interaction.options.getUser('user', true);
    const db = readDb();
    const record = db.users[target.id];
    if (!record?.minecraftName) return interaction.reply({ content: 'That player is not verified.', ephemeral: true });

    delete db.minecraftLinks[record.minecraftName.toLowerCase()];
    record.minecraftName = null;
    record.minecraftUuid = null;
    record.verifiedAt = null;
    delete db.pendingVerifications[target.id];
    writeDb(db);

    const setup = db.guilds?.[interaction.guildId];
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member && setup?.verifiedRoleId) await member.roles.remove(setup.verifiedRoleId).catch(() => null);
    return interaction.reply({ content: `✅ Verification reset for <@${target.id}>.`, ephemeral: true });
  }
}

function sendHttp(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function confirmFromMinecraft(payload) {
  const code = String(payload.code || '').trim().toUpperCase();
  const minecraftName = String(payload.minecraftName || '').trim();
  const minecraftUuid = String(payload.uuid || '').trim();
  if (!code || !minecraftName) return 'BAD_REQUEST';

  const db = readDb();
  const pending = Object.values(db.pendingVerifications).find(item => item.code === code);
  if (!pending) return 'INVALID_CODE';
  if (new Date(pending.expiresAt).getTime() <= Date.now()) {
    delete db.pendingVerifications[pending.discordId];
    writeDb(db);
    return 'EXPIRED';
  }
  if (pending.minecraftName.toLowerCase() !== minecraftName.toLowerCase()) return 'NAME_MISMATCH';

  const normalized = minecraftName.toLowerCase();
  const linkedDiscordId = db.minecraftLinks[normalized];
  if (linkedDiscordId && linkedDiscordId !== pending.discordId) return 'ALREADY_LINKED';

  const userRecord = db.users[pending.discordId] || {
    discordId: pending.discordId,
    username: pending.discordUsername,
    tiers: {},
    cooldowns: {}
  };
  userRecord.minecraftName = minecraftName;
  userRecord.minecraftUuid = minecraftUuid || userRecord.minecraftUuid || null;
  userRecord.verifiedAt = new Date().toISOString();
  userRecord.updatedAt = new Date().toISOString();
  userRecord.tiers ??= {};
  userRecord.cooldowns ??= {};
  db.users[pending.discordId] = userRecord;
  db.minecraftLinks[normalized] = pending.discordId;
  delete db.pendingVerifications[pending.discordId];
  writeDb(db);

  const guild = await client.guilds.fetch(pending.guildId || GUILD_ID).catch(() => null);
  if (guild) {
    const freshDb = readDb();
    const setup = freshDb.guilds?.[guild.id];
    const member = await guild.members.fetch(pending.discordId).catch(() => null);
    if (member && setup?.verifiedRoleId) {
      await member.roles.add(setup.verifiedRoleId).catch(error => console.error('Could not add Verified role:', error));
    }
    const discordUser = await client.users.fetch(pending.discordId).catch(() => null);
    await discordUser?.send(`✅ **MentalTiers verified!** Your Discord is now linked to Minecraft account **${minecraftName}**. Your waitlist channels are unlocked.`).catch(() => null);
  }

  return 'OK';
}

function startVerificationApi() {
  if (!VERIFY_API_SECRET) {
    console.warn('VERIFY_API_SECRET is missing. Minecraft /confirm API is disabled until you set it.');
    return;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/confirm') return sendHttp(res, 404, 'NOT_FOUND');
    if (req.headers['x-mentaltiers-secret'] !== VERIFY_API_SECRET) return sendHttp(res, 401, 'UNAUTHORIZED');

    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8192) req.destroy();
    });
    req.on('end', async () => {
      try {
        const result = await confirmFromMinecraft(JSON.parse(raw));
        sendHttp(res, result === 'OK' ? 200 : 400, result);
      } catch (error) {
        console.error('Verification API error:', error);
        sendHttp(res, 500, 'SERVER_ERROR');
      }
    });
  });

  server.listen(VERIFY_API_PORT, '0.0.0.0', () => {
    console.log(`MentalTiers verification API listening on port ${VERIFY_API_PORT}.`);
  });
}

client.once('ready', async () => {
  console.log(`MentalTiers online as ${client.user.tag}`);
  client.user.setActivity('MentalTiers');
  try {
    await registerCommands();
  } catch (error) {
    console.error('Command registration failed:', error);
  }
  startVerificationApi();
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit() && interaction.customId === 'verify_account_modal') return await handleVerifyModal(interaction);
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = { content: '❌ MentalTiers had an internal error. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

client.login(TOKEN);
