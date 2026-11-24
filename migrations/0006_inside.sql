-- Plan: "Drinnen" entries (the cat will not be let out) next to the outside windows. Additive only.
-- kind 'out' = outside window (all existing rows), 'in' = inside entry.
-- on_date = local date 'YYYY-MM-DD' for a one-off entry; NULL = repeats every week on `weekday`.
ALTER TABLE schedule_slots ADD COLUMN kind TEXT NOT NULL DEFAULT 'out';
ALTER TABLE schedule_slots ADD COLUMN on_date TEXT;
