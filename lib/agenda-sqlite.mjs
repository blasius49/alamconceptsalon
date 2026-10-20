import { occupiesSlot } from './agenda.mjs';
import { STATUSES } from './booking-status.mjs';
export function slotTaken(db,date,time,except='') {
  return Boolean(db.prepare('SELECT 1 FROM slot_blocks WHERE slot_date=? AND slot_time=? AND blocked=1').get(date,time)
    || db.prepare("SELECT 1 FROM bookings WHERE preferred_date=? AND preferred_time=? AND status IN ('confirmado','concluido') AND protocol<>?").get(date,time,except));
}
export function bookingJSON(db,protocol) {
  const row=db.prepare(`SELECT protocol,name,phone,preferred_date AS preferredDate,preferred_time AS preferredTime,period,notes,status,created_at AS createdAt,updated_at AS updatedAt,version,id FROM bookings WHERE protocol=?`).get(protocol);
  if(!row)return null;
  row.notification=db.prepare('SELECT status,error_code AS errorCode FROM booking_notifications WHERE booking_id=?').get(row.id)||{status:'not_configured'};
  row.history=db.prepare('SELECT from_date AS fromDate,from_time AS fromTime,to_date AS toDate,to_time AS toTime,changed_at AS changedAt FROM booking_reschedules WHERE booking_id=? ORDER BY id').all(row.id);
  delete row.id; return row;
}
export function agendaData(db,date) {
  return {blocks:db.prepare('SELECT slot_time AS time,blocked,reason,version FROM slot_blocks WHERE slot_date=?').all(date).map(row=>({...row,blocked:Boolean(row.blocked)})),
    bookings:db.prepare('SELECT protocol FROM bookings WHERE preferred_date=? ORDER BY preferred_time,created_at').all(date).map(row=>bookingJSON(db,row.protocol))};
}
export function setSlotBlock(db,input) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current=db.prepare('SELECT version FROM slot_blocks WHERE slot_date=? AND slot_time=?').get(input.date,input.time);
    if((current?.version||0)!==input.expectedVersion){db.exec('ROLLBACK');return {error:'conflict'};}
    if(input.blocked && db.prepare("SELECT 1 FROM bookings WHERE preferred_date=? AND preferred_time=? AND status IN ('confirmado','concluido')").get(input.date,input.time)){db.exec('ROLLBACK');return {error:'occupied'};}
    db.prepare(`INSERT INTO slot_blocks(slot_date,slot_time,blocked,reason,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(slot_date,slot_time) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,version=slot_blocks.version+1,updated_at=excluded.updated_at`).run(input.date,input.time,Number(input.blocked),input.reason.trim(),new Date().toISOString());
    db.exec('COMMIT');return {ok:true};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function changeBooking(db,protocol,input,{reschedule=false}={}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current=bookingJSON(db,protocol);
    const fail=error=>{db.exec('ROLLBACK');return {error,...(error==='conflict'?{booking:current}:{})};};
    if(!current)return fail('not_found');
    if(current.version!==input.expectedVersion)return fail('conflict');
    if(!STATUSES.includes(input.status))return fail('invalid_status');
    const date=reschedule?input.date:current.preferredDate;const time=reschedule?input.time:current.preferredTime;
    if((reschedule||occupiesSlot(input.status)) && (current.status!==input.status||reschedule) && slotTaken(db,date,time,protocol))return fail('unavailable');
    if(current.status!==input.status||date!==current.preferredDate||time!==current.preferredTime) {
      const now=new Date().toISOString();
      if(reschedule)db.prepare(`INSERT INTO booking_reschedules(booking_id,from_date,from_time,to_date,to_time,from_status,to_status,changed_at) VALUES((SELECT id FROM bookings WHERE protocol=?),?,?,?,?,?,?,?)`).run(protocol,current.preferredDate,current.preferredTime,date,time,current.status,input.status,now);
      db.prepare("UPDATE bookings SET status=?,preferred_date=?,preferred_time=?,period=?,version=version+1,updated_at=? WHERE protocol=?").run(input.status,date,time,Number(time?.slice(0,2))<12?'manha':'tarde',now,protocol);
    }
    const booking=bookingJSON(db,protocol);db.exec('COMMIT');return {booking};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
