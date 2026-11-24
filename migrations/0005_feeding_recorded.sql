-- Feeding tracker: when the entry was really made. ts stays the time the feeding happened (it can be earlier when entered afterwards).
-- Old rows have NULL here and count as recorded at their ts. Additive only.
ALTER TABLE feedings ADD COLUMN recorded_at INTEGER;
