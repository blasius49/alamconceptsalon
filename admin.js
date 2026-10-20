const loginView = document.querySelector('#login-view');
const dashboard = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const dashboardError = document.querySelector('#dashboard-error');
const password = document.querySelector('#admin-password');
const refresh = document.querySelector('#refresh-bookings');
const tbody = document.querySelector('#bookings-body');
const filterForm = document.querySelector('#filter-form');
const dialog = document.querySelector('#booking-detail');
const labels = { pendente: 'Aguardando contato', em_contato: 'Em contato', confirmado: 'Confirmado', reagendar: 'Reagendar', concluido: 'Concluído', cancelado: 'Cancelado' };
const statusForm = document.querySelector('#booking-status-form');
const statusSelect = document.querySelector('#detail-status');
const statusSave = document.querySelector('#save-booking-status');
const statusFeedback = document.querySelector('#status-feedback');
let selectedBooking = null;
let savingStatus = false;
let authenticated = false;
let pageNumber = 1;
let pages = 0;
let pending;
let search = '';
let status = '';
let fetching = false;
const notificationLabels = { queued:'Aguardando envio', sending:'Envio em processamento', accepted:'Aceito pela Meta (entrega não confirmada)', not_configured:'Não enviado — integração não configurada', failed:'Falha no envio', uncertain:'Envio não confirmado — verificar antes de reenviar', expired:'Aviso expirado — contato manual', demo:'Teste — nenhum WhatsApp enviado' };
const displayDate = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date(`${value}T12:00:00Z`));
const displayCreated = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
function phoneLabel(value) { return value.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'); }
function showLogin() {
  authenticated = false;
  pending?.abort();
  agendaRequest?.abort();
  slotsRequest?.abort();
  slotDialog.close();
  agendaSlots.replaceChildren();
  agendaSummary.textContent = '';
  document.querySelector('#agenda-unslotted').replaceChildren();
  dashboard.hidden = true;
  loginView.hidden = false;
  tbody.replaceChildren();
  dialog.close();
  selectedBooking = null;
  password.value = '';
}
function showDashboard() {
  authenticated = true;
  loginView.hidden = true;
  dashboard.hidden = false;
  document.querySelector('#dashboard-title').focus({ preventScroll: true });
  loadBookings();
  if(!agendaDate.value)agendaDate.value = todayInSalon();
  loadAgenda();
}
function renderDetail(row) {
  document.querySelector('#detail-title').textContent = row.name;
  document.querySelector('#detail-protocol').textContent = row.protocol;
  const fields = document.querySelector('#detail-fields');
  fields.replaceChildren();
  for (const [label, value] of [['Data do pedido', displayDate(row.preferredDate)], ['Horário', row.preferredTime || row.period], ['Telefone / WhatsApp', phoneLabel(row.phone)], ['Situação', labels[row.status] || row.status], ['Aviso por WhatsApp', notificationLabels[row.notification?.status] || 'Sem aviso registrado'], ['Recebido em', `${displayCreated(row.createdAt)} · Brasília`]]) {
    const group = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const definition = document.createElement('dd'); definition.textContent = value;
    group.append(term, definition); fields.append(group);
  }
  document.querySelector('#detail-notes').textContent = row.notes || 'Nenhuma observação informada.';
  document.querySelector('#detail-whatsapp').href = `https://wa.me/${row.phone}?text=${encodeURIComponent(`Olá, ${row.name}! Aqui é do Thaís Alam Concept Salon. Recebemos sua solicitação ${row.protocol} e gostaríamos de conversar sobre seu atendimento.`)}`;
  document.querySelector('#detail-reschedule-whatsapp').href = `https://wa.me/${row.phone}?text=${encodeURIComponent(`Olá, ${row.name}! Aqui é do Thaís Alam Concept Salon. Sobre o pedido ${row.protocol}, para ${displayDate(row.preferredDate)} às ${row.preferredTime}: precisamos combinar outra opção de horário. Podemos conversar?`)}`;
  const history = document.querySelector('#history-list'); history.replaceChildren();
  for (const entry of row.history || []) {
    const li = document.createElement('li');
    li.textContent = `${displayDate(entry.fromDate)} às ${entry.fromTime || 'horário não informado'} → ${displayDate(entry.toDate)} às ${entry.toTime} · atualizado em ${displayCreated(entry.changedAt)}`;
    history.append(li);
  }
  document.querySelector('#reschedule-history').hidden = !row.history?.length;
  statusSelect.value = row.status;
  statusSave.disabled = true;
}
function detail(row) {
  selectedBooking = { ...row };
  statusFeedback.textContent = '';
  statusFeedback.className = '';
  renderDetail(selectedBooking);
  resetReschedule();
  document.querySelector('#reschedule-editor').hidden = true;
  document.querySelector('#reschedule-toggle').setAttribute('aria-expanded','false');
  dialog.showModal();
}
async function loadBookings() {
  if (!authenticated) return;
  pending?.abort();
  const request = new AbortController(); pending = request;
  fetching = true;
  refresh.disabled = true;
  dashboardError.textContent = '';
  dashboard.setAttribute('aria-busy', 'true');
  const params = new URLSearchParams({ q: search, status, page: String(pageNumber) });
  try {
    const response = await fetch(`/api/admin/bookings?${params}`, { cache: 'no-store', signal: request.signal });
    if (response.status === 401) { showLogin(); loginError.textContent = 'Sua sessão terminou. Entre novamente.'; return; }
    if (!response.ok) throw new Error('Não foi possível consultar os pedidos. Tente atualizar.');
    const data = await response.json();
    pages = data.pages;
    if (pages > 0 && pageNumber > pages) { pageNumber = pages; return loadBookings(); }
    for (const [selector, value] of Object.entries({ '#stat-total': Object.values(data.summary).reduce((sum, count) => sum + count, 0), '#stat-pending': data.summary.pendente, '#stat-contact': data.summary.em_contato, '#stat-confirmed': data.summary.confirmado || 0, '#stat-reschedule': data.summary.reagendar || 0, '#stat-done': data.summary.concluido })) document.querySelector(selector).textContent = value;
    document.querySelector('#results-count').textContent = `${data.total} ${data.total === 1 ? 'solicitação encontrada' : 'solicitações encontradas'}`;
    document.querySelector('#last-update').textContent = `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())} · Brasília`;
    tbody.replaceChildren();
    for (const row of data.items) {
      const tr = document.createElement('tr');
      const client = document.createElement('td');
      const name = document.createElement('strong'); name.textContent = row.name;
      const protocol = document.createElement('small'); protocol.textContent = row.protocol; client.append(name, protocol);
      const date = document.createElement('td'); date.textContent = displayDate(row.preferredDate);
      const period = document.createElement('small'); period.textContent = row.preferredTime ? `às ${row.preferredTime}` : row.period; date.append(period);
      const phone = document.createElement('td'); phone.textContent = phoneLabel(row.phone);
      const state = document.createElement('td'); const badge = document.createElement('span');
      badge.className = `status-chip status-${Object.hasOwn(labels, row.status) ? row.status : 'pendente'}`; badge.textContent = labels[row.status] || row.status; state.append(badge);
      const action = document.createElement('td'); const button = document.createElement('button');
      button.type = 'button'; button.className = 'row-button'; button.textContent = 'Ver pedido ↗'; button.setAttribute('aria-label', `Ver pedido de ${row.name}`); button.addEventListener('click', () => detail(row)); action.append(button);
      tr.append(client, date, phone, state, action); tbody.append(tr);
    }
    document.querySelector('#table-wrap').hidden = data.items.length === 0;
    document.querySelector('#empty-state').hidden = data.items.length !== 0;
    document.querySelector('#empty-description').textContent = search || status ? 'Nenhuma solicitação corresponde aos filtros. Experimente buscar por outro nome ou protocolo.' : 'Quando alguém enviar o formulário, a solicitação aparecerá neste painel.';
    document.querySelector('#page-number').textContent = pages ? `Página ${pageNumber} de ${pages}` : '';
    document.querySelector('#previous-page').disabled = pageNumber <= 1;
    document.querySelector('#next-page').disabled = pageNumber >= pages;
  } catch (error) {
    if (error.name !== 'AbortError') dashboardError.textContent = 'Não foi possível consultar os pedidos. Confira sua conexão e clique em Atualizar pedidos.';
  } finally {
    if (pending === request) { fetching = false; refresh.disabled = false; dashboard.removeAttribute('aria-busy'); }
  }
}
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';
  const button = document.querySelector('#login-submit'); button.disabled = true;
  try {
    const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) });
    const data = await response.json();
    if (!response.ok) { loginError.textContent = data.message || 'Não foi possível entrar.'; return; }
    password.value = ''; showDashboard();
  } catch { loginError.textContent = 'Não foi possível conectar ao servidor. Tente novamente.'; }
  finally { button.disabled = false; }
});
document.querySelector('#password-toggle').addEventListener('click', event => {
  const reveal = password.type === 'password'; password.type = reveal ? 'text' : 'password';
  event.currentTarget.textContent = reveal ? 'Ocultar' : 'Mostrar'; event.currentTarget.setAttribute('aria-label', reveal ? 'Ocultar senha' : 'Mostrar senha');
});
filterForm.addEventListener('submit', event => { event.preventDefault(); search = filterForm.elements.q.value.trim(); status = filterForm.elements.status.value; pageNumber = 1; loadBookings(); });
refresh.addEventListener('click', () => {loadBookings();loadAgenda();});
document.querySelector('#previous-page').addEventListener('click', () => { if (pageNumber > 1) { pageNumber--; loadBookings(); } });
document.querySelector('#next-page').addEventListener('click', () => { if (pageNumber < pages) { pageNumber++; loadBookings(); } });
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/admin/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error('Logout');
    showLogin(); password.focus();
  } catch { dashboardError.textContent = 'Não foi possível encerrar a sessão no servidor. Confira sua conexão e tente novamente.'; }
});
dialog.querySelector('.dialog-close').addEventListener('click', () => { if (!savingStatus) dialog.close(); });
dialog.addEventListener('cancel', event => { if (savingStatus) event.preventDefault(); });
setInterval(() => { if (authenticated && !document.hidden && !fetching) {loadBookings();loadAgenda();} }, 30000);
async function init() {
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sessão indisponível');
    const data = await response.json();
    if (!data.configured) {
      document.querySelector('#setup-notice').hidden = false;
      loginForm.hidden = true;
    } else if (data.authenticated) showDashboard();
  } catch { loginError.textContent = 'Não foi possível conectar ao servidor. Recarregue a página para tentar novamente.'; }
}

statusSelect.addEventListener('change', () => {
  statusSave.disabled = savingStatus || !selectedBooking || statusSelect.value === selectedBooking.status;
  statusFeedback.textContent = '';
});
statusForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!selectedBooking || savingStatus || statusSelect.value === selectedBooking.status) return;
  saveBookingChange('status', {status:statusSelect.value}, statusFeedback);
});
async function saveBookingChange(action, payload, feedback) {
  slotsRequest?.abort();
  savingStatus = true;
  const controls = [...dialog.querySelectorAll('input,select,button')];
  const priorDisabled = controls.map(control => control.disabled);
  controls.forEach(control => {control.disabled = true;});
  dialog.setAttribute('aria-busy','true');
  feedback.textContent = 'Salvando…'; feedback.className = '';
  try {
    const response = await fetch(`/api/admin/bookings/${encodeURIComponent(selectedBooking.protocol)}/${action}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...payload,expectedVersion:selectedBooking.version}), signal:AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (response.status === 401) {showLogin(); loginError.textContent = 'Sua sessão terminou. Entre novamente.'; return;}
    if (response.status === 409 && data.booking) {
      Object.assign(selectedBooking,data.booking); renderDetail(selectedBooking); resetReschedule();
      feedback.className = 'status-error'; feedback.textContent = data.message;
      loadBookings();loadAgenda(); return;
    }
    if (!response.ok) throw new Error(data.message || 'Não foi possível salvar a alteração.');
    if (!data.booking) throw new Error('O servidor não confirmou a alteração.');
    Object.assign(selectedBooking,data.booking); renderDetail(selectedBooking);
    feedback.className = 'status-success';
    feedback.textContent = action === 'reschedule'
      ? `Reagendamento salvo${window.THAIS_DEMO?' apenas neste navegador':''}: ${displayDate(selectedBooking.preferredDate)} às ${selectedBooking.preferredTime}. ${labels[selectedBooking.status]}. Nenhuma mensagem foi enviada ao cliente.`
      : `Situação salva${window.THAIS_DEMO?' apenas neste navegador':''}: ${labels[selectedBooking.status]}. Nenhuma mensagem foi enviada ao cliente.`;
    loadBookings();loadAgenda();
  } catch (error) {
    feedback.className = 'status-error';
    feedback.textContent = ['TimeoutError','TypeError'].includes(error.name) ? 'Não foi possível confirmar a alteração. Atualize o pedido antes de tentar novamente.' : error.message;
  } finally {
    savingStatus = false; dialog.removeAttribute('aria-busy');
    controls.forEach((control,index) => {control.disabled = priorDisabled[index];});
    if(!rescheduleDate.value)rescheduleTime.disabled = true;
    statusSave.disabled = !selectedBooking || statusSelect.value === selectedBooking.status;
    updateRescheduleSave();
  }
}

// Agenda: a API autenticada fornece os clientes; o endpoint público só fornece horários livres.
const agendaDate = document.querySelector('#agenda-date');
const agendaSlots = document.querySelector('#agenda-slots');
const agendaSummary = document.querySelector('#agenda-summary');
const agendaError = document.querySelector('#agenda-error');
const slotDialog = document.querySelector('#slot-detail');
let agendaRequest;
let editingSlot = null;
let savingSlot = false;
const todayInSalon = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function element(tag,className,text) {
  const node = document.createElement(tag); if(className)node.className=className; if(text)node.textContent=text; return node;
}
function bookingButton(row) {
  const button=element('button','agenda-client',row.name); button.type='button';
  button.setAttribute('aria-label',`Ver pedido de ${row.name}`); button.addEventListener('click',()=>detail(row));
  const chip=element('span',`status-chip status-${Object.hasOwn(labels,row.status)?row.status:'pendente'}`,labels[row.status]||row.status);
  button.append(chip); return button;
}
async function loadAgenda() {
  if(!authenticated)return;
  if(!agendaDate.value || !agendaDate.validity.valid){agendaRequest?.abort();agendaSlots.replaceChildren();agendaSummary.textContent='';agendaError.textContent='Escolha uma data válida.';return;}
  agendaRequest?.abort(); const request=new AbortController(); agendaRequest=request;
  agendaError.textContent=''; agendaSlots.setAttribute('aria-busy','true');
  // Retirar ações antigas enquanto a data muda evita bloquear um horário do dia anterior.
  agendaSlots.replaceChildren(element('p','panel-footnote','Carregando agenda…'));
  agendaSummary.textContent=''; document.querySelector('#agenda-unslotted').hidden=true;
  try {
    const response=await fetch(`/api/admin/agenda?date=${encodeURIComponent(agendaDate.value)}`,{cache:'no-store',signal:request.signal});
    if(response.status===401){showLogin();loginError.textContent='Sua sessão terminou. Entre novamente.';return;}
    const data=await response.json();if(!response.ok)throw new Error(data.message||'Não foi possível carregar a agenda.');
    const occupied=data.slots.filter(slot=>slot.occupied).length;
    const blocked=data.slots.filter(slot=>slot.blocked).length;
    const available=data.slots.filter(slot=>!slot.occupied&&!slot.blocked&&!slot.past).length;
    agendaSummary.textContent=`${displayDate(data.date)} · ${available} disponíveis · ${occupied} ocupados · ${blocked} bloqueados`;
    agendaSlots.replaceChildren();
    for(const slot of data.slots) {
      const row=element('article',`agenda-slot${slot.blocked?' is-blocked':''}${slot.occupied?' is-occupied':''}${slot.past?' is-past':''}`);
      const time=element('div','agenda-time',slot.time); time.append(element('small','',slot.label.split(' – ')[1]));
      const content=element('div','agenda-slot-content');
      const state=slot.blocked?'Indisponível':slot.occupied?'Ocupado':slot.past?'Horário encerrado':!slot.editable?'Fora do período de agendamento':'Disponível';
      content.append(element('span','agenda-state',state));
      if(slot.reason && slot.blocked)content.append(element('p','agenda-reason',slot.reason));
      for(const booking of slot.bookings)content.append(bookingButton(booking));
      if(slot.bookings.filter(b=>['confirmado','concluido'].includes(b.status)).length>1)content.append(element('p','status-error','Há mais de um atendimento neste horário. Confira e reagende os pedidos.'));
      const action=element('div','agenda-slot-action');
      if(slot.editable&&!slot.occupied) {
        const button=element('button','row-button',slot.blocked?'Disponibilizar':'Bloquear');button.type='button';
        button.setAttribute('aria-label',`${slot.blocked?'Disponibilizar':'Bloquear'} ${slot.time}`);
        button.addEventListener('click',()=>editSlot({...slot,date:data.date}));action.append(button);
      }
      row.append(time,content,action);agendaSlots.append(row);
    }
    const unslotted=document.querySelector('#agenda-unslotted');unslotted.replaceChildren();
    if(data.unslotted?.length){unslotted.hidden=false;unslotted.append(element('h3','','Pedidos fora dos horários atuais'));for(const booking of data.unslotted)unslotted.append(bookingButton(booking));}
  }catch(error){if(error.name!=='AbortError'){agendaError.textContent=error.message;agendaSlots.replaceChildren();}}
  finally{if(agendaRequest===request){agendaSlots.removeAttribute('aria-busy');}}
}
function editSlot(slot) {
  editingSlot=slot;
  document.querySelector('#slot-title').textContent=slot.blocked?'Disponibilizar horário':'Bloquear horário';
  document.querySelector('#slot-description').textContent=`${displayDate(slot.date)} · ${slot.label}`;
  document.querySelector('#slot-reason').value=slot.reason;
  document.querySelector('#slot-reason').disabled=slot.blocked;
  document.querySelector('#save-slot').textContent=slot.blocked?'Liberar no site':'Bloquear no site';
  document.querySelector('#slot-feedback').textContent='';
  slotDialog.showModal();
}
document.querySelector('#slot-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!editingSlot||savingSlot)return;
  const slot={...editingSlot};savingSlot=true;
  const button=document.querySelector('#save-slot');button.disabled=true;
  const feedback=document.querySelector('#slot-feedback');feedback.textContent='Salvando…';feedback.className='';
  try{
    const response=await fetch('/api/admin/agenda/slot',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:slot.date,time:slot.time,blocked:!slot.blocked,reason:slot.blocked?'':document.querySelector('#slot-reason').value.trim(),expectedVersion:slot.version}),signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(response.status===401){showLogin();loginError.textContent='Sua sessão terminou. Entre novamente.';return;}
    if(!response.ok)throw new Error(data.message||'Não foi possível salvar o horário.');
    slotDialog.close();await loadAgenda();agendaSummary.textContent+=` · ${data.message}`;
  }catch(error){feedback.className='status-error';feedback.textContent=['TimeoutError','TypeError'].includes(error.name)?'Não foi possível confirmar a mudança. Feche e atualize a agenda antes de tentar novamente.':error.message;}
  finally{savingSlot=false;button.disabled=false;}
});
slotDialog.querySelector('.dialog-close').addEventListener('click',()=>{if(!savingSlot)slotDialog.close();});
slotDialog.addEventListener('cancel',event=>{if(savingSlot)event.preventDefault();});
agendaDate.addEventListener('change',loadAgenda);
function moveDay(amount){const date=new Date(`${agendaDate.value||todayInSalon()}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);agendaDate.value=date.toISOString().slice(0,10);loadAgenda();}
document.querySelector('#agenda-previous').addEventListener('click',()=>moveDay(-1));
document.querySelector('#agenda-next').addEventListener('click',()=>moveDay(1));
document.querySelector('#agenda-today').addEventListener('click',()=>{agendaDate.value=todayInSalon();loadAgenda();});
for(const name of ['agenda','requests'])document.querySelector(`#tab-${name}`).addEventListener('click',()=>{
  for(const tab of ['agenda','requests']){document.querySelector(`#${tab}-view`).hidden=tab!==name;document.querySelector(`#tab-${tab}`).classList.toggle('active',tab===name);document.querySelector(`#tab-${tab}`).setAttribute('aria-pressed',String(tab===name));}
});

const rescheduleDate=document.querySelector('#reschedule-date');
const rescheduleTime=document.querySelector('#reschedule-time');
const rescheduleFeedback=document.querySelector('#reschedule-feedback');
let slotsRequest;
function resetReschedule(){
  slotsRequest?.abort();
  const min=todayInSalon();const max=new Date(`${min}T12:00:00Z`);max.setUTCDate(max.getUTCDate()+90);
  rescheduleDate.min=min;rescheduleDate.max=max.toISOString().slice(0,10);rescheduleDate.value='';
  rescheduleTime.replaceChildren(new Option('Escolha a data',''));rescheduleTime.disabled=true;
  document.querySelector('#reschedule-status').value='confirmado';
  rescheduleFeedback.textContent='';document.querySelector('#reschedule-retry').hidden=true;updateRescheduleSave();
}
function updateRescheduleSave(){document.querySelector('#save-reschedule').disabled=savingStatus||rescheduleTime.disabled||!rescheduleTime.value||!rescheduleDate.validity.valid;}
function openReschedule(){document.querySelector('#reschedule-editor').hidden=false;document.querySelector('#reschedule-toggle').setAttribute('aria-expanded','true');}
document.querySelector('#reschedule-toggle').addEventListener('click',()=>{openReschedule();rescheduleDate.focus();});
document.querySelector('#detail-reschedule-whatsapp').addEventListener('click',openReschedule);
async function loadRescheduleTimes(){
  slotsRequest?.abort();const request=new AbortController();slotsRequest=request;
  const retry=document.querySelector('#reschedule-retry');retry.hidden=true;rescheduleFeedback.textContent='';
  rescheduleTime.disabled=true;rescheduleTime.replaceChildren(new Option('Carregando horários…',''));updateRescheduleSave();
  if(!rescheduleDate.value||!rescheduleDate.validity.valid){rescheduleTime.replaceChildren(new Option('Escolha uma data válida',''));return;}
  try{
    // A agenda autenticada permite manter o próprio horário e exclui todos os outros clientes confirmados.
    const response=await fetch(`/api/admin/agenda?date=${encodeURIComponent(rescheduleDate.value)}`,{cache:'no-store',signal:request.signal});
    if(response.status===401){showLogin();loginError.textContent='Sua sessão terminou. Entre novamente.';return;}
    const data=await response.json();if(!response.ok)throw new Error(data.message||'Não foi possível consultar horários.');
    const slots=data.slots.filter(slot=>slot.editable&&!slot.past&&!slot.blocked&&!slot.bookings.some(row=>row.protocol!==selectedBooking?.protocol&&['confirmado','concluido'].includes(row.status)));
    rescheduleTime.replaceChildren(new Option(slots.length?'Selecione um horário':'Sem horários disponíveis',''));
    for(const slot of slots)rescheduleTime.add(new Option(slot.label,slot.time));
    rescheduleTime.disabled=!slots.length;
    if(!slots.length){rescheduleFeedback.className='status-error';rescheduleFeedback.textContent='Escolha outra data. Não há horários disponíveis neste dia.';}
  }catch(error){if(error.name!=='AbortError'){rescheduleTime.replaceChildren(new Option('Falha ao carregar',''));rescheduleFeedback.className='status-error';rescheduleFeedback.textContent=error.message;retry.hidden=false;}}
  finally{if(slotsRequest===request)updateRescheduleSave();}
}
rescheduleDate.addEventListener('change',loadRescheduleTimes);
rescheduleTime.addEventListener('change',updateRescheduleSave);
document.querySelector('#reschedule-retry').addEventListener('click',loadRescheduleTimes);
document.querySelector('#reschedule-form').addEventListener('submit',event=>{
  event.preventDefault();if(savingStatus||!selectedBooking||rescheduleTime.disabled||!rescheduleTime.value)return;
  saveBookingChange('reschedule',{date:rescheduleDate.value,time:rescheduleTime.value,status:document.querySelector('#reschedule-status').value},rescheduleFeedback);
});

init();
