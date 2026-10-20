const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#navigation');
function closeMenu() {
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Abrir menu');
  toggle.textContent = '☰';
  nav.classList.remove('open');
}
toggle.addEventListener('click', () => {
  if (toggle.getAttribute('aria-expanded') === 'true') return closeMenu();
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-label', 'Fechar menu');
  toggle.textContent = '×';
  nav.classList.add('open');
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav.classList.contains('open')) { closeMenu(); toggle.focus(); }
});
const message = encodeURIComponent('Olá! Conheci o Thaís Alam Concept Salon pelo site e gostaria de saber mais sobre os serviços e agendar um horário.');
document.querySelectorAll('[data-whatsapp]').forEach(link => { link.href = `https://wa.me/5547991155556?text=${message}`; });
document.querySelector('#year').textContent = new Date().getFullYear();

// As abas têm URLs compartilháveis e respeitam Voltar/Avançar do navegador.
function route({ focus = false } = {}) {
  const hash = location.hash.slice(1);
  const page = ['galeria', 'agendamento'].includes(hash) ? hash : 'inicio';
  document.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== page; });
  document.querySelectorAll('[data-nav]').forEach(link => {
    const active = link.dataset.nav === (hash === 'localizacao' ? hash : page);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  document.title = `${page === 'galeria' ? 'Galeria — ' : page === 'agendamento' ? 'Agendamento — ' : ''}Thaís Alam — Concept Salon em Blumenau`;
  if (focus && page !== 'inicio') {
    document.querySelector(`[data-view="${page}"] h1`).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (page === 'inicio' && hash) {
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  }
}
window.addEventListener('hashchange', () => route({ focus: true }));
route();

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  const filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  let count = 0;
  document.querySelectorAll('.gallery-grid figure').forEach(figure => {
    figure.hidden = filter !== 'todos' && figure.dataset.category !== filter;
    if (!figure.hidden) count++;
  });
  document.querySelector('#gallery-count').textContent = `${count} inspirações`;
}));
const dialog = document.querySelector('#gallery-dialog');
const dialogImage = document.querySelector('#dialog-image');
const dialogImageError = document.querySelector('#dialog-image-error');
dialogImage.addEventListener('error', () => { dialogImage.hidden = true; dialogImageError.hidden = false; });
dialogImage.addEventListener('load', () => { dialogImage.hidden = false; dialogImageError.hidden = true; });
document.querySelectorAll('.gallery-photo').forEach(button => {
  const image = button.querySelector('img');
  const markFailed = () => image.classList.add('failed');
  image.addEventListener('error', markFailed);
  if (image.complete && !image.naturalWidth) markFailed();
  button.addEventListener('click', () => {
    const enlarged = dialogImage;
    enlarged.hidden = false;
    dialogImageError.hidden = true;
    enlarged.src = image.src;
    enlarged.alt = image.alt;
    document.querySelector('#dialog-caption').textContent = button.closest('figure').querySelector('figcaption').firstChild.textContent.trim();
    dialog.showModal();
  });
});
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog && (event.offsetX < 0 || event.offsetX > dialog.clientWidth || event.offsetY < 0 || event.offsetY > dialog.clientHeight)) dialog.close(); });

const form = document.querySelector('#booking-form');
const dateInput = form.elements.preferredDate;
const submit = document.querySelector('#booking-submit');
const feedback = document.querySelector('#form-feedback');
const fields = ['name', 'phone', 'preferredDate', 'preferredTime', 'notes', 'consent'];
const timeInput = form.elements.preferredTime;
let attempt = null;
let sending = false;
function newRequestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16));
}
function applyDates(range) { dateInput.min = range.min; dateInput.max = range.max; }
const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const today = ['year','month','day'].map(key => dateParts.find(part => part.type === key).value).join('-');
const last = new Date(`${today}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 90);
applyDates({ min: today, max: last.toISOString().slice(0, 10) });
if (location.protocol === 'file:' && !window.THAIS_DEMO) {
  document.querySelector('#booking-offline').hidden = false;
  submit.disabled = true;
} else {
  fetch('/api/health').then(response => response.ok ? response.json() : null).then(data => { if (data?.dateRange) applyDates(data.dateRange); }).catch(() => {});
}
form.elements.notes.addEventListener('input', () => { document.querySelector('#notes-count').textContent = `${form.elements.notes.value.length}/1000`; });
fields.forEach(key => form.elements[key].addEventListener('input', () => {
  document.getElementById(`${key}-error`).textContent = '';
  form.elements[key].removeAttribute('aria-invalid');
}));
function showErrors(errors) {
  fields.forEach(key => {
    document.getElementById(`${key}-error`).textContent = errors[key] || '';
    if (errors[key]) form.elements[key].setAttribute('aria-invalid', 'true'); else form.elements[key].removeAttribute('aria-invalid');
  });
  const first = fields.find(key => errors[key]);
  if (first) form.elements[first].focus();
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || (location.protocol === 'file:' && !window.THAIS_DEMO)) return;
  feedback.textContent = '';
  const payload = {
    name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(),
    preferredDate: dateInput.value, preferredTime: timeInput.value,
    notes: form.elements.notes.value.trim(), consent: form.elements.consent.checked,
  };
  const errors = {};
  if (payload.name.length < 2 || payload.name.length > 100) errors.name = 'Informe seu nome, com pelo menos 2 caracteres.';
  let digits = payload.phone.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (!/^[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(digits)) errors.phone = 'Informe um telefone brasileiro com DDD.';
  if (!payload.preferredDate || payload.preferredDate < dateInput.min || payload.preferredDate > dateInput.max) errors.preferredDate = 'Escolha uma data entre hoje e os próximos 90 dias.';
  if (!payload.preferredTime || timeInput.disabled) errors.preferredTime = 'Escolha um horário para a data selecionada.';
  if (!payload.consent) errors.consent = 'Autorize o contato para enviar a solicitação.';
  showErrors(errors);
  if (Object.keys(errors).length) return;
  const fingerprint = JSON.stringify(payload);
  if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, requestId: newRequestId() };
  sending = true;
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  form.querySelector('.submit-label').textContent = 'Enviando seu pedido…';
  try {
    const response = await fetch('/api/agendamentos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, requestId: attempt.requestId }), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) {
      showErrors(result.errors || {});
      feedback.textContent = result.message || 'Não foi possível enviar. Tente novamente.';
      if (response.status === 409 && result.errors?.preferredTime) await loadTimes();
      if (!result.errors) feedback.focus();
      return;
    }
    if (!result.protocol) throw new Error('Resposta sem protocolo');
    document.querySelector('#booking-protocol').textContent = result.protocol;
    const readableDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long' }).format(new Date(`${payload.preferredDate}T12:00:00Z`));
    document.querySelector('#booking-summary').textContent = `Preferência: ${readableDate} às ${payload.preferredTime}.`;
    const notifications = { queued: 'Aviso de recebimento aguardando envio pelo WhatsApp.', accepted: 'O aviso foi aceito pelo WhatsApp para envio. A entrega ainda não foi confirmada.', not_configured: 'O aviso automático por WhatsApp ainda não está disponível. Guarde o seu protocolo.', failed: 'O pedido está salvo, mas o aviso de WhatsApp não pôde ser enviado.', uncertain: 'O pedido está salvo. Não foi possível confirmar o envio do aviso.', expired: 'O pedido está salvo. Entre em contato com a equipe pelo WhatsApp.', demo: 'Demonstração: nenhum WhatsApp foi enviado. Abra o painel de teste para ver o pedido.' };
    document.querySelector('#booking-notification').textContent = notifications[result.notification?.status] || 'Seu pedido está salvo. Guarde o protocolo.';
    document.querySelector('#booking-followup').href = `https://wa.me/5547991155556?text=${encodeURIComponent(`Olá! Fiz uma solicitação pelo site. Meu protocolo é ${result.protocol}. Gostaria de combinar meu atendimento.`)}`;
    document.querySelector('#booking-form-area').hidden = true;
    const success = document.querySelector('#booking-success');
    success.hidden = false;
    success.focus();
    form.reset();
    timeInput.replaceChildren(new Option('Escolha uma data primeiro', ''));
    timeInput.disabled = true;
    attempt = null;
  } catch {
    feedback.textContent = 'Não conseguimos confirmar o envio. Confira sua conexão e tente novamente: repetir este envio não duplica seu pedido. Você também pode conversar pelo WhatsApp.';
    feedback.focus();
  } finally {
    sending = false;
    submit.disabled = false;
    form.removeAttribute('aria-busy');
    form.querySelector('.submit-label').textContent = 'Enviar solicitação';
  }
});
document.querySelector('#new-booking').addEventListener('click', () => {
  document.querySelector('#booking-success').hidden = true;
  document.querySelector('#booking-form-area').hidden = false;
  document.querySelector('#notes-count').textContent = '0/1000';
  feedback.textContent = '';
  showErrors({});
  form.elements.name.focus();
});

let timesRequest;
async function loadTimes() {
  timesRequest?.abort();
  const request = new AbortController(); timesRequest = request;
  const retry = document.querySelector('#retry-times'); retry.hidden = true;
  timeInput.disabled = true;
  timeInput.replaceChildren(new Option(dateInput.value ? 'Carregando horários…' : 'Escolha uma data primeiro', ''));
  if (!dateInput.value) return;
  try {
    const response = await fetch(`/api/horarios?date=${encodeURIComponent(dateInput.value)}`, { signal: request.signal });
    const data = await response.json();
    if (!response.ok) throw new Error('Horários indisponíveis');
    timeInput.replaceChildren(new Option(data.slots.length ? 'Selecione um horário' : 'Sem horários de preferência nesta data', ''));
    for (const slot of data.slots) timeInput.add(new Option(slot.label, slot.time));
    timeInput.disabled = !data.slots.length;
    document.querySelector('#preferredTime-error').textContent = data.slots.length ? '' : 'Escolha outra data. Não há horários restantes para este dia.';
  } catch (error) {
    if (error.name === 'AbortError') return;
    timeInput.replaceChildren(new Option('Não foi possível carregar', ''));
    document.querySelector('#preferredTime-error').textContent = 'Confira sua conexão e tente carregar os horários novamente.';
    retry.hidden = false;
  }
}
dateInput.addEventListener('change', loadTimes);
document.querySelector('#retry-times').addEventListener('click', loadTimes);
