import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { migrateBookingStatuses } from './booking-status-sqlite.mjs';
import { slotTaken } from './agenda-sqlite.mjs';
import { salonDate } from './schedule.mjs';
export { dateRange } from './schedule.mjs';

export const PERIODS = { flexivel: 'Sem preferência', manha: 'Manhã', tarde: 'Tarde' };
export { STATUSES } from './booking-status.mjs';
export const databasePath = () => resolve(process.env.DATABASE_PATH || 'data/agendamentos.sqlite');

export const dateInSalon = salonDate;

export { validateBooking } from './booking-input.mjs';

export function openBookings(file = databasePath()) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY,
      protocol TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      preferred_date TEXT NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('flexivel','manha','tarde')),
      notes TEXT NOT NULL DEFAULT '',
      consent_at TEXT NOT NULL,
      consent_version TEXT NOT NULL DEFAULT 'contact-v1',
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_contato','confirmado','reagendar','concluido','cancelado')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookings_status_date ON bookings(status, preferred_date);`);
  if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'preferred_time')) db.exec('ALTER TABLE bookings ADD COLUMN preferred_time TEXT');
  if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'version')) db.exec('ALTER TABLE bookings ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  migrateBookingStatuses(db);
  db.exec(`CREATE TABLE IF NOT EXISTS booking_notifications (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
    status TEXT NOT NULL CHECK (status IN ('not_configured','queued','sending','accepted','failed','uncertain','expired')),
    provider_id TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS notifications_status ON booking_notifications(status, created_at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS slot_blocks (
    slot_date TEXT NOT NULL,slot_time TEXT NOT NULL,blocked INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(slot_date,slot_time));
    CREATE TABLE IF NOT EXISTS booking_reschedules (id INTEGER PRIMARY KEY,booking_id INTEGER NOT NULL REFERENCES bookings(id),
    from_date TEXT NOT NULL,from_time TEXT,to_date TEXT NOT NULL,to_time TEXT NOT NULL,from_status TEXT NOT NULL,to_status TEXT NOT NULL,changed_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS booking_reschedules_booking ON booking_reschedules(booking_id,id);
    CREATE INDEX IF NOT EXISTS bookings_agenda_date ON bookings(preferred_date,preferred_time);`);
  return db;
}

export function saveBooking(db, data, { notificationReady = false } = {}) {
  const hash = createHash('sha256').update(JSON.stringify({ name: data.name, phone: data.phone, preferredDate: data.preferredDate, preferredTime: data.preferredTime, period: data.period, notes: data.notes })).digest('hex');
  const protocol = `TA-${randomBytes(6).toString('hex').toUpperCase()}`;
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=db.prepare('SELECT request_id FROM bookings WHERE request_id=?').get(data.requestId);
    if(!existing && slotTaken(db,data.preferredDate,data.preferredTime)){db.exec('ROLLBACK');return {error:'unavailable'};}
    const inserted = db.prepare(`INSERT INTO bookings
      (protocol, request_id, payload_hash, name, phone, preferred_date, preferred_time, period, notes, consent_at, consent_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'contact-whatsapp-v2', ?, ?) ON CONFLICT(request_id) DO NOTHING`).run(
      protocol, data.requestId, hash, data.name, data.phone, data.preferredDate, data.preferredTime, data.period, data.notes, now, now, now);
    const row = db.prepare('SELECT id, protocol, payload_hash, created_at FROM bookings WHERE request_id=?').get(data.requestId);
    if (row.payload_hash !== hash) { db.exec('ROLLBACK'); return { conflict: true }; }
    if (inserted.changes === 1) db.prepare('INSERT INTO booking_notifications (booking_id,status,created_at,updated_at) VALUES (?,?,?,?)').run(row.id, notificationReady ? 'queued' : 'not_configured', now, now);
    const notification = db.prepare('SELECT status FROM booking_notifications WHERE booking_id=?').get(row.id);
    db.exec('COMMIT');
    return { created: inserted.changes === 1, booking: { protocol: row.protocol, status: 'recebido', createdAt: row.created_at, notification: { status: notification?.status || 'not_configured' } } };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
