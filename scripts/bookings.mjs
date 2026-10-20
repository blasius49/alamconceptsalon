import { openBookings, PERIODS, STATUSES } from '../lib/bookings.mjs';
const [command = 'listar', protocol, status] = process.argv.slice(2);
const db = openBookings();
try {
  if (command === 'listar') {
    const rows = db.prepare('SELECT protocol, name, phone, preferred_date, preferred_time, period, status, notes FROM bookings ORDER BY created_at DESC LIMIT 100').all();
    console.table(rows.map(row => ({ protocolo: row.protocol, nome: row.name, telefone: `+${row.phone}`, data_preferida: row.preferred_date, horario: row.preferred_time || PERIODS[row.period], status: row.status, observacoes: row.notes })));
    if (!rows.length) console.log('Nenhuma solicitação cadastrada.');
  } else if (command === 'status' && protocol && STATUSES.includes(status)) {
    const result = db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE protocol=?').run(status, new Date().toISOString(), protocol);
    if (!result.changes) { console.error('Protocolo não encontrado.'); process.exitCode = 1; }
    else console.log('Status atualizado. Isso não envia mensagens nem confirma horário automaticamente.');
  } else {
    console.error('Uso: npm run agendamentos -- listar\n     npm run agendamentos -- status TA-PROTOCOLO pendente|em_contato|concluido|cancelado');
    process.exitCode = 1;
  }
} finally { db.close(); }
