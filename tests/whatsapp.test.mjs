import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openBookings, dateRange, validateBooking, saveBooking } from '../lib/bookings.mjs';
import { createNotifier } from '../lib/whatsapp.mjs';
const settings = {ready:true,enabled:true,token:'test-token-not-a-real-credential',phoneId:'123456',template:'solicitacao_agendamento_recebida',language:'pt_BR',version:'v23.0'};
function fixture(ready=true) {
 const db=openBookings(':memory:');
 const data=validateBooking({name:'Cliente de Teste',phone:'47999990000',preferredDate:dateRange().max,preferredTime:'15:00',notes:'Dados fictícios.',consent:true,requestId:randomUUID()}).data;
 const result=saveBooking(db,data,{notificationReady:ready});return {db,data,result};
}
test('sem integração configurada o pedido fica salvo e não ocorre qualquer envio',async()=>{
 const {db}=fixture(false);let calls=0;
 const worker=createNotifier(db,{settings:{ready:false},fetchImpl:async()=>{calls++;throw new Error('Não deve enviar');}});
 try{worker.start();await worker.kick();assert.equal(calls,0);assert.equal(db.prepare('SELECT status FROM booking_notifications').get().status,'not_configured');assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);}finally{await worker.stop();db.close();}
});
test('template oficial inclui cliente, protocolo, data e horário e só é enviado uma vez',async()=>{
 const {db,data,result}=fixture();let calls=0;let body;
 const worker=createNotifier(db,{settings,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://graph.facebook.com/v23.0/123456/messages');body=JSON.parse(options.body);return new Response(JSON.stringify({messages:[{id:'wamid.test'}]}),{status:200});
 }});
 try{await worker.kick();await worker.kick();assert.equal(calls,1);assert.equal(body.to,'5547999990000');assert.equal(body.type,'template');assert.equal(body.template.components[0].parameters[1].text,result.booking.protocol);assert.equal(body.template.components[0].parameters[3].text,'15:00');assert.equal(db.prepare('SELECT status FROM booking_notifications').get().status,'accepted');
  saveBooking(db,data,{notificationReady:true});await worker.kick();assert.equal(calls,1);
 }finally{await worker.stop();db.close();}
});
test('erro da Meta e falha ambígua ficam registrados sem apagar o pedido nem reenviar',async()=>{
 for(const [fetchImpl,expected] of [[async()=>new Response(JSON.stringify({error:{code:132001}}),{status:400}),'failed'],[async()=>{throw new Error('timeout');},'uncertain']]) {
  const {db}=fixture();let calls=0;const worker=createNotifier(db,{settings,fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
  try{await worker.kick();await worker.kick();assert.equal(calls,1);assert.equal(db.prepare('SELECT status FROM booking_notifications').get().status,expected);assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);}finally{await worker.stop();db.close();}
 }
});
test('reinício não duplica envio interrompido nem envia aviso de solicitação muito antiga',async()=>{
 const {db}=fixture();db.prepare("UPDATE booking_notifications SET status='sending'").run();let calls=0;
 const worker=createNotifier(db,{settings,intervalMs:60000,fetchImpl:async()=>{calls++;}});
 try{worker.start();await worker.kick();assert.equal(calls,0);assert.equal(db.prepare('SELECT status FROM booking_notifications').get().status,'uncertain');db.prepare("UPDATE booking_notifications SET status='queued',created_at='2020-01-01'").run();await worker.kick();assert.equal(calls,0);assert.equal(db.prepare('SELECT status FROM booking_notifications').get().status,'expired');}finally{await worker.stop();db.close();}
});
