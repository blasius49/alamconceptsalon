// Horários informados pelo solicitante. Cada preferência ocupa uma janela de 60 minutos.
export const WEEKLY_SCHEDULE = [
  { day: 'domingo', open: '14:00', close: '19:30' },
  { day: 'segunda-feira', open: '09:00', close: '21:00' },
  { day: 'terça-feira', open: '09:00', close: '21:00' },
  { day: 'quarta-feira', open: '09:00', close: '21:00' },
  { day: 'quinta-feira', open: '09:00', close: '21:00' },
  { day: 'sexta-feira', open: '09:00', close: '21:00' },
  { day: 'sábado', open: '09:00', close: '21:00' },
];
export function salonDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}
export function dateRange(now = new Date()) {
  const min = salonDate(now); const last = new Date(`${min}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 90);
  return { min, max: last.toISOString().slice(0, 10) };
}
export function validDate(date, now = new Date()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`); const range = dateRange(now);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date >= range.min && date <= range.max;
}
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function calendarDate(date) {
  if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function daySlots(date) {
  if (!calendarDate(date)) return [];
  const schedule = WEEKLY_SCHEDULE[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const slots = [];
  for (let start = minutes(schedule.open); start + 60 <= minutes(schedule.close); start += 60)
    slots.push({ time: clock(start), label: `${clock(start)} – ${clock(start + 60)}` });
  return slots;
}
export function hourSlots(date, now = new Date()) {
  if (!validDate(date, now)) return [];
  const today = salonDate(now);
  const current = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
  const cutoff = date === today ? minutes(current) + Number(current.slice(6)) / 60 : -1;
  return daySlots(date).filter(slot => minutes(slot.time) >= cutoff);
}
