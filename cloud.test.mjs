import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCloudHandler } from '../cloud/api.mjs';
import { SupabaseStore } from '../cloud/store.mjs';
import { dateRange } from '../lib/schedule.mjs';
import { postgresFixture } from './helpers-postgres.mjs';
const payload=()=>({name:'TESTE — Supabase',phone:'47999990000',preferredDate:dateRange().max,preferredTime:'15:00',notes:'Dados fictícios. <script>não executar</script>',consent:true,requestId:randomUUID()});
const request=(path,body,extra={})=>new Request('https://salon.example'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(body===undefined?{}:{Origin:'https://salon.example'}),...extra.headers},...(body===undefined?{}:{body:JSON.stringify(body)}),...extra});

test('Functions e PostgreSQL real: pedido, idempotência, painel entre instâncias e logout',async()=>{
 const f=await postgresFixture();
 try{
  const handler=()=>createCloudHandler({env:f.env,store:new SupabaseStore({env:f.env,fetchImpl:f.fetchImpl})});
  const body=payload();const r=await handler()(request('/api/agendamentos',body),{ip:'127.0.0.1'});assert.equal(r.status,201);
  const first=await r.json();assert.match(first.protocol,/^TA-/);assert.equal(first.notification.status,'not_configured');
  const replay=await handler()(request('/api/agendamentos',body),{ip:'127.0.0.1'});assert.equal(replay.status,200);assert.equal((await replay.json()).protocol,first.protocol);
  assert.equal((await handler()(request('/api/agendamentos',{...body,name:'Outro nome'}),{ip:'127.0.0.1'})).status,409);
  assert.equal((await handler()(request('/api/admin/bookings'))).status,401);
  const login=await handler()(request('/api/admin/session',{password:f.env.ADMIN_PASSWORD}),{ip:'127.0.0.1'});assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/; Secure/);
  const cookie=setCookie.split(';')[0];
  const listed=await handler()(request('/api/admin/bookings?q='+first.protocol,undefined,{headers:{cookie}}));assert.equal(listed.status,200);
  const results=await listed.json();assert.equal(results.total,1);assert.equal(results.items[0].protocol,first.protocol);assert.equal(results.items[0].preferredTime,'15:00');assert.equal(results.items[0].name,body.name);
  assert.equal(results.summary.pendente,1);assert.equal('request_id' in results.items[0],false);
  const rows=await f.db.query('SELECT * FROM salon_sessions');assert.equal(rows.rows.length,1);assert.notEqual(rows.rows[0].token_hash,cookie.split('=')[1]);
  const changed=createCloudHandler({env:{...f.env,ADMIN_PASSWORD:'Senha diferente para rotação!'},store:f.store});
  assert.equal((await changed(request('/api/admin/bookings',undefined,{headers:{cookie}}))).status,401);
  const logout=await handler()(request('/api/admin/session',undefined,{method:'DELETE',headers:{cookie,Origin:'https://salon.example'}}));assert.equal(logout.status,200);
  assert.equal((await handler()(request('/api/admin/bookings',undefined,{headers:{cookie}}))).status,401);
  const count=await f.db.query('SELECT count(*)::int AS n FROM salon_bookings');assert.equal(count.rows[0].n,1);
 }finally{await f.close();}
});

test('RLS e permissões impedem acesso com chaves públicas; reaplicar SQL preserva pedidos',async()=>{
 const f=await postgresFixture();try{
  const h=createCloudHandler({env:f.env,store:f.store});await h(request('/api/agendamentos',payload()),{ip:'test'});
  await f.db.exec(f.schema);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_bookings')).rows[0].n,1);
  await f.db.exec('SET ROLE anon');
  await assert.rejects(f.db.query('SELECT * FROM public.salon_bookings'),/permission denied/);
  await assert.rejects(f.db.query('SELECT public.salon_list_bookings()'),/permission denied/);
  await f.db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(f.db.query('SELECT * FROM public.salon_sessions'),/permission denied/);
  await assert.rejects(f.db.query('SELECT public.salon_create_booking($1,$2,$3,$4)',[JSON.stringify(payload()),'hash','TA-TEST',false]),/permission denied/);
  await f.db.exec('RESET ROLE; SET ROLE service_role');
  assert.equal((await f.db.query('SELECT public.salon_health() AS result')).rows[0].result.status,'ok');
  await f.db.exec('RESET ROLE');
 }finally{await f.close();}
});

test('validação, proteção de origem e limite de login persistem entre Functions',async()=>{
 const f=await postgresFixture();try{
  const next=()=>createCloudHandler({env:f.env,store:f.store});
  assert.equal((await next()(request('/api/agendamentos',{...payload(),consent:false}),{ip:'A'})).status,422);
  assert.equal((await next()(request('/api/agendamentos',{...payload(),preferredTime:'15:30'}),{ip:'A'})).status,422);
  assert.equal((await next()(request('/api/agendamentos',payload(),{headers:{Origin:'https://other.example'}}),{ip:'A'})).status,403);
  assert.equal((await next()(request('/api/agendamentos',payload(),{headers:{'content-type':'text/plain'}}),{ip:'A'})).status,415);
  assert.equal((await next()(request('/api/agendamentos',{...payload(),notes:'x'.repeat(13000)}),{ip:'A'})).status,413);
  for(let n=0;n<5;n++)assert.equal((await next()(request('/api/admin/session',{password:'errada'}),{ip:'B'})).status,401);
  const limited=await next()(request('/api/admin/session',{password:f.env.ADMIN_PASSWORD}),{ip:'B'});assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_bookings')).rows[0].n,0);
 }finally{await f.close();}
});

test('sem Supabase a API recusa salvar, sem simular sucesso; chaves secretas nunca vão ao frontend',async()=>{
 const env={};const h=createCloudHandler({env});
 assert.equal((await h(request('/api/agendamentos',payload()))).status,503);
 assert.equal((await h(request('/api/health'))).status,503);
 assert.deepEqual(await (await h(request('/api/admin/session'))).json(),{configured:false,authenticated:false});
 const f=await postgresFixture();try{await f.store.health();assert.equal(f.calls[0].headers.apikey,f.env.SUPABASE_SECRET_KEY);assert.equal(f.calls[0].headers.Authorization,undefined);}finally{await f.close();}
});
