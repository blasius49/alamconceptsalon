// Migração transacional do CHECK antigo, preservando colunas, índices, gatilhos e referências.
export function migrateBookingStatuses(db) {
  const schema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'").get()?.sql;
  if(!schema || schema.includes("'confirmado'") || !/CHECK\s*\(/i.test(schema))return;
  const oldCheck=/status\s+IN\s*\(\s*'pendente'\s*,\s*'em_contato'\s*,\s*'concluido'\s*,\s*'cancelado'\s*\)/i;
  if(!oldCheck.test(schema))throw new Error('O esquema de situações local precisa de revisão antes da migração.');
  const ddl=schema.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?bookings["`]?\s*\(/i,'CREATE TABLE bookings_status_v2 (')
    .replace(oldCheck,"status IN ('pendente','em_contato','confirmado','reagendar','concluido','cancelado')");
  const columns=db.prepare('PRAGMA table_xinfo(bookings)').all().filter(column=>column.hidden===0).map(column=>'"'+column.name.replaceAll('"','""')+'"').join(',');
  const extras=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='bookings' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  const foreignKeys=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(ddl);
    db.exec(`INSERT INTO bookings_status_v2 (${columns}) SELECT ${columns} FROM bookings`);
    db.exec('DROP TABLE bookings; ALTER TABLE bookings_status_v2 RENAME TO bookings');
    for(const row of extras)db.exec(row.sql);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Referências inválidas; migração cancelada para preservar os dados.');
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  finally{db.exec(`PRAGMA foreign_keys=${foreignKeys?1:0}`);}
}
