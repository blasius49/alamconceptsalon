import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.mjs';
import { openBookings, dateRange, dateInSalon, validateBooking } from '../lib/bookings.mjs';

const sample = () => ({ name: 'Cliente de Teste', phone: '(47) 99999-1234', preferredDate: dateRange().max, preferredTime: '15:00', notes: 'Gostaria de conversar sobre meu cabelo.', consent: true, requestId: randomUUID() });
async function start(db, options = {}) {
  const server = createApp({ database: db, publicOrigin: '', ...options, whatsapp: { settings: { ready: false } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const stop = server => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
const post = (url, data, headers = {}) => fetch(url + '/api/agendamentos', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof data === 'string' ? data : JSON.stringify(data) });

test('cria um pedido real, não duplica reenvios e persiste após reiniciar o servidor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thais-booking-'));
  const file = join(dir, 'test.sqlite');
  let db = openBookings(file);
  let app = await start(db);
  const data = sample();
  let first;
  try {
    const response = await post(app.url, data);
    assert.equal(response.status, 201);
    first = await response.json();
    assert.match(first.protocol, /^TA-[A-F0-9]{12}$/);
    assert.equal(first.status, 'recebido');
    assert.equal('name' in first, false);
    const row = db.prepare('SELECT * FROM bookings').get();
    assert.equal(row.phone, '5547999991234');
    assert.equal(row.status, 'pendente');
    assert.ok(row.consent_at);
    const repeated = await Promise.all([post(app.url, data), post(app.url, data)]);
    for (const r of repeated) { assert.equal(r.status, 200); assert.equal((await r.json()).protocol, first.protocol); }
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n, 1);
    const conflict = await post(app.url, { ...data, name: 'Outro Nome' });
    assert.equal(conflict.status, 409);
    assert.equal(db.prepare('SELECT name FROM bookings').get().name, data.name);
  } finally { await stop(app.server); db.close(); }
  db = openBookings(file);
  app = await start(db);
  try {
    const replay = await post(app.url, data);
    assert.equal((await replay.json()).protocol, first.protocol);
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n, 1);
  } finally { await stop(app.server); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('rejeita dados inválidos, falta de consentimento e datas fora do intervalo sem gravar', async () => {
  const db = openBookings(':memory:'); const app = await start(db);
  const badInputs = [
    [{ name: '' }, 'name'], [{ phone: '1234' }, 'phone'], [{ consent: false }, 'consent'],
    [{ preferredDate: '2020-01-01' }, 'preferredDate'], [{ preferredDate: '2099-01-01' }, 'preferredDate'],
    [{ preferredDate: '2026-02-30' }, 'preferredDate'], [{ preferredTime: '15:30' }, 'preferredTime'],
    [{ notes: 'a'.repeat(1001) }, 'notes'], [{ requestId: 'no' }, 'form'],
  ];
  try {
    for (const [patch, field] of badInputs) {
      const response = await post(app.url, { ...sample(), ...patch });
      assert.equal(response.status, 422, field);
      assert.ok((await response.json()).errors[field], field);
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n, 0);
  } finally { await stop(app.server); db.close(); }
});

test('protege dados privados, valida origem e formato e limita abuso', async () => {
  const db = openBookings(':memory:'); const app = await start(db, { limit: 3 });
  try {
    for (const path of ['/data/agendamentos.sqlite', '/lib/bookings.mjs', '/README.md', '/package.json', '/.git/config', '/dist/index.html']) assert.equal((await fetch(app.url + path)).status, 404, path);
    assert.equal((await fetch(app.url + '/api/agendamentos')).status, 405);
    assert.equal((await post(app.url, sample(), { origin: 'https://outro-site.example' })).status, 403);
    assert.equal((await post(app.url, sample(), { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post(app.url, sample(), { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post(app.url, '{invalid')).status, 400);
    assert.equal((await post(app.url, { ...sample(), notes: 'x'.repeat(13000) })).status, 413);
    assert.equal((await post(app.url, sample())).status, 201);
    const limited = await post(app.url, sample());
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n, 1);
    const health = await fetch(app.url + '/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).timezone, 'America/Sao_Paulo');
    const home = await fetch(app.url);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /id="booking-form"/);
  } finally { await stop(app.server); db.close(); }
});

test('usa a data de Blumenau e aceita telefone com prefixo do Brasil', () => {
  const nearMidnight = new Date('2026-10-21T01:00:00Z');
  assert.equal(dateInSalon(nearMidnight), '2026-10-20');
  assert.deepEqual(dateRange(nearMidnight), { min: '2026-10-20', max: '2027-01-18' });
  const parsed = validateBooking({ ...sample(), phone: '+55 (47) 99999-1234', preferredDate: '2026-10-21', preferredTime: '15:00' }, nearMidnight);
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.data.phone, '5547999991234');
});
