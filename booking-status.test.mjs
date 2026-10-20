import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { postgresFixture } from './helpers-postgres.mjs';
import { createCloudHandler } from '../cloud/api.mjs';
import { dateRange } from '../lib/schedule.mjs';
import { openBookings } from '../lib/bookings.mjs';
import { updateBookingStatus } from '../lib/admin.mjs';
import { createApp } from '../server.mjs';

const input=()=>({name:'TESTE Situação',phone:'47999990000',preferredDate:dateRange().max,preferredTime:'15:00',notes:'Teste sem contatos reais',consent:true,requestId:randomUUID()});
const req=(path,body,method='POST',cookie='',origin='https://salon.example')=>new Request('https://salon.example'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});

test('situação salva no PostgreSQL aparece em novas instâncias, filtros e contadores; concorrência não sobrescreve',async()=>{
 const f=await postgresFixture();try{
  const handle=()=>createCloudHandler({env:f.env,store:f.store});
  const first=await handle()(req('/api/agendamentos',input()),{ip:'test'});const {protocol}=await first.json();const route=`/api/admin/bookings/${protocol}/status`;
  const login=await handle()(req('/api/admin/session',{password:f.env.ADMIN_PASSWORD}),{ip:'test'});const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await handle()(req(route,{status:'confirmado',expectedVersion:1},'PATCH'))).status,401);
  assert.equal((await handle()(req(route,{status:'confirmado',expectedVersion:1},'PATCH',cookie,'https://outro.example'))).status,403);
  assert.equal((await handle()(req(route,{status:'__proto__',expectedVersion:1},'PATCH',cookie))).status,422);
  assert.equal((await handle()(req(route,{status:'confirmado'},'PATCH',cookie))).status,422);
  const saved=await handle()(req(route,{status:'confirmado',expectedVersion:1},'PATCH',cookie),{ip:'test'});assert.equal(saved.status,200);assert.equal((await saved.json()).booking.version,2);
  const stale=await handle()(req(route,{status:'cancelado',expectedVersion:1},'PATCH',cookie),{ip:'test'});assert.equal(stale.status,409);assert.equal((await stale.json()).booking.status,'confirmado');
  const list=await handle()(req('/api/admin/bookings?status=confirmado',null,'GET',cookie));const result=await list.json();assert.equal(result.total,1);assert.equal(result.items[0].status,'confirmado');assert.equal(result.summary.confirmado,1);assert.equal(result.summary.pendente,0);assert.equal(result.items[0].version,2);
  assert.equal((await handle()(req(route,{status:'reagendar',expectedVersion:2},'PATCH',cookie),{ip:'test'})).status,200);
  const final=await f.store.listBookings('','reagendar',1);assert.equal(final.items[0].version,3);assert.equal(final.summary.reagendar,1);
  assert.equal((await f.db.query('SELECT status FROM salon_notifications')).rows[0].status,'not_configured');
  assert.equal((await handle()(req('/api/admin/bookings/TA-FFFFFFFFFFFF/status',{status:'confirmado',expectedVersion:1},'PATCH',cookie),{ip:'test'})).status,404);
  await f.db.exec('SET ROLE anon');await assert.rejects(f.db.query('SELECT salon_update_booking_status($1,$2,$3)',[protocol,'cancelado',3]),/permission denied/);await f.db.exec('RESET ROLE');
 }finally{await f.close();}
});

test('migração Supabase mantém pedidos, protocolos e avisos e pode ser reaplicada',async()=>{
 const old=await readFile(new URL('./fixtures/supabase-v1.sql',import.meta.url),'utf8');
 const migration=await readFile(new URL('../supabase/migrations/002-booking-status.sql',import.meta.url),'utf8');
 const f=await postgresFixture({schemaText:old});try{
  const body=input();const result=await f.store.createBooking({...body,phone:'5547999990000'},false);const protocol=result.booking.protocol;
  await f.db.exec(migration);await f.db.exec(migration);
  const items=await f.store.listBookings(protocol,'pendente',1);assert.equal(items.total,1);assert.equal(items.items[0].version,1);
  const updated=await f.store.updateBookingStatus(protocol,'confirmado',1);assert.equal(updated.booking.status,'confirmado');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_bookings')).rows[0].n,1);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM salon_notifications')).rows[0].n,1);
 }finally{await f.close();}
});

test('migração SQLite mantém dados, colunas extras, notificações e gatilhos; alterações persistem após reabrir',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'thais-status-'));const file=path.join(dir,'old.sqlite');
 const old=new DatabaseSync(file);
 old.exec(`CREATE TABLE bookings (id INTEGER PRIMARY KEY,protocol TEXT UNIQUE,request_id TEXT UNIQUE,payload_hash TEXT,name TEXT,phone TEXT,preferred_date TEXT,period TEXT,notes TEXT,consent_at TEXT,consent_version TEXT,status TEXT CHECK(status IN ('pendente','em_contato','concluido','cancelado')),created_at TEXT,updated_at TEXT,preferred_time TEXT,custom_note TEXT);
 INSERT INTO bookings VALUES(7,'TA-123456789ABC','req','hash','Cliente antigo','5547999990000','2026-10-25','tarde','Preservar','now','v1','pendente','now','now','15:00','Campo local preservado');
 CREATE TABLE booking_notifications(id INTEGER PRIMARY KEY,booking_id INTEGER REFERENCES bookings(id),status TEXT,provider_id TEXT,error_code TEXT,created_at TEXT,updated_at TEXT);
 INSERT INTO booking_notifications VALUES(10,7,'not_configured',NULL,NULL,'now','now');
 CREATE TABLE audit (value TEXT); CREATE TRIGGER user_status_audit AFTER UPDATE OF status ON bookings BEGIN INSERT INTO audit VALUES(new.status); END;`);old.close();
 let db=openBookings(file);
 try{
  assert.equal(db.prepare('SELECT custom_note FROM bookings').get().custom_note,'Campo local preservado');assert.equal(db.prepare('SELECT booking_id FROM booking_notifications').get().booking_id,7);
  const result=updateBookingStatus(db,'TA-123456789ABC','confirmado',1);assert.equal(result.booking.version,2);assert.equal(db.prepare('SELECT value FROM audit').get().value,'confirmado');
  assert.equal(updateBookingStatus(db,'TA-123456789ABC','cancelado',1).error,'conflict');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.close();db=openBookings(file);assert.equal(db.prepare('SELECT status FROM bookings').get().status,'confirmado');assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('API local também exige sessão e salva a situação com controle de versão',async()=>{
 const db=openBookings(':memory:');const password='Senha para testar alteração!';const server=createApp({database:db,publicOrigin:'',admin:{password},whatsapp:{settings:{ready:false}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const send=(url,body,method='POST',cookie='')=>fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base},body:JSON.stringify(body)});
 try{
  const booking=await (await send('/api/agendamentos',input())).json();const route=`/api/admin/bookings/${booking.protocol}/status`;
  assert.equal((await send(route,{status:'confirmado',expectedVersion:1},'PATCH')).status,401);
  const login=await send('/api/admin/session',{password});const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await send(route,{status:'confirmado',expectedVersion:1},'PATCH',cookie)).status,200);assert.equal(db.prepare('SELECT status FROM bookings').get().status,'confirmado');
  assert.equal((await send(route,{status:'cancelado',expectedVersion:1},'PATCH',cookie)).status,409);
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});db.close();}
});
