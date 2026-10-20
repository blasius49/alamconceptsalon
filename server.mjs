import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { dateRange, openBookings, saveBooking, validateBooking } from './lib/bookings.mjs';
import { createAdminAuth, listBookings, updateBookingStatus } from './lib/admin.mjs';
import { hourSlots, validDate, WEEKLY_SCHEDULE } from './lib/schedule.mjs';
import { validStatusChange } from './lib/booking-status.mjs';
import { calendarDate, calendarView, freeSlots, validBlock, validReschedule } from './lib/agenda.mjs';
import { agendaData, setSlotBlock, changeBooking } from './lib/agenda-sqlite.mjs';
import { createNotifier } from './lib/whatsapp.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin/', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.css', ['admin.css', 'text/css; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
]);
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJSON(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12000) throw Object.assign(new Error('Use no máximo 12 KB por pedido.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Formato do pedido inválido.'), { status: 400 }); }
}

export function createApp({ database, limit = 20, admin = {}, whatsapp = {}, publicOrigin = process.env.PUBLIC_ORIGIN } = {}) {
  const db = database || openBookings();
  const attempts = new Map();
  const adminAuth = createAdminAuth({ secureCookies: publicOrigin?.startsWith('https://') || false, ...admin });
  const notifier = createNotifier(db, whatsapp);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/admin/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
          if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { message: 'Acesse pelo domínio do site.' });
          const origin = req.headers.origin;
          const expected = publicOrigin ? new URL(publicOrigin).origin : `http://${req.headers.host}`;
          if (origin && origin !== expected) return json(res, 403, { message: 'Origem não permitida.' });
        }
        if (url.pathname === '/api/admin/session') {
          if (req.method === 'GET') return json(res, 200, { configured: adminAuth.configured, authenticated: adminAuth.authenticated(req) });
          if (req.method === 'POST') {
            if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(res, 415, { message: 'Formato inválido.' });
            const input = await readJSON(req);
            const status = adminAuth.login(req, res, input?.password);
            return json(res, status, status === 200 ? { authenticated: true } : { message: status === 429 ? 'Muitas tentativas. Aguarde 15 minutos.' : status === 503 ? 'O responsável precisa cadastrar a senha no servidor.' : 'Senha incorreta.' });
          }
          if (req.method === 'DELETE') {
            adminAuth.logout(req, res);
            return json(res, 200, { authenticated: false });
          }
          return json(res, 405, { message: 'Método não permitido.' });
        }
        if (!adminAuth.authenticated(req)) return json(res, 401, { message: 'Entre no painel para consultar as solicitações.' });
        if(url.pathname==='/api/admin/agenda' && req.method==='GET') {
          const date=url.searchParams.get('date');
          if(!calendarDate(date))return json(res,422,{message:'Escolha uma data válida.'});
          return json(res,200,calendarView(date,agendaData(db,date)));
        }
        if(url.pathname==='/api/admin/agenda/slot') {
          if(req.method!=='PATCH')return json(res,405,{message:'Método não permitido.'});
          if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')return json(res,415,{message:'Envie os dados no formato JSON.'});
          const input=await readJSON(req);
          if(!validBlock(input))return json(res,422,{message:'Escolha um horário futuro de atendimento e um motivo de até 200 caracteres.'});
          const result=setSlotBlock(db,input);
          if(result.error==='conflict')return json(res,409,{message:'Outra pessoa alterou este horário. Atualize a agenda.'});
          if(result.error==='occupied')return json(res,409,{message:'Este horário tem um atendimento confirmado ou concluído. Reagende ou cancele antes de bloquear.'});
          return json(res,200,{message:input.blocked?'Horário bloqueado no site.':'Horário liberado no site.'});
        }
        const rescheduleRoute=url.pathname.match(/^\/api\/admin\/bookings\/(TA-[A-F0-9]{12})\/reschedule$/);
        if(rescheduleRoute) {
          if(req.method!=='PATCH')return json(res,405,{message:'Método não permitido.'});
          if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')return json(res,415,{message:'Envie os dados no formato JSON.'});
          const input=await readJSON(req);
          if(!validReschedule(input))return json(res,422,{message:'Escolha uma nova data e um horário futuro de atendimento.'});
          const result=changeBooking(db,rescheduleRoute[1],input,{reschedule:true});
          if(result.error==='not_found')return json(res,404,{message:'Solicitação não encontrada.'});
          if(result.error==='conflict')return json(res,409,{message:'Outra pessoa alterou este pedido. Confira os dados atuais.',booking:result.booking});
          if(result.error==='unavailable')return json(res,409,{message:'Este horário está bloqueado ou ocupado. Escolha outro horário.'});
          return json(res,200,{...result,message:'Reagendamento salvo. Nenhuma mensagem foi enviada ao cliente.'});
        }
        const statusRoute=url.pathname.match(/^\/api\/admin\/bookings\/(TA-[A-F0-9]{12})\/status$/);
        if(statusRoute) {
          if(req.method!=='PATCH')return json(res,405,{message:'Método não permitido.'});
          if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')return json(res,415,{message:'Envie os dados no formato JSON.'});
          const input=await readJSON(req);
          if(!validStatusChange(input))return json(res,422,{message:'Escolha uma situação válida e atualize o pedido antes de salvar.'});
          const result=updateBookingStatus(db,statusRoute[1],input.status,input.expectedVersion);
          if(result.error==='not_found')return json(res,404,{message:'Solicitação não encontrada.'});
          if(result.error==='unavailable')return json(res,409,{message:'Este horário está bloqueado ou ocupado por outro cliente. Reagende o pedido antes de confirmar.'});
          if(result.error==='conflict')return json(res,409,{message:'Outra pessoa alterou este pedido. A situação atual foi carregada; confira antes de salvar novamente.',booking:result.booking});
          return json(res,200,{...result,message:'Situação salva. Nenhuma mensagem foi enviada ao cliente.'});
        }
        if (url.pathname === '/api/admin/bookings' && req.method === 'GET') {
          const result = listBookings(db, url.searchParams);
          return json(res, result.error ? 422 : 200, result);
        }
        return json(res, 404, { message: 'Página não encontrada.' });
      }
      if (url.pathname === '/api/agendamentos') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return json(res, 405, { message: 'Método não permitido.' });
        }
        // Formulários de outros sites não podem criar pedidos neste servidor.
        if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { message: 'Envie o pedido pelo site do salão.' });
        const origin = req.headers.origin;
        if (origin) {
          const originURL = new URL(origin);
          const host = (publicOrigin ? new URL(publicOrigin).host : req.headers.host);
          if (!['http:', 'https:'].includes(originURL.protocol) || originURL.host !== host) return json(res, 403, { message: 'Origem do pedido não permitida.' });
        }
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(res, 415, { message: 'Envie o pedido no formato JSON.' });
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        const attempt = attempts.get(ip) || { count: 0, until: now + 60000 };
        attempts.set(ip, attempt);
        if (++attempt.count > limit) {
          res.setHeader('Retry-After', String(Math.ceil((attempt.until - now) / 1000)));
          return json(res, 429, { message: 'Muitas tentativas. Aguarde um minuto e tente novamente.' });
        }
        const input = await readJSON(req);
        const { data, errors } = validateBooking(input);
        if (Object.keys(errors).length) return json(res, 422, { message: 'Confira os campos indicados.', errors });
        const result = saveBooking(db, data, { notificationReady: notifier.ready });
        if (result.error==='unavailable') return json(res,409,{message:'Este horário acabou de ficar indisponível. Escolha outro horário.',errors:{preferredTime:'Escolha outro horário disponível.'}});
        if (result.conflict) return json(res, 409, { message: 'Este envio já foi registrado com outros dados. Recarregue a página antes de fazer um novo pedido.' });
        notifier.kick();
        return json(res, result.created ? 201 : 200, result.booking);
      }
      if (url.pathname === '/api/horarios' && req.method === 'GET') {
        const date = url.searchParams.get('date');
        if (!validDate(date)) return json(res, 422, { message: 'Escolha uma data entre hoje e os próximos 90 dias.' });
        return json(res, 200, { date, slots: freeSlots(date,agendaData(db,date)), kind: 'preference', timezone: 'America/Sao_Paulo' });
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        db.prepare('SELECT 1').get();
        return json(res, 200, { status: 'ok', dateRange: dateRange(), timezone: 'America/Sao_Paulo', schedule: WEEKLY_SCHEDULE });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: 'Método não permitido.' });
      const file = publicFiles.get(url.pathname);
      if (!file) return json(res, 404, { message: 'Página não encontrada.' });
      const data = await readFile(path.join(root, file[0]));
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': url.pathname.startsWith('/admin') ? 'no-store' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      // Não registrar conteúdo do formulário nem expor erros do SQLite ao visitante.
      if (!error.status) console.error('Falha na requisição:', error.code || error.name);
      json(res, error.status || 500, { message: error.status ? error.message : 'Não foi possível registrar agora. Tente novamente ou fale pelo WhatsApp.' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('listening', () => notifier.start());
  server.on('close', () => { notifier.stop().finally(() => { if (!database) db.close(); }); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = createApp();
  app.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Site e agendamentos na porta ${process.env.PORT || 3000}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(() => process.exit(0)));
}
