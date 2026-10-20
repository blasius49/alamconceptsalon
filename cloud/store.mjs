import { createHash, randomBytes } from 'node:crypto';

export class SupabaseStore {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    this.url = (env.SUPABASE_URL || '').replace(/\/$/, '');
    this.key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
    this.fetch = fetchImpl;
    this.configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(this.url) && (this.key.startsWith('sb_secret_') || this.key.startsWith('eyJ'));
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
  createSession(tokenHash, version, expires) { return this.rpc('salon_session_create', { p_token_hash: tokenHash, p_password_version: version, p_expires_at: expires }); }
  sessionValid(tokenHash, version) { return this.rpc('salon_session_valid', { p_token_hash: tokenHash, p_password_version: version }); }
  revokeSession(tokenHash) { return this.rpc('salon_session_revoke', { p_token_hash: tokenHash }); }
  claimNotification() { return this.rpc('salon_claim_notification'); }
  finishNotification(id, result) { return this.rpc('salon_finish_notification', { p_id: id, p_status: result.status, p_provider_id: result.providerId || null, p_error_code: result.errorCode || null }); }
}
