import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openBookings, dateRange } from '../lib/bookings.mjs';
import { createApp } from '../server.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashPassword } from '../lib/admin.mjs';

const password = 'Senha somente para teste 2026!';
const payload = () => ({ name: 'TESTE — demonstração', phone: '(47) 99999-0000', preferredDate: dateRange().max, preferredTime: '15:00', notes: '<script>Este texto precisa ser exibido como texto, sem executar.</script>', consent: true, requestId: randomUUID() });
async function fixture(admin = { password }, fn) {
  const db = openBookings(':memory:'); const server = createApp({ database: db, publicOrigin: '', admin, whatsapp: { settings: { ready: false } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`, db); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); db.close(); }
}
const login = (url, value, extraHeaders = {}) => fetch(url + '/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify({ password: value }) });

test('pedido enviado pelo formulário é consultável apenas no painel autenticado e pode ser localizado pelo protocolo', async () => {
  await fixture(undefined, async (url, db) => {
    const response = await fetch(url + '/api/agendamentos', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload()) });
    assert.equal(response.status, 201);
    const { protocol } = await response.json();
    assert.equal((await fetch(url + '/api/admin/bookings')).status, 401);
    assert.equal((await login(url, 'senha errada')).status, 401);
    const session = await login(url, password, { Origin: url });
    assert.equal(session.status, 200);
    const setCookie = session.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    const result = await fetch(url + `/api/admin/bookings?q=${protocol}`, { headers: { cookie } });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const data = await result.json();
    assert.equal(data.total, 1); assert.equal(data.items[0].protocol, protocol); assert.equal(data.items[0].name, 'TESTE — demonstração');
    assert.equal(data.items[0].status, 'pendente'); assert.equal(data.items[0].preferredTime, '15:00'); assert.equal(data.summary.pendente, 1);
    assert.equal('request_id' in data.items[0], false); assert.equal('payload_hash' in data.items[0], false);
    assert.equal((await (await fetch(url + '/api/admin/bookings?status=concluido', { headers: { cookie } })).json()).total, 0);
    assert.equal((await (await fetch(url + '/api/admin/bookings?q=%25', { headers: { cookie } })).json()).total, 0);
    assert.equal((await fetch(url + '/api/admin/bookings?page=-1', { headers: { cookie } })).status, 422);
    const shell = await fetch(url + '/admin');
    assert.equal(shell.status, 200); assert.equal(shell.headers.get('cache-control'), 'no-store'); assert.equal((await shell.text()).includes(protocol), false);
    assert.equal((await fetch(url + '/data/admin-auth.json')).status, 404);
    assert.equal((await fetch(url + '/api/admin/session', { method:'DELETE', headers:{cookie,Origin:'https://outro.example'} })).status, 403);
    assert.equal((await fetch(url + '/api/admin/session', { method:'DELETE', headers:{cookie,Origin:url} })).status, 200);
    assert.equal((await fetch(url + '/api/admin/bookings', { headers:{cookie} })).status, 401);
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n, 1);
  });
});

test('painel sem senha fica bloqueado e login tem limite de tentativas', async () => {
  await fixture({ password:'', authFile:join(tmpdir(),randomUUID()+'.json') }, async url => {
    const session = await (await fetch(url + '/api/admin/session')).json();
    assert.equal(session.configured, false); assert.equal(session.authenticated, false);
    assert.equal((await login(url,password)).status, 503);
    assert.equal((await fetch(url+'/api/admin/bookings')).status,401);
  });
  await fixture(undefined, async url => {
    assert.equal((await login(url,password,{Origin:'https://outro.example'})).status,403);
    for(let i=0;i<5;i++)assert.equal((await login(url,'incorreta')).status,401);
    const limited = await login(url,password);
    assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  });
});

test('senha persistida como hash permite login e cookie seguro é configurável', async () => {
  const directory = mkdtempSync(join(tmpdir(),'thais-admin-'));
  const file = join(directory,'admin-auth.json');
  const credential = hashPassword(password);
  assert.ok(!JSON.stringify(credential).includes(password));
  writeFileSync(file,JSON.stringify(credential),{mode:0o600});
  try {
    await fixture({ password:'', authFile:file, secureCookies:true },async url=>{
      const response = await login(url,password);
      assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/; Secure/);
    });
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
