// Event queries. All of them read a handful of rows thanks to the indexes in migrations/0002_indexes.sql.
import { CATS } from './util.js';

/** Newest event per cat: { ilford: row|null, bonnie: row|null }. */
export async function lastEvents(env) {
  const rows = await Promise.all(
    CATS.map((cat) => env.DB.prepare('SELECT * FROM events WHERE cat = ? ORDER BY id DESC LIMIT 1').bind(cat).first()),
  );
  return Object.fromEntries(CATS.map((cat, i) => [cat, rows[i] ?? null]));
}

/** Every event with ts >= from, plus the last one before `from` per cat (so an open interval still has its start). Ordered by time. */
export async function eventsSince(env, from) {
  const [{ results: inside }, ...before] = await Promise.all([
    env.DB.prepare('SELECT * FROM events WHERE ts >= ? ORDER BY ts, id').bind(from).all(),
    ...CATS.map((cat) => env.DB.prepare('SELECT * FROM events WHERE cat = ? AND ts < ? ORDER BY ts DESC, id DESC LIMIT 1').bind(cat, from).first()),
  ]);
  return [...before.filter(Boolean), ...inside].sort((a, b) => a.ts - b.ts || a.id - b.id);
}
