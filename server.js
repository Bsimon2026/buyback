'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { one, run } = require('./src/db');
const api = require('./src/api');
const { siteForHost } = require('./src/sites');

const PORT = Number(process.env.PORT || 8099);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webp': 'image/webp',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 3 * 1024 * 1024) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'content-type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  // the landing page is per-domain; everything else is shared
  let rel = pathname;
  if (pathname === '/') {
    const site = siteForHost(req.headers.host);
    const custom = site ? path.join('sites', site, 'index.html') : null;
    rel = custom && fs.existsSync(path.join(PUBLIC_DIR, custom)) ? '/' + custom.split(path.sep).join('/') : '/index.html';
  }
  if (rel === '/admin') rel = '/admin.html';
  if (rel === '/terms') rel = '/terms.html';
  if (rel === '/privacy') rel = '/privacy.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // unknown path -> customer SPA shell for /sell etc is not needed; 404
      return send(res, 404, 'Not found');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return send(res, 400, { error: 'Bad URL' }); }

  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/doc/'))
    return serveStatic(req, res, url.pathname);

  try {
    const authHeader = String(req.headers.authorization || req.headers['x-auth-token'] || '');
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    let auth = null;
    if (token) {
      const s = one(`SELECT s.token, u.* FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`, token);
      if (s) auth = { ...s, token };
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const out = await api.handle(req, res, url, body, ip, auth);
    if (out === undefined) return;
    if (out && typeof out === 'object' && typeof out.__html === 'string') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(out.__html);
    }
    send(res, 200, out);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    send(res, status, { error: err.message || 'Server error', detail: err.detail || undefined });
  }
});

server.listen(PORT, () => {
  const { getSetting } = require('./src/db');
  console.log(`in Dubai City — buyback platform running on http://localhost:${PORT}  [${getSetting('base_currency')}]`);
  console.log(`  customer : http://localhost:${PORT}/`);
  console.log(`  admin    : http://localhost:${PORT}/admin`);
  console.log('  seeded staff (CHANGE BEFORE GO-LIVE):');
  console.log('    admin@indubaicity.com / admin123      (super admin)');
  console.log('    ops@indubaicity.com / ops12345        (ops manager)');
  console.log('    inspector@indubaicity.com / insp1234  (inspector)');
  console.log('    finance@indubaicity.com / fin12345    (finance)');
});
