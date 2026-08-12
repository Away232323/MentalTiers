const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const { MODES, TIERS, TIER_POINTS, MODE_LABELS } = require('./constants');
const { readDb, writeDb, ensureUser } = require('./store');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) {
  console.error('DISCORD_TOKEN fehlt. Lege den Token als Secret/Umgebungsvariable an.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const modeChoices = MODES.map(mode => ({ name: MODE_LABELS[mode], value: mode }));
const tierChoices = TIERS.map(tier => ({ name: tier, value: tier }));

const commands = [
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Zeigt das MentalTiers-Profil eines Spielers.')
    .addUserOption(option =>
      option.setName('user').setDescription('Spieler, dessen Profil du sehen willst.').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('tier-set')
    .setDescription('Setzt ein Tier fuer einen Spieler. Tester/Admin only.')
    .addUserOption(option => option.setName('user').setDescription('Discord-Spieler').setRequired(true))
    .addStringOption(option =>
      option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices)
    )
    .addStringOption(option =>
      option.setName('tier').setDescription('Tier').setRequired(true).addChoices(...tierChoices)
    ),

  new SlashCommandBuilder()
    .setName('tier-remove')
    .setDescription('Entfernt ein Tier. Tester/Admin only.')
    .addUserOption(option => option.setName('user').setDescription('Discord-Spieler').setRequired(true))
    .addStringOption(option =>
      option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices)
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Zeigt die globale MentalTiers-Rangliste.'),

  new SlashCommandBuilder()
    .setName('test-request')
    .setDescription('Fordert einen Tier-Test an.')
    .addStringOption(option =>
      option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices)
    )
    .addStringOption(option =>
      option.setName('minecraft-name').setDescription('Dein Minecraft-Name').setRequired(true).setMaxLength(16)
    ),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Zeigt die offene Test-Queue.')
    .addStringOption(option =>
      option.setName('mode').setDescription('Optional nach Gamemode filtern').setRequired(false).addChoices(...modeChoices)
    ),

  new SlashCommandBuilder()
    .setName('test-claim')
    .setDescription('Uebernimmt einen offenen Test. Tester/Admin only.')
    .addUserOption(option => option.setName('user').setDescription('Spieler').setRequired(true))
    .addStringOption(option =>
      option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices)
    ),

  new SlashCommandBuilder()
    .setName('test-result')
    .setDescription('Traegt das Ergebnis eines Tests ein. Tester/Admin only.')
    .addUserOption(option => option.setName('user').setDescription('Getesteter Spieler').setRequired(true))
    .addStringOption(option =>
      option.setName('mode').setDescription('Gamemode').setRequired(true).addChoices(...modeChoices)
    )
    .addStringOption(option =>
      option.setName('tier').setDescription('Ergebnis').setRequired(true).addChoices(...tierChoices)
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Zeigt alle MentalTiers Commands.')
].map(command => command.toJSON());

function isTester(member) {
  if (!member) return false;

  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageRoles)
  ) {
    return true;
  }

  return member.roles.cache.some(role => {
    const name = role.name.toLowerCase();
    return name === 'tester' || name.endsWith(' tester') || name.includes('tier tester');
  });
}

function tierRoleName(mode, tier) {
  return `Mental ${MODE_LABELS[mode]} • ${tier}`;
}

async function syncTierRole(member, mode, tier) {
  if (!member?.guild) return 'Keine Guild gefunden.';

  const guild = member.guild;
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'Tier gespeichert, aber dem Bot fehlt **Rollen verwalten**.';
  }

  const prefix = `Mental ${MODE_LABELS[mode]} • `;
  const oldRoles = member.roles.cache.filter(role => role.name.startsWith(prefix));

  for (const role of oldRoles.values()) {
    if (role.editable) {
      await member.roles.remove(role).catch(() => null);
    }
  }

  let role = guild.roles.cache.find(r => r.name === tierRoleName(mode, tier));
  if (!role) {
    role = await guild.roles.create({
      name: tierRoleName(mode, tier),
      reason: `MentalTiers Auto-Rolle fuer ${MODE_LABELS[mode]} ${tier}`
    });
  }

  if (!role.editable) {
    return `Tier gespeichert, aber die Rolle **${role.name}** liegt ueber der Bot-Rolle.`;
  }

  await member.roles.add(role);
  return `Rolle **${role.name}** wurde automatisch vergeben.`;
}

async function removeTierRole(member, mode) {
  if (!member?.guild) return;
  const prefix = `Mental ${MODE_LABELS[mode]} • `;
  const roles = member.roles.cache.filter(role => role.name.startsWith(prefix));

  for (const role of roles.values()) {
    if (role.editable) await member.roles.remove(role).catch(() => null);
  }
}

function setTier(discordUser, mode, tier) {
  const db = readDb();
  const user = ensureUser(db, discordUser);
  user.tiers[mode] = tier;
  user.updatedAt = new Date().toISOString();
  writeDb(db);
  return user;
}

function formatProfile(discordUser, record) {
  const lines = MODES.map(mode => {
    const value = record?.tiers?.[mode] ?? 'Unranked';
    return `**${MODE_LABELS[mode]}:** ${value}`;
  });

  return new EmbedBuilder()
    .setTitle(`MentalTiers • ${discordUser.username}`)
    .setDescription(lines.join('\n'))
    .setThumbnail(discordUser.displayAvatarURL())
    .setFooter({ text: 'MentalTiers' })
    .setTimestamp();
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const applicationId = client.user.id;

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(applicationId, GUILD_ID), { body: commands });
    console.log(`Slash-Commands fuer Guild ${GUILD_ID} registriert.`);
  } else {
    await rest.put(Routes.applicationCommands(applicationId), { body: commands });
    console.log('Globale Slash-Commands registriert.');
  }
}

client.once('ready', async () => {
  console.log(`MentalTiers online als ${client.user.tag}`);
  client.user.setActivity('MentalTiers');

  try {
    await registerCommands();
  } catch (error) {
    console.error('Command-Registrierung fehlgeschlagen:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('MentalTiers • Hilfe')
        .setDescription([
          '`/profile [user]` – Tier-Profil anzeigen',
          '`/test-request` – Test anfordern',
          '`/queue` – offene Tests anzeigen',
          '`/leaderboard` – Rangliste anzeigen',
          '`/test-claim` – Test uebernehmen (Tester)',
          '`/test-result` – Ergebnis eintragen (Tester)',
          '`/tier-set` – Tier manuell setzen (Tester)',
          '`/tier-remove` – Tier entfernen (Tester)'
        ].join('\n'));

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'profile') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const db = readDb();
      const record = db.users[target.id];
      return interaction.reply({ embeds: [formatProfile(target, record)] });
    }

    if (interaction.commandName === 'test-request') {
      const mode = interaction.options.getString('mode', true);
      const minecraftName = interaction.options.getString('minecraft-name', true);
      const db = readDb();

      const exists = db.queue.some(entry => entry.discordId === interaction.user.id && entry.mode === mode);
      if (exists) {
        return interaction.reply({
          content: `Du bist fuer **${MODE_LABELS[mode]}** bereits in der Queue.`,
          ephemeral: true
        });
      }

      db.queue.push({
        discordId: interaction.user.id,
        discordUsername: interaction.user.username,
        minecraftName,
        mode,
        requestedAt: new Date().toISOString(),
        claimedBy: null
      });
      writeDb(db);

      return interaction.reply(
        `✅ **${minecraftName}** ist jetzt fuer **${MODE_LABELS[mode]}** in der Test-Queue.`
      );
    }

    if (interaction.commandName === 'queue') {
      const mode = interaction.options.getString('mode');
      const db = readDb();
      const queue = mode ? db.queue.filter(entry => entry.mode === mode) : db.queue;

      if (!queue.length) {
        return interaction.reply({ content: 'Aktuell ist die Test-Queue leer.', ephemeral: true });
      }

      const lines = queue.slice(0, 20).map((entry, index) => {
        const claimed = entry.claimedBy ? ` • claimed von <@${entry.claimedBy}>` : '';
        return `**${index + 1}.** <@${entry.discordId}> (${entry.minecraftName}) • **${MODE_LABELS[entry.mode]}**${claimed}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('MentalTiers • Test Queue')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${queue.length} offene Test(s)` });

      return interaction.reply({ embeds: [embed] });
    }

    if (['tier-set', 'tier-remove', 'test-claim', 'test-result'].includes(interaction.commandName)) {
      if (!isTester(interaction.member)) {
        return interaction.reply({
          content: '❌ Dieser Command ist nur fuer **Tester/Admins**.',
          ephemeral: true
        });
      }
    }

    if (interaction.commandName === 'tier-set') {
      const target = interaction.options.getUser('user', true);
      const mode = interaction.options.getString('mode', true);
      const tier = interaction.options.getString('tier', true);

      setTier(target, mode, tier);
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      const roleMessage = await syncTierRole(member, mode, tier).catch(() => 'Tier gespeichert, Rollen-Sync fehlgeschlagen.');

      return interaction.reply(
        `✅ <@${target.id}> wurde in **${MODE_LABELS[mode]}** auf **${tier}** gesetzt.\n${roleMessage}`
      );
    }

    if (interaction.commandName === 'tier-remove') {
      const target = interaction.options.getUser('user', true);
      const mode = interaction.options.getString('mode', true);
      const db = readDb();

      if (!db.users[target.id]?.tiers?.[mode]) {
        return interaction.reply({
          content: `Der Spieler hat in **${MODE_LABELS[mode]}** aktuell kein Tier.`,
          ephemeral: true
        });
      }

      delete db.users[target.id].tiers[mode];
      db.users[target.id].updatedAt = new Date().toISOString();
      writeDb(db);

      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      await removeTierRole(member, mode).catch(() => null);

      return interaction.reply(`🗑️ Das **${MODE_LABELS[mode]}**-Tier von <@${target.id}> wurde entfernt.`);
    }

    if (interaction.commandName === 'test-claim') {
      const target = interaction.options.getUser('user', true);
      const mode = interaction.options.getString('mode', true);
      const db = readDb();
      const entry = db.queue.find(item => item.discordId === target.id && item.mode === mode);

      if (!entry) {
        return interaction.reply({
          content: `Für <@${target.id}> gibt es keinen offenen **${MODE_LABELS[mode]}**-Test.`,
          ephemeral: true
        });
      }

      if (entry.claimedBy && entry.claimedBy !== interaction.user.id) {
        return interaction.reply({
          content: `Dieser Test wurde bereits von <@${entry.claimedBy}> uebernommen.`,
          ephemeral: true
        });
      }

      entry.claimedBy = interaction.user.id;
      entry.claimedAt = new Date().toISOString();
      writeDb(db);

      return interaction.reply(
        `🧪 <@${interaction.user.id}> testet jetzt <@${target.id}> in **${MODE_LABELS[mode]}**.`
      );
    }

    if (interaction.commandName === 'test-result') {
      const target = interaction.options.getUser('user', true);
      const mode = interaction.options.getString('mode', true);
      const tier = interaction.options.getString('tier', true);
      const db = readDb();
      const entryIndex = db.queue.findIndex(item => item.discordId === target.id && item.mode === mode);

      const userRecord = ensureUser(db, target);
      userRecord.tiers[mode] = tier;
      userRecord.updatedAt = new Date().toISOString();

      if (entryIndex !== -1) db.queue.splice(entryIndex, 1);
      writeDb(db);

      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      const roleMessage = await syncTierRole(member, mode, tier).catch(() => 'Tier gespeichert, Rollen-Sync fehlgeschlagen.');

      const embed = new EmbedBuilder()
        .setTitle('🏆 MentalTiers • Testergebnis')
        .setDescription(`<@${target.id}> wurde in **${MODE_LABELS[mode]}** als **${tier}** eingestuft.`)
        .addFields(
          { name: 'Tester', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Gamemode', value: MODE_LABELS[mode], inline: true },
          { name: 'Tier', value: tier, inline: true }
        )
        .setFooter({ text: roleMessage })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'leaderboard') {
      const db = readDb();
      const ranked = Object.values(db.users)
        .map(user => {
          const score = Object.values(user.tiers ?? {}).reduce(
            (sum, tier) => sum + (TIER_POINTS[tier] ?? 0),
            0
          );
          return { ...user, score };
        })
        .filter(user => user.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);

      if (!ranked.length) {
        return interaction.reply({ content: 'Noch hat niemand ein Tier.', ephemeral: true });
      }

      const lines = ranked.map((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
        return `${medal} <@${user.discordId}> — **${user.score} Punkte**`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 MentalTiers • Leaderboard')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'HT1 = 10 Punkte • LT5 = 1 Punkt' });

      return interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error(error);

    const payload = {
      content: '❌ Beim Ausfuehren des Commands ist ein Fehler aufgetreten.',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

client.login(TOKEN);
