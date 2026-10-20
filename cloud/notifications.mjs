import { whatsappSettings } from '../lib/whatsapp.mjs';

export async function runNotifications(store, { env = process.env, fetchImpl = fetch, max = 2 } = {}) {
  const settings = whatsappSettings(env);
  if (!settings.ready || !store.configured) return { processed: 0, enabled: false };
  let processed = 0;
  for (let n = 0; n < max; n++) {
    const row = await store.claimNotification();
    if (!row) break;
    let result;
    try {
      const parameters = [row.name, row.protocol, row.preferred_date.split('-').reverse().join('/'), row.preferred_time].map(text => ({ type: 'text', text }));
      const response = await fetchImpl(`https://graph.facebook.com/${settings.version}/${settings.phoneId}/messages`, {
        method:'POST', headers:{Authorization:`Bearer ${settings.token}`,'Content-Type':'application/json'},
        body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:row.phone,type:'template',template:{name:settings.template,language:{code:settings.language},components:[{type:'body',parameters}]}}),
        signal:AbortSignal.timeout(8000),
      });
      let body;
      try { body = await response.json(); } catch { body = {}; }
      const id = body?.messages?.[0]?.id;
      if (response.ok && typeof id === 'string' && id) result = {status:'accepted',providerId:id};
      else result = {status:response.ok?'uncertain':'failed',errorCode:Number.isInteger(body?.error?.code)?`meta_${body.error.code}`:`http_${response.status}`};
    } catch { result = {status:'uncertain',errorCode:'network_or_timeout'}; }
    // Se esta gravação falhar, a próxima execução considera o envio incerto; não o repete.
    await store.finishNotification(row.id,result);
    processed++;
  }
  return {processed,enabled:true};
}
