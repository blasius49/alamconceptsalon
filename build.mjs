import { mkdir, copyFile } from 'node:fs/promises';
// O backend e o banco persistente são necessários para receber agendamentos.
// Copiamos apenas código; dados pessoais nunca entram no pacote de publicação.
const files = ['index.html', 'style.css', 'script.js', 'server.mjs', 'package.json', 'README.md', '.env.example', 'scripts/build-demo.mjs', 'demo/api.js', 'build.mjs', 'lib/bookings.mjs', 'lib/booking-input.mjs', 'lib/booking-status.mjs', 'lib/booking-status-sqlite.mjs', 'lib/admin.mjs', 'lib/agenda.mjs', 'lib/agenda-sqlite.mjs', 'lib/schedule.mjs', 'lib/whatsapp.mjs', 'tests/whatsapp.test.mjs', 'tests/schedule.test.mjs', 'admin.html', 'admin.css', 'admin.js', 'scripts/admin-setup.mjs', 'tests/admin.test.mjs', 'scripts/bookings.mjs', 'tests/bookings.test.mjs'];
for (const dir of ['dist', 'dist/lib', 'dist/scripts', 'dist/tests', 'dist/demo']) await mkdir(dir, { recursive: true });
for (const file of files) await copyFile(file, 'dist/' + file);
console.log('Aplicação gerada em dist/. Execute com Node.js 24+ e um volume persistente para DATABASE_PATH.');
