#!/usr/bin/env node
/* LogLens CORS proxy — local diagnostic relay for AI endpoints without CORS.
 *
 *   node cors_proxy.js [port]        (default port 8790)
 *
 * Then put  http://127.0.0.1:8790  in the AI wizard's "optional CORS proxy"
 * field. LogLens POSTs {url, headers, body} to the proxy; the proxy forwards
 * them to `url` and returns {status, body} with permissive CORS headers.
 *
 * LOCAL TOOL ONLY: it forwards arbitrary URLs with permissive CORS — never
 * expose it beyond loopback / your own machine.
 */
'use strict';
const http = require('http');
const https = require('https');
const port = Number(process.argv[2] || 8790);

http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    // Chrome's Private Network Access / Local Network Access: a public https
    // page (the live demo) calling this loopback proxy gets a preflight that
    // must be answered with this header, or the browser blocks the request
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let raw = '';
  req.on('data', d => { raw += d; if (raw.length > 8 * 1024 * 1024) req.destroy(); });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch (e) {
      res.writeHead(400, cors); return res.end(JSON.stringify({ error: 'body must be JSON {url, headers, body}' }));
    }
    const target = payload.url;
    if (typeof target !== 'string' || !/^https?:\/\//.test(target)) {
      res.writeHead(400, cors); return res.end(JSON.stringify({ error: 'url must be an http(s) URL' }));
    }
    const tu = new URL(target);
    const lib = tu.protocol === 'https:' ? https : http;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, payload.headers || {});
    const pr = lib.request(tu, { method: 'POST', headers }, r => {
      let body = '';
      r.on('data', d => { body += d; if (body.length > 32 * 1024 * 1024) r.destroy(); });
      r.on('end', () => { res.writeHead(200, cors); res.end(JSON.stringify({ status: r.statusCode, body })); });
    });
    pr.on('error', e => { res.writeHead(200, cors); res.end(JSON.stringify({ status: 0, body: String(e.message) })); });
    pr.setTimeout(120000, () => pr.destroy(new Error('timeout')));
    pr.end(payload.body || '');
  });
}).listen(port, '127.0.0.1', () => {
  console.log('LogLens CORS proxy on http://127.0.0.1:' + port + ' — put that URL in the wizard proxy field');
});
