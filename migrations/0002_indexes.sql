-- Keep every poll cheap: the app reads "latest event per cat" and "events since midnight" all day long.
-- Without these, each read would scan the whole events table (D1 bills and limits by rows read).
CREATE INDEX IF NOT EXISTS events_cat_id ON events (cat, id);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
