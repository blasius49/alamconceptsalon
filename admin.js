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
const labels = { pendente: 'Aguardando contato', em_contato: 'Em contato', concluido: 'Concluído', cancelado: 'Cancelado' };
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
  dashboard.hidden = true;
  loginView.hidden = false;
  tbody.replaceChildren();
  dialog.close();
  password.value = '';
}
function showDashboard() {
  authenticated = true;
  loginView.hidden = true;
  dashboard.hidden = false;
  document.querySelector('#dashboard-title').focus({ preventScroll: true });
  loadBookings();
}
function detail(row) {
  document.querySelector('#detail-title').textContent = row.name;
  document.querySelector('#detail-protocol').textContent = row.protocol;
  const fields = document.querySelector('#detail-fields');
  fields.replaceChildren();
  for (const [label, value] of [['Data de preferência', displayDate(row.preferredDate)], ['Horário de preferência', row.preferredTime || row.period], ['Telefone / WhatsApp', phoneLabel(row.phone)], ['Situação', labels[row.status] || row.status], ['Aviso por WhatsApp', notificationLabels[row.notification?.status] || 'Sem aviso registrado'], ['Recebido em', `${displayCreated(row.createdAt)} · Brasília`]]) {
    const group = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const definition = document.createElement('dd'); definition.textContent = value;
    group.append(term, definition); fields.append(group);
  }
  document.querySelector('#detail-notes').textContent = row.notes || 'Nenhuma observação informada.';
  document.querySelector('#detail-whatsapp').href = `https://wa.me/${row.phone}?text=${encodeURIComponent(`Olá, ${row.name}! Aqui é do Thaís Alam Concept Salon. Recebemos sua solicitação ${row.protocol} e gostaríamos de conversar sobre seu atendimento.`)}`;
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
    for (const [selector, value] of Object.entries({ '#stat-total': Object.values(data.summary).reduce((sum, count) => sum + count, 0), '#stat-pending': data.summary.pendente, '#stat-contact': data.summary.em_contato, '#stat-done': data.summary.concluido })) document.querySelector(selector).textContent = value;
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
refresh.addEventListener('click', () => loadBookings());
document.querySelector('#previous-page').addEventListener('click', () => { if (pageNumber > 1) { pageNumber--; loadBookings(); } });
document.querySelector('#next-page').addEventListener('click', () => { if (pageNumber < pages) { pageNumber++; loadBookings(); } });
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/admin/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error('Logout');
    showLogin(); password.focus();
  } catch { dashboardError.textContent = 'Não foi possível encerrar a sessão no servidor. Confira sua conexão e tente novamente.'; }
});
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
setInterval(() => { if (authenticated && !document.hidden && !fetching) loadBookings(); }, 30000);
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
init();
