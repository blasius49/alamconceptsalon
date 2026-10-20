import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SupabaseStore } from './store.mjs';
import { validateBooking } from '../lib/booking-input.mjs';
import { dateRange, hourSlots, validDate, WEEKLY_SCHEDULE } from '../lib/schedule.mjs';
import { whatsappSettings } from '../lib/whatsapp.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',...extra,
} });
const failure = (message, status) => Object.assign(new Error(message), { status });
async function readJSON(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw failure('Envie os dados no formato JSON.',415);
  if (Number(request.headers.get('content-length')) > 12000) throw failure('Pedido maior que o limite permitido.',413);
  const chunks=[]; let size=0;
  if (request.body) for await (const chunk of request.body) { size+=chunk.length; if(size>12000)throw failure('Pedido maior que o limite permitido.',413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('Formato do pedido inválido.',400); }
}
const tokenFrom = request => request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('thais_admin='))?.slice('thais_admin='.length) || '';

export function createCloudHandler({ env = process.env, store = new SupabaseStore({env}), now = () => new Date() } = {}) {
  const password = env.ADMIN_PASSWORD || '';
  const configuredAdmin = store.configured && password.length >= 12 && password.length <= 256;
  const credential = configuredAdmin ? scryptSync(password,'thais-netlify-admin-v1',64) : null;
  const version = credential ? hash(credential) : '';
  const ipSecret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || 'unconfigured';
  const notificationsReady = whatsappSettings(env).ready;
  async function authenticated(request) {
    const token = tokenFrom(request);
    return Boolean(configuredAdmin && /^[a-f0-9]{64}$/.test(token) && await store.sessionValid(hash(token),version));
  }
  async function checkRate(scope, context, limit, seconds) {
    // context.ip vem da plataforma; não confiar em X-Forwarded-For enviado pelo cliente.
    const key = createHmac('sha256',ipSecret).update(`${scope}\0${context.ip || 'unknown'}`).digest('hex');
    return store.rateLimit(key,limit,seconds);
  }
  return async function handle(request, context = {}) {
    try {
      const url = new URL(request.url);
      let path = url.pathname;
      if (path.startsWith('/.netlify/functions/api/')) path = '/api/' + path.slice('/.netlify/functions/api/'.length);
      const expected = new URL(env.PUBLIC_ORIGIN || env.DEPLOY_PRIME_URL || env.URL || url.origin).origin;
      if (!['GET','HEAD'].includes(request.method)) {
        if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== expected)) return reply({message:'Envie o pedido pelo domínio do site.'},403);
      }
      const cookie = (token,maxAge) => `thais_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${expected.startsWith('https://')?'; Secure':''}`;
      if (path === '/api/horarios' && request.method === 'GET') {
        const date=url.searchParams.get('date');
        if(!validDate(date,now()))return reply({message:'Escolha uma data entre hoje e os próximos 90 dias.'},422);
        return reply({date,slots:hourSlots(date,now()),kind:'preference',timezone:'America/Sao_Paulo'});
      }
      if (path === '/api/health' && request.method === 'GET') {
        const schedule={dateRange:dateRange(now()),schedule:WEEKLY_SCHEDULE,timezone:'America/Sao_Paulo'};
        if(!store.configured)return reply({status:'unconfigured',message:'Configure o Supabase na hospedagem para receber pedidos.',...schedule},503);
        const health = await store.health();
        if(health?.status !== 'ok' || health?.tableAvailable !== true)throw failure('Crie as tabelas do projeto com o SQL fornecido antes de receber pedidos.',503);
        return reply({status:'ok',backend:'netlify-supabase',...schedule});
      }
      if (path === '/api/admin/session') {
        if(request.method==='GET')return reply({configured:configuredAdmin,authenticated:await authenticated(request)});
        if(request.method==='POST') {
          if(!configuredAdmin)return reply({message:'Configure o banco e a senha da equipe na hospedagem.'},503);
          const input=await readJSON(request);
          const limit=await checkRate('admin-login',context,5,900);
          if(!limit.allowed)return reply({message:'Muitas tentativas. Aguarde antes de tentar novamente.'},429,{'Retry-After':String(limit.retryAfter)});
          const candidate=typeof input?.password==='string' && input.password.length<=256 ? input.password : '';
          if(!timingSafeEqual(scryptSync(candidate,'thais-netlify-admin-v1',64),credential))return reply({message:'Senha incorreta.'},401);
          const previous=tokenFrom(request);if(/^[a-f0-9]{64}$/.test(previous))await store.revokeSession(hash(previous));
          const token=randomBytes(32).toString('hex');
          await store.createSession(hash(token),version,new Date(now().getTime()+8*3600000).toISOString());
          return reply({authenticated:true},200,{'Set-Cookie':cookie(token,8*3600)});
        }
        if(request.method==='DELETE') {
          const token=tokenFrom(request);if(store.configured && /^[a-f0-9]{64}$/.test(token))await store.revokeSession(hash(token));
          return reply({authenticated:false},200,{'Set-Cookie':cookie('',0)});
        }
        return reply({message:'Método não permitido.'},405,{Allow:'GET, POST, DELETE'});
      }
      if(path==='/api/admin/bookings') {
        if(!await authenticated(request))return reply({message:'Entre no painel para consultar as solicitações.'},401);
        if(request.method!=='GET')return reply({message:'Método não permitido.'},405);
        const q=(url.searchParams.get('q')||'').trim(); const status=url.searchParams.get('status')||''; const page=Number(url.searchParams.get('page')||1);
        if(q.length>100 || !['','pendente','em_contato','concluido','cancelado'].includes(status) || !Number.isInteger(page) || page<1 || page>100000)return reply({message:'Filtro inválido.'},422);
        return reply(await store.listBookings(q,status,page));
      }
      if(path==='/api/agendamentos') {
        if(request.method!=='POST')return reply({message:'Método não permitido.'},405,{Allow:'POST'});
        if(!store.configured)return reply({message:'O agendamento online ainda está sendo configurado. Fale com a equipe pelo WhatsApp.'},503);
        const input=await readJSON(request);
        const limit=await checkRate('booking',context,20,60);
        if(!limit.allowed)return reply({message:'Muitas tentativas. Aguarde um minuto e tente novamente.'},429,{'Retry-After':String(limit.retryAfter)});
        const {data,errors}=validateBooking(input,now());
        if(Object.keys(errors).length)return reply({message:'Confira os campos indicados.',errors},422);
        const result=await store.createBooking(data,notificationsReady);
        if(result.conflict)return reply({message:'Este envio já foi registrado com outros dados. Recarregue a página antes de fazer um novo pedido.'},409);
        return reply(result.booking,result.created?201:200);
      }
      return reply({message:'Página não encontrada.'},404);
    } catch(error) {
      if(!error.status)console.error('Falha na função de agendamentos:',error.name);
      return reply({message:error.status?error.message:'Não foi possível processar agora. Tente novamente em instantes.'},error.status||500);
    }
  };
}
