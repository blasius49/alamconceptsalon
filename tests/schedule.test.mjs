import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourSlots } from '../lib/schedule.mjs';
import { validateBooking, openBookings } from '../lib/bookings.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const now = new Date('2026-10-20T15:30:00Z');
test('segunda a sábado oferecem janelas completas de hora em hora das 9h às 21h', () => {
 const slots = hourSlots('2026-10-21', now);
 assert.equal(slots.length, 12); assert.equal(slots[0].time,'09:00'); assert.equal(slots.at(-1).time,'20:00');
 assert.equal(slots.at(-1).label,'20:00 – 21:00');
});
test('domingo respeita abertura 14h e fechamento 19h30, sem janela de 19h a 20h', () => {
 const slots = hourSlots('2026-10-25', now);
 assert.deepEqual(slots.map(slot=>slot.time),['14:00','15:00','16:00','17:00','18:00']);
 assert.equal(hourSlots('2026-10-20',now)[0].time,'13:00');
 assert.deepEqual(hourSlots('2020-01-01',now),[]);
});
test('servidor rejeita horários fracionados, fora do expediente e já passados', () => {
 const base = {name:'Cliente de Teste',phone:'47999991234',preferredDate:'2026-10-21',preferredTime:'10:00',notes:'',consent:true,requestId:randomUUID()};
 assert.deepEqual(validateBooking(base,now).errors,{});
 for(const preferredTime of ['10:30','08:00','21:00','99:00'])assert.ok(validateBooking({...base,preferredTime},now).errors.preferredTime);
 assert.ok(validateBooking({...base,preferredDate:'2026-10-25',preferredTime:'19:00'},now).errors.preferredTime);
 assert.ok(validateBooking({...base,preferredDate:'2026-10-20',preferredTime:'09:00'},now).errors.preferredTime);
});
test('migração acrescenta horário sem apagar pedidos antigos e não cria notificações retroativas',()=>{
 const dir=mkdtempSync(join(tmpdir(),'thais-migration-'));const file=join(dir,'old.sqlite');
 const old=new DatabaseSync(file);
 old.exec(`CREATE TABLE bookings (id INTEGER PRIMARY KEY, protocol TEXT, request_id TEXT, payload_hash TEXT, name TEXT, phone TEXT, preferred_date TEXT, period TEXT, notes TEXT, consent_at TEXT, consent_version TEXT, status TEXT, created_at TEXT, updated_at TEXT);
 INSERT INTO bookings VALUES(1,'TA-ANTIGO','old','hash','Pedido antigo','5547999990000','2026-10-25','tarde','','now','contact-v1','pendente','now','now');`);old.close();
 const db=openBookings(file);
 try{assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);assert.equal(db.prepare('SELECT preferred_time FROM bookings').get().preferred_time,null);assert.equal(db.prepare('SELECT count(*) AS n FROM booking_notifications').get().n,0);}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
