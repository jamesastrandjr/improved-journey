import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

test('data bank API: CRUD, newest-wins, export/import, auth', async () => {
  const srv = createServer({ dbFile: ':memory:', token: 'abc' });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const H = { 'X-LaneLab-Token': 'abc', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/health')).status, 401);
  const rec = { id: 'c1', profile: { name: 'Pat Smith', phone: '555' }, createdAt: 'x', updatedAt: '2026-01-02T00:00:00Z' };
  assert.equal((await fetch(base + '/api/clients/c1', { method: 'PUT', headers: H, body: JSON.stringify(rec) })).status, 200);
  // older write must not overwrite newer
  await fetch(base + '/api/clients/c1', { method: 'PUT', headers: H, body: JSON.stringify({ ...rec, profile: { name: 'OLD' }, updatedAt: '2025-01-01T00:00:00Z' }) });
  assert.equal((await (await fetch(base + '/api/clients/c1', { headers: H })).json()).profile.name, 'Pat Smith');
  assert.equal((await (await fetch(base + '/api/clients?q=pat', { headers: H })).json()).length, 1);
  assert.equal((await fetch(base + '/api/clients/bad id!', { method: 'PUT', headers: H, body: '{}' })).status, 400);
  const ex = await (await fetch(base + '/api/export', { headers: H })).json();
  assert.equal(ex.clients.c1.profile.name, 'Pat Smith');
  await fetch(base + '/api/clients/c1', { method: 'DELETE', headers: H });
  assert.equal((await fetch(base + '/api/clients/c1', { headers: H })).status, 404);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
  srv.close();
});
