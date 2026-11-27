-- Corrected times: the original time and who changed it stay on the event (admins can correct Rein/Raus times of the last 24 hours).
-- orig_ts is set once, on the first correction; all three stay NULL for events that were never touched.
ALTER TABLE events ADD COLUMN orig_ts INTEGER;
ALTER TABLE events ADD COLUMN edited_by TEXT;
ALTER TABLE events ADD COLUMN edited_at INTEGER;
