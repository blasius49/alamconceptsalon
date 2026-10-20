import { SupabaseStore } from '../../cloud/store.mjs';
import { runNotifications } from '../../cloud/notifications.mjs';

// Scheduled Functions são executadas pela Netlify no deploy de produção.
// Não dependemos de processos em memória ou de setInterval entre invocações.
export default async () => {
  const result = await runNotifications(new SupabaseStore(), { max: 1 });
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
};
export const config = { schedule: '* * * * *' };
