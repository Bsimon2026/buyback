// Build the static preview that goes to Vercel.
//
//   node scripts/build-demo.mjs [--port 8099]
//
// It snapshots config / catalog / questions / pricing parameters from the running server, copies the
// customer site, and injects the offline API shim so the whole journey works with no backend.
// Writes to _demo/indubaicity/ (the folder name becomes the Vercel project name).
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '8099';
const BASE = `http://localhost:${PORT}`;
const OUT = join(root, '_demo', 'indubaicity');

const get = (p) => fetch(BASE + p).then((r) => (r.ok ? r.json() : Promise.reject(new Error(p + ' ' + r.status))));

// ---- pricing parameters come straight from settings, not copied into the code ----
process.env.DB_FILE = process.env.DB_FILE || join(root, 'data', 'buyback.db');
const money = (await import('../src/money.js')).default;
const db = (await import('../src/db.js')).default;
const S = db.getSettings();
const pricing = {
  currency: S.base_currency,
  factor: money.factor(S.base_currency),
  roundingStep: Number(S.rounding_step),
  rangePctBp: Number(S.range_pct_bp),
  floorPctBp: Number(S.min_floor_pct_bp),
};

console.log('pricing:', pricing);

const [config, mobCat, lapCat, mobQ, lapQ] = await Promise.all([
  get('/api/config'),
  get('/api/catalog?category=mobile'),
  get('/api/catalog?category=laptop'),
  get('/api/questions?category=mobile'),
  get('/api/questions?category=laptop'),
]);

const data = { pricing, config, catalog: { mobile: mobCat, laptop: lapCat }, questions: { mobile: mobQ, laptop: lapQ } };

// ---- assemble ----
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(root, 'public'), OUT, { recursive: true });
// the preview is the customer site only
rmSync(join(OUT, 'admin.html'), { force: true });
rmSync(join(OUT, 'assets', 'admin.js'), { force: true });

const inline = `<script>window.__DEMO_DATA__=${JSON.stringify(data)};</script>\n  <script src="/assets/demo-api.js"></script>`;
let html = readFileSync(join(OUT, 'index.html'), 'utf8');
if (!html.includes('demo-api.js')) {
  // must run before customer.js
  html = html.replace('<script src="/assets/customer.js"', inline + '\n  <script src="/assets/customer.js"');
  writeFileSync(join(OUT, 'index.html'), html);
}

// demo notice, so nobody mistakes a preview booking for a real one
const notice = `<style>
#demochip{position:fixed;right:16px;bottom:16px;z-index:9999;background:var(--ink);color:var(--paper);
 font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;padding:9px 13px;
 border-radius:3px;opacity:.92;pointer-events:none}
</style>
<div id="demochip">Preview · bookings not processed</div>
`;
for (const f of ['index.html', 'terms.html', 'privacy.html']) {
  const p = join(OUT, f);
  if (!existsSync(p)) continue;
  let s = readFileSync(p, 'utf8');
  s = s.replace('</body>', notice + '</body>');
  writeFileSync(p, s);
}

// Vercel: plain static hosting, clean URLs
writeFileSync(join(OUT, 'vercel.json'), JSON.stringify({
  cleanUrls: true,
  trailingSlash: false,
  headers: [{ source: '/assets/(.*)', headers: [{ key: 'cache-control', value: 'public, max-age=3600' }] }],
}, null, 2));

writeFileSync(join(OUT, 'demo-data.json'), JSON.stringify(data));

const size = (p) => readFileSync(p).length;
console.log('build written to', OUT);
console.log('variants  :', mobCat.concat(lapCat).reduce((n, b) => n + b.models.reduce((m, x) => m + x.variants.length, 0), 0));
console.log('questions :', mobQ.length, 'mobile /', lapQ.length, 'laptop');
console.log('index.html:', size(join(OUT, 'index.html')), 'bytes');
