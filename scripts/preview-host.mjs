// Tiny proxy that forwards to the app with a chosen Host header — only for previewing a
// site variant locally, where a browser cannot set the Host header itself.
//   node scripts/preview-host.mjs 8801 sellformoney.com 8800
const [, , LISTEN = '8801', HOST = 'sellformoney.com', UPSTREAM = '8800'] = process.argv;
import http from 'node:http';

http.createServer((req, res) => {
  const opts = {
    host: '127.0.0.1', port: Number(UPSTREAM), path: req.url, method: req.method,
    headers: { ...req.headers, host: HOST },
  };
  const up = http.request(opts, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end('upstream: ' + e.message); });
  req.pipe(up);
}).listen(Number(LISTEN), () => console.log(`preview http://localhost:${LISTEN}/  as Host: ${HOST} -> :${UPSTREAM}`));
