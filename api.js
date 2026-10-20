// Este arquivo só entra na demonstração offline. Não é usado pelo servidor de produção.
window.THAIS_DEMO = true;
(() => {
  const originalFetch = window.fetch.bind(window);
  const key = 'thais-alam-demonstracao-v1';
  let items = [];
  try { items = JSON.parse(localStorage.getItem(key) || '[]'); if (!Array.isArray(items)) items = []; } catch { items = []; }
  for (const row of items) { row.version ||= 1; row.updatedAt ||= row.createdAt; }
  let blocks = [];
  try { blocks = JSON.parse(localStorage.getItem(key+'-blocks') || '[]'); if(!Array.isArray(blocks))blocks=[]; } catch {}
  const persistBlocks=()=>{try{localStorage.setItem(key+'-blocks',JSON.stringify(blocks));}catch{}};
  const occupied = status => ['confirmado','concluido'].includes(status);
  const taken = (date,time,except='') => blocks.some(row=>row.date===date&&row.time===time&&row.blocked)
    || items.some(row=>row.preferredDate===date&&row.preferredTime===time&&row.protocol!==except&&occupied(row.status));
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(items)); } catch {} };
  const response = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://demo.invalid');
    if (url.pathname === '/api/health') return response({ status:'demo', dateRange:dateRange(), timezone:'America/Sao_Paulo' });
    if (url.pathname === '/api/horarios') {const date=url.searchParams.get('date');return response({ slots:hourSlots(date).filter(slot=>!taken(date,slot.time)), kind:'preference' });}
    if (url.pathname === '/api/agendamentos' && options.method === 'POST') {
      const data = JSON.parse(options.body);
      const old = items.find(row => row.requestId === data.requestId);
      if (old) return response({ protocol:old.protocol, notification:{status:'demo'} });
      if(taken(data.preferredDate,data.preferredTime))return response({message:'Este horário está bloqueado ou ocupado.',errors:{preferredTime:'Escolha outro horário disponível.'}},409);
      const row = { ...data, history:[], protocol:`DEMO-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase()}`, period: Number(data.preferredTime.slice(0,2)) < 12 ? 'Manhã' : 'Tarde', phone:'55'+data.phone.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,''), status:'pendente', version:1, updatedAt:new Date().toISOString(), notification:{status:'demo'}, createdAt:new Date().toISOString() };
      items.unshift(row); persist(); window.dispatchEvent(new Event('demo-change'));
      return response({protocol:row.protocol,notification:{status:'demo'}},201);
    }
    if(url.pathname==='/api/admin/agenda') {
      const date=url.searchParams.get('date');const future=new Set(hourSlots(date).map(slot=>slot.time));
      return response({date,timezone:'America/Sao_Paulo',slots:daySlots(date).map(slot=>{
        const block=blocks.find(row=>row.date===date&&row.time===slot.time);const bookings=items.filter(row=>row.preferredDate===date&&row.preferredTime===slot.time);
        return {...slot,blocked:block?.blocked||false,reason:block?.reason||'',version:block?.version||0,
          editable:future.has(slot.time),past:date<salonDate()||(date===salonDate()&&!future.has(slot.time)),occupied:bookings.some(row=>occupied(row.status)),bookings};
      }),unslotted:items.filter(row=>row.preferredDate===date&&!daySlots(date).some(slot=>slot.time===row.preferredTime))});
    }
    if(url.pathname==='/api/admin/agenda/slot'&&options.method==='PATCH') {
      const input=JSON.parse(options.body);let block=blocks.find(row=>row.date===input.date&&row.time===input.time);
      if((block?.version||0)!==input.expectedVersion)return response({message:'Este horário foi alterado. Atualize a agenda.'},409);
      if(input.blocked&&items.some(row=>row.preferredDate===input.date&&row.preferredTime===input.time&&occupied(row.status)))return response({message:'Há um atendimento confirmado neste horário.'},409);
      if(!block){block={date:input.date,time:input.time,version:0};blocks.push(block);}
      Object.assign(block,{blocked:input.blocked,reason:input.reason,version:block.version+1});persistBlocks();
      return response({message:input.blocked?'Horário bloqueado nesta demonstração.':'Horário liberado nesta demonstração.'});
    }
    const rescheduleRoute=url.pathname.match(/^\/api\/admin\/bookings\/(DEMO-[A-F0-9]+)\/reschedule$/);
    if(rescheduleRoute&&options.method==='PATCH') {
      const input=JSON.parse(options.body);const row=items.find(item=>item.protocol===rescheduleRoute[1]);
      if(!row)return response({message:'Pedido de teste não encontrado.'},404);
      if(row.version!==input.expectedVersion)return response({message:'Este pedido foi alterado. Confira os dados atuais.',booking:row},409);
      if(taken(input.date,input.time,row.protocol))return response({message:'Este horário está bloqueado ou ocupado.'},409);
      if(!hourSlots(input.date).some(slot=>slot.time===input.time))return response({message:'Escolha um horário futuro de atendimento.'},422);
      if(row.preferredDate!==input.date||row.preferredTime!==input.time||row.status!==input.status){
        row.history||=[];row.history.push({fromDate:row.preferredDate,fromTime:row.preferredTime,toDate:input.date,toTime:input.time,changedAt:new Date().toISOString()});
        Object.assign(row,{preferredDate:input.date,preferredTime:input.time,status:input.status,version:row.version+1,updatedAt:new Date().toISOString()});persist();
      }
      return response({booking:row,message:'Reagendamento salvo nesta demonstração.'});
    }
    const statusRoute=url.pathname.match(/^\/api\/admin\/bookings\/(DEMO-[A-F0-9]+)\/status$/);
    if(statusRoute && options.method==='PATCH') {
      const input=JSON.parse(options.body);const row=items.find(item=>item.protocol===statusRoute[1]);
      if(!row)return response({message:'Pedido de teste não encontrado.'},404);
      if(!['pendente','em_contato','confirmado','reagendar','concluido','cancelado'].includes(input.status))return response({message:'Situação inválida.'},422);
      if(row.version!==input.expectedVersion)return response({message:'O pedido de teste foi alterado. Confira a situação atual.',booking:row},409);
      if(row.status!==input.status&&occupied(input.status)&&taken(row.preferredDate,row.preferredTime,row.protocol))return response({message:'Este horário está bloqueado ou ocupado. Reagende o pedido antes de confirmar.'},409);
      if(row.status!==input.status){row.status=input.status;row.version++;row.updatedAt=new Date().toISOString();persist();}
      return response({booking:row,message:'Situação atualizada apenas nesta demonstração.'});
    }
    if (url.pathname === '/api/admin/session') return response({configured:true,authenticated:true});
    if (url.pathname === '/api/admin/bookings') {
      const q=(url.searchParams.get('q')||'').toLocaleLowerCase('pt-BR');
      const status=url.searchParams.get('status');
      const page=Number(url.searchParams.get('page')||1);
      const filtered=items.filter(row=>(!status||row.status===status)&&(!q||row.name.toLocaleLowerCase('pt-BR').includes(q)||row.protocol.toLocaleLowerCase('pt-BR').includes(q)));
      const summary={pendente:0,em_contato:0,confirmado:0,reagendar:0,concluido:0,cancelado:0}; for(const row of items)if(Object.hasOwn(summary,row.status))summary[row.status]++;
      return response({items:filtered.slice((page-1)*20,page*20),total:filtered.length,page,pages:Math.ceil(filtered.length/20),summary});
    }
    return originalFetch(input, options);
  };
  document.addEventListener('click', event => {
    const link=event.target.closest('a');if(!link)return;
    if(link.href.includes('wa.me/')||link.href.startsWith('tel:')){
      event.preventDefault();alert('Demonstração: nenhuma mensagem será enviada e nenhuma ligação será feita. O texto do aviso pode ser visto nos detalhes do pedido de teste.');
    }
  });
  window.addEventListener('DOMContentLoaded',()=>{
    document.querySelector('#demo-reset').addEventListener('click',()=>{
      if(!confirm('Apagar os pedidos desta demonstração neste navegador?'))return;
      items=[];blocks=[];persist();persistBlocks();document.querySelector('#refresh-bookings').click();
    });
    window.addEventListener('hashchange',()=>{if(location.hash==='#painel')document.querySelector('#refresh-bookings').click();});
    document.addEventListener('click',event=>{
      if(!event.target.closest('#bookings-body,.agenda-client'))return;
      const name=document.querySelector('#detail-title').textContent;
      document.querySelector('#demo-message-preview').textContent=`Olá, ${name}! Recebemos sua solicitação de agendamento. Em alguns instantes, nossa equipe entrará em contato para confirmar o agendamento ou combinar um reagendamento.`;
    });
    const explain=document.createElement('a');explain.className='button';explain.href='#painel';explain.textContent='Ver meu pedido no painel de teste ↗';explain.style.marginTop='20px';document.querySelector('#booking-success').append(explain);
  });
})();
