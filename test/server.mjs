// Serveur local de test : sert public/ et l'API avec un magasin en mémoire.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import handler, { __setStore } from '../netlify/functions/api.mjs';
import { mockStore } from './mockstore.mjs';
__setStore(mockStore());
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handler(new Request('http://localhost' + req.url, { method: req.method, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
  } else { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(new URL('../public/index.html', import.meta.url))); }
}).listen(8899, () => console.log('http://localhost:8899'));
