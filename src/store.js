const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');

function defaultDb() {
  return {
    users: {},
    queues: {},
    pendingVerifications: {},
    minecraftLinks: {},
    guilds: {},
    activeTests: []
  };
}

function hydrate(db) {
  db.users ??= {};
  db.queues ??= {};
  db.pendingVerifications ??= {};
  db.minecraftLinks ??= {};
  db.guilds ??= {};
  db.activeTests ??= [];

  // Migrate the old queue format if an earlier MentalTiers build used it.
  if (Array.isArray(db.queue) && db.queue.length) {
    for (const entry of db.queue) {
      const key = `eu:${entry.mode}`;
      db.queues[key] ??= {
        open: false,
        openedBy: null,
        openedAt: null,
        lastSessionAt: null,
        entries: []
      };
      db.queues[key].entries.push({
        discordId: entry.discordId,
        discordUsername: entry.discordUsername,
        minecraftName: entry.minecraftName,
        joinedAt: entry.requestedAt ?? new Date().toISOString()
      });
    }
    delete db.queue;
  }

  return db;
}

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return hydrate(JSON.parse(raw));
  } catch {
    const db = defaultDb();
    writeDb(db);
    return db;
  }
}

function writeDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(hydrate(db), null, 2));
}

function ensureUser(db, discordUser) {
  const id = discordUser.id;
  db.users[id] ??= {
    discordId: id,
    username: discordUser.username,
    minecraftName: null,
    minecraftUuid: null,
    verifiedAt: null,
    tiers: {},
    cooldowns: {},
    updatedAt: new Date().toISOString()
  };

  db.users[id].username = discordUser.username;
  db.users[id].tiers ??= {};
  db.users[id].cooldowns ??= {};
  return db.users[id];
}

function ensureQueue(db, region, mode) {
  const key = `${region}:${mode}`;
  db.queues[key] ??= {
    open: false,
    openedBy: null,
    openedAt: null,
    lastSessionAt: null,
    entries: []
  };
  db.queues[key].entries ??= [];
  return db.queues[key];
}

function ensureGuild(db, guildId) {
  db.guilds[guildId] ??= {
    verifiedRoleId: null,
    testerRoleId: null,
    verifyChannelId: null,
    verifyMessageId: null,
    queueCategoryIds: {},
    queueChannels: {},
    queueMessages: {}
  };
  db.guilds[guildId].queueCategoryIds ??= {};
  db.guilds[guildId].queueChannels ??= {};
  db.guilds[guildId].queueMessages ??= {};
  return db.guilds[guildId];
}

module.exports = {
  readDb,
  writeDb,
  ensureUser,
  ensureQueue,
  ensureGuild
};
