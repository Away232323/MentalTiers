CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  discord_username TEXT NOT NULL,
  minecraft_name TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  tiers TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_state (
  mode TEXT PRIMARY KEY,
  is_open INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,
  panel_message_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_entries (
  mode TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (mode, discord_id)
);

CREATE TABLE IF NOT EXISTS test_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  tier TEXT NOT NULL,
  tester_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_entries_mode_joined
ON queue_entries(mode, joined_at);
