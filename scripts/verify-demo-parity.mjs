// Proves the static preview quotes identically to the real server.
//
//   node scripts/verify-demo-parity.mjs [--port 8099]
//
// For every variant × N random answer sets it compares the browser shim's arithmetic against
// POST /api/quote on the live server. Any drift is a bug: the preview would show a price the
// business cannot honour.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '8099';
const BASE = `http://localhost:${PORT}`;

const data = JSON.parse(readFileSync(join(root, '_demo', 'indubaicity', 'demo-data.json'), 'utf8'));
const engine = require(join(root, 'public', 'assets', 'demo-api.js'))(data);
const variants = engine.flatVariants();

const COMBOS = 6;
let checked = 0, failed = 0;

function pickAnswers(questions, seed) {
  const answers = {};
  questions.forEach((q, qi) => {
    answers[q.code] = q.options[(seed * 7 + qi * 3) % q.options.length].code;
  });
  return answers;
}

for (const v of variants) {
  const qs = data.questions[v._category] || [];
  for (let seed = 0; seed < COMBOS; seed++) {
    const answers = pickAnswers(qs, seed + v.id);
    const mine = engine.valuate(v, qs, answers);
    const res = await fetch(BASE + '/api/quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variantId: v.id, category: v._category, answers }),
    });
    const real = await res.json();
    checked++;
    const problems = [];
    if (mine.estimate.minor !== real.estimate.minor) problems.push(`estimate ${mine.estimate.minor} vs ${real.estimate.minor}`);
    if (mine.range.low.minor !== real.range.low.minor) problems.push(`low ${mine.range.low.minor} vs ${real.range.low.minor}`);
    if (mine.range.high.minor !== real.range.high.minor) problems.push(`high ${mine.range.high.minor} vs ${real.range.high.minor}`);
    if (mine.grade !== real.grade) problems.push(`grade ${mine.grade} vs ${real.grade}`);
    if (mine.range.text !== real.range.text) problems.push(`text "${mine.range.text}" vs "${real.range.text}"`);
    if (mine.basePrice.formatted !== real.basePrice.formatted) problems.push(`base "${mine.basePrice.formatted}" vs "${real.basePrice.formatted}"`);
    if (mine.adjustments.length !== real.adjustments.length) problems.push('adjustment count');
    mine.adjustments.forEach((a, i) => {
      const b = real.adjustments[i];
      if (!b || a.deltaMinor !== b.deltaMinor) problems.push(`adj ${a.question}: ${a.deltaMinor} vs ${b && b.deltaMinor}`);
    });
    if (problems.length) {
      failed++;
      console.log(`MISMATCH ${v._brand} ${v._model} ${v.variant} (id ${v.id}, seed ${seed}): ${problems.join('; ')}`);
    }
  }
}

console.log(`\n${checked} quotes compared across ${variants.length} variants — ${failed} mismatches`);
process.exit(failed ? 1 : 0);
