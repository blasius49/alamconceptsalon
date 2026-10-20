export const RECEIPT_TEXT = 'Recebemos sua solicitação de agendamento. Em alguns instantes, nossa equipe entrará em contato para confirmar o agendamento ou combinar um reagendamento.';

export function whatsappSettings(env = process.env) {
  const settings = {
    enabled: env.WHATSAPP_ENABLED === 'true', token: env.WHATSAPP_ACCESS_TOKEN || '',
    phoneId: env.WHATSAPP_PHONE_NUMBER_ID || '', template: env.WHATSAPP_TEMPLATE_NAME || '',
    language: env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR', version: env.WHATSAPP_GRAPH_VERSION || 'v23.0',
  };
  settings.ready = settings.enabled && Boolean(settings.token) && /^\d+$/.test(settings.phoneId) && /^[a-z0-9_]+$/.test(settings.template) && /^[a-z]{2}(?:_[A-Z]{2})?$/.test(settings.language) && /^v\d+\.\d+$/.test(settings.version);
  return settings;
}

export function createNotifier(db, { settings = whatsappSettings(), fetchImpl = fetch, intervalMs = 3000 } = {}) {
  let timer; let running = false; let stopped = false; let activeTask;
  function recover() {
    // Uma interrupção durante o envio pode ter ocorrido depois de a Meta aceitar.
    // Não reenviar automaticamente: isso poderia duplicar a mensagem.
    db.prepare("UPDATE booking_notifications SET status='uncertain', error_code='interrupted', updated_at=? WHERE status='sending'").run(new Date().toISOString());
  }
  async function processOne() {
    if (!settings.ready || stopped) return;
    const now = new Date().toISOString();
    const oldest = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE booking_notifications SET status='expired', error_code='stale_request', updated_at=? WHERE status='queued' AND created_at < ?").run(now, oldest);
    const row = db.prepare(`SELECT n.id, b.name, b.protocol, b.phone, b.preferred_date, b.preferred_time
      FROM booking_notifications n JOIN bookings b ON b.id=n.booking_id
      WHERE n.status='queued' ORDER BY n.id LIMIT 1`).get();
    if (!row) return;
    const claim = db.prepare("UPDATE booking_notifications SET status='sending', updated_at=? WHERE id=? AND status='queued'").run(now, row.id);
    if (claim.changes !== 1) return;
    const date = row.preferred_date.split('-').reverse().join('/');
    const parameters = [row.name, row.protocol, date, row.preferred_time].map(text => ({ type: 'text', text }));
    try {
      const response = await fetchImpl(`https://graph.facebook.com/${settings.version}/${settings.phoneId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: row.phone, type: 'template', template: { name: settings.template, language: { code: settings.language }, components: [{ type: 'body', parameters }] } }),
        signal: AbortSignal.timeout(15000),
      });
      let body;
      try { body = await response.json(); } catch {
        db.prepare("UPDATE booking_notifications SET status=?, error_code=?, updated_at=? WHERE id=?").run(response.ok ? 'uncertain' : 'failed', `invalid_response_${response.status}`, new Date().toISOString(), row.id);
        return;
      }
      const id = body?.messages?.[0]?.id;
      if (response.ok && typeof id === 'string' && id) {
        db.prepare("UPDATE booking_notifications SET status='accepted', provider_id=?, error_code=NULL, updated_at=? WHERE id=?").run(id, new Date().toISOString(), row.id);
      } else {
        const code = Number.isInteger(body?.error?.code) ? `meta_${body.error.code}` : `http_${response.status}`;
        db.prepare('UPDATE booking_notifications SET status=?, error_code=?, updated_at=? WHERE id=?').run(response.ok ? 'uncertain' : 'failed', code, new Date().toISOString(), row.id);
      }
    } catch {
      db.prepare("UPDATE booking_notifications SET status='uncertain', error_code='network_or_timeout', updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    }
  }
  function kick() {
    if (running || stopped || !settings.ready) return activeTask || Promise.resolve();
    running = true;
    activeTask = processOne().catch(() => { console.error('Não foi possível processar um aviso de WhatsApp. Consulte o painel.'); }).finally(() => { running = false; });
    return activeTask;
  }
  return {
    ready: settings.ready,
    kick,
    start() { recover(); if (settings.ready) { timer = setInterval(kick, intervalMs); timer.unref(); kick(); } },
    async stop() { stopped = true; clearInterval(timer); await activeTask; },
  };
}
