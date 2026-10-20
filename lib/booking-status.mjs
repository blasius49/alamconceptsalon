export const STATUS_LABELS = Object.freeze({
  pendente: 'Aguardando contato',
  em_contato: 'Em contato',
  confirmado: 'Confirmado',
  reagendar: 'Reagendar',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
});
export const STATUSES = Object.freeze(Object.keys(STATUS_LABELS));
export function validStatusChange(input) {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(STATUS_LABELS,input.status) && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0);
}
