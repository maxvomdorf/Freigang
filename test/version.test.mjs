// The version number lives in four files; they must agree or phones reload in circles / show the wrong version.
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/version.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const grab = (p, re) => re.exec(read(p))?.[1];
const found = {
  'src/version.js': VERSION,
  'package.json': JSON.parse(read('package.json')).version,
  'public/app.js': grab('public/app.js', /const VERSION = '([^']+)'/),
  'public/sw.js': grab('public/sw.js', /const VERSION = '([^']+)'/),
};
let bad = 0;
console.log('version');
for (const [f, v] of Object.entries(found)) { const ok = v === VERSION && /^\d+\.\d+\.\d+$/.test(v); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${f}: ${v}`); if (!ok) bad++; }
if (bad) process.exit(1);
console.log('\nall passed');
