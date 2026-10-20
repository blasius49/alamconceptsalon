import { createHash, randomBytes } from 'node:crypto';

export class SupabaseStore {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    const rawUrl = (env.SUPABASE_URL || '').trim();
    this.url = '';
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) && !parsed.port && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && /^\/(?:rest\/v1\/?)?$/.test(parsed.pathname)) this.url = parsed.origin;
    } catch { /* A resposta de diagnóstico identifica somente o formato, sem expor valores. */ }
    this.key = (env.SUPABASE_SECRET_KEY || '').trim() || (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    this.fetch = fetchImpl;
    this.configuration = {
      supabaseUrl: !rawUrl ? 'missing' : this.url ? 'ok' : 'invalid',
      supabaseKey: !this.key ? 'missing' : (this.key.startsWith('sb_secret_') || this.key.startsWith('eyJ')) ? 'ok' : 'invalid',
    };
    this.configured = this.configuration.supabaseUrl === 'ok' && this.configuration.supabaseKey === 'ok';
  }
  async rpc(name, args = {}) {
    if (!this.configured) throw Object.assign(new Error('Configure o banco na hospedagem para receber solicitações.'), { status: 503 });
    try {
      const headers = { apikey: this.key, 'Content-Type': 'application/json' };
      // Chaves novas sb_secret_ vão somente em apikey; não são JWTs.
      if (this.key.startsWith('eyJ')) headers.Authorization = `Bearer ${this.key}`;
      const response = await this.fetch(`${this.url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('database_response');
      return await response.json();
    } catch {
      throw Object.assign(new Error('O banco está indisponível. Tente novamente em instantes.'), { status: 503 });
    }
  }
  health() { return this.rpc('salon_health'); }
  rateLimit(keyHash, limit, seconds) { return this.rpc('salon_rate_limit', { p_key_hash: keyHash, p_limit: limit, p_window_seconds: seconds }); }
  createBooking(data, notificationReady) {
    const payloadHash = createHash('sha256').update(JSON.stringify({ name: data.name, phone: data.phone, preferredDate: data.preferredDate, preferredTime: data.preferredTime, notes: data.notes })).digest('hex');
    return this.rpc('salon_create_booking', { p_booking: { ...data, consent: true }, p_payload_hash: payloadHash, p_protocol: `TA-${randomBytes(6).toString('hex').toUpperCase()}`, p_notification_ready: notificationReady });
  }
  listBookings(q, status, page) { return this.rpc('salon_list_bookings', { p_q: q, p_status: status, p_page: page }); }
  updateBookingStatus(protocol,status,expectedVersion) { return this.rpc('salon_update_booking_status',{p_protocol:protocol,p_status:status,p_expected_version:expectedVersion}); }
  availability(date) { return this.rpc('salon_availability', {p_date:date}); }
  agenda(date) { return this.rpc('salon_agenda', {p_date:date}); }
  setSlotBlock(input) { return this.rpc('salon_set_slot_block', {p_date:input.date,p_time:input.time,p_blocked:input.blocked,p_reason:input.reason.trim(),p_expected_version:input.expectedVersion}); }
  rescheduleBooking(protocol,input) { return this.rpc('salon_reschedule_booking', {p_protocol:protocol,p_date:input.date,p_time:input.time,p_status:input.status,p_expected_version:input.expectedVersion}); }
  createSession(tokenHash, version, expires) { return this.rpc('salon_session_create', { p_token_hash: tokenHash, p_password_version: version, p_expires_at: expires }); }
  sessionValid(tokenHash, version) { return this.rpc('salon_session_valid', { p_token_hash: tokenHash, p_password_version: version }); }
  revokeSession(tokenHash) { return this.rpc('salon_session_revoke', { p_token_hash: tokenHash }); }
  claimNotification() { return this.rpc('salon_claim_notification'); }
  finishNotification(id, result) { return this.rpc('salon_finish_notification', { p_id: id, p_status: result.status, p_provider_id: result.providerId || null, p_error_code: result.errorCode || null }); }
}
