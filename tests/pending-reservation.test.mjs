import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { postgresFixture } from './helpers-postgres.mjs';
import { createCloudHandler } from '../cloud/api.mjs';
import { dateRange } from '../lib/schedule.mjs';
import { createApp } from '../server.mjs';
import { openBookings } from '../lib/bookings.mjs';
const date=()=>dateRange().max;
const input=(time='15:00')=>({name:'TESTE Reserva de pedido',phone:'5547999990000',preferredDate:date(),preferredTime:time,notes:'Teste fictício, sem contato real.',consent:true,requestId:randomUUID()});
const request=(path,body,method=body?'POST':'GET',cookie='')=>new Request('https://salon.example'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://salon.example',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});

test('dois envios concorrentes só criam uma solicitação: pendente já reserva, reenvio não duplica nem envia outro aviso',async()=>{
 const f=await postgresFixture();try{
  const call=(...args)=>createCloudHandler({env:f.env,store:f.store})(...args);
  const first=input();const second=input();
  const before=await (await call(request('/api/horarios?date='+date()))).json();assert.ok(before.slots.some(s=>s.time==='15:00'));
  const responses=await Promise.all([call(request('/api/agendamentos',first)),call(request('/api/agendamentos',second))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const winner=responses[0].status===201?0:1;const saved=await responses[winner].json();const rejected=await responses[1-winner].json();assert.ok(rejected.errors.preferredTime);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_bookings')).rows[0].n,1);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_notifications')).rows[0].n,1);
  const retry=await call(request('/api/agendamentos',winner===0?first:second));assert.equal(retry.status,200);assert.equal((await retry.json()).protocol,saved.protocol);
  const availability=await (await call(request('/api/horarios?date='+date()))).json();assert.ok(!availability.slots.some(s=>s.time==='15:00'));assert.ok(!JSON.stringify(availability).includes(saved.protocol));assert.ok(!JSON.stringify(availability).includes(first.name));
  assert.equal((await call(request('/api/agendamentos',input()))).status,409);
  const row=(await f.store.agenda(date())).bookings[0];assert.equal(row.status,'pendente');assert.equal(row.notification.status,'not_configured');
  const login=await call(request('/api/admin/session',{password:f.env.ADMIN_PASSWORD}));const cookie=login.headers.get('set-cookie').split(';')[0];
  const agenda=await (await call(request('/api/admin/agenda?date='+date(),null,'GET',cookie))).json();assert.equal(agenda.slots.find(s=>s.time==='15:00').occupied,true);
  assert.equal((await f.store.setSlotBlock({date:date(),time:'15:00',blocked:true,reason:'',expectedVersion:0})).error,'occupied');
  await f.store.updateBookingStatus(saved.protocol,'em_contato',1);
  assert.equal((await f.store.createBooking(input(),false)).error,'unavailable');
  await f.store.updateBookingStatus(saved.protocol,'reagendar',2);
  assert.ok((await (await call(request('/api/horarios?date='+date()))).json()).slots.some(s=>s.time==='15:00'));
  const next=await f.store.createBooking(input(),false);assert.ok(next.created);
  // Uma reativação também precisa respeitar a vaga já reservada por outro cliente.
  for(const status of ['pendente','em_contato','confirmado','concluido'])assert.equal((await f.store.updateBookingStatus(saved.protocol,status,3)).error,'unavailable');
  assert.equal((await f.store.listBookings(saved.protocol,'',1)).items[0].status,'reagendar');
  const moved=await f.store.rescheduleBooking(saved.protocol,{date:date(),time:'17:00',status:'em_contato',expectedVersion:3});assert.equal(moved.booking.preferredTime,'17:00');
  assert.equal((await f.store.createBooking(input('17:00'),false)).error,'unavailable');
  await f.store.updateBookingStatus(saved.protocol,'cancelado',4);
  assert.ok((await f.store.createBooking(input('17:00'),false)).created);
 }finally{await f.close();}
});

test('migração 004 conserva duplicados existentes e exige resolução manual; reaplicar não cancela, apaga ou duplica nada',async()=>{
 const v3=await readFile(new URL('./fixtures/supabase-v3.sql',import.meta.url),'utf8');
 const migration=await readFile(new URL('../supabase/migrations/004-reservar-pedido-pendente.sql',import.meta.url),'utf8');
 const f=await postgresFixture({schemaText:v3});try{
  const a=(await f.store.createBooking(input(),false)).booking.protocol;const b=(await f.store.createBooking(input(),false)).booking.protocol;
  const h=createCloudHandler({env:f.env,store:f.store});
  assert.equal((await h(request('/api/health'))).status,503);assert.equal((await h(request('/api/horarios?date='+date()))).status,503);
  await f.db.exec(migration);await f.db.exec(migration);
  assert.equal((await f.store.health()).schemaVersion,4);assert.equal((await f.store.availability(date())).reservationPolicy,'request-v1');
  const rows=(await f.store.listBookings('','',1)).items;assert.equal(rows.length,2);assert.ok(rows.every(row=>row.status==='pendente'&&row.version===1&&row.notification.status==='not_configured'));
  assert.equal((await f.store.createBooking(input(),false)).error,'unavailable');
  assert.equal((await f.store.updateBookingStatus(a,'confirmado',1)).error,'unavailable');
  await f.store.updateBookingStatus(b,'cancelado',1);
  assert.equal((await f.store.createBooking(input(),false)).error,'unavailable');
  assert.equal((await f.store.updateBookingStatus(a,'confirmado',1)).booking.status,'confirmado');
  await f.store.updateBookingStatus(a,'cancelado',2);
  assert.ok((await f.store.createBooking(input(),false)).created);
  await f.db.exec(migration);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_bookings')).rows[0].n,3);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_notifications')).rows[0].n,3);
  for(const name of ['salon_slot_taken(date,time,bigint)','salon_availability(date)','salon_set_slot_block(date,time,boolean,text,integer)','salon_update_booking_status(text,text,integer)','salon_health()'])for(const role of ['anon','authenticated'])assert.equal((await f.db.query('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,name,'EXECUTE'])).rows[0].allowed,false);
 }finally{await f.close();}
});

test('API local reserva ao receber, mantém durante contato e libera somente após cancelar ou reagendar',async()=>{
 const db=openBookings(':memory:');const server=createApp({database:db,publicOrigin:'',admin:{password:'Senha exclusiva de teste!'},whatsapp:{settings:{ready:false}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,body,method=body?'POST':'GET',cookie='')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const first=input();const responses=await Promise.all([call('/api/agendamentos',first),call('/api/agendamentos',input())]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const index=responses.findIndex(r=>r.status===201);const saved=await responses[index].json();assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
  if(index===0)assert.equal((await call('/api/agendamentos',first)).status,200);
  const slots=await (await call('/api/horarios?date='+date())).json();assert.ok(!slots.slots.some(s=>s.time==='15:00'));
  const login=await call('/api/admin/session',{password:'Senha exclusiva de teste!'});const cookie=login.headers.get('set-cookie').split(';')[0];
  const status=`/api/admin/bookings/${saved.protocol}/status`;
  assert.equal((await call(status,{status:'em_contato',expectedVersion:1},'PATCH',cookie)).status,200);
  assert.equal((await call('/api/agendamentos',input())).status,409);
  assert.equal((await call(status,{status:'cancelado',expectedVersion:2},'PATCH',cookie)).status,200);
  assert.equal((await call('/api/agendamentos',input())).status,201);
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();}
});
