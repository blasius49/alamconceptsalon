import { calendarDate, daySlots, hourSlots, validDate, salonDate } from './schedule.mjs';
export const occupiesSlot = status => ['pendente', 'em_contato', 'confirmado', 'concluido'].includes(status);
export function validReschedule(input, now = new Date()) {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input)
    && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0
    && ['confirmado', 'em_contato', 'reagendar'].includes(input.status)
    && validDate(input.date, now) && hourSlots(input.date, now).some(slot => slot.time === input.time));
}
export function validBlock(input, now = new Date()) {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input)
    && validDate(input.date, now) && hourSlots(input.date, now).some(slot => slot.time === input.time)
    && typeof input.blocked === 'boolean' && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0
    && typeof input.reason === 'string' && input.reason.trim().length <= 200);
}
export function calendarView(date, data, now = new Date()) {
  const future = new Set(hourSlots(date, now).map(slot => slot.time));
  return { date, timezone: 'America/Sao_Paulo', slots: daySlots(date).map(slot => {
    const block = data.blocks.find(row => row.time === slot.time);
    const bookings = data.bookings.filter(row => row.preferredTime === slot.time);
    return { ...slot, blocked: block?.blocked || false, reason: block?.reason || '', version: block?.version || 0,
      past: date < salonDate(now) || (date === salonDate(now) && !future.has(slot.time)), editable: future.has(slot.time), occupied: bookings.some(row => occupiesSlot(row.status)), bookings };
  }), unslotted: data.bookings.filter(row => !daySlots(date).some(slot => slot.time === row.preferredTime)) };
}
export function freeSlots(date, data, now = new Date(), excludeProtocol = '') {
  return hourSlots(date, now).filter(slot => !data.blocks.some(row => row.time === slot.time && row.blocked)
    && !data.bookings.some(row => row.preferredTime === slot.time && row.protocol !== excludeProtocol && occupiesSlot(row.status)));
}
export { calendarDate };
