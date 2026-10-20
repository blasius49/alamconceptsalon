import { openBookings, PERIODS, STATUSES } from '../lib/bookings.mjs';
import { updateBookingStatus } from '../lib/admin.mjs';
const [command = 'listar', protocol, status] = process.argv.slice(2);
const db = openBookings();
try {
  if (command === 'listar') {
    const rows = db.prepare('SELECT protocol, name, phone, preferred_date, preferred_time, period, status, notes FROM bookings ORDER BY created_at DESC LIMIT 100').all();
    console.table(rows.map(row => ({ protocolo: row.protocol, nome: row.name, telefone: `+${row.phone}`, data_preferida: row.preferred_date, horario: row.preferred_time || PERIODS[row.period], status: row.status, observacoes: row.notes })));
    if (!rows.length) console.log('Nenhuma solicitação cadastrada.');
  } else if (command === 'status' && protocol && STATUSES.includes(status)) {
    const row = db.prepare('SELECT version FROM bookings WHERE protocol=?').get(protocol);
    const result = row ? updateBookingStatus(db,protocol,status,row.version) : {error:'not_found'};
    if (result.error) { console.error(result.error === 'unavailable' ? 'Horário bloqueado ou ocupado. Reagende antes de confirmar.' : 'Protocolo não encontrado ou alterado. Consulte novamente.'); process.exitCode = 1; }
    else console.log('Situação atualizada. Nenhuma mensagem foi enviada.');
  } else {
    console.error('Uso: npm run agendamentos -- listar\n     npm run agendamentos -- status TA-PROTOCOLO pendente|em_contato|confirmado|reagendar|concluido|cancelado');
    process.exitCode = 1;
  }
} finally { db.close(); }
