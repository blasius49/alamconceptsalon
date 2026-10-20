import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { changeBooking, bookingJSON } from './agenda-sqlite.mjs';
import { databasePath, PERIODS, STATUSES } from './bookings.mjs';

export const adminAuthPath = () => process.env.ADMIN_AUTH_FILE || join(dirname(databasePath()), 'admin-auth.json');
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Escolha uma senha com 12 a 256 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return { version: 1, salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
export function loadAuthFile(file = adminAuthPath()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.version !== 1 || !/^[a-f0-9]{32}$/.test(data.salt) || !/^[a-f0-9]{128}$/.test(data.hash)) throw new Error('Arquivo de autenticação inválido.');
    return data;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function createAdminAuth({ password = process.env.ADMIN_PASSWORD, authFile = adminAuthPath(), secureCookies = process.env.PUBLIC_ORIGIN?.startsWith('https://') || false } = {}) {
  const credential = password ? hashPassword(password) : loadAuthFile(authFile);
  const sessions = new Map();
  const attempts = new Map();
  const lifetime = 8 * 60 * 60 * 1000;
  const cookie = (token, maxAge) => `thais_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  function clean() {
    const now = Date.now();
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  }
  function tokenFrom(req) { return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('thais_admin='))?.slice('thais_admin='.length); }
  return {
    configured: Boolean(credential),
    authenticated(req) { clean(); return (sessions.get(tokenFrom(req)) || 0) > Date.now(); },
    login(req, res, password) {
      clean();
      const ip = req.socket.remoteAddress;
      const state = attempts.get(ip) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
      if (state.count >= 5) {
        res.setHeader('Retry-After', String(Math.ceil((state.until - Date.now()) / 1000)));
        return 429;
      }
      if (!credential) return 503;
      if (typeof password !== 'string' || password.length > 256 || !timingSafeEqual(scryptSync(password, credential.salt, 64), Buffer.from(credential.hash, 'hex'))) {
        state.count++;
        attempts.set(ip, state);
        return 401;
      }
      attempts.delete(ip);
      // A entrada substitui somente a sessão deste navegador.
      sessions.delete(tokenFrom(req));
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + lifetime);
      res.setHeader('Set-Cookie', cookie(token, lifetime / 1000));
      return 200;
    },
    logout(req, res) { sessions.delete(tokenFrom(req)); res.setHeader('Set-Cookie', cookie('', 0)); },
  };
}

export function listBookings(db, params) {
  const status = params.get('status') || '';
  const search = (params.get('q') || '').trim();
  const page = Number(params.get('page') || 1);
  if ((status && !STATUSES.includes(status)) || search.length > 100 || !Number.isInteger(page) || page < 1 || page > 100000) return { error: 'Filtro inválido.' };
  const where = [];
  const values = [];
  if (status) { where.push('status = ?'); values.push(status); }
  if (search) {
    where.push("(name LIKE ? ESCAPE '\\' OR protocol LIKE ? ESCAPE '\\')");
    const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    values.push(term, term);
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT count(*) AS total FROM bookings${clause}`).get(...values).total;
  const rows = db.prepare(`SELECT protocol, name, phone, preferred_date, preferred_time, period, notes, status, created_at, updated_at, version FROM bookings${clause} ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?`).all(...values, (page - 1) * 20);
  const summary = Object.fromEntries(STATUSES.map(status => [status, 0]));
  for (const row of db.prepare('SELECT status, count(*) AS total FROM bookings GROUP BY status').all()) summary[row.status] = row.total;
  return {
    items: rows.map(row => ({...bookingJSON(db,row.protocol),period:PERIODS[row.period]})),
    total, page, pages: Math.ceil(total / 20), summary,
  };
}

export function updateBookingStatus(db,protocol,status,expectedVersion) {
  return changeBooking(db,protocol,{status,expectedVersion});
}
