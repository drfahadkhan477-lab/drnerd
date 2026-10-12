'use strict';
/* A real origin transport outage. The page and unmodified service worker see
   a normal HTTP origin; cutting it prevents network responses in every
   engine, including WebKit where setOffline does not preserve SW behavior. */
const http = require('http');
async function originTransport(target) {
  const base = new URL(target), requests = new Set();
  const client = base.protocol === 'https:' ? require('https') : http;
  let online = true;
  const server = http.createServer((req, res) => {
    if (!online) { req.socket.destroy(); return; }
    const upstream = client.request(new URL(req.url, base.origin), {
      method: req.method, headers: { ...req.headers, host: base.host },
    }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    requests.add(upstream);
    upstream.on('close', () => requests.delete(upstream));
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    url: origin + base.pathname + base.search,
    cut() { online = false; server.closeAllConnections(); for (const r of requests) r.destroy(); },
    resume() { online = true; },
    async unavailable() { try { await fetch(origin + '/__transport_probe'); return false; } catch (_) { return true; } },
    close() { server.closeAllConnections(); for (const r of requests) r.destroy(); server.close(); },
  };
}
module.exports = { originTransport };
