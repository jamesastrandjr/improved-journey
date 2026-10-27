// LaneLab server: serves the app and stores the data bank in SQLite (node:sqlite, no npm install needed).
//   npm start                       -> http://127.0.0.1:3000
//   HOST=0.0.0.0 LANELAB_TOKEN=secret npm start   -> reachable from other shop devices, token protected
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const TABLES = { clients: 'clients', fittings: 'fittings', balls: 'balls' };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const t of Object.values(TABLES)) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
      id TEXT PRIMARY KEY, search TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
      deleted_at TEXT, json TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_upd ON ${t}(updated_at)`);
  }
  return db;
}

export function createServer({ dbFile = path.join(here, 'data', 'lanelab.db'), token = process.env.LANELAB_TOKEN || '' } = {}) {
  const db = openDb(dbFile);
  const upsert = {};
  for (const t of Object.values(TABLES)) {
    upsert[t] = db.prepare(`INSERT INTO ${t}(id,search,updated_at,deleted_at,json) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET search=excluded.search, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, json=excluded.json
      WHERE excluded.updated_at >= ${t}.updated_at`);
  }
  const searchText = (kind, r) => kind === 'clients' ? [r.profile?.name, r.profile?.phone, r.profile?.email].join(' ').toLowerCase() : [r.name, r.label].join(' ').toLowerCase();

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 2e6) { reject(Object.assign(new Error('Body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const all = (t) => db.prepare(`SELECT json FROM ${t}`).all().map((r) => JSON.parse(r.json));

  async function api(req, res, url) {
    if (token && req.headers['x-lanelab-token'] !== token) return send(res, 401, { error: 'token required' });
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const [kind, id] = parts;
    if (kind === 'health') return send(res, 200, { ok: true, counts: Object.fromEntries(Object.values(TABLES).map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE deleted_at IS NULL`).get().n])) });
    if (kind === 'export' && req.method === 'GET') return send(res, 200, { app: 'lanelab', version: 1, exportedAt: new Date().toISOString(), ...Object.fromEntries(Object.values(TABLES).map((t) => [t, Object.fromEntries(all(t).map((r) => [r.id, r]))])) });
    if (kind === 'import' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (body.app !== 'lanelab') return send(res, 400, { error: 'not a LaneLab backup' });
      let n = 0;
      for (const t of Object.values(TABLES)) for (const r of Object.values(body[t] || {})) if (ID_RE.test(r.id || '')) { upsert[t].run(r.id, searchText(t, r), r.updatedAt, r.deletedAt || null, JSON.stringify(r)); n++; }
      return send(res, 200, { imported: n });
    }
    if (!TABLES[kind]) return send(res, 404, { error: 'unknown resource' });
    const t = TABLES[kind];
    if (!id && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const rows = db.prepare(`SELECT json FROM ${t} WHERE deleted_at IS NULL AND search LIKE ? ORDER BY updated_at DESC LIMIT 500`).all(`%${q}%`);
      return send(res, 200, rows.map((r) => JSON.parse(r.json)));
    }
    if (!id || !ID_RE.test(id)) return send(res, 400, { error: 'bad id' });
    if (req.method === 'GET') {
      const row = db.prepare(`SELECT json FROM ${t} WHERE id=? AND deleted_at IS NULL`).get(id);
      return row ? send(res, 200, JSON.parse(row.json)) : send(res, 404, { error: 'not found' });
    }
    if (req.method === 'PUT') {
      let rec; try { rec = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      if (!rec || typeof rec !== 'object' || rec.id !== id || !rec.updatedAt) return send(res, 400, { error: 'id/updatedAt required' });
      upsert[t].run(id, searchText(kind, rec), rec.updatedAt, rec.deletedAt || null, JSON.stringify(rec));
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const row = db.prepare(`SELECT json FROM ${t} WHERE id=?`).get(id);
      if (!row) return send(res, 404, { error: 'not found' });
      const rec = JSON.parse(row.json); rec.deletedAt = rec.updatedAt = new Date().toISOString();
      upsert[t].run(id, '', rec.updatedAt, rec.deletedAt, JSON.stringify(rec));
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'method not allowed' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const pub = path.join(here, 'public');
      const file = path.normalize(path.join(pub, rel));
      if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      return send(res, e.code === 413 ? 413 : 500, { error: e.message });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`LaneLab running at http://${host}:${port}  (data: data/lanelab.db)`));
}
