-- Per-person settings. Additive only. own_push = 1: also get status pushes when someone else in your own household switches your cat.
CREATE TABLE IF NOT EXISTS user_prefs (
  user TEXT PRIMARY KEY,
  own_push INTEGER NOT NULL DEFAULT 1
);
