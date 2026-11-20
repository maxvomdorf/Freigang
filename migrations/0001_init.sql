-- Freigang schema. Times are epoch milliseconds (UTC); the app shows Europe/Berlin.

-- One row per status change. The newest row per cat is its current status.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cat         TEXT    NOT NULL CHECK (cat IN ('ilford','bonnie')),
  status      TEXT    NOT NULL CHECK (status IN ('in','soon','out')),
  prev_status TEXT,
  ts          INTEGER NOT NULL,  -- effective time (can be earlier than recorded_at when backdated)
  recorded_at INTEGER NOT NULL,  -- when the tap really happened
  actor       TEXT    NOT NULL,
  soon_until  INTEGER,           -- countdown end for status 'soon'
  override    INTEGER NOT NULL DEFAULT 0,  -- 1 = let out although the other cat was outside
  note        TEXT
);
CREATE INDEX events_cat_ts ON events (cat, ts);

-- Recurring outside windows. weekday 0 = Monday ... 6 = Sunday, minutes after local midnight.
CREATE TABLE schedule_slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cat        TEXT    NOT NULL CHECK (cat IN ('ilford','bonnie')),
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min  INTEGER NOT NULL,
  end_min    INTEGER NOT NULL,
  remind_min INTEGER NOT NULL DEFAULT 10
);
CREATE INDEX slots_day ON schedule_slots (weekday, start_min);

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user       TEXT    NOT NULL,
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

-- "Warten": user is waiting until the given cat is inside again.
CREATE TABLE watches (
  user       TEXT    NOT NULL,
  cat        TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user, cat)
);

-- Dedupes reminders and nudges so each is sent once.
CREATE TABLE sent_keys (
  key TEXT PRIMARY KEY,
  ts  INTEGER NOT NULL
);

-- Admin notes on overlap incidents, keyed by the overlap start time.
CREATE TABLE incident_notes (
  start_ts   INTEGER PRIMARY KEY,
  note       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
