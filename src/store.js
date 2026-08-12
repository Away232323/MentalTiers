const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');

function defaultDb() {
  return { users: {}, queue: [] };
}

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.users ??= {};
    parsed.queue ??= [];
    return parsed;
  } catch {
    const db = defaultDb();
    writeDb(db);
    return db;
  }
}

function writeDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function ensureUser(db, discordUser) {
  const id = discordUser.id;
  db.users[id] ??= {
    discordId: id,
    username: discordUser.username,
    tiers: {},
    updatedAt: new Date().toISOString()
  };

  db.users[id].username = discordUser.username;
  db.users[id].tiers ??= {};
  return db.users[id];
}

module.exports = { readDb, writeDb, ensureUser };
