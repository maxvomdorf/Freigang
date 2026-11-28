-- Weather for Ilford's statistics. Additive only.
-- weather_hours: one row per hour for the household's location (Open-Meteo, DWD ICON model), so the activity can be compared with the weather later.
--   ts = start of the hour, UTC ms. temp/feels in °C, hum in %, precip in mm and snow in cm (sums over the PRECEDING hour), code = WMO weather code,
--   cloud in %, wind/gust in km/h, sun = seconds of sunshine in the preceding hour. NULL = the model gave no value.
CREATE TABLE IF NOT EXISTS weather_hours (
  ts INTEGER PRIMARY KEY,
  temp REAL, feels REAL, hum INTEGER, precip REAL, snow REAL, code INTEGER, cloud INTEGER, wind REAL, gust REAL, sun INTEGER
);
-- kv: small settings the app keeps itself. Keys used: wx_config (location, rounded to ~1 km), wx_status (last attempt and result), wx_now (current reading).
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
