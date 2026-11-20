// Unit tests for the status note helpers (pure, no server needed).
import { normalizeNote, noteForNewEvent, csvField, NOTE_MAX } from '../src/note.js';

let failed = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };

console.log('note');
ok(normalizeNote('  In   Begleitung \n') === 'In Begleitung', 'trims and collapses spaces and newlines');
ok(normalizeNote('a\u0000b\u0007c\tD') === 'a b c D', 'control characters become spaces');
ok(normalizeNote('x‮y​z') === 'x y z', 'invisible direction and zero-width characters are removed');
ok(normalizeNote('ä'.repeat(60)).length === NOTE_MAX, `capped at ${NOTE_MAX} characters`);
ok(Array.from(normalizeNote('🐈'.repeat(60))).length === NOTE_MAX, 'emoji are not cut in half');
ok(normalizeNote(null) === '' && normalizeNote(42) === '' && normalizeNote({}) === '', 'non-text gives no note');
ok(normalizeNote('<b>hi</b>') === '<b>hi</b>', 'markup is kept as plain text (the client escapes it)');

ok(noteForNewEvent('in', 'out', 'A', { note: 'B' }) === null, 'coming inside never keeps a note');
ok(noteForNewEvent('out', 'in', null, { note: 'B' }) === 'B', 'note in the request is used');
ok(noteForNewEvent('out', 'in', null, {}) === null, 'no note, no note');
ok(noteForNewEvent('out', 'soon', 'A', {}) === 'A', 'soon -> out carries the note over');
ok(noteForNewEvent('out', 'soon', 'A', { note: '' }) === null, 'explicit empty note clears it');
ok(noteForNewEvent('out', 'soon', 'A', { note: 'C' }) === 'C', 'explicit note replaces the carried one');
ok(noteForNewEvent('soon', 'in', null, { note: '  X ' }) === 'X', 'announcement can carry a note');

ok(csvField('plain') === 'plain', 'plain CSV field untouched');
ok(csvField('a;b') === '"a;b"', 'semicolon is quoted');
ok(csvField('say "hi"') === '"say ""hi"""', 'quotes are doubled');
ok(csvField('=1+1') === '"=1+1"', 'formula-looking text is quoted');

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
