// The "data bank": local-first record store (browser localStorage) that mirrors to the LaneLab
// server (SQLite) whenever one is reachable. Works completely offline from a plain .html file.
import { newId } from './state.js';

const KEY = 'lanelab.bank.v1';
const OUT = 'lanelab.outbox.v1';
const KINDS = ['clients', 'fittings', 'balls'];

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

export class Bank {
  constructor() {
    this.db = { clients: {}, fittings: {}, balls: {} };
    try { const raw = safeGet(KEY); if (raw) this.db = { ...this.db, ...JSON.parse(raw) }; } catch { /* corrupt -> start fresh */ }
    try { this.outbox = JSON.parse(safeGet(OUT) || '[]'); } catch { this.outbox = []; }
    this.mode = 'local'; // local | online | offline
    this.listeners = new Set();
    this.token = safeGet('lanelab.token') || '';
    this.persistOk = true;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(this.mode, this.outbox.length); }
  _persist() {
    this.persistOk = safeSet(KEY, JSON.stringify(this.db)) && safeSet(OUT, JSON.stringify(this.outbox));
    return this.persistOk;
  }

  // ---- generic ----
  _put(kind, rec) {
    const now = new Date().toISOString();
    rec.id = rec.id || newId();
    rec.createdAt = rec.createdAt || now;
    rec.updatedAt = now;
    delete rec.deletedAt;
    this.db[kind][rec.id] = rec;
    this.outbox = this.outbox.filter((o) => !(o.kind === kind && o.id === rec.id));
    this.outbox.push({ kind, id: rec.id, op: 'put' });
    this._persist();
    this.flushSoon();
    return rec;
  }
  _del(kind, id) {
    const r = this.db[kind][id];
    if (!r) return;
    r.deletedAt = new Date().toISOString();
    r.updatedAt = r.deletedAt;
    this.outbox = this.outbox.filter((o) => !(o.kind === kind && o.id === id));
    this.outbox.push({ kind, id, op: 'put' });
    this._persist();
    this.flushSoon();
  }
  _live(kind) { return Object.values(this.db[kind]).filter((r) => !r.deletedAt); }

  // ---- clients ----
  listClients(q = '') {
    const s = q.trim().toLowerCase();
    return this._live('clients')
      .filter((c) => !s || [c.profile.name, c.profile.phone, c.profile.email, c.profile.league].join(' ').toLowerCase().includes(s))
      .map((c) => ({ ...c, fittingCount: this.listFittings(c.id).length }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  getClient(id) { const c = this.db.clients[id]; return c && !c.deletedAt ? c : null; }
  putClient(rec) { return this._put('clients', rec); }
  deleteClient(id) { this.listFittings(id).forEach((f) => this._del('fittings', f.id)); this._del('clients', id); }

  // ---- fittings ----
  listFittings(clientId) {
    return this._live('fittings').filter((f) => f.clientId === clientId).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  getFitting(id) { const f = this.db.fittings[id]; return f && !f.deletedAt ? f : null; }
  putFitting(rec) { return this._put('fittings', rec); }
  deleteFitting(id) { this._del('fittings', id); }

  // ---- ball library ----
  listBalls() { return this._live('balls').sort((a, b) => (a.name || '').localeCompare(b.name || '')); }
  putBall(rec) { return this._put('balls', rec); }
  deleteBall(id) { this._del('balls', id); }

  // ---- backup ----
  exportAll() { return { app: 'lanelab', version: 1, exportedAt: new Date().toISOString(), ...this.db }; }
  importAll(obj, { merge = true } = {}) {
    if (!obj || obj.app !== 'lanelab') throw new Error('Not a LaneLab backup file');
    let n = 0;
    for (const k of KINDS) {
      for (const rec of Object.values(obj[k] || {})) {
        const cur = this.db[k][rec.id];
        if (!merge || !cur || (rec.updatedAt || '') > (cur.updatedAt || '')) {
          this.db[k][rec.id] = rec; n++;
          this.outbox.push({ kind: k, id: rec.id, op: 'put' });
        }
      }
    }
    this._persist(); this.flushSoon();
    return n;
  }
  clientsCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Name', 'Phone', 'Email', 'Hand', 'Average', 'League', 'Fittings', 'Last updated']];
    for (const c of this.listClients()) rows.push([c.profile.name, c.profile.phone, c.profile.email, c.profile.hand, c.profile.average, c.profile.league, c.fittingCount, c.updatedAt]);
    return rows.map((r) => r.map(esc).join(',')).join('\n');
  }

  // ---- server sync (optional) ----
  _headers() { const h = { 'Content-Type': 'application/json' }; if (this.token) h['X-LaneLab-Token'] = this.token; return h; }
  async connect() {
    if (!/^https?:$/.test(location.protocol)) { this.mode = 'local'; this.emit(); return; }
    try {
      const r = await fetch('api/health', { headers: this._headers(), cache: 'no-store' });
      if (r.status === 401) { this.mode = 'offline'; this.needsToken = true; this.emit(); return; }
      if (!r.ok) throw new Error('bad status');
      const ex = await (await fetch('api/export', { headers: this._headers() })).json();
      this.importAll(ex, { merge: true });
      this.mode = 'online';
      await this.flush();
    } catch { this.mode = 'local'; }
    this.emit();
    this._timer = this._timer || setInterval(() => { if (this.outbox.length || this.mode === 'offline') this.flush(); }, 15000);
  }
  flushSoon() { clearTimeout(this._ft); this._ft = setTimeout(() => this.flush(), 600); this.emit(); }
  async flush() {
    if (this.mode === 'local' || !/^https?:$/.test(location.protocol)) return;
    const q = this.outbox.slice();
    try {
      for (const o of q) {
        const rec = this.db[o.kind][o.id];
        if (!rec) { this.outbox = this.outbox.filter((x) => x !== o); continue; }
        const r = await fetch(`api/${o.kind}/${encodeURIComponent(o.id)}`, { method: 'PUT', headers: this._headers(), body: JSON.stringify(rec) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.outbox = this.outbox.filter((x) => !(x.kind === o.kind && x.id === o.id && x === o));
      }
      this.mode = 'online';
    } catch { this.mode = 'offline'; }
    this._persist(); this.emit();
  }
}
