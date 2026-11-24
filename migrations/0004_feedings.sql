-- Feeding tracker (Bonnie's household only). Additive only.
-- One row per feeding; "undo" deletes the row. ts is epoch milliseconds (UTC), user is the person's key.
CREATE TABLE IF NOT EXISTS feedings (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   INTEGER NOT NULL,
  user TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS feedings_ts ON feedings (ts);

-- feed_push = 1: get a push when someone else in the household feeds Bonnie (on by default, switchable in the settings).
ALTER TABLE user_prefs ADD COLUMN feed_push INTEGER NOT NULL DEFAULT 1;
