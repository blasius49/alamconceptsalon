import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { salonDate } from './schedule.mjs';
export { dateRange } from './schedule.mjs';

export const PERIODS = { flexivel: 'Sem preferência', manha: 'Manhã', tarde: 'Tarde' };
export const STATUSES = ['pendente', 'em_contato', 'concluido', 'cancelado'];
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
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_contato','concluido','cancelado')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookings_status_date ON bookings(status, preferred_date);`);
  if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'preferred_time')) db.exec('ALTER TABLE bookings ADD COLUMN preferred_time TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS booking_notifications (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
    status TEXT NOT NULL CHECK (status IN ('not_configured','queued','sending','accepted','failed','uncertain','expired')),
    provider_id TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS notifications_status ON booking_notifications(status, created_at);`);
  return db;
}

export function saveBooking(db, data, { notificationReady = false } = {}) {
  const hash = createHash('sha256').update(JSON.stringify({ name: data.name, phone: data.phone, preferredDate: data.preferredDate, preferredTime: data.preferredTime, period: data.period, notes: data.notes })).digest('hex');
  const protocol = `TA-${randomBytes(6).toString('hex').toUpperCase()}`;
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
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
