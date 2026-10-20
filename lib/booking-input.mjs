import { validDate, hourSlots } from './schedule.mjs';

export function validateBooking(input, now = new Date()) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: { form: 'Envie os dados do formulário.' } };
  const text = (key) => typeof input[key] === 'string' ? input[key].trim() : '';
  const name = text('name').replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100 || /[\x00-\x1f<>]/.test(name)) errors.name = 'Informe seu nome, entre 2 e 100 caracteres.';
  const rawPhone = text('phone');
  let phone = rawPhone.replace(/\D/g, '');
  if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2);
  if (!/^[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(phone) || /[^\d\s()+.\-]/.test(rawPhone)) errors.phone = 'Informe um telefone brasileiro com DDD.';
  const preferredDate = text('preferredDate');
  if (!validDate(preferredDate, now)) errors.preferredDate = 'Escolha uma data entre hoje e os próximos 90 dias.';
  const preferredTime = text('preferredTime');
  if (!/^\d{2}:00$/.test(preferredTime) || !hourSlots(preferredDate, now).some(slot => slot.time === preferredTime)) errors.preferredTime = 'Escolha um dos horários disponíveis para preferência nesta data.';
  const period = Number(preferredTime.slice(0, 2)) < 12 ? 'manha' : 'tarde';
  const notes = text('notes');
  if (notes.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(notes)) errors.notes = 'Use no máximo 1.000 caracteres.';
  if (input.consent !== true) errors.consent = 'Autorize o uso dos dados para responder ao seu pedido.';
  const requestId = text('requestId');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) errors.form = 'Atualize a página e tente novamente.';
  return { errors, data: { name, phone: `55${phone}`, preferredDate, preferredTime, period, notes, requestId } };
}

