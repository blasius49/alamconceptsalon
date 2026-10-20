import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dateRange } from '../lib/schedule.mjs';
import { validateBooking } from '../lib/booking-input.mjs';
import { runNotifications } from '../cloud/notifications.mjs';
import { postgresFixture } from './helpers-postgres.mjs';
const whatsEnv={WHATSAPP_ENABLED:'true',WHATSAPP_ACCESS_TOKEN:'token-ficticio-dos-testes',WHATSAPP_PHONE_NUMBER_ID:'123456',WHATSAPP_TEMPLATE_NAME:'aviso_agendamento',WHATSAPP_TEMPLATE_LANGUAGE:'pt_BR'};
async function add(f,ready=true){const {data}=validateBooking({name:'TESTE cliente',phone:'47999990000',preferredDate:dateRange().max,preferredTime:'15:00',notes:'Teste isolado',consent:true,requestId:randomUUID()});return f.store.createBooking(data,ready);}

test('fila em Postgres envia uma vez e mantém aceitação distinta de entrega',async()=>{
 const f=await postgresFixture();try{
  const booking=await add(f);let calls=0;
  const send=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.to,'5547999990000');assert.equal(body.template.components[0].parameters[1].text,booking.booking.protocol);return new Response(JSON.stringify({messages:[{id:'wamid.test'}]}));};
  await runNotifications(f.store,{env:whatsEnv,fetchImpl:send});await runNotifications(f.store,{env:whatsEnv,fetchImpl:send});
  assert.equal(calls,1);assert.equal((await f.store.listBookings('', '',1)).items[0].notification.status,'accepted');
 }finally{await f.close();}
});
test('sem configuração não há envio e mensagens ambíguas ou antigas não são repetidas',async()=>{
 const f=await postgresFixture();try{
  await add(f,false);let calls=0;const mock=async()=>{calls++;throw new Error('timeout simulado');};
  await runNotifications(f.store,{env:{},fetchImpl:mock});assert.equal(calls,0);
  await add(f,true);await runNotifications(f.store,{env:whatsEnv,fetchImpl:mock});await runNotifications(f.store,{env:whatsEnv,fetchImpl:mock});assert.equal(calls,1);
  const rows=(await f.store.listBookings('','',1)).items;assert.equal(rows.find(row=>row.notification.status==='uncertain').notification.errorCode,'network_or_timeout');
  await add(f,true);await f.db.exec("UPDATE salon_notifications SET created_at=now()-interval '2 hours' WHERE status='queued'");await runNotifications(f.store,{env:whatsEnv,fetchImpl:mock});assert.equal(calls,1);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM salon_notifications WHERE status='expired'")).rows[0].n,1);
 }finally{await f.close();}
});
