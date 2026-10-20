import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { postgresFixture } from './helpers-postgres.mjs';
import { createCloudHandler } from '../cloud/api.mjs';
import { dateRange, daySlots, hourSlots } from '../lib/schedule.mjs';
import { openBookings, saveBooking } from '../lib/bookings.mjs';
import { agendaData, changeBooking, setSlotBlock } from '../lib/agenda-sqlite.mjs';
import { freeSlots, calendarView, validBlock, validReschedule } from '../lib/agenda.mjs';
import { createApp } from '../server.mjs';
const date=()=>dateRange().max;
const booking=(time='15:00')=>({name:'TESTE Cliente da agenda',phone:'5547999990000',preferredDate:date(),preferredTime:time,period:'tarde',notes:'Dados fictícios; não contatar.',consent:true,requestId:randomUUID()});
const request=(route,body,method='GET',cookie='',origin='https://salon.example')=>new Request('https://salon.example'+route,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
async function login(f){const response=await createCloudHandler({env:f.env,store:f.store})(request('/api/admin/session',{password:f.env.ADMIN_PASSWORD},'POST'),{ip:'fixture'});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}

test('agenda Supabase: bloqueio persistente, disponibilidade pública sem dados pessoais e proteção contra edições simultâneas',async()=>{
 const f=await postgresFixture();try{
  const call=(...args)=>createCloudHandler({env:f.env,store:f.store})(...args);
  const cookie=await login(f);const route='/api/admin/agenda?date='+date();
  assert.equal((await call(request(route))).status,401);
  assert.equal((await call(request('/api/admin/agenda?date=2026-02-30',null,'GET',cookie))).status,422);
  const input={date:date(),time:'15:00',blocked:true,reason:'Compromisso interno',expectedVersion:0};
  assert.equal((await call(request('/api/admin/agenda/slot',input,'PATCH'))).status,401);
  assert.equal((await call(request('/api/admin/agenda/slot',input,'PATCH',cookie,'https://outro.example'))).status,403);
  assert.equal((await call(request('/api/admin/agenda/slot',input,'PATCH',cookie))).status,200);
  let publicData=await (await call(request('/api/horarios?date='+date()))).json();assert.ok(!publicData.slots.some(s=>s.time==='15:00'));assert.ok(!JSON.stringify(publicData).includes('Compromisso'));
  const denied=await call(request('/api/agendamentos',booking(),'POST'));assert.equal(denied.status,409);assert.ok((await denied.json()).errors.preferredTime);
  const data=await (await call(request(route,null,'GET',cookie))).json();const slot=data.slots.find(s=>s.time==='15:00');assert.equal(slot.blocked,true);assert.equal(slot.version,1);assert.equal(slot.reason,'Compromisso interno');
  assert.equal((await call(request('/api/admin/agenda/slot',{...input,blocked:false},'PATCH',cookie))).status,409);
  assert.equal((await call(request('/api/admin/agenda/slot',{...input,blocked:false,expectedVersion:1},'PATCH',cookie))).status,200);
  publicData=await (await call(request('/api/horarios?date='+date()))).json();assert.ok(publicData.slots.some(s=>s.time==='15:00'));
  assert.equal((await f.store.setSlotBlock({...input,reason:'x'.repeat(201),expectedVersion:2})).error,'invalid_slot');
  const sql='SELECT has_function_privilege($1,$2,$3) AS allowed';
  for(const role of ['anon','authenticated'])for(const fn of ['salon_agenda(date)','salon_availability(date)','salon_set_slot_block(date,time,boolean,text,integer)','salon_reschedule_booking(text,date,time,text,integer)','salon_booking_json(bigint)'])assert.equal((await f.db.query(sql,[role,fn,'EXECUTE'])).rows[0].allowed,false);
  await f.db.exec('SET ROLE anon');for(const table of ['salon_slot_blocks','salon_reschedules','salon_agenda_lock'])await assert.rejects(f.db.query('SELECT * FROM '+table),/permission denied/);await f.db.exec('RESET ROLE');
 }finally{await f.close();}
});

test('confirmação e reagendamento Supabase são atômicos: só um confirmado por vaga, histórico e protocolo preservados',async()=>{
 const f=await postgresFixture();try{
  const cookie=await login(f);const call=(route,body,method='GET')=>createCloudHandler({env:f.env,store:f.store})(request(route,body,method,cookie),{ip:'fixture'});
  const original=booking();const first=await f.store.createBooking(original,false);const second=await f.store.createBooking(booking(),false);
  const a=first.booking.protocol;const b=second.booking.protocol;
  const results=await Promise.all([f.store.updateBookingStatus(a,'confirmado',1),f.store.updateBookingStatus(b,'confirmado',1)]);
  assert.equal(results.filter(r=>r.booking).length,1);assert.equal(results.filter(r=>r.error==='unavailable').length,1);
  const winner=results[0].booking?a:b;const loser=winner===a?b:a;
  assert.equal((await f.store.setSlotBlock({date:date(),time:'15:00',blocked:true,reason:'',expectedVersion:0})).error,'occupied');
  const retry=await f.store.createBooking(original,false);assert.equal(retry.created,false);assert.equal(retry.booking.protocol,a);
  assert.equal((await f.store.createBooking(booking(),false)).error,'unavailable');
  assert.equal((await f.store.rescheduleBooking(loser,{date:date(),time:'15:00',status:'confirmado',expectedVersion:1})).error,'unavailable');
  await f.store.setSlotBlock({date:date(),time:'16:00',blocked:true,reason:'Interno',expectedVersion:0});
  assert.equal((await f.store.rescheduleBooking(winner,{date:date(),time:'16:00',status:'confirmado',expectedVersion:2})).error,'unavailable');
  assert.equal((await call(`/api/admin/bookings/${winner}/reschedule`,{date:date(),time:'14:30',status:'confirmado',expectedVersion:2},'PATCH')).status,422);
  const result=await call(`/api/admin/bookings/${winner}/reschedule`,{date:date(),time:'17:00',status:'confirmado',expectedVersion:2},'PATCH');assert.equal(result.status,200);const updated=(await result.json()).booking;
  assert.equal(updated.protocol,winner);assert.equal(updated.preferredTime,'17:00');assert.equal(updated.version,3);assert.equal(updated.history.length,1);assert.equal(updated.history[0].fromTime,'15:00');
  const stale=await call(`/api/admin/bookings/${winner}/reschedule`,{date:date(),time:'18:00',status:'confirmado',expectedVersion:2},'PATCH');assert.equal(stale.status,409);assert.equal((await stale.json()).booking.preferredTime,'17:00');
  const agenda=await (await call('/api/admin/agenda?date='+date())).json();assert.equal(agenda.slots.find(s=>s.time==='17:00').bookings[0].protocol,winner);assert.ok(!agenda.slots.find(s=>s.time==='15:00').occupied);
  const times=await (await call('/api/horarios?date='+date())).json();assert.ok(times.slots.some(s=>s.time==='15:00'));assert.ok(!times.slots.some(s=>s.time==='17:00'));assert.ok(!JSON.stringify(times).includes(winner));assert.ok(!JSON.stringify(times).includes(original.name));
  assert.equal((await f.store.listBookings(winner,'confirmado',1)).items[0].history.length,1);
  assert.deepEqual((await f.db.query('SELECT status FROM salon_notifications')).rows.map(r=>r.status),['not_configured','not_configured']);
  assert.equal((await f.store.rescheduleBooking('TA-FFFFFFFFFFFF',{date:date(),time:'18:00',status:'confirmado',expectedVersion:1})).error,'not_found');
 }finally{await f.close();}
});

test('migração 003 aceita versão original e pode reaplicar sem apagar pedidos, bloqueios ou histórico',async()=>{
 const old=await readFile(new URL('./fixtures/supabase-v1.sql',import.meta.url),'utf8');
 const migration=await readFile(new URL('../supabase/migrations/003-agenda-reagendamento.sql',import.meta.url),'utf8');
 const f=await postgresFixture({schemaText:old});try{
  const oldBooking=await f.store.createBooking(booking(),false);const protocol=oldBooking.booking.protocol;
  await f.db.exec(migration);assert.equal((await f.store.health()).schemaVersion,3);
  await f.store.updateBookingStatus(protocol,'confirmado',1);
  await f.store.rescheduleBooking(protocol,{date:date(),time:'16:00',status:'confirmado',expectedVersion:2});
  await f.store.setSlotBlock({date:date(),time:'18:00',blocked:true,reason:'Preservar',expectedVersion:0});
  await f.db.exec(migration);
  const row=(await f.store.listBookings(protocol,'confirmado',1)).items[0];assert.equal(row.preferredTime,'16:00');assert.equal(row.version,3);assert.equal(row.history.length,1);
  assert.equal((await f.store.agenda(date())).blocks[0].reason,'Preservar');assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_notifications')).rows[0].n,1);
 }finally{await f.close();}
});

test('agenda local persiste bloqueios e reagendamentos, rejeita vaga ocupada e aceita reenvio idempotente',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'thais-agenda-'));const file=path.join(dir,'agenda.sqlite');let db=openBookings(file);
 try{
  const input=booking();const a=saveBooking(db,input).booking.protocol;const b=saveBooking(db,booking()).booking.protocol;
  assert.ok(changeBooking(db,a,{status:'confirmado',expectedVersion:1}).booking);
  assert.equal(changeBooking(db,b,{status:'confirmado',expectedVersion:1}).error,'unavailable');
  assert.equal(saveBooking(db,input).booking.protocol,a);
  assert.equal(saveBooking(db,booking()).error,'unavailable');
  assert.equal(setSlotBlock(db,{date:date(),time:'15:00',blocked:true,reason:'',expectedVersion:0}).error,'occupied');
  assert.ok(setSlotBlock(db,{date:date(),time:'16:00',blocked:true,reason:'Motivo interno',expectedVersion:0}).ok);
  assert.equal(changeBooking(db,a,{date:date(),time:'16:00',status:'confirmado',expectedVersion:2},{reschedule:true}).error,'unavailable');
  const updated=changeBooking(db,a,{date:date(),time:'17:00',status:'confirmado',expectedVersion:2},{reschedule:true});assert.equal(updated.booking.history.length,1);
  db.close();db=openBookings(file);const data=agendaData(db,date());assert.equal(data.bookings.find(r=>r.protocol===a).preferredTime,'17:00');assert.ok(data.blocks[0].blocked);
  assert.ok(!freeSlots(date(),data).some(s=>['16:00','17:00'].includes(s.time)));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('agenda local via HTTP exige sessão, esconde cliente no público e valida bloqueios e reagendamentos',async()=>{
 const db=openBookings(':memory:');const password='Senha de teste da agenda!';const server=createApp({database:db,publicOrigin:'',admin:{password},whatsapp:{settings:{ready:false}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const send=(route,body,method='GET',cookie='')=>fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await send('/api/admin/agenda?date='+date())).status,401);
  const login=await send('/api/admin/session',{password},'POST');const cookie=login.headers.get('set-cookie').split(';')[0];
  const item=await (await send('/api/agendamentos',booking(),'POST')).json();
  assert.equal((await send('/api/admin/agenda/slot',{date:date(),time:'16:00',blocked:true,reason:'',expectedVersion:0},'PATCH',cookie)).status,200);
  const route=`/api/admin/bookings/${item.protocol}/reschedule`;
  assert.equal((await send(route,{date:date(),time:'16:00',status:'confirmado',expectedVersion:1},'PATCH',cookie)).status,409);
  assert.equal((await send(route,{date:date(),time:'17:00',status:'confirmado',expectedVersion:1},'PATCH',cookie)).status,200);
  const agenda=await (await send('/api/admin/agenda?date='+date(),null,'GET',cookie)).json();assert.equal(agenda.slots.find(s=>s.time==='17:00').bookings[0].protocol,item.protocol);
  const publicData=await (await send('/api/horarios?date='+date())).json();assert.ok(!JSON.stringify(publicData).includes(item.protocol));assert.ok(!publicData.slots.some(s=>['16:00','17:00'].includes(s.time)));
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});db.close();}
});

test('agenda diária inclui horários já passados e respeita domingo e janelas inteiras de uma hora',()=>{
 const now=new Date('2026-10-20T20:30:00Z');const data={blocks:[],bookings:[]};
 const calendar=calendarView('2026-10-20',data,now);assert.equal(calendar.slots.length,12);assert.equal(calendar.slots[0].past,true);assert.equal(calendar.slots.at(-1).past,false);
 assert.deepEqual(daySlots('2026-10-25').map(s=>s.time),['14:00','15:00','16:00','17:00','18:00']);
 assert.equal(daySlots('2026-02-30').length,0);assert.ok(!validBlock({date:'2026-10-20',time:'09:00',blocked:true,reason:'',expectedVersion:0},now));
 assert.ok(!validReschedule({date:'2026-10-25',time:'19:00',status:'confirmado',expectedVersion:1},now));
 assert.ok(hourSlots('2026-10-20',now).every(s=>Number(s.time.slice(0,2))>=18));
});
